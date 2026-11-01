import { runMigrations, type Migration } from './migrator';
import { createNodeSqliteDriver } from './node-sqlite-driver';
import { migrations } from './migrations';
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
