import { runMigrations, type Migration } from './migrator';
import { createNodeSqliteDriver } from './node-sqlite-driver';
import { migrations } from './migrations';
import { ledgerMigration } from './migrations/001-ledger';
import type { SqlDriver } from './sql-driver';

const first: Migration = { version: 1, name: 'first', sql: 'CREATE TABLE a (id TEXT);' };
const second: Migration = { version: 2, name: 'second', sql: 'CREATE TABLE b (id TEXT);' };

describe('runMigrations', () => {
  let driver: SqlDriver;

  beforeEach(() => {
    driver = createNodeSqliteDriver();
  });

  afterEach(() => driver.close());

  const tables = async () =>
    (
      await driver.all<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('a', 'b', 'c') ORDER BY name",
      )
    ).map((row) => row.name);

  it('applies pending migrations in order and records them', async () => {
    await runMigrations(driver, [second, first]);

    await expect(tables()).resolves.toEqual(['a', 'b']);
    await expect(driver.all('SELECT version FROM schema_migrations ORDER BY version')).resolves.toEqual(
      [{ version: 1 }, { version: 2 }],
    );
  });

  it('is idempotent and only runs what is new', async () => {
    await runMigrations(driver, [first]);
    await runMigrations(driver, [first]);
    await runMigrations(driver, [first, second]);

    await expect(tables()).resolves.toEqual(['a', 'b']);
  });

  it('rolls back a failing migration entirely and keeps earlier ones', async () => {
    const broken: Migration = {
      version: 3,
      name: 'broken',
      sql: 'CREATE TABLE c (id TEXT); INSERT INTO missing VALUES (1);',
    };

    await expect(runMigrations(driver, [first, broken])).rejects.toThrow();

    await expect(tables()).resolves.toEqual(['a']);
    await expect(driver.all('SELECT version FROM schema_migrations')).resolves.toEqual([
      { version: 1 },
    ]);
  });

  it('rejects duplicate versions before touching the database', async () => {
    await expect(runMigrations(driver, [first, { ...second, version: 1 }])).rejects.toThrow(
      'Duplicate migration version: 1',
    );

    await expect(tables()).resolves.toEqual([]);
  });

  it('applies the app migrations on an empty database', async () => {
    await expect(runMigrations(driver, migrations)).resolves.toBeUndefined();
  });
});

describe('upgrading a version 1 database', () => {
  const eighteenDecimals = '1234567890123456789012';
  let driver: SqlDriver;

  beforeEach(async () => {
    driver = createNodeSqliteDriver();
    await runMigrations(driver, [ledgerMigration]);
    await driver.exec(`
      INSERT INTO settings VALUES ('base_currency', 'USD');
      INSERT INTO currencies VALUES
        ('USD', 'US Dollar', 2, '$', 'fiat'),
        ('DAI', 'Dai', 18, 'DAI', 'stablecoin');
      INSERT INTO accounts (id, name, type, currency_code, opening_balance) VALUES
        ('checking', 'Checking', 'Bank', 'USD', '10000'),
        ('wallet', 'Wallet', 'Crypto', 'DAI', '0');
      INSERT INTO accounts (id, name, type, currency_code, system_role) VALUES
        ('system:USD:income', 'Income', 'system', 'USD', 'income'),
        ('system:DAI:income', 'Income', 'system', 'DAI', 'income');
      INSERT INTO categories (id, name, kind) VALUES ('salary', 'Salary', 'income');
      INSERT INTO transactions VALUES
        ('pay', '2026-01-15T12:00:00.000Z', 'income', 'Pay', 'salary', '{"ruleId":"rule-1"}'),
        ('coin', '2026-01-16T12:00:00.000Z', 'income', 'Coin', NULL, NULL);
      INSERT INTO postings (transaction_id, position, account_id, amount, currency_code) VALUES
        ('pay', 0, 'checking', '150000', 'USD'),
        ('pay', 1, 'system:USD:income', '-150000', 'USD'),
        ('coin', 0, 'wallet', '${eighteenDecimals}', 'DAI'),
        ('coin', 1, 'system:DAI:income', '-${eighteenDecimals}', 'DAI');
      INSERT INTO exchange_rates VALUES ('rate', 'USD', 'DAI', '1.0001', '2026-01-15');
    `);
  });

  afterEach(() => driver.close());

  const LEDGER_TABLES = [
    'settings',
    'currencies',
    'accounts',
    'categories',
    'transactions',
    'postings',
    'exchange_rates',
  ];

  const snapshot = async () => {
    const tables: Record<string, unknown[]> = {};
    for (const table of LEDGER_TABLES) {
      tables[table] = await driver.all(`SELECT * FROM ${table} ORDER BY 1, 2`);
    }
    return tables;
  };

  it('keeps every row exactly as it was', async () => {
    const before = await snapshot();
    expect(Object.values(before).every((rows) => rows.length > 0)).toBe(true);

    await runMigrations(driver, migrations);

    await expect(snapshot()).resolves.toEqual(before);
    await expect(driver.all('SELECT version FROM schema_migrations ORDER BY version')).resolves.toEqual(
      [{ version: 1 }, { version: 2 }],
    );
    await expect(driver.all('PRAGMA foreign_key_check')).resolves.toEqual([]);
  });

  it('keeps an 18 decimal amount as exact text', async () => {
    await runMigrations(driver, migrations);

    await expect(
      driver.get("SELECT amount, typeof(amount) AS type FROM postings WHERE account_id = 'wallet'"),
    ).resolves.toEqual({ amount: eighteenDecimals, type: 'text' });
  });

  it('lets the new tables reference rows from before the upgrade', async () => {
    await runMigrations(driver, migrations);

    await driver.exec(`
      INSERT INTO split_structures (id, name) VALUES ('plan', 'Plan');
      INSERT INTO split_runs VALUES
        ('run', 'pay', 'plan', 'Plan', 'checking', 'USD', '150000', '2026-01-15T12:00:00.000Z');
      INSERT INTO pending_moves VALUES
        ('move', 'run', 0, 'Save', 'checking', 'wallet', '150000', 'USD', 'pending', NULL);
    `);

    await expect(
      driver.get("SELECT transaction_id FROM split_runs WHERE id = 'run'"),
    ).resolves.toEqual({ transaction_id: 'pay' });
    await expect(
      driver.exec(`
        INSERT INTO split_runs VALUES
          ('bad', 'missing', 'plan', 'Plan', 'checking', 'USD', '1', '2026-01-15T12:00:00.000Z')
      `),
    ).rejects.toThrow(/foreign key/i);
  });
});
