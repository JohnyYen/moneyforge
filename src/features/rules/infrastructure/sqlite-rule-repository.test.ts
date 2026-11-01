import { migrations } from '@/shared/persistence/migrations';
import { runMigrations } from '@/shared/persistence/migrator';
import { createNodeSqliteDriver } from '@/shared/persistence/node-sqlite-driver';
import type { SqlDriver } from '@/shared/persistence/sql-driver';

import type { RuleRepository } from '../application/ports';
import type { InboxItem } from '../domain/inbox-item';
import type { Rule } from '../domain/rule';
import { createSqliteRuleRepository } from './sqlite-rule-repository';

const HUGE = 123456789012345678901234567890n;

const rule: Rule = {
  id: 'r1',
  sourceId: 's1',
  name: 'Income',
  priority: 3,
  template: 'Got {amount}',
  format: { decimal: ',', thousands: '' },
  kind: 'transfer_out',
  accountId: 'a',
  categoryId: null,
  counterpartAccountId: 'b',
  currencyCode: 'DAI',
  autoPost: true,
  splitMode: 'none',
  splitStructureId: null,
  samples: ['Got 1', 'Got "2"'],
};

const item: InboxItem = {
  id: 'i1',
  sourceId: 's1',
  ruleId: 'r1',
  status: 'proposed',
  channel: 'paste',
  receivedAt: '2026-03-10T12:00:00.000Z',
  body: 'Got 1',
  bodyHash: 'hash',
  referenceKey: 'REF',
  note: 'A note',
  kind: 'transfer_out',
  accountId: 'a',
  categoryId: null,
  counterpartAccountId: 'b',
  amountMinor: HUGE,
  currencyCode: 'DAI',
  reference: 'ref',
  counterparty: 'Acme',
  balance: '-1.50',
  description: 'Acme',
  autoPost: true,
  splitMode: 'none',
  splitStructureId: null,
  splitRequested: false,
  pairItemId: null,
  transactionId: null,
};

describe('sqlite rule repository', () => {
  let driver: SqlDriver;
  let repository: RuleRepository;

  beforeEach(async () => {
    driver = createNodeSqliteDriver();
    await runMigrations(driver, migrations);
    repository = createSqliteRuleRepository(driver);
    await driver.exec(`
      INSERT INTO currencies (code, name, decimals, symbol, kind)
        VALUES ('DAI', 'Dai', 18, 'DAI', 'stablecoin');
      INSERT INTO accounts (id, name, type, currency_code)
        VALUES ('a', 'A', 'Bank', 'DAI'), ('b', 'B', 'Bank', 'DAI');
      INSERT INTO transactions (id, occurred_at, kind, description)
        VALUES ('tx', '2026-03-10T12:00:00.000Z', 'transfer', '');
    `);
    await repository.saveSource({
      id: 's1',
      name: 'Bank',
      channel: 'sms',
      sender: 'bank',
      enabled: true,
    });
    await repository.saveRule(rule);
  });

  afterEach(() => driver.close());

  it('round-trips a source and finds it by sender', async () => {
    await expect(repository.findSourceBySender('bank')).resolves.toMatchObject({ id: 's1' });
    await expect(repository.findSourceBySender('other')).resolves.toBeNull();
    await repository.saveSource({
      id: 's1',
      name: 'Renamed',
      channel: 'paste',
      sender: 'bank2',
      enabled: false,
    });
    await expect(repository.getSource('s1')).resolves.toEqual({
      id: 's1',
      name: 'Renamed',
      channel: 'paste',
      sender: 'bank2',
      enabled: false,
    });
  });

  it('refuses two sources for one sender', async () => {
    await expect(
      repository.saveSource({ id: 's2', name: 'Copy', channel: 'sms', sender: 'bank', enabled: true }),
    ).rejects.toThrow(/UNIQUE/);
  });

  it('round-trips a rule with its format, flags, and samples', async () => {
    await expect(repository.getRule('r1')).resolves.toEqual(rule);
    await expect(repository.listRules('s1')).resolves.toEqual([rule]);
    await repository.saveRule({ ...rule, name: 'Changed', autoPost: false });
    await expect(repository.getRule('r1')).resolves.toMatchObject({
      name: 'Changed',
      autoPost: false,
    });
  });

  it('round-trips an item with a huge amount stored as text', async () => {
    await repository.saveItem(item);
    await expect(repository.getItem('i1')).resolves.toEqual(item);
    await expect(
      driver.get(`SELECT typeof(amount_minor) AS type FROM inbox_items`),
    ).resolves.toEqual({ type: 'text' });
  });

  it('updates an item in place', async () => {
    await repository.saveItem(item);
    await repository.saveItem({
      ...item,
      status: 'posted',
      body: null,
      transactionId: 'tx',
      note: null,
      splitRequested: true,
    });
    await expect(repository.getItem('i1')).resolves.toMatchObject({
      status: 'posted',
      body: null,
      transactionId: 'tx',
      note: null,
      splitRequested: true,
    });
  });

  it('allows one item per source and reference', async () => {
    await repository.saveItem(item);
    await expect(repository.saveItem({ ...item, id: 'i2' })).rejects.toThrow(/UNIQUE/);
    await expect(repository.findItemByReference('s1', 'REF')).resolves.toMatchObject({ id: 'i1' });
    await expect(repository.findItemByReference('s1', 'OTHER')).resolves.toBeNull();
  });

  it('finds items by body hash, whatever their status', async () => {
    await repository.saveItem({ ...item, status: 'rejected', body: null });
    await expect(repository.listItemsByBodyHash('s1', 'hash')).resolves.toHaveLength(1);
    await expect(repository.listItemsByBodyHash('s1', 'nope')).resolves.toEqual([]);
  });

  it('offers open or solo posted sides inside the time range', async () => {
    const side = {
      ...item,
      kind: 'transfer_in',
      status: 'waiting_pair',
      referenceKey: null,
    } as const;
    await repository.saveItem({ ...side, id: 'waiting' });
    await repository.saveItem({ ...side, id: 'solo', status: 'posted', body: null, transactionId: 'tx' });
    await repository.saveItem({ ...side, id: 'gone', status: 'posted', body: null });
    await repository.saveItem({ ...side, id: 'rejected', status: 'rejected', body: null });
    await repository.saveItem({ ...side, id: 'paired', pairItemId: 'waiting' });
    await repository.saveItem({ ...side, id: 'late', receivedAt: '2026-03-20T12:00:00.000Z' });
    await repository.saveItem({ ...side, id: 'other', kind: 'transfer_out' });

    const candidates = await repository.listPairCandidates(
      'transfer_in',
      '2026-03-10T00:00:00.000Z',
      '2026-03-11T00:00:00.000Z',
    );

    expect(candidates.map(({ id }) => id).sort()).toEqual(['solo', 'waiting']);
  });

  it('lists open items and posted ones with a split still wanted', async () => {
    await repository.saveItem({ ...item, referenceKey: null, id: 'open' });
    await repository.saveItem({
      ...item,
      referenceKey: null,
      id: 'wanted',
      status: 'posted',
      body: null,
      splitRequested: true,
      transactionId: 'tx',
    });
    await repository.saveItem({ ...item, referenceKey: null, id: 'done', status: 'rejected', body: null });

    const open = await repository.listOpenItems();

    expect(open.map(({ id }) => id).sort()).toEqual(['open', 'wanted']);
  });

  it('nulls the links to a deleted transaction and rule', async () => {
    await repository.saveItem({ ...item, status: 'posted', body: null, transactionId: 'tx' });
    await driver.run('DELETE FROM transactions');
    await repository.removeRule('r1');
    await expect(repository.getItem('i1')).resolves.toMatchObject({
      transactionId: null,
      ruleId: null,
      status: 'posted',
    });
  });
});
