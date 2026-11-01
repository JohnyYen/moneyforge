import { createAppServices, type AppServices } from '@/app-services/create-app-services';
import type { Account } from '@/features/ledger/domain/account';
import { migrations } from '@/shared/persistence/migrations';
import { runMigrations } from '@/shared/persistence/migrator';
import { createNodeSqliteDriver } from '@/shared/persistence/node-sqlite-driver';
import type { SqlDriver, SqlExecutor } from '@/shared/persistence/sql-driver';
import type { Result } from '@/shared/result';

import type { MessageChannel } from '../domain/message';
import type { RuleInput } from './rule-use-cases';

function unwrap<T>(result: Result<T, { code: string; message: string }>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

/** Fails any write whose SQL matches, including inside a transaction. */
function failingOn(driver: SqlDriver, pattern: RegExp): SqlExecutor {
  const wrap = (sql: SqlExecutor): SqlExecutor => ({
    exec: (text) => sql.exec(text),
    all: (text, params) => sql.all(text, params),
    get: (text, params) => sql.get(text, params),
    run: async (text, params) => {
      if (pattern.test(text)) throw new Error('disk failure');
      await sql.run(text, params);
    },
    transaction: (work) => sql.transaction((tx) => work(wrap(tx))),
  });
  return wrap(driver);
}

const NOW = '2026-03-10T12:00:00.000Z';
const hoursAfter = (hours: number) => new Date(Date.parse(NOW) + hours * 3_600_000).toISOString();
const daysAfter = (days: number) => hoursAfter(days * 24);

const SALARY = 'You received 1,500.25 USD from Acme. Ref R-1';
const SENDER = 'BankCo';

describe('rules engine', () => {
  let driver: SqlDriver;
  let services: AppServices;
  let sequence: number;
  let now: string;

  const servicesOn = (sql: SqlExecutor) =>
    createAppServices({
      driver: sql,
      clock: { now: () => new Date(now) },
      generateId: () => `id-${++sequence}`,
      generateSecret: () => 'test-secret',
    });

  const tableNames = async () =>
    (
      await driver.all<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      )
    ).map(({ name }) => name);

  /** Every row of every table, so a test can prove that nothing at all was written. */
  const snapshot = async () => {
    const rows: Record<string, unknown[]> = {};
    for (const name of await tableNames()) rows[name] = await driver.all(`SELECT * FROM ${name}`);
    return rows;
  };

  const account = async (name: string, currencyCode = 'USD') =>
    unwrap(
      await services.ledger.createAccount({
        name,
        type: 'Bank',
        currencyCode,
        openingBalance: '0',
      }),
    );

  const category = async (kind: 'income' | 'expense') => {
    const found = (await services.ledger.listCategories()).find((item) => item.kind === kind);
    if (!found) throw new Error(`No ${kind} category`);
    return found;
  };

  const source = async (sender = SENDER, channel: MessageChannel = 'sms', enabled = true) =>
    unwrap(await services.rules.createSource({ name: sender, channel, sender, enabled }));

  let checking: Account;
  let savings: Account;
  let bank: { id: string };

  const ruleInput = (over: Partial<RuleInput> = {}): RuleInput => ({
    sourceId: bank.id,
    name: 'Salary',
    priority: 0,
    template: 'You received {amount} {currency} from {counterparty}. Ref {reference}',
    format: { decimal: '.', thousands: ',' },
    kind: 'income',
    accountId: checking.id,
    categoryId: null,
    counterpartAccountId: null,
    currencyCode: null,
    autoPost: false,
    splitMode: 'none',
    splitStructureId: null,
    samples: [],
    ...over,
  });

  const rule = async (over: Partial<RuleInput> = {}) =>
    unwrap(await services.rules.createRule(ruleInput(over)));

  /** Moves the clock along, because a message is never dated after now. */
  const ingest = (
    body: string,
    over: { channel?: MessageChannel; sender?: string; receivedAt?: string } = {},
  ) => {
    const arrival = Date.parse(over.receivedAt ?? NOW);
    if (arrival > Date.parse(now)) now = new Date(arrival).toISOString();
    return services.rules.ingestMessage({
      channel: 'sms',
      sender: SENDER,
      receivedAt: NOW,
      ...over,
      body,
    });
  };

  const items = () =>
    driver.all<Record<string, string | number | null>>(
      'SELECT * FROM inbox_items ORDER BY received_at, id',
    );

  const transactions = () =>
    driver.all<{ id: string; kind: string }>('SELECT * FROM transactions ORDER BY id');

  const balanceOf = async (id: string) =>
    (await services.ledger.accountBalances()).find((item) => item.account.id === id)?.balance;

  const allPostingsBalance = async () => {
    const rows = await driver.all<{ amount: string; currency_code: string }>(
      'SELECT amount, currency_code FROM postings',
    );
    const totals: Record<string, bigint> = {};
    for (const row of rows) {
      totals[row.currency_code] = (totals[row.currency_code] ?? 0n) + BigInt(row.amount);
    }
    return Object.values(totals).every((total) => total === 0n);
  };

  beforeEach(async () => {
    driver = createNodeSqliteDriver();
    await runMigrations(driver, migrations);
    sequence = 0;
    now = NOW;
    services = servicesOn(driver);
    await services.ledger.initialize();
    unwrap(await services.ledger.setBaseCurrency('USD'));
    checking = await account('Checking');
    savings = await account('Savings');
    bank = await source();
  });

  afterEach(() => driver.close());

  describe('allowlist', () => {
    it('persists nothing at all for a sender outside the allowlist', async () => {
      await rule({ template: '{amount} USD {*}' });
      const before = await snapshot();

      await expect(ingest('100 USD paid', { sender: 'Stranger' })).resolves.toEqual({
        outcome: 'dropped',
      });

      await expect(snapshot()).resolves.toEqual(before);
      expect(Object.keys(before)).toEqual(
        expect.arrayContaining(['inbox_items', 'message_rules', 'message_sources', 'settings']),
      );
    });

    it('never holds the body of a dropped message in any table, in any column', async () => {
      await ingest('secret-from-stranger', { sender: 'Stranger' });
      const everything = JSON.stringify(await snapshot());
      expect(everything).not.toContain('secret-from-stranger');
      expect(everything).not.toContain('Stranger');
    });

    it('drops a message from a disabled source', async () => {
      const off = await source('OffBank', 'sms', false);
      await rule({ sourceId: off.id });
      const before = await snapshot();
      await expect(ingest(SALARY, { sender: 'OffBank' })).resolves.toEqual({ outcome: 'dropped' });
      await expect(snapshot()).resolves.toEqual(before);
    });

    it('does not let a paste-only source allowlist an SMS sender', async () => {
      await source('PasteOnly', 'paste');
      const before = await snapshot();
      await expect(ingest(SALARY, { sender: 'PasteOnly' })).resolves.toEqual({
        outcome: 'dropped',
      });
      await expect(snapshot()).resolves.toEqual(before);
    });

    it('does not let a paste name an unknown sender', async () => {
      const before = await snapshot();
      await expect(ingest(SALARY, { channel: 'paste', sender: 'Stranger' })).resolves.toEqual({
        outcome: 'dropped',
      });
      await expect(snapshot()).resolves.toEqual(before);
    });

    it('matches the sender exactly after normalizing', async () => {
      await expect(ingest('Hello', { sender: '  bankco ' })).resolves.toMatchObject({
        outcome: 'inbox',
      });
      await expect(ingest('Hello 2', { sender: 'BankCo2' })).resolves.toEqual({
        outcome: 'dropped',
      });
    });
  });

  describe('matched messages', () => {
    it('creates an item with the extracted fields and a proposed transaction', async () => {
      const salary = await rule();
      const result = await ingest(SALARY);

      expect(result).toMatchObject({ outcome: 'inbox', status: 'proposed' });
      await expect(transactions()).resolves.toEqual([]);
      const [item] = await items();
      expect(item).toMatchObject({
        status: 'proposed',
        rule_id: salary.id,
        amount_minor: '150025',
        currency_code: 'USD',
        counterparty: 'Acme',
        reference: 'R-1',
        kind: 'income',
        account_id: checking.id,
        description: 'Acme',
      });
    });

    it('posts at once with autoPost, through the ledger', async () => {
      const income = await category('income');
      await rule({ autoPost: true, categoryId: income.id });

      const result = await ingest(SALARY);

      expect(result).toMatchObject({ outcome: 'posted' });
      await expect(balanceOf(checking.id)).resolves.toBe(150025n);
      await expect(allPostingsBalance()).resolves.toBe(true);
      const [item] = await items();
      expect(item).toMatchObject({ status: 'posted', body: null });
      if (result.outcome !== 'posted') throw new Error('Not posted');
      await expect(services.ledger.getTransaction(result.transactionId)).resolves.toMatchObject({
        kind: 'income',
        occurredAt: NOW,
        categoryId: income.id,
      });
    });

    it('uses the time the message arrived, not the time it was read', async () => {
      await rule({ autoPost: true });
      const receivedAt = '2026-03-09T08:30:00+02:00';
      await ingest(SALARY, { receivedAt });
      const [item] = await items();
      expect(item.received_at).toBe('2026-03-09T06:30:00.000Z');
      const [{ occurred_at: occurredAt }] = await driver.all<{ occurred_at: string }>(
        'SELECT occurred_at FROM transactions',
      );
      expect(occurredAt).toBe('2026-03-09T06:30:00.000Z');
    });

    it('falls back to the clock on an unreadable arrival time', async () => {
      await ingest('Hello', { receivedAt: 'yesterday-ish' });
      expect((await items())[0].received_at).toBe(NOW);
    });

    it('leaves the item for review when the ledger refuses an automatic post', async () => {
      await rule({ autoPost: true });
      unwrap(
        await services.ledger.updateAccount({
          id: checking.id,
          name: checking.name,
          type: checking.type,
          openingBalance: '0',
          archived: true,
        }),
      );

      await expect(ingest(SALARY)).resolves.toMatchObject({ outcome: 'inbox', status: 'proposed' });

      await expect(transactions()).resolves.toEqual([]);
      const [item] = await items();
      expect(item.note).toContain('archived');
      expect(item.body).toBe(SALARY);
    });

    it('picks among several matching rules by priority', async () => {
      await rule({ name: 'Low', priority: 1 });
      const high = await rule({ name: 'High', priority: 5, accountId: savings.id });
      await ingest(SALARY);
      expect((await items())[0]).toMatchObject({ rule_id: high.id, account_id: savings.id });
    });

    it('only uses rules of the source that sent the message', async () => {
      const other = await source('OtherBank');
      await rule({ sourceId: other.id });
      await ingest(SALARY);
      expect((await items())[0]).toMatchObject({ status: 'unmatched', rule_id: null });
    });
  });

  describe('messages with no rule', () => {
    it('keeps an allowlisted message as unmatched, so a rule can be built from it', async () => {
      await expect(ingest('Something new')).resolves.toMatchObject({
        outcome: 'inbox',
        status: 'unmatched',
      });
      expect((await items())[0]).toMatchObject({ status: 'unmatched', body: 'Something new' });
    });

    it.each([
      'Your OTP is 482913',
      'Your verification code is 991122',
      '482913',
      'Tu código de verificación es 123456',
    ])('stores nothing in any form for %j', async (body) => {
      const before = await snapshot();
      await expect(ingest(body)).resolves.toEqual({ outcome: 'one-time-code' });
      await expect(snapshot()).resolves.toEqual(before);
    });

    it('sends an unreadable amount to the inbox as unmatched, without guessing', async () => {
      await rule({ autoPost: true });
      await expect(ingest('You received 1.500,25 USD from Acme. Ref R-2')).resolves.toMatchObject({
        status: 'unmatched',
      });
      await expect(transactions()).resolves.toEqual([]);
      const [item] = await items();
      expect(item).toMatchObject({ status: 'unmatched', amount_minor: null, kind: null });
      expect(item.note).toContain('1.500,25');
    });

    it('never records an amount in the wrong currency', async () => {
      await rule({ autoPost: true });
      await ingest('You received 50.00 EUR from Acme. Ref R-3');
      await expect(transactions()).resolves.toEqual([]);
      expect((await items())[0].status).toBe('unmatched');
    });

    it('never matches a message over the limit and does not store its body', async () => {
      await rule({ template: 'Got {amount} {*}', autoPost: true });
      const body = `Got 5 ${'x'.repeat(3000)}`;
      await ingest(body);
      await expect(transactions()).resolves.toEqual([]);
      const [item] = await items();
      expect(item).toMatchObject({ status: 'unmatched', body: null });
      expect(item.note).toContain('2000');
      expect(JSON.stringify(await snapshot())).not.toContain('xxxxx');
    });

    it('does not let two long messages share a fingerprint through a common prefix', async () => {
      const prefix = 'x'.repeat(2000);
      await ingest(`${prefix} first`);
      await ingest(`${prefix} second`);
      const [first, second] = await items();
      expect(first.body_hash).not.toBe(second.body_hash);
      expect(second.note).not.toMatch(/possible repeat/i);
    });
  });

  describe('retention', () => {
    it('erases the raw body when an item is approved', async () => {
      await rule();
      await ingest(SALARY);
      const [{ id }] = await items();
      unwrap(await services.rules.approveItem(String(id)));
      expect((await items())[0]).toMatchObject({ status: 'posted', body: null });
      expect(JSON.stringify(await snapshot())).not.toContain(SALARY);
    });

    it('erases the raw body when an item is rejected', async () => {
      await ingest('Something new');
      const [{ id }] = await items();
      unwrap(await services.rules.rejectItem(String(id)));
      expect((await items())[0]).toMatchObject({ status: 'rejected', body: null });
      expect(JSON.stringify(await snapshot())).not.toContain('Something new');
    });

    it('refuses at the database to keep a body on a resolved item', async () => {
      await ingest('Something new');
      await expect(
        driver.run(`UPDATE inbox_items SET status = 'posted'`),
      ).rejects.toThrow(/CHECK/);
    });

    it('purges unresolved items older than the default 30 days, and no younger', async () => {
      await ingest('Old message', { receivedAt: NOW });
      await ingest('Newer message', { receivedAt: hoursAfter(1) });

      await expect(services.rules.purgeExpired(new Date(daysAfter(30)))).resolves.toBe(0);
      await expect(services.rules.purgeExpired(new Date(hoursAfter(30 * 24 + 0.5)))).resolves.toBe(1);

      expect((await items()).map(({ body }) => body)).toEqual(['Newer message']);
    });

    it('follows the retention setting', async () => {
      unwrap(
        await services.rules.updateMessageSettings({
          retentionDays: 2,
          dedupWindowMinutes: 10,
          transferWindowHours: 24,
        }),
      );
      await ingest('Old message');
      await expect(services.rules.purgeExpired(new Date(daysAfter(3)))).resolves.toBe(1);
    });

    it('ignores a retention value that cannot be read', async () => {
      await driver.run(`INSERT INTO settings (key, value) VALUES ('rules.retention_days', 'soon')`);
      await ingest('Old message');
      await expect(services.rules.purgeExpired(new Date(daysAfter(29)))).resolves.toBe(0);
      await expect(services.rules.purgeExpired(new Date(daysAfter(31)))).resolves.toBe(1);
    });

    it('keeps resolved items, so a replay is still recognized after a purge', async () => {
      await rule({ autoPost: true });
      await ingest(SALARY);
      await services.rules.purgeExpired(new Date(daysAfter(400)));
      await expect(ingest(SALARY, { receivedAt: daysAfter(400) })).resolves.toEqual({
        outcome: 'duplicate',
      });
    });

    it('keeps a pair with money on it, erasing only the expired text', async () => {
      const { out, incoming } = await transferRules();
      await ingest(out('100.00', 'T1'), { receivedAt: NOW });
      await ingest(incoming('100.00', 'T2'), { receivedAt: hoursAfter(2) });
      await expect(services.rules.purgeExpired(new Date(hoursAfter(30 * 24 + 1)))).resolves.toBe(1);
      const [first, second] = await items();
      expect(first).toMatchObject({ status: 'proposed', body: null, amount_minor: '10000' });
      expect(second).toMatchObject({ status: 'proposed', pair_item_id: first.id });
      expect(second.body).not.toBeNull();
    });

    it('never discards a pending item that carries money', async () => {
      await rule();
      await ingest(SALARY);
      await expect(services.rules.purgeExpired(new Date(daysAfter(31)))).resolves.toBe(1);
      expect(await items()).toEqual([
        expect.objectContaining({ status: 'proposed', body: null, amount_minor: '150025' }),
      ]);
      unwrap(await services.rules.approveItem(String((await items())[0].id)));
      await expect(balanceOf(checking.id)).resolves.toBe(150025n);
    });

    it('keeps the dedup keys of an expired pending item, so a replay stays inert', async () => {
      await rule();
      await ingest(SALARY);
      await services.rules.purgeExpired(new Date(daysAfter(31)));
      await expect(ingest(SALARY, { receivedAt: daysAfter(31) })).resolves.toEqual({
        outcome: 'duplicate',
      });
    });

    it('counts an erased body once', async () => {
      await rule();
      await ingest(SALARY);
      await expect(services.rules.purgeExpired(new Date(daysAfter(31)))).resolves.toBe(1);
      await expect(services.rules.purgeExpired(new Date(daysAfter(32)))).resolves.toBe(0);
    });
  });

  describe('dedup', () => {
    it('treats one reference from one source as one message, whatever the text', async () => {
      await rule();
      await ingest(SALARY);
      await expect(
        ingest('You received 1,500.25 USD from Acme Corp. Ref r-1', {
          receivedAt: daysAfter(20),
        }),
      ).resolves.toEqual({ outcome: 'duplicate' });
      await expect(items()).resolves.toHaveLength(1);
    });

    it('keeps the same reference from two sources apart', async () => {
      const other = await source('OtherBank');
      await rule();
      await rule({ sourceId: other.id });
      await ingest(SALARY);
      await expect(ingest(SALARY, { sender: 'OtherBank' })).resolves.toMatchObject({
        outcome: 'inbox',
      });
      await expect(items()).resolves.toHaveLength(2);
    });

    it('creates no second item for the same message by SMS and paste', async () => {
      await rule();
      await ingest(SALARY, { channel: 'sms' });
      await expect(
        ingest(`  ${SALARY.replace(' from ', '\n from ')} `, {
          channel: 'paste',
          receivedAt: hoursAfter(3),
        }),
      ).resolves.toEqual({ outcome: 'duplicate' });
      await expect(items()).resolves.toHaveLength(1);
    });

    it('keeps a same-text repeat inside the window for review, never dropping it', async () => {
      await rule({ template: 'Paid {amount} at Shop', kind: 'expense', autoPost: true });
      await ingest('Paid 10 at Shop');
      await expect(ingest('Paid 10 at Shop', { receivedAt: hoursAfter(0.1) })).resolves.toMatchObject({
        outcome: 'inbox',
        status: 'proposed',
      });
      await expect(transactions()).resolves.toHaveLength(1);
      const [, repeat] = await items();
      expect(repeat).toMatchObject({ status: 'proposed', auto_post: 0, amount_minor: '1000' });
      expect(repeat.note).toMatch(/possible repeat/i);
      expect(repeat.note).toMatch(/10 minutes/);
    });

    it('holds a replay after the window for review instead of posting it again', async () => {
      await rule({ template: 'Paid {amount} at Shop', kind: 'expense', autoPost: true });
      await ingest('Paid 10 at Shop');
      await expect(ingest('Paid 10 at Shop', { receivedAt: daysAfter(3) })).resolves.toMatchObject({
        outcome: 'inbox',
        status: 'proposed',
      });
      await expect(transactions()).resolves.toHaveLength(1);
      const [, repeat] = await items();
      expect(repeat).toMatchObject({ status: 'proposed', auto_post: 0 });
      expect(repeat.note).toMatch(/possible repeat/i);
      expect(repeat.note).not.toMatch(/10 minutes/);
    });

    it('lets the user approve a real second movement held as a repeat', async () => {
      await rule({ template: 'Paid {amount} at Shop', kind: 'expense', autoPost: true });
      await ingest('Paid 10 at Shop');
      await ingest('Paid 10 at Shop', { receivedAt: hoursAfter(1) });
      unwrap(await services.rules.approveItem(String((await items())[1].id)));
      await expect(balanceOf(checking.id)).resolves.toBe(-2000n);
    });

    it('notes a repeat of a message no rule matched', async () => {
      await ingest('Something new');
      await ingest('Something new', { receivedAt: hoursAfter(1) });
      const [, repeat] = await items();
      expect(repeat.status).toBe('unmatched');
      expect(repeat.note).toMatch(/possible repeat/i);
    });

    it('never posts a repeat through a pairing', async () => {
      const { incoming } = await transferRules({ autoPost: true });
      await rule({
        name: 'Out, no reference',
        template: 'Moved {amount} USD to savings',
        kind: 'transfer_out',
        counterpartAccountId: savings.id,
        autoPost: true,
      });
      await ingest('Moved 100.00 USD to savings');
      await ingest(incoming('100.00', 'T2'));
      await expect(transactions()).resolves.toHaveLength(1);
      await ingest('Moved 100.00 USD to savings', { receivedAt: hoursAfter(1) });
      await ingest(incoming('100.00', 'T3'), { receivedAt: hoursAfter(1) });
      await expect(transactions()).resolves.toHaveLength(1);
      expect((await items()).filter(({ status }) => status === 'proposed')).toHaveLength(2);
    });

    it('follows the dedup window setting', async () => {
      unwrap(
        await services.rules.updateMessageSettings({
          retentionDays: 30,
          dedupWindowMinutes: 60,
          transferWindowHours: 72,
        }),
      );
      await ingest('Hello');
      await ingest('Hello', { receivedAt: hoursAfter(0.5) });
      await ingest('Hello', { receivedAt: hoursAfter(2) });
      const [, inside, outside] = await items();
      expect(inside.note).toMatch(/60 minutes/);
      expect(outside.note).toMatch(/possible repeat/i);
      expect(outside.note).not.toMatch(/60 minutes/);
    });

    it('keeps a reversal with the reference of its purchase', async () => {
      await rule({ name: 'Buy', template: 'Paid {amount} USD. Ref {reference}', kind: 'expense' });
      await rule({ name: 'Back', template: 'Reversed {amount} USD. Ref {reference}', kind: 'income' });
      await ingest('Paid 10 USD. Ref A1');
      await expect(ingest('Reversed 10 USD. Ref A1')).resolves.toMatchObject({ outcome: 'inbox' });
      await expect(items()).resolves.toHaveLength(2);
    });

    it('pairs the two sides of a transfer that share one reference', async () => {
      const { out, incoming } = await transferRules({ autoPost: true });
      await ingest(out('100.00', 'SAME'));
      await ingest(incoming('100.00', 'SAME'));
      await expect(transactions()).resolves.toHaveLength(1);
    });

    it('still recognizes a replay after the user changed the kind of its item', async () => {
      await rule();
      await ingest(SALARY);
      const [{ id }] = await items();
      unwrap(
        await services.rules.editItem(String(id), {
          kind: 'expense',
          accountId: checking.id,
          counterpartAccountId: null,
          categoryId: null,
          amount: '1500.25',
          description: 'Corrected',
        }),
      );
      await expect(ingest(SALARY, { receivedAt: daysAfter(2) })).resolves.toEqual({
        outcome: 'duplicate',
      });
    });

    it('never stores a reference in the clear as a dedup key', async () => {
      await rule();
      await ingest(SALARY);
      const [item] = await items();
      expect(item.reference_key).toMatch(/^[0-9a-f]{64}$/);
    });

    it('holds a message that first arrived before its rule existed', async () => {
      await ingest(SALARY);
      await rule({ autoPost: true });
      await expect(ingest(SALARY, { receivedAt: hoursAfter(1) })).resolves.toMatchObject({
        outcome: 'inbox',
        status: 'proposed',
      });
      await expect(transactions()).resolves.toEqual([]);
    });

    it('deduplicates two copies racing each other', async () => {
      await rule({ autoPost: true });
      const results = await Promise.all([ingest(SALARY), ingest(SALARY)]);
      expect(results.map(({ outcome }) => outcome).sort()).toEqual(['duplicate', 'posted']);
      await expect(transactions()).resolves.toHaveLength(1);
    });
  });

  describe('idempotent replay', () => {
    it('posts nothing when a message with no reference and an edited amount comes back', async () => {
      await rule({ template: 'Paid {amount} at Shop', kind: 'expense' });
      await ingest('Paid 10 at Shop');
      const [{ id }] = await items();
      unwrap(
        await services.rules.editItem(String(id), {
          kind: 'expense',
          accountId: checking.id,
          counterpartAccountId: null,
          categoryId: null,
          amount: '12',
          description: 'Shop',
        }),
      );
      unwrap(await services.rules.approveItem(String(id)));
      await expect(ingest('Paid 10 at Shop', { receivedAt: hoursAfter(1) })).resolves.toMatchObject({
        outcome: 'inbox',
        status: 'proposed',
      });
      await expect(transactions()).resolves.toHaveLength(1);
    });

    it('creates nothing when a posted message comes back', async () => {
      await rule({ autoPost: true });
      await ingest(SALARY);
      const before = await snapshot();
      await expect(ingest(SALARY)).resolves.toEqual({ outcome: 'duplicate' });
      await expect(snapshot()).resolves.toEqual(before);
    });

    it('creates nothing when a rejected message comes back', async () => {
      await rule();
      await ingest(SALARY);
      unwrap(await services.rules.rejectItem(String((await items())[0].id)));
      const before = await snapshot();
      await expect(ingest(SALARY)).resolves.toEqual({ outcome: 'duplicate' });
      await expect(snapshot()).resolves.toEqual(before);
    });

    it('asks again when a rejected message with no reference comes back', async () => {
      await ingest('Something new');
      unwrap(await services.rules.rejectItem(String((await items())[0].id)));
      await expect(ingest('Something new')).resolves.toMatchObject({ outcome: 'inbox' });
      expect((await items())[1].note).toMatch(/possible repeat/i);
    });

    it('does not post again when a posted transaction was deleted', async () => {
      await rule({ autoPost: true });
      await ingest(SALARY);
      const [{ id }] = await transactions();
      unwrap(await services.ledger.deleteTransaction(id));
      expect((await items())[0]).toMatchObject({ status: 'posted', transaction_id: null });
      await expect(ingest(SALARY)).resolves.toEqual({ outcome: 'duplicate' });
      await expect(transactions()).resolves.toEqual([]);
    });
  });

  const outMessage = (amount: string, reference: string, code = 'USD') =>
    `Sent ${amount} ${code} to savings. Ref ${reference}`;
  const inMessage = (amount: string, reference: string, code = 'USD') =>
    `Received ${amount} ${code} from checking. Ref ${reference}`;

  async function transferRules(
    over: { autoPost?: boolean; to?: Account; inAutoPost?: boolean } = {},
  ) {
    const to = over.to ?? savings;
    const autoPost = over.autoPost ?? false;
    await rule({
      name: 'Out',
      template: 'Sent {amount} {currency} to savings. Ref {reference}',
      kind: 'transfer_out',
      counterpartAccountId: to.id,
      autoPost,
    });
    await rule({
      name: 'In',
      template: 'Received {amount} {currency} from checking. Ref {reference}',
      kind: 'transfer_in',
      accountId: to.id,
      counterpartAccountId: checking.id,
      autoPost: over.inAutoPost ?? autoPost,
    });
    return { out: outMessage, incoming: inMessage };
  }

  describe('own transfers', () => {
    it('makes one transfer from two messages, out first', async () => {
      const { out, incoming } = await transferRules({ autoPost: true });

      await expect(ingest(out('100.00', 'T1'))).resolves.toMatchObject({
        outcome: 'inbox',
        status: 'waiting_pair',
      });
      await expect(transactions()).resolves.toEqual([]);
      await expect(ingest(incoming('100.00', 'T2'), { receivedAt: hoursAfter(1) })).resolves.toMatchObject({
        outcome: 'posted',
      });

      const stored = await transactions();
      expect(stored).toEqual([expect.objectContaining({ kind: 'transfer' })]);
      await expect(balanceOf(checking.id)).resolves.toBe(-10000n);
      await expect(balanceOf(savings.id)).resolves.toBe(10000n);
      await expect(allPostingsBalance()).resolves.toBe(true);
      const both = await items();
      expect(both.map(({ status }) => status)).toEqual(['posted', 'posted']);
      expect(both.map(({ transaction_id: id }) => id)).toEqual([stored[0].id, stored[0].id]);
      expect(both.map(({ body }) => body)).toEqual([null, null]);
    });

    it('makes one transfer when each bank reports its own side', async () => {
      const receiving = await source('SavingsBank');
      await rule({
        template: 'Sent {amount} {currency}. Ref {reference}',
        kind: 'transfer_out',
        counterpartAccountId: savings.id,
        autoPost: true,
      });
      await rule({
        sourceId: receiving.id,
        template: 'Got {amount} {currency}. Ref {reference}',
        kind: 'transfer_in',
        accountId: savings.id,
        counterpartAccountId: checking.id,
        autoPost: true,
      });

      await ingest('Sent 100.00 USD. Ref A');
      await ingest('Got 100.00 USD. Ref B', { sender: 'SavingsBank' });

      await expect(transactions()).resolves.toHaveLength(1);
      await expect(balanceOf(savings.id)).resolves.toBe(10000n);
    });

    it('makes one transfer in the other arrival order, between the same accounts', async () => {
      const { out, incoming } = await transferRules({ autoPost: true });
      await ingest(incoming('100.00', 'T2'));
      await ingest(out('100.00', 'T1'), { receivedAt: hoursAfter(1) });
      await expect(transactions()).resolves.toHaveLength(1);
      await expect(balanceOf(checking.id)).resolves.toBe(-10000n);
      await expect(balanceOf(savings.id)).resolves.toBe(10000n);
    });

    it('holds a matched pair for one approval unless both rules post by themselves', async () => {
      const { out, incoming } = await transferRules({ autoPost: true, inAutoPost: false });
      await ingest(out('100.00', 'T1'));
      await ingest(incoming('100.00', 'T2'));
      await expect(transactions()).resolves.toEqual([]);
      const both = await items();
      expect(both.map(({ status }) => status)).toEqual(['proposed', 'proposed']);

      unwrap(await services.rules.approveItem(String(both[1].id)));

      await expect(transactions()).resolves.toHaveLength(1);
      expect((await items()).map(({ status }) => status)).toEqual(['posted', 'posted']);
      await expect(services.rules.approveItem(String(both[0].id))).resolves.toMatchObject({
        ok: false,
        error: { code: 'item-resolved' },
      });
      await expect(transactions()).resolves.toHaveLength(1);
    });

    it('lists a matched pair as one row', async () => {
      const { out, incoming } = await transferRules();
      await ingest(out('100.00', 'T1'));
      await ingest(incoming('100.00', 'T2'));
      const inbox = await services.rules.listInbox();
      expect(inbox.review).toHaveLength(1);
      await expect(services.rules.countInbox()).resolves.toBe(1);
      const details = await services.rules.getItem(inbox.review[0].id);
      expect(details?.partner?.kind).toBe('transfer_in');
    });

    it('sends a pair across currencies to review, showing the implied rate', async () => {
      const euros = await account('Euros', 'EUR');
      const { out, incoming } = await transferRules({ autoPost: true, to: euros });

      await ingest(out('100.00', 'T1'));
      await expect(ingest(incoming('92.50', 'T2', 'EUR'))).resolves.toMatchObject({
        outcome: 'inbox',
        status: 'proposed',
      });

      await expect(transactions()).resolves.toEqual([]);
      const both = await items();
      expect(both.map(({ status }) => status)).toEqual(['proposed', 'proposed']);
      expect(both[0].note).toContain('1 USD = 0.925 EUR');
    });

    it('makes one conversion with both amounts when the currencies differ', async () => {
      const euros = await account('Euros', 'EUR');
      const { out, incoming } = await transferRules({ autoPost: true, to: euros });

      await ingest(out('100.00', 'T1'));
      await ingest(incoming('92.50', 'T2', 'EUR'));
      unwrap(await services.rules.approveItem(String((await items())[0].id)));

      const stored = await transactions();
      expect(stored).toEqual([expect.objectContaining({ kind: 'conversion' })]);
      await expect(balanceOf(checking.id)).resolves.toBe(-10000n);
      await expect(balanceOf(euros.id)).resolves.toBe(9250n);
      await expect(allPostingsBalance()).resolves.toBe(true);
    });

    it('never posts an unpaired side as income or expense', async () => {
      const { out } = await transferRules({ autoPost: true });
      await ingest(out('100.00', 'T1'));
      await expect(transactions()).resolves.toEqual([]);
      expect((await items())[0].status).toBe('waiting_pair');
    });

    it('surfaces a side for the user only after the window', async () => {
      const { out } = await transferRules();
      await ingest(out('100.00', 'T1'));

      let inbox = await services.rules.listInbox();
      expect(inbox.waiting).toHaveLength(1);
      expect(inbox.review).toEqual([]);
      await expect(services.rules.countInbox()).resolves.toBe(0);

      now = hoursAfter(73);
      inbox = await services.rules.listInbox();
      expect(inbox.waiting).toEqual([]);
      expect(inbox.review).toHaveLength(1);
      await expect(services.rules.countInbox()).resolves.toBe(1);
    });

    it('leaves sides outside the window apart, and follows the setting', async () => {
      unwrap(
        await services.rules.updateMessageSettings({
          retentionDays: 30,
          dedupWindowMinutes: 10,
          transferWindowHours: 2,
        }),
      );
      const { out, incoming } = await transferRules({ autoPost: true });
      await ingest(out('100.00', 'T1'));
      await ingest(incoming('100.00', 'T2'), { receivedAt: hoursAfter(3) });
      await expect(transactions()).resolves.toEqual([]);
      expect((await items()).map(({ status }) => status)).toEqual(['waiting_pair', 'waiting_pair']);
    });

    it('leaves different amounts in one currency apart', async () => {
      const { out, incoming } = await transferRules({ autoPost: true });
      await ingest(out('100.00', 'T1'));
      await ingest(incoming('99.00', 'T2'));
      await expect(transactions()).resolves.toEqual([]);
    });

    it('does not use one side for two pairs', async () => {
      const { out, incoming } = await transferRules({ autoPost: true });
      await ingest(out('100.00', 'T1'));
      await ingest(incoming('100.00', 'T2'));
      await ingest(incoming('100.00', 'T3'));
      await expect(transactions()).resolves.toHaveLength(1);
      expect((await items())[2].status).toBe('waiting_pair');
      await ingest(out('100.00', 'T4'));
      await expect(transactions()).resolves.toHaveLength(2);
    });

    it('makes one transfer when both sides race each other', async () => {
      const { out, incoming } = await transferRules({ autoPost: true });
      await Promise.all([ingest(out('100.00', 'T1')), ingest(incoming('100.00', 'T2'))]);
      await expect(transactions()).resolves.toHaveLength(1);
    });

    it('lets the user post a side alone, and the late side then adds nothing', async () => {
      const { out, incoming } = await transferRules();
      await ingest(out('100.00', 'T1'));
      const [{ id }] = await items();
      unwrap(await services.rules.approveItem(String(id)));
      await expect(transactions()).resolves.toHaveLength(1);
      await expect(balanceOf(savings.id)).resolves.toBe(10000n);

      await expect(ingest(incoming('100.00', 'T2'), { receivedAt: hoursAfter(1) })).resolves.toMatchObject({
        outcome: 'posted',
      });

      await expect(transactions()).resolves.toHaveLength(1);
      await expect(balanceOf(savings.id)).resolves.toBe(10000n);
      const both = await items();
      expect(both.map(({ status }) => status)).toEqual(['posted', 'posted']);
      expect(both[1].body).toBeNull();
    });

    it('needs the other amount to post one side of a conversion alone', async () => {
      const euros = await account('Euros', 'EUR');
      const { out } = await transferRules({ to: euros });
      await ingest(out('100.00', 'T1'));
      const [{ id }] = await items();

      await expect(services.rules.approveItem(String(id))).resolves.toMatchObject({
        ok: false,
        error: { code: 'item-incomplete' },
      });
      await expect(transactions()).resolves.toEqual([]);

      unwrap(await services.rules.approveItem(String(id), { counterAmount: '92.50' }));
      await expect(balanceOf(euros.id)).resolves.toBe(9250n);
    });

    describe('a lone side with an opposite side outside the window', () => {
      const farApart = async () => {
        const { out, incoming } = await transferRules();
        await ingest(out('100.00', 'T1'));
        await ingest(incoming('100.00', 'T2'), { receivedAt: hoursAfter(100) });
        const [first, second] = await items();
        return { first: String(first.id), second: String(second.id) };
      };

      it('asks before posting, whichever side is approved', async () => {
        const { first, second } = await farApart();
        for (const id of [first, second]) {
          await expect(services.rules.approveItem(id)).resolves.toMatchObject({
            ok: false,
            error: { code: 'confirmation-required' },
          });
        }
        await expect(transactions()).resolves.toEqual([]);
      });

      it('makes one transfer when the user says they are the same movement', async () => {
        const { first } = await farApart();
        unwrap(await services.rules.approveItem(first, { otherSide: 'same' }));
        await expect(transactions()).resolves.toHaveLength(1);
        await expect(balanceOf(savings.id)).resolves.toBe(10000n);
        expect((await items()).map(({ status }) => status)).toEqual(['posted', 'posted']);
        await expect(allPostingsBalance()).resolves.toBe(true);
      });

      it('joins a side the user already posted alone, adding nothing', async () => {
        const { first, second } = await farApart();
        const posted = unwrap(await services.rules.approveItem(first, { otherSide: 'different' }));
        await expect(transactions()).resolves.toHaveLength(1);

        await expect(services.rules.approveItem(second)).resolves.toMatchObject({
          ok: false,
          error: { code: 'confirmation-required' },
        });
        const joined = unwrap(await services.rules.approveItem(second, { otherSide: 'same' }));

        expect(joined.id).toBe(posted.id);
        await expect(transactions()).resolves.toHaveLength(1);
        await expect(balanceOf(savings.id)).resolves.toBe(10000n);
        const both = await items();
        expect(both.map(({ transaction_id: id }) => id)).toEqual([posted.id, posted.id]);
        expect(both[1].body).toBeNull();
      });

      it('makes two transfers only when the user says they are different', async () => {
        const { first, second } = await farApart();
        unwrap(await services.rules.approveItem(first, { otherSide: 'different' }));
        unwrap(await services.rules.approveItem(second, { otherSide: 'different' }));
        await expect(transactions()).resolves.toHaveLength(2);
      });

      it('does not ask about a different amount in one currency', async () => {
        const { out, incoming } = await transferRules();
        await ingest(out('100.00', 'T1'));
        await ingest(incoming('99.00', 'T2'), { receivedAt: hoursAfter(100) });
        unwrap(await services.rules.approveItem(String((await items())[0].id)));
        await expect(transactions()).resolves.toHaveLength(1);
      });

      it('finds a side held as a repeat', async () => {
        const { incoming } = await transferRules();
        await rule({
          name: 'Out, no reference',
          template: 'Moved {amount} USD to savings',
          kind: 'transfer_out',
          counterpartAccountId: savings.id,
        });
        await ingest('Moved 100.00 USD to savings');
        unwrap(await services.rules.rejectItem(String((await items())[0].id)));
        await ingest('Moved 100.00 USD to savings', { receivedAt: hoursAfter(1) });
        await ingest(incoming('100.00', 'T2'), { receivedAt: hoursAfter(200) });
        const last = (await items())[2];

        await expect(services.rules.approveItem(String(last.id))).resolves.toMatchObject({
          ok: false,
          error: { code: 'confirmation-required' },
        });
        unwrap(await services.rules.approveItem(String(last.id), { otherSide: 'same' }));

        await expect(transactions()).resolves.toHaveLength(1);
        expect((await items()).map(({ status }) => status)).toEqual(['rejected', 'posted', 'posted']);
      });
    });

    describe('a side joining a conversion posted alone', () => {
      const postedAlone = async (typed: string) => {
        const euros = await account('Euros', 'EUR');
        const { out, incoming } = await transferRules({ to: euros });
        await ingest(out('100.00', 'T1'));
        unwrap(await services.rules.approveItem(String((await items())[0].id), { counterAmount: typed }));
        return { euros, incoming };
      };

      it('joins when the message agrees with the typed amount', async () => {
        const { incoming } = await postedAlone('92.50');
        await expect(ingest(incoming('92.50', 'T2', 'EUR'))).resolves.toMatchObject({
          outcome: 'posted',
        });
        await expect(transactions()).resolves.toHaveLength(1);
      });

      it('flags a mismatch for review instead of hiding it', async () => {
        const { euros, incoming } = await postedAlone('92.50');
        await expect(ingest(incoming('90.00', 'T2', 'EUR'))).resolves.toMatchObject({
          outcome: 'inbox',
          status: 'proposed',
        });
        await expect(transactions()).resolves.toHaveLength(1);
        await expect(balanceOf(euros.id)).resolves.toBe(9250n);
        const [, side] = await items();
        expect(side.note).toContain('90.00');
        expect(side.note).toContain('92.50');
        expect(await services.rules.countInbox()).toBe(1);
      });
    });

    it('returns the other side to waiting when one side of a pair is rejected', async () => {
      const { out, incoming } = await transferRules();
      await ingest(out('100.00', 'T1'));
      await ingest(incoming('100.00', 'T2'));
      const [first, second] = await items();

      unwrap(await services.rules.rejectItem(String(first.id)));

      await expect(transactions()).resolves.toEqual([]);
      const after = await items();
      expect(after.find(({ id }) => id === first.id)).toMatchObject({ status: 'rejected' });
      expect(after.find(({ id }) => id === second.id)).toMatchObject({
        status: 'waiting_pair',
        pair_item_id: null,
      });
    });

    it('does not pair with a rejected side', async () => {
      const { out, incoming } = await transferRules({ autoPost: true });
      await ingest(out('100.00', 'T1'));
      unwrap(await services.rules.rejectItem(String((await items())[0].id)));
      await ingest(incoming('100.00', 'T2'));
      await expect(transactions()).resolves.toEqual([]);
    });

    it('does not pair a late side with a transfer the user deleted', async () => {
      const { out, incoming } = await transferRules();
      await ingest(out('100.00', 'T1'));
      unwrap(await services.rules.approveItem(String((await items())[0].id)));
      unwrap(await services.ledger.deleteTransaction((await transactions())[0].id));
      await ingest(incoming('100.00', 'T2'));
      expect((await items())[1].status).toBe('waiting_pair');
    });

    it('pairs again after an edit makes two sides agree', async () => {
      const { out, incoming } = await transferRules();
      await ingest(out('100.00', 'T1'));
      await ingest(incoming('99.00', 'T2'));
      const [, second] = await items();
      unwrap(
        await services.rules.editItem(String(second.id), {
          kind: 'transfer_in',
          accountId: savings.id,
          counterpartAccountId: checking.id,
          categoryId: null,
          amount: '100.00',
          description: 'Fixed',
        }),
      );
      expect((await items()).map(({ status }) => status)).toEqual(['proposed', 'proposed']);
    });
  });

  describe('split on posting', () => {
    const structureFor = async () =>
      unwrap(
        await services.split.createStructure({
          name: 'Salary',
          lines: [
            { label: 'Save', targetAccountId: savings.id, percentage: '10', isRemainder: false },
            { label: 'Stay', targetAccountId: checking.id, percentage: null, isRemainder: true },
          ],
        }),
      );

    it('applies the structure with auto', async () => {
      const structure = await structureFor();
      await rule({ autoPost: true, splitMode: 'auto', splitStructureId: structure.id });
      await ingest(SALARY);
      const [{ id }] = await transactions();
      await expect(services.split.splitDetails(id)).resolves.toMatchObject({
        run: { structureId: structure.id },
      });
      await expect(services.split.countPendingMoves()).resolves.toBe(1);
      await expect(services.rules.countInbox()).resolves.toBe(0);
    });

    it('applies auto on a manual approval too', async () => {
      const structure = await structureFor();
      await rule({ splitMode: 'auto', splitStructureId: structure.id });
      await ingest(SALARY);
      unwrap(await services.rules.approveItem(String((await items())[0].id)));
      await expect(services.split.countPendingMoves()).resolves.toBe(1);
    });

    it('flags the income for a proposal with ask', async () => {
      await rule({ autoPost: true, splitMode: 'ask' });
      await ingest(SALARY);
      await expect(services.split.countPendingMoves()).resolves.toBe(0);
      const inbox = await services.rules.listInbox();
      expect(inbox.splits).toHaveLength(1);
      await expect(services.rules.countInbox()).resolves.toBe(1);
    });

    it('drops the flag once the income is split', async () => {
      const structure = await structureFor();
      await rule({ autoPost: true, splitMode: 'ask' });
      await ingest(SALARY);
      const [{ id }] = await transactions();
      unwrap(await services.split.applyStructure({ transactionId: id, structureId: structure.id }));
      await expect(services.rules.countInbox()).resolves.toBe(0);
    });

    it('drops the flag when the user declines', async () => {
      await rule({ autoPost: true, splitMode: 'ask' });
      await ingest(SALARY);
      unwrap(await services.rules.dismissSplit(String((await items())[0].id)));
      await expect(services.rules.countInbox()).resolves.toBe(0);
    });

    it('does nothing with none', async () => {
      await structureFor();
      await rule({ autoPost: true });
      await ingest(SALARY);
      await expect(services.split.countPendingMoves()).resolves.toBe(0);
      await expect(services.rules.countInbox()).resolves.toBe(0);
    });

    it('keeps the income and asks when auto can no longer apply', async () => {
      const structure = await structureFor();
      await rule({ autoPost: true, splitMode: 'auto', splitStructureId: structure.id });
      unwrap(await services.split.setStructureActive(structure.id, false));

      await expect(ingest(SALARY)).resolves.toMatchObject({ outcome: 'posted' });

      await expect(balanceOf(checking.id)).resolves.toBe(150025n);
      await expect(services.split.countPendingMoves()).resolves.toBe(0);
      expect((await items())[0]).toMatchObject({ split_requested: 1 });
      expect((await items())[0].note).toContain('archived');
    });
  });

  describe('atomic writes', () => {
    it('stores nothing when the post fails halfway', async () => {
      await rule({ autoPost: true });
      await ingest('Hello');
      const before = await snapshot();
      const failing = servicesOn(failingOn(driver, /INSERT INTO postings/));

      await expect(
        failing.rules.ingestMessage({ channel: 'sms', sender: SENDER, receivedAt: NOW, body: SALARY }),
      ).rejects.toThrow('disk failure');

      await expect(snapshot()).resolves.toEqual(before);
    });

    it('stores nothing when applying a split fails halfway through a post', async () => {
      const structure = unwrap(
        await services.split.createStructure({
          name: 'Salary',
          lines: [{ label: 'Save', targetAccountId: savings.id, percentage: '100', isRemainder: false }],
        }),
      );
      await rule({ autoPost: true, splitMode: 'auto', splitStructureId: structure.id });
      await ingest('Hello');
      const before = await snapshot();
      const failing = servicesOn(failingOn(driver, /INSERT INTO pending_moves/));

      await expect(
        failing.rules.ingestMessage({ channel: 'sms', sender: SENDER, receivedAt: NOW, body: SALARY }),
      ).rejects.toThrow('disk failure');

      await expect(snapshot()).resolves.toEqual(before);
    });

    it('keeps both items open when posting a pair fails', async () => {
      const { out, incoming } = await transferRules();
      await ingest(out('100.00', 'T1'));
      await ingest(incoming('100.00', 'T2'));
      const before = await snapshot();
      const failing = servicesOn(failingOn(driver, /INSERT INTO inbox_items/));
      await expect(
        failing.rules.approveItem(String((await items())[0].id)),
      ).rejects.toThrow('disk failure');
      await expect(snapshot()).resolves.toEqual(before);
    });
  });

  describe('review', () => {
    it('posts what was edited, not what was extracted', async () => {
      const expense = await category('expense');
      await rule();
      await ingest(SALARY);
      const [{ id }] = await items();

      unwrap(
        await services.rules.editItem(String(id), {
          kind: 'expense',
          accountId: savings.id,
          counterpartAccountId: null,
          categoryId: expense.id,
          amount: '20.50',
          description: 'Corrected',
        }),
      );
      const transaction = unwrap(await services.rules.approveItem(String(id)));

      await expect(balanceOf(savings.id)).resolves.toBe(-2050n);
      await expect(balanceOf(checking.id)).resolves.toBe(0n);
      expect(transaction).toMatchObject({ kind: 'expense', description: 'Corrected' });
    });

    it('turns an unmatched item into a proposal once it has the details', async () => {
      await ingest('Something new');
      const [{ id }] = await items();
      await expect(services.rules.approveItem(String(id))).resolves.toMatchObject({
        ok: false,
        error: { code: 'item-incomplete' },
      });

      unwrap(
        await services.rules.editItem(String(id), {
          kind: 'income',
          accountId: checking.id,
          counterpartAccountId: null,
          categoryId: null,
          amount: '5',
          description: 'Gift',
        }),
      );

      expect((await items())[0]).toMatchObject({ status: 'proposed', amount_minor: '500' });
      unwrap(await services.rules.approveItem(String(id)));
      await expect(balanceOf(checking.id)).resolves.toBe(500n);
    });

    it.each([
      ['a bad amount', 'abc', 'invalid-amount'],
      ['too many decimals', '1.234', 'too-precise'],
      ['zero', '0', 'non-positive-amount'],
    ])('refuses %s without changing the item', async (_label, amount, code) => {
      await rule();
      await ingest(SALARY);
      const before = await snapshot();
      await expect(
        services.rules.editItem(String((await items())[0].id), {
          kind: 'income',
          accountId: checking.id,
          counterpartAccountId: null,
          categoryId: null,
          amount,
          description: '',
        }),
      ).resolves.toMatchObject({ ok: false, error: { code } });
      await expect(snapshot()).resolves.toEqual(before);
    });

    it('refuses to touch a resolved item', async () => {
      await rule({ autoPost: true });
      await ingest(SALARY);
      const id = String((await items())[0].id);
      await expect(services.rules.rejectItem(id)).resolves.toMatchObject({
        ok: false,
        error: { code: 'item-resolved' },
      });
      await expect(services.rules.approveItem(id)).resolves.toMatchObject({
        error: { code: 'item-resolved' },
      });
    });

    it('builds a rule from an unmatched item and applies it to that item', async () => {
      await ingest(SALARY);
      const [{ id }] = await items();

      const created = unwrap(
        await services.rules.createRule(ruleInput({ samples: [SALARY] }), { fromItemId: String(id) }),
      );

      expect((await items())[0]).toMatchObject({
        status: 'proposed',
        rule_id: created.id,
        amount_minor: '150025',
        reference_key: expect.stringMatching(/^[0-9a-f]{64}$/),
      });
    });

    it('posts the item at once when the new rule posts by itself', async () => {
      await ingest(SALARY);
      const [{ id }] = await items();
      unwrap(
        await services.rules.createRule(ruleInput({ autoPost: true }), { fromItemId: String(id) }),
      );
      expect((await items())[0]).toMatchObject({ status: 'posted', body: null });
      await expect(balanceOf(checking.id)).resolves.toBe(150025n);
    });

    it('leaves the item for a person when its reference was already handled', async () => {
      await rule({ autoPost: true });
      await ingest(SALARY);
      await ingest('You got 1,500.25 USD from Acme. Ref R-1');
      await driver.run('DELETE FROM message_rules');
      const [, { id }] = await items();

      unwrap(
        await services.rules.createRule(
          ruleInput({
            template: 'You got {amount} {currency} from {counterparty}. Ref {reference}',
            autoPost: true,
          }),
          { fromItemId: String(id) },
        ),
      );

      await expect(transactions()).resolves.toHaveLength(1);
      expect((await items())[1]).toMatchObject({ status: 'proposed', reference_key: null });
    });

    it('keeps the rule and says why when it does not fit its item', async () => {
      await ingest('Something new');
      const [{ id }] = await items();
      unwrap(await services.rules.createRule(ruleInput(), { fromItemId: String(id) }));
      await expect(services.rules.listRules(bank.id)).resolves.toHaveLength(1);
      const [item] = await items();
      expect(item.status).toBe('unmatched');
      expect(item.note).toContain('Expected');
    });

    it('keeps the items of a deleted rule', async () => {
      const salary = await rule();
      await ingest(SALARY);
      unwrap(await services.rules.deleteRule(salary.id));
      expect((await items())[0]).toMatchObject({ status: 'proposed', rule_id: null });
    });
  });

  describe('one-time codes', () => {
    const anyPurchase = {
      name: 'Purchase',
      template: '{*} for purchase of {amount} USD at {counterparty}',
      kind: 'expense',
      autoPost: true,
    } as const;

    it('keeps nothing of a one-time code that a rule would match', async () => {
      await rule(anyPurchase);
      const before = await snapshot();
      await expect(ingest('Your OTP 482913 for purchase of 250 USD at Amazon')).resolves.toEqual({
        outcome: 'one-time-code',
      });
      await expect(snapshot()).resolves.toEqual(before);
    });

    it('keeps a purchase notice with an authorization code', async () => {
      await rule({
        name: 'Card',
        template: 'Purchase of {amount} USD at {counterparty}, auth code {*}',
        kind: 'expense',
        autoPost: true,
      });
      await expect(ingest('Purchase of 25 USD at Shop, auth code 123456')).resolves.toMatchObject({
        outcome: 'posted',
      });
    });

    it('refuses to save a rule built on a one-time code', async () => {
      const template = 'Your OTP {*} for purchase of {amount} USD';
      await expect(services.rules.createRule(ruleInput({ template }))).resolves.toMatchObject({
        ok: false,
        error: { code: 'invalid-template' },
      });
      const saved = await rule();
      await expect(
        services.rules.updateRule({ ...ruleInput({ template }), id: saved.id }),
      ).resolves.toMatchObject({ ok: false, error: { code: 'invalid-template' } });
    });
  });

  describe('free fields', () => {
    it('sends a counterparty over the cap to unmatched', async () => {
      await rule({ autoPost: true });
      await ingest(`You received 10.00 USD from ${'A'.repeat(65)}. Ref R-9`);
      await expect(transactions()).resolves.toEqual([]);
      expect((await items())[0]).toMatchObject({ status: 'unmatched', counterparty: null });
    });

    it('clears everything but the dedup keys on reject', async () => {
      await rule();
      await ingest(SALARY);
      const [stored] = await items();
      unwrap(await services.rules.rejectItem(String(stored.id)));

      expect((await items())[0]).toEqual({
        ...stored,
        rule_id: null,
        status: 'rejected',
        body: null,
        note: null,
        kind: null,
        account_id: null,
        category_id: null,
        counterpart_account_id: null,
        amount_minor: null,
        currency_code: null,
        reference: null,
        counterparty: null,
        balance: null,
        description: '',
        auto_post: 0,
        split_mode: 'none',
        split_structure_id: null,
        split_requested: 0,
        pair_item_id: null,
        transaction_id: null,
      });
      expect(JSON.stringify(await items())).not.toContain('Acme');
      await expect(ingest(SALARY, { receivedAt: daysAfter(2) })).resolves.toEqual({
        outcome: 'duplicate',
      });
    });
  });

  describe('arrival time', () => {
    it('never dates a message after now', async () => {
      await services.rules.ingestMessage({
        channel: 'sms',
        sender: SENDER,
        receivedAt: daysAfter(5),
        body: 'Hello',
      });
      expect((await items())[0].received_at).toBe(NOW);
    });
  });

  describe('dedup secret', () => {
    const secretRows = () =>
      driver.all<{ value: string }>(`SELECT value FROM settings WHERE key = 'rules.dedup_secret'`);

    it('stores one secret on the first accepted message and reuses it', async () => {
      const generated: string[] = [];
      const counting = createAppServices({
        driver,
        clock: { now: () => new Date(now) },
        generateId: () => `id-${++sequence}`,
        generateSecret: async () => {
          generated.push(`secret-${generated.length}`);
          return generated[generated.length - 1];
        },
      });
      const message = { channel: 'sms', sender: SENDER, receivedAt: NOW, body: 'Hello' } as const;

      const results = await Promise.all([
        counting.rules.ingestMessage(message),
        counting.rules.ingestMessage({ ...message, body: 'Hello there' }),
      ]);
      await counting.rules.ingestMessage({ ...message, body: 'Hello again' });

      expect(results.map(({ outcome }) => outcome)).toEqual(['inbox', 'inbox']);
      await expect(secretRows()).resolves.toHaveLength(1);
      expect(generated.length).toBeLessThanOrEqual(2);
    });

    it('stores no secret for a dropped sender or a one-time code', async () => {
      await ingest('Hello', { sender: 'Stranger' });
      await ingest('Your OTP is 482913');
      await expect(secretRows()).resolves.toEqual([]);
    });

    it('generates the secret outside any write', async () => {
      let open = 0;
      const counted: SqlExecutor = {
        exec: (text) => driver.exec(text),
        all: (text, params) => driver.all(text, params),
        get: (text, params) => driver.get(text, params),
        run: (text, params) => driver.run(text, params),
        transaction: async (work) => {
          open += 1;
          try {
            return await driver.transaction(work);
          } finally {
            open -= 1;
          }
        },
      };
      const seen: number[] = [];
      const app = createAppServices({
        driver: counted,
        clock: { now: () => new Date(now) },
        generateId: () => `id-${++sequence}`,
        generateSecret: () => {
          seen.push(open);
          return 'test-secret';
        },
      });
      await app.rules.ingestMessage({ channel: 'sms', sender: SENDER, receivedAt: NOW, body: 'Hello' });
      expect(seen).toEqual([0]);
    });
  });

  describe('sources and rules', () => {
    it('refuses a second source for one sender', async () => {
      await expect(
        services.rules.createSource({ name: 'Copy', channel: 'paste', sender: ' BANKCO ', enabled: true }),
      ).resolves.toMatchObject({ ok: false, error: { code: 'already-exists' } });
    });

    it('allows saving a source without changing its sender', async () => {
      const updated = unwrap(
        await services.rules.updateSource({ id: bank.id, name: 'New', channel: 'sms', sender: SENDER, enabled: false }),
      );
      expect(updated).toMatchObject({ name: 'New', enabled: false, sender: 'bankco' });
    });

    it.each([
      ['an account in another currency', { currencyCode: 'EUR' }, 'currency-mismatch'],
      ['an unknown account', { accountId: 'nope' }, 'not-found'],
      ['an unknown source', { sourceId: 'nope' }, 'not-found'],
      ['a category of the wrong kind', {}, 'category-mismatch'],
      ['an unknown structure', { splitMode: 'auto', splitStructureId: 'nope' }, 'not-found'],
      ['a bad template', { template: 'no amount here' }, 'invalid-template'],
      ['a split on an expense', { kind: 'expense', splitMode: 'ask' }, 'invalid-rule'],
      ['a transfer with no counterpart', { kind: 'transfer_out' }, 'invalid-rule'],
    ] as const)('refuses a rule with %s', async (label, change, code) => {
      const categoryId = label.includes('category') ? (await category('expense')).id : null;
      await expect(
        services.rules.createRule(ruleInput({ categoryId, ...change })),
      ).resolves.toMatchObject({ ok: false, error: { code } });
    });

    it('refuses settings outside the allowed range', async () => {
      await expect(
        services.rules.updateMessageSettings({ retentionDays: 0, dedupWindowMinutes: 10, transferWindowHours: 72 }),
      ).resolves.toMatchObject({ ok: false, error: { code: 'invalid-settings' } });
    });

    it('refuses a retention shorter than the transfer window', async () => {
      await expect(
        services.rules.updateMessageSettings({ retentionDays: 2, dedupWindowMinutes: 10, transferWindowHours: 49 }),
      ).resolves.toMatchObject({ ok: false, error: { code: 'invalid-settings' } });
      unwrap(
        await services.rules.updateMessageSettings({ retentionDays: 2, dedupWindowMinutes: 10, transferWindowHours: 48 }),
      );
    });

    it('reports the default settings until they change', async () => {
      await expect(services.rules.getMessageSettings()).resolves.toEqual({
        retentionDays: 30,
        dedupWindowMinutes: 10,
        transferWindowHours: 72,
      });
    });

    it('updates a rule in place', async () => {
      const salary = await rule();
      const updated = unwrap(await services.rules.updateRule({ ...ruleInput({ name: 'Pay' }), id: salary.id }));
      expect(updated).toMatchObject({ id: salary.id, name: 'Pay' });
      await expect(services.rules.listRules(bank.id)).resolves.toHaveLength(1);
    });
  });
});
