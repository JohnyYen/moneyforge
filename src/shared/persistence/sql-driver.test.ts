import { createNodeSqliteDriver } from './node-sqlite-driver';
import {
  assertSecureDeleteEnabled,
  assertForeignKeysEnabled,
  createSqlDriver,
  ReentrantTransactionError,
  TransactionRollbackError,
  type SqlDriver,
  type SqlStatements,
} from './sql-driver';

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

/** Records every statement; `fails` decides which ones throw. */
function fakeConnection(fails: (sql: string) => Error | null = () => null) {
  const statements: string[] = [];
  const execute = async (sql: string) => {
    statements.push(sql);
    const failure = fails(sql);
    if (failure) throw failure;
  };
  const connection: SqlStatements = {
    exec: execute,
    run: execute,
    all: async (sql) => {
      await execute(sql);
      return [];
    },
    get: async (sql) => {
      await execute(sql);
      return undefined;
    },
  };
  return { connection, statements };
}

describe('SqlDriver close', () => {
  it('closes only after the work already queued has run', async () => {
    const { connection, statements } = fakeConnection();
    const driver = createSqlDriver(connection, async () => {
      statements.push('CLOSE');
    });

    const transaction = driver.transaction(async (tx) => {
      await tx.run('INSERT restored');
    });
    const closed = driver.close();
    await Promise.all([transaction, closed]);

    expect(statements).toEqual(['BEGIN IMMEDIATE', 'INSERT restored', 'COMMIT', 'CLOSE']);
  });

  it('fails a call made after close instead of reopening anything', async () => {
    const driver = createNodeSqliteDriver();
    await driver.close();

    await expect(driver.run('SELECT 1')).rejects.toThrow();
  });
});

describe('SqlDriver rollback failures', () => {
  const failWork = () => Promise.reject(new Error('boom'));
  const closeNothing = async () => undefined;

  it('reports a distinct error carrying both causes', async () => {
    const rollbackFailure = new Error('disk I/O error');
    const { connection } = fakeConnection((sql) => (sql === 'ROLLBACK' ? rollbackFailure : null));
    const driver = createSqlDriver(connection, closeNothing);

    const failure = await driver.transaction(failWork).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(TransactionRollbackError);
    expect(failure).toMatchObject({ workError: { message: 'boom' }, rollbackError: rollbackFailure });
  });

  it('retries the rollback before the next operation, which then runs', async () => {
    let attempts = 0;
    const { connection, statements } = fakeConnection((sql) => {
      if (sql !== 'ROLLBACK') return null;
      attempts += 1;
      return attempts === 1 ? new Error('busy') : null;
    });
    const driver = createSqlDriver(connection, closeNothing);
    await driver.transaction(failWork).catch(() => undefined);

    await driver.run('INSERT next');
    await driver.transaction(async () => 'again');

    expect(statements).toEqual([
      'BEGIN IMMEDIATE',
      'ROLLBACK',
      'ROLLBACK',
      'INSERT next',
      'BEGIN IMMEDIATE',
      'COMMIT',
    ]);
  });

  it('refuses to run anything while the transaction stays open, and can still close', async () => {
    const { connection, statements } = fakeConnection((sql) =>
      sql === 'ROLLBACK' ? new Error('busy') : null,
    );
    const closed = jest.fn(closeNothing);
    const driver = createSqlDriver(connection, closed);
    await driver.transaction(failWork).catch(() => undefined);

    await expect(driver.run('INSERT next')).rejects.toBeInstanceOf(TransactionRollbackError);

    expect(statements).not.toContain('INSERT next');
    await driver.close();
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('treats a transaction SQLite already rolled back as rolled back', async () => {
    const { connection } = fakeConnection((sql) =>
      sql === 'ROLLBACK' ? new Error('cannot rollback - no transaction is active') : null,
    );
    const driver = createSqlDriver(connection, closeNothing);

    await expect(driver.transaction(failWork)).rejects.toThrow('boom');
    await expect(driver.run('INSERT next')).resolves.toBeUndefined();
  });
});

describe('SqlDriver re-entrancy', () => {
  let driver: SqlDriver;

  beforeEach(async () => {
    driver = createNodeSqliteDriver(':memory:', { stallTimeoutMs: 20 });
    await driver.exec('CREATE TABLE items (name TEXT NOT NULL)');
  });

  afterEach(() => driver.close());

  it('rejects a top-level call awaited inside a transaction and rolls back', async () => {
    await expect(
      driver.transaction(async (tx) => {
        await tx.run('INSERT INTO items VALUES (?)', ['a']);
        await driver.all('SELECT name FROM items');
      }),
    ).rejects.toBeInstanceOf(ReentrantTransactionError);

    await expect(driver.all('SELECT name FROM items')).resolves.toEqual([]);
  });

  it('rejects a nested top-level transaction', async () => {
    await expect(
      driver.transaction(() => driver.transaction(async () => 'inner')),
    ).rejects.toBeInstanceOf(ReentrantTransactionError);
  });

  it('never runs a rejected statement later', async () => {
    await driver.transaction(async () => {
      await driver.run('INSERT INTO items VALUES (?)', ['rejected']).catch(() => undefined);
    });

    await expect(driver.all('SELECT name FROM items')).resolves.toEqual([]);
  });

  it('leaves a caller waiting on a transaction that is still executing statements', async () => {
    const { connection } = fakeConnection();
    const slow: SqlStatements = {
      ...connection,
      run: async (sql, params) => {
        await new Promise((resolve) => setTimeout(resolve, 15));
        await connection.run(sql, params);
      },
    };
    const busy = createSqlDriver(slow, async () => undefined, { stallTimeoutMs: 20 });

    const transaction = busy.transaction(async (tx) => {
      for (let step = 0; step < 6; step += 1) await tx.run('UPDATE step');
      return 'done';
    });
    const waiting = busy.get('SELECT outside');

    await expect(transaction).resolves.toBe('done');
    await expect(waiting).resolves.toBeUndefined();
  });
});

describe('SqlDriver stall deadline', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const stalledDriver = async (stallTimeoutMs: number) => {
    const driver = createSqlDriver(fakeConnection().connection, async () => undefined, {
      stallTimeoutMs,
    });
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const transaction = driver.transaction(() => gate);
    await jest.advanceTimersByTimeAsync(0);
    return { driver, transaction, release };
  };

  it('runs from the first waiter, so steady arrivals do not postpone detection', async () => {
    const { driver, transaction, release } = await stalledDriver(100);
    const failures: unknown[] = [];
    const wait = () => {
      driver.get('SELECT outside').catch((error: unknown) => failures.push(error));
    };

    wait();
    for (let arrival = 0; arrival < 9; arrival += 1) {
      await jest.advanceTimersByTimeAsync(10);
      wait();
    }
    expect(failures).toEqual([]);

    await jest.advanceTimersByTimeAsync(10);

    expect(failures).toHaveLength(10);
    for (const failure of failures) expect(failure).toBeInstanceOf(ReentrantTransactionError);
    release();
    await transaction;
  });

  it('starts a fresh period for a waiter arriving after a detection', async () => {
    const { driver, transaction, release } = await stalledDriver(100);
    const first = driver.get('SELECT outside').catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(100);
    await expect(first).resolves.toBeInstanceOf(ReentrantTransactionError);

    let settled = false;
    const second = driver
      .get('SELECT outside')
      .catch((error: unknown) => error)
      .finally(() => {
        settled = true;
      });
    await jest.advanceTimersByTimeAsync(99);
    expect(settled).toBe(false);

    await jest.advanceTimersByTimeAsync(1);
    await expect(second).resolves.toBeInstanceOf(ReentrantTransactionError);
    release();
    await transaction;
  });
});

describe('assertForeignKeysEnabled', () => {
  it('passes on a connection that enforces them', async () => {
    const driver = createNodeSqliteDriver();

    await expect(assertForeignKeysEnabled(driver)).resolves.toBeUndefined();
    await driver.close();
  });

  it('fails when they read back as off', async () => {
    const driver = createNodeSqliteDriver();
    await driver.exec('PRAGMA foreign_keys = OFF');

    await expect(assertForeignKeysEnabled(driver)).rejects.toThrow(/foreign keys/i);
    await driver.close();
  });
});

describe('assertSecureDeleteEnabled', () => {
  const answering = (row: { secure_delete: number } | undefined) => ({
    get: async <Row>() => row as Row | undefined,
  });

  it('accepts a connection that reports it on', async () => {
    await expect(assertSecureDeleteEnabled(answering({ secure_delete: 1 }))).resolves.toBeUndefined();
  });

  it.each([[{ secure_delete: 0 }], [undefined]])('refuses %j', async (row) => {
    await expect(assertSecureDeleteEnabled(answering(row))).rejects.toThrow('secure_delete');
  });

  it('reads back what real SQLite reports', async () => {
    const driver = createNodeSqliteDriver();
    await driver.exec('PRAGMA secure_delete = ON;');
    await expect(assertSecureDeleteEnabled(driver)).resolves.toBeUndefined();
    await driver.close();
  });
});
