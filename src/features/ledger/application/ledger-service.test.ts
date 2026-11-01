import { runMigrations } from '@/shared/persistence/migrator';
import { migrations } from '@/shared/persistence/migrations';
import { createNodeSqliteDriver } from '@/shared/persistence/node-sqlite-driver';
import type { SqlDriver } from '@/shared/persistence/sql-driver';
import type { Result } from '@/shared/result';

import { systemAccountId } from '../domain/account';
import type { LedgerError } from '../domain/ledger-error';
import { createSqliteLedgerStore } from '../infrastructure/sqlite-ledger-store';
import { createLedgerService, type LedgerService } from './ledger-service';

function unwrap<T>(result: Result<T, LedgerError>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

describe('ledger service', () => {
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
  });

  afterEach(() => driver.close());

  const account = async (name: string, currencyCode: string, openingBalance = '0') =>
    unwrap(await ledger.createAccount({ name, type: 'Bank', currencyCode, openingBalance }));

  const balanceOf = async (id: string) =>
    (await ledger.accountBalances()).find((item) => item.account.id === id)?.balance;

  const categoryNamed = async (name: string) => {
    const found = (await ledger.listCategories()).find((category) => category.name === name);
    if (!found) throw new Error(`No category ${name}`);
    return found;
  };

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

  describe('first run', () => {
    it('seeds defaults as editable data and needs a base currency', async () => {
      await expect(ledger.getBaseCurrency()).resolves.toBeNull();

      const currencies = await ledger.listCurrencies();
      const categories = await ledger.listCategories();

      expect(currencies.map((currency) => currency.code)).toEqual(
        expect.arrayContaining(['USD', 'EUR', 'USDT', 'USDC', 'DAI']),
      );
      expect(currencies.find((currency) => currency.code === 'DAI')?.decimals).toBe(18);
      expect(categories.some((category) => category.kind === 'income')).toBe(true);
      expect(categories.some((category) => category.kind === 'expense')).toBe(true);
    });

    it('does not restore defaults the user changed', async () => {
      const food = await categoryNamed('Food');
      unwrap(await ledger.updateCategory({ id: food.id, name: 'Meals', parentId: null, archived: true }));

      await ledger.initialize();

      const names = (await ledger.listCategories()).map((category) => category.name);
      expect(names).toContain('Meals');
      expect(names).not.toContain('Food');
    });

    it('completes setup with a base currency', async () => {
      unwrap(await ledger.setBaseCurrency('EUR'));

      await expect(ledger.getBaseCurrency()).resolves.toMatchObject({ code: 'EUR' });
    });

    it('rejects an unknown base currency', async () => {
      await expect(ledger.setBaseCurrency('XXX')).resolves.toMatchObject({
        ok: false,
        error: { code: 'not-found' },
      });
    });
  });

  describe('currencies', () => {
    it('creates a user currency with its hidden system accounts', async () => {
      unwrap(
        await ledger.createCurrency({ code: 'pen', name: 'Sol', decimals: 2, symbol: 'S/', kind: 'fiat' }),
      );

      const pen = await account('Lima', 'PEN');
      unwrap(await ledger.recordIncome({ accountId: pen.id, amount: '5' }));

      await expect(balanceOf(pen.id)).resolves.toBe(500n);
      expect((await ledger.accountBalances()).map((item) => item.account.name)).toEqual(['Lima']);
    });

    it('rejects a duplicate code', async () => {
      await expect(
        ledger.createCurrency({ code: 'USD', name: 'Again', decimals: 2, symbol: '$', kind: 'fiat' }),
      ).resolves.toMatchObject({ ok: false, error: { code: 'already-exists' } });
    });

    it('edits a currency', async () => {
      unwrap(
        await ledger.updateCurrency({ code: 'USD', name: 'Dollar', decimals: 3, symbol: 'US$', kind: 'fiat' }),
      );

      expect((await ledger.listCurrencies()).find((item) => item.code === 'USD')).toMatchObject({
        name: 'Dollar',
        decimals: 3,
      });
    });

    it('refuses new decimals once postings exist, which would rescale stored amounts', async () => {
      await account('Main', 'USD', '10');

      await expect(
        ledger.updateCurrency({ code: 'USD', name: 'US Dollar', decimals: 3, symbol: '$', kind: 'fiat' }),
      ).resolves.toMatchObject({ ok: false, error: { code: 'currency-in-use' } });
      unwrap(
        await ledger.updateCurrency({ code: 'USD', name: 'Dollar', decimals: 2, symbol: '$', kind: 'fiat' }),
      );
    });
  });

  describe('accounts', () => {
    it('posts the opening balance against equity', async () => {
      const main = await account('Main', 'USD', '100.50');

      await expect(balanceOf(main.id)).resolves.toBe(10050n);
      await expect(allPostingsBalance()).resolves.toBe(true);
      const balances = await createSqliteLedgerStore(driver).journal.balances();
      expect(balances[systemAccountId('USD', 'equity')]).toBe(-10050n);
    });

    it('allows a negative opening balance and no entry for zero', async () => {
      const card = await account('Card', 'USD', '-20');
      const empty = await account('Empty', 'USD');

      await expect(balanceOf(card.id)).resolves.toBe(-2000n);
      await expect(ledger.listTransactions({ accountId: empty.id })).resolves.toEqual([]);
    });

    it('rejects an unknown currency, a blank name, and a bad opening balance', async () => {
      const input = { name: 'A', type: 'Bank', currencyCode: 'USD', openingBalance: '0' };

      await expect(ledger.createAccount({ ...input, currencyCode: 'XXX' })).resolves.toMatchObject({
        ok: false,
        error: { code: 'not-found' },
      });
      await expect(ledger.createAccount({ ...input, name: ' ' })).resolves.toMatchObject({
        ok: false,
        error: { code: 'invalid-account' },
      });
      await expect(
        ledger.createAccount({ ...input, openingBalance: '1.234' }),
      ).resolves.toMatchObject({ ok: false, error: { code: 'too-precise' } });
      await expect(ledger.listAccounts()).resolves.toEqual([]);
    });

    it('edits fields and keeps one opening entry when the balance changes', async () => {
      const main = await account('Main', 'USD', '100');
      const update = { id: main.id, name: 'Primary', type: 'Cash', archived: false };

      unwrap(await ledger.updateAccount({ ...update, openingBalance: '150' }));

      await expect(balanceOf(main.id)).resolves.toBe(15000n);
      await expect(ledger.listTransactions({ accountId: main.id })).resolves.toHaveLength(1);
      await expect(ledger.getAccount(main.id)).resolves.toMatchObject({
        name: 'Primary',
        type: 'Cash',
        openingBalance: 15000n,
      });

      unwrap(await ledger.updateAccount({ ...update, openingBalance: '0' }));

      await expect(balanceOf(main.id)).resolves.toBe(0n);
      await expect(ledger.listTransactions({ accountId: main.id })).resolves.toEqual([]);
    });

    it('never treats a system account as a user account', async () => {
      await expect(ledger.getAccount(systemAccountId('USD', 'equity'))).resolves.toBeNull();
    });
  });

  describe('categories', () => {
    it('creates, nests, and archives', async () => {
      const parent = unwrap(await ledger.createCategory({ name: 'Bills', kind: 'expense', parentId: null }));
      const child = unwrap(
        await ledger.createCategory({ name: 'Water', kind: 'expense', parentId: parent.id }),
      );

      unwrap(await ledger.updateCategory({ id: child.id, name: 'Water', parentId: null, archived: true }));

      expect((await ledger.listCategories()).find((item) => item.id === child.id)).toMatchObject({
        parentId: null,
        archived: true,
      });
    });

    it('rejects a parent of another kind, a missing parent, and a cycle', async () => {
      const salary = await categoryNamed('Salary');
      const food = await categoryNamed('Food');
      const lunch = unwrap(
        await ledger.createCategory({ name: 'Lunch', kind: 'expense', parentId: food.id }),
      );

      await expect(
        ledger.createCategory({ name: 'X', kind: 'expense', parentId: salary.id }),
      ).resolves.toMatchObject({ ok: false, error: { code: 'invalid-category' } });
      await expect(
        ledger.createCategory({ name: 'X', kind: 'expense', parentId: 'missing' }),
      ).resolves.toMatchObject({ ok: false, error: { code: 'not-found' } });
      await expect(
        ledger.updateCategory({ id: food.id, name: 'Food', parentId: lunch.id, archived: false }),
      ).resolves.toMatchObject({ ok: false, error: { code: 'invalid-category' } });
    });
  });

  describe('recording', () => {
    it('records income and expense with their category', async () => {
      const main = await account('Main', 'USD');
      const salary = await categoryNamed('Salary');
      const food = await categoryNamed('Food');

      unwrap(await ledger.recordIncome({ accountId: main.id, amount: '1000', categoryId: salary.id }));
      const expense = unwrap(
        await ledger.recordExpense({
          accountId: main.id,
          amount: '12.50',
          categoryId: food.id,
          description: 'Lunch',
          occurredAt: '2026-03-01T09:00:00.000Z',
        }),
      );

      await expect(balanceOf(main.id)).resolves.toBe(98750n);
      expect(expense).toMatchObject({
        categoryId: food.id,
        description: 'Lunch',
        occurredAt: '2026-03-01T09:00:00.000Z',
      });
      await expect(allPostingsBalance()).resolves.toBe(true);
    });

    it('defaults the date to now', async () => {
      const main = await account('Main', 'USD');

      const income = unwrap(await ledger.recordIncome({ accountId: main.id, amount: '1' }));

      expect(income.occurredAt).toBe('2026-03-10T12:00:00.000Z');
    });

    it('rejects a category of the wrong kind or archived', async () => {
      const main = await account('Main', 'USD');
      const salary = await categoryNamed('Salary');
      const food = await categoryNamed('Food');
      unwrap(await ledger.updateCategory({ id: food.id, name: 'Food', parentId: null, archived: true }));

      await expect(
        ledger.recordExpense({ accountId: main.id, amount: '1', categoryId: salary.id }),
      ).resolves.toMatchObject({ ok: false, error: { code: 'category-mismatch' } });
      await expect(
        ledger.recordExpense({ accountId: main.id, amount: '1', categoryId: food.id }),
      ).resolves.toMatchObject({ ok: false, error: { code: 'category-mismatch' } });
    });

    it('rejects archived, missing, and system accounts', async () => {
      const main = await account('Main', 'USD');
      unwrap(
        await ledger.updateAccount({
          id: main.id,
          name: 'Main',
          type: 'Bank',
          openingBalance: '0',
          archived: true,
        }),
      );

      await expect(ledger.recordIncome({ accountId: main.id, amount: '1' })).resolves.toMatchObject({
        ok: false,
        error: { code: 'account-archived' },
      });
      await expect(ledger.recordIncome({ accountId: 'nope', amount: '1' })).resolves.toMatchObject({
        ok: false,
        error: { code: 'not-found' },
      });
      await expect(
        ledger.recordIncome({ accountId: systemAccountId('USD', 'equity'), amount: '1' }),
      ).resolves.toMatchObject({ ok: false, error: { code: 'not-found' } });
    });

    it('transfers with a fee and keeps every currency balanced', async () => {
      const main = await account('Main', 'USD', '100');
      const savings = await account('Savings', 'USD');

      unwrap(
        await ledger.recordTransfer({
          fromAccountId: main.id,
          toAccountId: savings.id,
          amount: '40',
          fee: '1.50',
        }),
      );

      await expect(balanceOf(main.id)).resolves.toBe(5850n);
      await expect(balanceOf(savings.id)).resolves.toBe(4000n);
      await expect(allPostingsBalance()).resolves.toBe(true);
    });

    it('converts using the rate when no received amount is given', async () => {
      const dollars = await account('Dollars', 'USD', '100');
      const wallet = await account('Wallet', 'DAI');

      const conversion = unwrap(
        await ledger.recordConversion({
          fromAccountId: dollars.id,
          toAccountId: wallet.id,
          sourceAmount: '10',
          rate: '0.998877665544332211',
        }),
      );

      await expect(balanceOf(dollars.id)).resolves.toBe(9000n);
      await expect(balanceOf(wallet.id)).resolves.toBe(9988776655443322110n);
      expect(conversion.metadata).toMatchObject({ rate: '0.998877665544332211' });
      await expect(allPostingsBalance()).resolves.toBe(true);
    });

    it('keeps the received amount and fee the provider actually applied', async () => {
      const dollars = await account('Dollars', 'USD', '100');
      const euros = await account('Euros', 'EUR');

      unwrap(
        await ledger.recordConversion({
          fromAccountId: dollars.id,
          toAccountId: euros.id,
          sourceAmount: '10',
          targetAmount: '9.13',
          rate: '0.92',
          fee: '0.50',
          feeCurrency: 'USD',
        }),
      );

      await expect(balanceOf(dollars.id)).resolves.toBe(8950n);
      await expect(balanceOf(euros.id)).resolves.toBe(913n);
      await expect(allPostingsBalance()).resolves.toBe(true);
    });

    it('parses a conversion fee by the decimals of its own currency', async () => {
      const dollars = await account('Dollars', 'USD', '100');
      const wallet = await account('Wallet', 'DAI');

      unwrap(
        await ledger.recordConversion({
          fromAccountId: dollars.id,
          toAccountId: wallet.id,
          sourceAmount: '10',
          rate: '1',
          fee: '0.000000000000000001',
          feeCurrency: 'DAI',
        }),
      );

      await expect(balanceOf(wallet.id)).resolves.toBe(9999999999999999999n);
      await expect(allPostingsBalance()).resolves.toBe(true);
    });

    it('reconciles the difference against equity', async () => {
      const main = await account('Main', 'USD', '100');

      const adjustment = unwrap(await ledger.reconcile({ accountId: main.id, countedBalance: '92.25' }));

      expect(adjustment?.kind).toBe('adjustment');
      await expect(balanceOf(main.id)).resolves.toBe(9225n);
      await expect(allPostingsBalance()).resolves.toBe(true);
    });

    it('records nothing when the counted balance already matches', async () => {
      const main = await account('Main', 'USD', '100');

      await expect(ledger.reconcile({ accountId: main.id, countedBalance: '100.00' })).resolves.toEqual({
        ok: true,
        value: null,
      });
      await expect(ledger.listTransactions({ accountId: main.id })).resolves.toHaveLength(1);
    });
  });

  describe('listing', () => {
    it('filters through the store', async () => {
      const main = await account('Main', 'USD');
      const other = await account('Other', 'USD');
      unwrap(await ledger.recordIncome({ accountId: main.id, amount: '1' }));
      unwrap(await ledger.recordExpense({ accountId: other.id, amount: '1' }));

      const listed = await ledger.listTransactions({ accountId: main.id });

      expect(listed.map((transaction) => transaction.kind)).toEqual(['income']);
    });
  });

  describe('net worth', () => {
    beforeEach(async () => {
      unwrap(await ledger.setBaseCurrency('USD'));
    });

    it('needs a base currency', async () => {
      await driver.run("DELETE FROM settings WHERE key = 'base_currency'");

      await expect(ledger.netWorth()).resolves.toMatchObject({
        ok: false,
        error: { code: 'setup-required' },
      });
    });

    it('values each currency with the stored rate as of today', async () => {
      await account('Dollars', 'USD', '100');
      await account('Euros', 'EUR', '50');
      unwrap(
        await ledger.saveRate({ fromCode: 'EUR', toCode: 'USD', rate: '1.2', effectiveOn: '2026-03-01' }),
      );
      unwrap(
        await ledger.saveRate({ fromCode: 'EUR', toCode: 'USD', rate: '9', effectiveOn: '2026-04-01' }),
      );

      await expect(ledger.netWorth()).resolves.toEqual({
        ok: true,
        value: { total: { minor: 16000n, currency: 'USD' }, missingRates: [] },
      });
    });

    it('flags missing rates and leaves archived accounts out', async () => {
      await account('Dollars', 'USD', '100');
      await account('Euros', 'EUR', '50');
      const old = await account('Old', 'USD', '7');
      unwrap(
        await ledger.updateAccount({
          id: old.id,
          name: 'Old',
          type: 'Bank',
          openingBalance: '7',
          archived: true,
        }),
      );

      await expect(ledger.netWorth()).resolves.toEqual({
        ok: true,
        value: { total: { minor: 10000n, currency: 'USD' }, missingRates: ['EUR'] },
      });
    });
  });

  describe('exchange rates', () => {
    const rate = { fromCode: 'EUR', toCode: 'USD', rate: '1.0825', effectiveOn: '2026-03-01' };

    it('keeps the rate as the exact string and replaces the same day', async () => {
      unwrap(await ledger.saveRate(rate));
      unwrap(await ledger.saveRate({ ...rate, rate: '1.0830' }));

      await expect(ledger.listRates()).resolves.toMatchObject([{ rate: '1.0830' }]);
    });

    it('rejects invalid rates, dates, and pairs', async () => {
      await expect(ledger.saveRate({ ...rate, rate: '0' })).resolves.toMatchObject({
        ok: false,
        error: { code: 'invalid-rate' },
      });
      await expect(ledger.saveRate({ ...rate, effectiveOn: '2026-02-30' })).resolves.toMatchObject({
        ok: false,
        error: { code: 'invalid-date' },
      });
      await expect(ledger.saveRate({ ...rate, toCode: 'EUR' })).resolves.toMatchObject({
        ok: false,
        error: { code: 'currency-mismatch' },
      });
      await expect(ledger.saveRate({ ...rate, toCode: 'XXX' })).resolves.toMatchObject({
        ok: false,
        error: { code: 'not-found' },
      });
    });
  });
});
