import { runMigrations } from '@/shared/persistence/migrator';
import { migrations } from '@/shared/persistence/migrations';
import { createNodeSqliteDriver } from '@/shared/persistence/node-sqlite-driver';
import type { SqlDriver } from '@/shared/persistence/sql-driver';
import type { Result } from '@/shared/result';

import type { LedgerError } from '../domain/ledger-error';
import { createSqliteLedgerStore } from '../infrastructure/sqlite-ledger-store';
import { createLedgerService, type LedgerService } from './ledger-service';

function unwrap<T>(result: Result<T, LedgerError>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

describe('accounts overview', () => {
  let driver: SqlDriver;
  let ledger: LedgerService;
  let sequence: number;

  beforeEach(async () => {
    driver = createNodeSqliteDriver();
    await runMigrations(driver, migrations);
    sequence = 0;
    ledger = createLedgerService({
      store: createSqliteLedgerStore(driver),
      clock: { now: () => new Date('2026-03-10T12:00:00.000Z') },
      generateId: () => `id-${++sequence}`,
    });
    await ledger.initialize();
    unwrap(await ledger.setBaseCurrency('USD'));
  });

  afterEach(() => driver.close());

  const bankX = async () =>
    unwrap(
      await ledger.createAccountGroup({
        name: 'Bank X',
        type: 'Bank',
        currencies: [
          { currencyCode: 'USD', openingBalance: '100' },
          { currencyCode: 'EUR', openingBalance: '50' },
        ],
      }),
    );

  const eurRate = (rate: string) =>
    ledger.saveRate({ fromCode: 'EUR', toCode: 'USD', rate, effectiveOn: '2026-03-01' });

  it('needs a base currency', async () => {
    await driver.run("DELETE FROM settings WHERE key = 'base_currency'");

    await expect(ledger.accountsOverview()).resolves.toMatchObject({
      ok: false,
      error: { code: 'setup-required' },
    });
  });

  it('returns each group with its sub-account balances and base total, and the ungrouped accounts', async () => {
    const { group, accounts } = await bankX();
    unwrap(await eurRate('1.2'));
    const wallet = unwrap(
      await ledger.createAccount({ name: 'Wallet', type: 'Cash', currencyCode: 'COP', openingBalance: '5' }),
    );

    const overview = unwrap(await ledger.accountsOverview());

    expect(overview.baseCurrency).toBe('USD');
    expect(overview.groups).toEqual([
      {
        group,
        // In the order accounts are listed: by name.
        accounts: [
          expect.objectContaining({ account: accounts[1], balance: 5000n }),
          expect.objectContaining({ account: accounts[0], balance: 10000n }),
        ],
        total: 16000n,
        baseCurrency: 'USD',
        missingRates: [],
      },
    ]);
    expect(overview.groups[0].accounts[0].currency.code).toBe('EUR');
    expect(overview.ungrouped).toEqual([
      expect.objectContaining({ account: wallet, balance: 500n }),
    ]);
  });

  it('reports a sub-account currency with no rate instead of counting it as zero', async () => {
    await bankX();

    const [summary] = unwrap(await ledger.accountsOverview()).groups;

    expect(summary).toMatchObject({ total: 10000n, missingRates: ['EUR'] });
  });

  it('leaves archived sub-accounts out of the total but lists them, and keeps archived groups', async () => {
    const { group, accounts } = await bankX();
    unwrap(await eurRate('1.2'));
    unwrap(
      await ledger.updateAccount({
        id: accounts[1].id,
        name: accounts[1].name,
        type: 'Bank',
        openingBalance: '50',
        archived: true,
      }),
    );
    const other = unwrap(
      await ledger.createAccountGroup({
        name: 'Old bank',
        type: 'Bank',
        currencies: [{ currencyCode: 'USD', openingBalance: '1' }],
      }),
    );
    unwrap(await ledger.setAccountGroupArchived(other.group.id, true));

    const { groups } = unwrap(await ledger.accountsOverview());

    expect(groups.map((summary) => [summary.group.id, summary.total])).toEqual([
      [group.id, 10000n],
      [other.group.id, 0n],
    ]);
    expect(groups[0].accounts).toHaveLength(2);
    expect(groups[1].group.archived).toBe(true);
  });

  it('leaves the net worth result unchanged', async () => {
    await bankX();
    unwrap(await eurRate('1.2'));

    await expect(ledger.netWorth()).resolves.toEqual({
      ok: true,
      value: { total: { minor: 16000n, currency: 'USD' }, missingRates: [] },
    });
  });

  it('labels balances for display with their group name', async () => {
    const { accounts } = await bankX();
    const wallet = unwrap(
      await ledger.createAccount({ name: 'Wallet', type: 'Cash', currencyCode: 'USD', openingBalance: '5' }),
    );

    const labelled = await ledger.accountBalancesForDisplay();

    expect(labelled.find(({ account }) => account.id === accounts[1].id)).toMatchObject({
      account: { name: 'Bank X · EUR' },
      balance: 5000n,
    });
    expect(labelled.find(({ account }) => account.id === wallet.id)?.account.name).toBe('Wallet');
  });
});
