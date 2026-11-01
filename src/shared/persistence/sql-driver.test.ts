import { createNodeSqliteDriver } from './node-sqlite-driver';
import type { SqlDriver } from './sql-driver';

describe('SqlDriver', () => {
  let driver: SqlDriver;

  beforeEach(async () => {
    driver = createNodeSqliteDriver();
    await driver.exec('CREATE TABLE items (name TEXT NOT NULL)');
  });

  afterEach(() => driver.close());

  const names = async () =>
    (await driver.all<{ name: string }>('SELECT name FROM items ORDER BY name')).map(
      (row) => row.name,
    );

  it('runs parameterized statements', async () => {
    await driver.run('INSERT INTO items VALUES (?)', ['a']);

    await expect(driver.get('SELECT name FROM items WHERE name = ?', ['a'])).resolves.toEqual({
      name: 'a',
    });
    await expect(driver.get('SELECT name FROM items WHERE name = ?', ['z'])).resolves.toBeUndefined();
  });

  it('commits a transaction', async () => {
    const value = await driver.transaction(async (tx) => {
      await tx.run('INSERT INTO items VALUES (?)', ['a']);
      return 'done';
    });

    expect(value).toBe('done');
    await expect(names()).resolves.toEqual(['a']);
  });

  it('rolls back when the work fails and rethrows the cause', async () => {
    await expect(
      driver.transaction(async (tx) => {
        await tx.run('INSERT INTO items VALUES (?)', ['a']);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    await expect(names()).resolves.toEqual([]);
  });

  it('keeps statements issued during a transaction out of it', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const failing = driver.transaction(async (tx) => {
      await tx.run('INSERT INTO items VALUES (?)', ['in-transaction']);
      await gate;
      throw new Error('boom');
    });
    const outside = driver.run('INSERT INTO items VALUES (?)', ['outside']);
    release();

    await expect(failing).rejects.toThrow('boom');
    await outside;
    await expect(names()).resolves.toEqual(['outside']);
  });

  it('nests with savepoints', async () => {
    await driver.transaction(async (tx) => {
      await tx.run('INSERT INTO items VALUES (?)', ['outer']);
      await expect(
        tx.transaction(async (nested) => {
          await nested.run('INSERT INTO items VALUES (?)', ['inner']);
          throw new Error('inner failed');
        }),
      ).rejects.toThrow('inner failed');
    });

    await expect(names()).resolves.toEqual(['outer']);
  });

  it('stays usable after a failed transaction', async () => {
    await driver.transaction(async () => Promise.reject(new Error('boom'))).catch(() => undefined);

    await driver.run('INSERT INTO items VALUES (?)', ['after']);

    await expect(names()).resolves.toEqual(['after']);
  });
});
