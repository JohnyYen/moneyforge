import { createNodeSqliteDriver } from '@/shared/persistence/node-sqlite-driver';
import { runMigrations } from '@/shared/persistence/migrator';
import { migrations } from '@/shared/persistence/migrations';
import {
  ReentrantTransactionError,
  type SqlDriver,
  type SqlExecutor,
} from '@/shared/persistence/sql-driver';

import { buildSystemAccounts, type Account } from '../domain/account';
import type { Currency } from '../domain/currency';
import { createExpense, createIncome, createTransfer, type Transaction } from '../domain/journal';
import type { LedgerStore } from '../application/ports';
import { createSqliteLedgerStore } from './sqlite-ledger-store';

const dai: Currency = { code: 'DAI', name: 'Dai', decimals: 18, symbol: 'DAI', kind: 'stablecoin' };
const usd: Currency = { code: 'USD', name: 'US Dollar', decimals: 2, symbol: '$', kind: 'fiat' };

const account = (id: string, currencyCode: string): Account => ({
  id,
  name: id,
  type: 'Bank',
  currencyCode,
  openingBalance: 0n,
  archived: false,
  systemRole: null,
});

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }) {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

const at = (day: number) => `2026-01-${String(day).padStart(2, '0')}T10:00:00.000Z`;

describe('SQLite ledger store', () => {
  let driver: SqlDriver;
  let store: LedgerStore;

  beforeEach(async () => {
    driver = createNodeSqliteDriver();
    await runMigrations(driver, migrations);
    store = createSqliteLedgerStore(driver);
    for (const currency of [usd, dai]) {
      await store.currencies.save(currency);
      for (const system of buildSystemAccounts(currency.code)) await store.accounts.save(system);
    }
    await store.accounts.save(account('main', 'USD'));
    await store.accounts.save(account('savings', 'USD'));
    await store.accounts.save(account('wallet', 'DAI'));
  });

  afterEach(() => driver.close());

  const income = (id: string, accountId: string, amount: bigint, day = 1, currencyCode = 'USD') =>
    unwrap(
      createIncome({
        id,
        occurredAt: at(day),
        description: `Income ${id}`,
        account: { id: accountId, currencyCode },
        amount,
      }),
    );

  it('round trips currencies, accounts, and hides system accounts', async () => {
    await expect(store.currencies.get('DAI')).resolves.toEqual(dai);
    await expect(store.accounts.get('main')).resolves.toEqual(account('main', 'USD'));

    const listed = await store.accounts.listUser();

    expect(listed.map((item) => item.id)).toEqual(['main', 'savings', 'wallet']);
  });

  it('stores amounts as TEXT and round trips 18 decimals exactly', async () => {
    const amount = 123456789012345678901234123456789012345678n;

    await store.journal.save(income('t1', 'wallet', amount, 1, 'DAI'));

    const stored = await driver.get<{ kind: string; amount: string }>(
      "SELECT typeof(amount) AS kind, amount FROM postings WHERE account_id = 'wallet'",
    );
    expect(stored).toEqual({ kind: 'text', amount: amount.toString() });
    const saved = await store.journal.get('t1');
    expect(saved?.postings.find((posting) => posting.accountId === 'wallet')?.amount).toBe(amount);
  });

  it('round trips a whole transaction', async () => {
    const transaction: Transaction = {
      ...income('t1', 'main', 100n),
      metadata: { rate: '1.5' },
    };

    await store.journal.save(transaction);

    await expect(store.journal.get('t1')).resolves.toEqual(transaction);
  });

  it('rejects an unbalanced transaction at the write boundary', async () => {
    const valid = income('t1', 'main', 100n);
    const unbalanced: Transaction = {
      ...valid,
      postings: valid.postings.map((posting, index) =>
        index === 0 ? { ...posting, amount: posting.amount + 1n } : posting,
      ),
    };

    await expect(store.journal.save(unbalanced)).rejects.toThrow('does not balance');

    await expect(store.journal.get('t1')).resolves.toBeNull();
  });

  it('rolls back the transaction row when a posting fails to write', async () => {
    const valid = income('t1', 'main', 100n);
    const broken: Transaction = {
      ...valid,
      postings: [valid.postings[0], { ...valid.postings[1], accountId: 'missing-account' }],
    };

    await expect(store.journal.save(broken)).rejects.toThrow();

    await expect(store.journal.get('t1')).resolves.toBeNull();
    await expect(driver.all('SELECT * FROM transactions')).resolves.toEqual([]);
    await expect(driver.all('SELECT * FROM postings')).resolves.toEqual([]);
  });

  it('rolls back everything done inside atomic when a later step fails', async () => {
    await expect(
      store.atomic(async (repositories) => {
        await repositories.journal.save(income('t1', 'main', 100n));
        await repositories.accounts.save(account('new', 'USD'));
        throw new Error('later step failed');
      }),
    ).rejects.toThrow('later step failed');

    await expect(store.journal.get('t1')).resolves.toBeNull();
    await expect(store.accounts.get('new')).resolves.toBeNull();
  });

  it('replaces postings when saving the same id again', async () => {
    await store.journal.save(income('t1', 'main', 100n));

    await store.journal.save(income('t1', 'main', 250n));

    await expect(store.journal.balances()).resolves.toMatchObject({ main: 250n });
    await expect(driver.all("SELECT id FROM postings WHERE transaction_id = 't1'")).resolves.toHaveLength(2);
  });

  it('removes a transaction with its postings', async () => {
    await store.journal.save(income('t1', 'main', 100n));

    await store.journal.remove('t1');

    await expect(store.journal.get('t1')).resolves.toBeNull();
    await expect(driver.all('SELECT * FROM postings')).resolves.toEqual([]);
  });

  it('sums balances beyond the integer range of SQLite', async () => {
    const big = 9000000000000000000000000000n;
    await store.journal.save(income('t1', 'wallet', big, 1, 'DAI'));
    await store.journal.save(income('t2', 'wallet', big, 2, 'DAI'));

    const balances = await store.journal.balances();

    expect(balances.wallet).toBe(big * 2n);
  });

  describe('listing', () => {
    beforeEach(async () => {
      await store.categories.save({
        id: 'food',
        name: 'Food',
        kind: 'expense',
        parentId: null,
        archived: false,
      });
      await store.journal.save(income('t1', 'main', 100n, 1));
      await store.journal.save(
        unwrap(
          createExpense({
            id: 't2',
            occurredAt: at(2),
            description: 'Lunch',
            account: { id: 'main', currencyCode: 'USD' },
            amount: 10n,
            categoryId: 'food',
          }),
        ),
      );
      await store.journal.save(
        unwrap(
          createTransfer({
            id: 't3',
            occurredAt: at(3),
            description: 'Save',
            from: { id: 'main', currencyCode: 'USD' },
            to: { id: 'savings', currencyCode: 'USD' },
            amount: 20n,
          }),
        ),
      );
    });

    const ids = async (filter: Parameters<LedgerStore['journal']['list']>[0]) =>
      (await store.journal.list(filter)).map((transaction) => transaction.id);

    it('lists newest first', async () => {
      await expect(ids({})).resolves.toEqual(['t3', 't2', 't1']);
    });

    it('filters by account, category, kind, and date range', async () => {
      await expect(ids({ accountId: 'savings' })).resolves.toEqual(['t3']);
      await expect(ids({ categoryId: 'food' })).resolves.toEqual(['t2']);
      await expect(ids({ kind: 'income' })).resolves.toEqual(['t1']);
      await expect(ids({ from: at(2), to: at(2) })).resolves.toEqual(['t2']);
    });

    it('pages results', async () => {
      await expect(ids({ limit: 1, offset: 1 })).resolves.toEqual(['t2']);
    });
  });

  it('stores settings and exchange rates', async () => {
    await expect(store.settings.get('base_currency')).resolves.toBeNull();
    await store.settings.set('base_currency', 'USD');
    await store.settings.set('base_currency', 'DAI');
    await expect(store.settings.get('base_currency')).resolves.toBe('DAI');

    const rate = { id: 'r1', fromCode: 'DAI', toCode: 'USD', rate: '1.0001', effectiveOn: '2026-01-01' };
    await store.exchangeRates.save(rate);
    await store.exchangeRates.save({ ...rate, id: 'r2', rate: '1.0002' });

    await expect(store.exchangeRates.list()).resolves.toEqual([{ ...rate, rate: '1.0002' }]);
  });

  it('reports whether a currency has postings', async () => {
    await expect(store.journal.currencyHasPostings('USD')).resolves.toBe(false);

    await store.journal.save(income('t1', 'main', 100n));

    await expect(store.journal.currencyHasPostings('USD')).resolves.toBe(true);
  });

  it('loads a history larger than one query can bind, keeping every posting', async () => {
    const count = 1201;
    for (let index = 0; index < count; index += 1) {
      await store.journal.save(income(`t${String(index).padStart(4, '0')}`, 'main', 1n));
    }
    let largestBinding = 0;
    const counting: SqlExecutor = {
      ...driver,
      all: (sql, params) => {
        largestBinding = Math.max(largestBinding, params?.length ?? 0);
        return driver.all(sql, params);
      },
    };

    const listed = await createSqliteLedgerStore(counting).journal.list({ accountId: 'main' });

    expect(listed).toHaveLength(count);
    expect(listed.every((item) => item.postings.length === 2)).toBe(true);
    expect(listed[0].id).toBe('t1200');
    expect(largestBinding).toBeLessThanOrEqual(500);
  });

  it('fails clearly when a top-level call is awaited inside atomic', async () => {
    const stalling = createNodeSqliteDriver(':memory:', { stallTimeoutMs: 20 });
    await runMigrations(stalling, migrations);
    const reentrant = createSqliteLedgerStore(stalling);

    await expect(reentrant.atomic(() => reentrant.currencies.list())).rejects.toBeInstanceOf(
      ReentrantTransactionError,
    );
    await expect(reentrant.currencies.list()).resolves.toEqual([]);
    await stalling.close();
  });

  it('keeps the original when replacing a transaction fails midway', async () => {
    const original = income('t1', 'main', 100n);
    await store.journal.save(original);
    const broken = income('t1', 'unknown-account', 100n);

    await expect(store.journal.save(broken)).rejects.toThrow(/foreign key/i);

    await expect(store.journal.get('t1')).resolves.toEqual(original);
  });
});
