import { createAppServices, type AppServices } from '@/app-services/create-app-services';
import { migrations } from '@/shared/persistence/migrations';
import { runMigrations } from '@/shared/persistence/migrator';
import { createNodeSqliteDriver } from '@/shared/persistence/node-sqlite-driver';
import type { SqlDriver } from '@/shared/persistence/sql-driver';
import type { Result } from '@/shared/result';

import { parseCsv } from '../domain/csv';
import type { CsvImportInput } from './transfer-service';

function unwrap<T>(result: Result<T, { code: string; message: string }>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

const CSV = [
  'Date,Description,Amount,Category',
  '2026-01-02,Salary,"1,000.50",Wages',
  '2026-01-03,Coffee,-3.25,Treats',
  '2026-01-03,Coffee,-3.25,Treats',
  '2026-01-04,Mystery,-1.00,Hobbies',
  '01/05/2026,Bad date,-1.00,Treats',
  '2026-01-06,Bad amount,-1.5.0,Treats',
].join('\n');

describe('transfer service', () => {
  let driver: SqlDriver;
  let services: AppServices;
  let accountId: string;
  let sequence: number;

  beforeEach(async () => {
    driver = createNodeSqliteDriver();
    await runMigrations(driver, migrations);
    sequence = 0;
    services = createAppServices({
      driver,
      clock: { now: () => new Date('2026-03-10T12:00:00.000Z') },
      generateId: () => `id-${++sequence}`,
      generateSecret: () => 'test-secret',
    });
    await services.ledger.initialize();
    unwrap(await services.ledger.setBaseCurrency('USD'));
    accountId = unwrap(
      await services.ledger.createAccount({
        name: 'Checking',
        type: 'Bank',
        currencyCode: 'USD',
        openingBalance: '0',
      }),
    ).id;
    unwrap(await services.ledger.createCategory({ name: 'Treats', kind: 'expense', parentId: null }));
    unwrap(await services.ledger.createCategory({ name: 'Wages', kind: 'income', parentId: null }));
  });

  afterEach(() => driver.close());

  const input = (change: Partial<CsvImportInput> = {}): CsvImportInput => ({
    text: CSV,
    separator: ',',
    hasHeader: true,
    accountId,
    mapping: {
      date: 0,
      description: 1,
      amount: { mode: 'single', column: 2, positive: 'income' },
      category: 3,
      dateFormat: 'ymd',
      numberFormat: { decimal: '.', thousands: ',' },
    },
    unknownCategories: { action: 'fallback', income: null, expense: null },
    ...change,
  });

  const snapshot = async () =>
    JSON.stringify([
      await driver.all('SELECT * FROM transactions ORDER BY id'),
      await driver.all('SELECT * FROM postings ORDER BY id'),
      await driver.all('SELECT * FROM categories ORDER BY id'),
      await driver.all('SELECT * FROM imported_rows ORDER BY fingerprint'),
    ]);

  const balance = async () =>
    (await services.ledger.accountBalances()).find(({ account }) => account.id === accountId)
      ?.balance;

  describe('preview', () => {
    it('counts rows and writes nothing to the ledger', async () => {
      const before = await snapshot();
      const preview = unwrap(await services.transfer.previewCsv(input()));
      expect(preview).toMatchObject({ valid: 4, duplicates: 0, newCategories: [] });
      expect(preview.invalid.map(({ line }) => line)).toEqual([6, 7]);
      expect(preview.invalid[0].reason).toMatch(/date/i);
      expect(await snapshot()).toBe(before);
    });

    it('reports a malformed file instead of guessing at its rows', async () => {
      await expect(services.transfer.previewCsv(input({ text: 'a,"b' }))).resolves.toMatchObject({
        ok: false,
        error: { code: 'invalid-csv' },
      });
    });

    it('refuses an account that does not exist', async () => {
      await expect(
        services.transfer.previewCsv(input({ accountId: 'nope' })),
      ).resolves.toMatchObject({ ok: false, error: { code: 'not-found' } });
    });

    it('marks two categories that share a name as ambiguous', async () => {
      unwrap(
        await services.ledger.createCategory({ name: 'treats', kind: 'expense', parentId: null }),
      );
      const preview = unwrap(await services.transfer.previewCsv(input()));
      expect(preview.invalid.filter(({ reason }) => /share/.test(reason))).toHaveLength(2);
    });
  });

  describe('import', () => {
    it('posts valid rows through the ledger with exact amounts', async () => {
      const report = unwrap(await services.transfer.importCsv(input()));
      expect(report).toMatchObject({ imported: 4, duplicates: 0 });
      expect(report.invalid).toHaveLength(2);
      expect(await balance()).toBe(100050n - 325n - 325n - 100n);
      const list = await services.ledger.listTransactions({});
      expect(list.filter(({ kind }) => kind === 'expense')).toHaveLength(3);
      expect(list.map(({ occurredAt }) => new Date(occurredAt).getHours())).toContain(12);
      const postings = await driver.all<{ amount: string }>('SELECT amount FROM postings');
      expect(postings.map(({ amount }) => amount)).toContain('100050');
    });

    it('keeps 18 decimals exact', async () => {
      const id = unwrap(
        await services.ledger.createAccount({
          name: 'Wallet',
          type: 'Crypto',
          currencyCode: 'USDT',
          openingBalance: '0',
        }),
      ).id;
      await driver.run(`UPDATE currencies SET decimals = 18 WHERE code = 'USDT'`);
      const text = 'd,a\n2026-01-02,123456789012.123456789012345678';
      unwrap(
        await services.transfer.importCsv(
          input({
            text,
            accountId: id,
            mapping: {
              ...input().mapping,
              description: null,
              category: null,
              amount: { mode: 'single', column: 1, positive: 'income' },
            },
          }),
        ),
      );
      const balances = await services.ledger.accountBalances();
      expect(balances.find(({ account }) => account.id === id)?.balance).toBe(
        123456789012123456789012345678n,
      );
    });

    it('creates nothing on a second import of the same file', async () => {
      unwrap(await services.transfer.importCsv(input()));
      const before = await snapshot();
      const preview = unwrap(await services.transfer.previewCsv(input()));
      expect(preview).toMatchObject({ valid: 0, duplicates: 4 });
      const report = unwrap(await services.transfer.importCsv(input()));
      expect(report).toMatchObject({ imported: 0, duplicates: 4 });
      expect(await snapshot()).toBe(before);
    });

    it('matches the same rows written in another format', async () => {
      unwrap(await services.transfer.importCsv(input()));
      const text = 'Date;Description;Amount\n02/01/2026;SALARY;1.000,50';
      const preview = unwrap(
        await services.transfer.previewCsv(
          input({
            text,
            separator: ';',
            mapping: {
              ...input().mapping,
              category: null,
              dateFormat: 'dmy',
              numberFormat: { decimal: ',', thousands: '.' },
            },
          }),
        ),
      );
      expect(preview).toMatchObject({ valid: 0, duplicates: 1 });
    });

    it('imports only what a longer statement adds, repeated rows included', async () => {
      unwrap(await services.transfer.importCsv(input()));
      const longer = `${CSV}\n2026-01-03,Coffee,-3.25,Treats\n2026-01-07,Tea,-2.00,Treats`;
      expect(unwrap(await services.transfer.importCsv(input({ text: longer })))).toMatchObject({
        imported: 2,
        duplicates: 4,
      });
    });

    it('treats the same file in another account as new', async () => {
      unwrap(await services.transfer.importCsv(input()));
      const other = unwrap(
        await services.ledger.createAccount({
          name: 'Savings',
          type: 'Bank',
          currencyCode: 'USD',
          openingBalance: '0',
        }),
      ).id;
      expect(unwrap(await services.transfer.previewCsv(input({ accountId: other })))).toMatchObject(
        { valid: 4, duplicates: 0 },
      );
    });

    it('lets a row come back once its transaction was deleted', async () => {
      unwrap(await services.transfer.importCsv(input()));
      const [first] = await services.ledger.listTransactions({ kind: 'income' });
      unwrap(await services.ledger.deleteTransaction(first.id));
      expect(unwrap(await services.transfer.previewCsv(input()))).toMatchObject({
        valid: 1,
        duplicates: 3,
      });
    });

    it('leaves unknown categories empty by default', async () => {
      unwrap(await services.transfer.importCsv(input()));
      const list = await services.ledger.listTransactions({});
      expect(list.find(({ description }) => description === 'Mystery')?.categoryId).toBeNull();
    });

    it('uses the chosen fallback for each kind', async () => {
      const food = (await services.ledger.listCategories()).find(({ name }) => name === 'Treats');
      unwrap(
        await services.transfer.importCsv(
          input({
            unknownCategories: { action: 'fallback', income: null, expense: food?.id ?? null },
          }),
        ),
      );
      const list = await services.ledger.listTransactions({});
      expect(list.find(({ description }) => description === 'Mystery')?.categoryId).toBe(food?.id);
    });

    it('lists categories it would create, then creates each once', async () => {
      const create = input({
        text: `${CSV}\n2026-01-08,More,-1.00,hobbies`,
        unknownCategories: { action: 'create' },
      });
      const preview = unwrap(await services.transfer.previewCsv(create));
      expect(preview.newCategories).toEqual([{ name: 'Hobbies', kind: 'expense' }]);
      unwrap(await services.transfer.importCsv(create));
      const made = (await services.ledger.listCategories()).filter(
        ({ name }) => name === 'Hobbies',
      );
      expect(made).toHaveLength(1);
      const list = await services.ledger.listTransactions({ categoryId: made[0].id });
      expect(list).toHaveLength(2);
    });

    it('writes nothing at all when one row fails in the batch', async () => {
      const before = await snapshot();
      // Salary posts first, and the expense fallback then fails inside the same write.
      const broken = input({
        unknownCategories: { action: 'fallback', income: null, expense: 'not-a-category' },
      });
      await expect(services.transfer.importCsv(broken)).resolves.toMatchObject({
        ok: false,
        error: { code: 'import-failed' },
      });
      expect(await snapshot()).toBe(before);
    });

    it('refuses an archived account', async () => {
      unwrap(
        await services.ledger.updateAccount({
          id: accountId,
          name: 'Checking',
          type: 'Bank',
          openingBalance: '0',
          archived: true,
        }),
      );
      await expect(services.transfer.importCsv(input())).resolves.toMatchObject({
        ok: false,
        error: { code: 'account-archived' },
      });
    });

    it('refuses an archived category by name instead of creating its twin', async () => {
      const food = (await services.ledger.listCategories()).find(({ name }) => name === 'Treats');
      if (food) unwrap(await services.ledger.updateCategory({ ...food, archived: true }));
      const preview = unwrap(
        await services.transfer.previewCsv(input({ unknownCategories: { action: 'create' } })),
      );
      expect(preview.newCategories).toEqual([{ name: 'Hobbies', kind: 'expense' }]);
      expect(preview.invalid.filter(({ reason }) => /archived/.test(reason))).toHaveLength(2);
    });
  });

  it('hands shared text over once', () => {
    services.transfer.holdSharedCsv('a,b');
    expect(services.transfer.takeSharedCsv()).toBe('a,b');
    expect(services.transfer.takeSharedCsv()).toBeNull();
  });

  describe('export', () => {
    const exported = async (range: { accountId?: string | null; from?: string; to?: string } = {}) =>
      unwrap(
        await services.transfer.exportCsv({
          accountId: range.accountId ?? null,
          from: range.from ?? '',
          to: range.to ?? '',
        }),
      );

    const rows = async (range = {}) => {
      const parsed = unwrap(parseCsv((await exported(range)).csv, ','));
      return parsed.map(({ cells }) => cells);
    };

    it('writes exact amounts, oldest first, with a header', async () => {
      unwrap(await services.transfer.importCsv(input()));
      const [header, first, second] = await rows();
      expect(header).toEqual([
        'date',
        'kind',
        'description',
        'category',
        'account',
        'currency',
        'amount',
      ]);
      expect(first).toEqual(['2026-01-02', 'income', 'Salary', 'Wages', 'Checking', 'USD', '1000.50']);
      expect(second.slice(-1)).toEqual(['-3.25']);
    });

    it('neutralizes formulas in text but keeps amounts as numbers', async () => {
      unwrap(
        await services.ledger.recordExpense({
          accountId,
          amount: '4.00',
          description: '=HYPERLINK("http://example.com")',
          occurredAt: '2026-02-01T12:00:00.000Z',
        }),
      );
      const [, row] = await rows();
      expect(row[2]).toBe(`'=HYPERLINK("http://example.com")`);
      expect(row[6]).toBe('-4.00');
    });

    it('writes both sides of a transfer, one row per account, and hides fees accounts', async () => {
      const savings = unwrap(
        await services.ledger.createAccount({
          name: 'Savings',
          type: 'Bank',
          currencyCode: 'USD',
          openingBalance: '0',
        }),
      ).id;
      unwrap(
        await services.ledger.recordTransfer({
          fromAccountId: accountId,
          toAccountId: savings,
          amount: '10.00',
          fee: '1.00',
        }),
      );
      const all = await rows();
      expect(all.slice(1).map((row) => [row[1], row[4], row[6]])).toEqual(
        expect.arrayContaining([
          ['transfer', 'Checking', '-11.00'],
          ['transfer', 'Savings', '10.00'],
        ]),
      );
      expect(all).toHaveLength(3);
      const one = await rows({ accountId: savings });
      expect(one).toHaveLength(2);
    });

    it('limits to a range, both ends included', async () => {
      unwrap(await services.transfer.importCsv(input()));
      const inside = await rows({ from: '2026-01-03', to: '2026-01-03' });
      expect(inside).toHaveLength(3);
      expect(await exported()).toMatchObject({ rows: 4 });
    });

    it.each([
      [{ from: 'soon' }],
      [{ to: '2026-13-01' }],
      [{ from: '2026-02-01', to: '2026-01-01' }],
    ])('refuses the range %j', async (range) => {
      await expect(
        services.transfer.exportCsv({ accountId: null, from: '', to: '', ...range }),
      ).resolves.toMatchObject({ ok: false, error: { code: 'invalid-range' } });
    });

    it('refuses what Share cannot carry rather than cutting it short', async () => {
      const long = 'x'.repeat(1900);
      for (let index = 0; index < 120; index += 1) {
        unwrap(await services.ledger.recordExpense({ accountId, amount: '1.00', description: long }));
      }
      await expect(
        services.transfer.exportCsv({ accountId: null, from: '', to: '' }),
      ).resolves.toMatchObject({ ok: false, error: { code: 'too-large' } });
    });
  });
});
