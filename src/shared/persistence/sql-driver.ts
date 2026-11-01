export type SqlValue = string | number | null;

export interface SqlStatements {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: readonly SqlValue[]): Promise<void>;
  all<Row>(sql: string, params?: readonly SqlValue[]): Promise<Row[]>;
  get<Row>(sql: string, params?: readonly SqlValue[]): Promise<Row | undefined>;
}

export interface SqlExecutor extends SqlStatements {
  transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T>;
}

export interface SqlDriver extends SqlExecutor {
  close(): Promise<void>;
}

/**
 * Wraps one connection. Every top-level operation runs through a queue, so a
 * statement issued during a transaction can never land inside it.
 */
export function createSqlDriver(connection: SqlStatements, close: () => Promise<void>): SqlDriver {
  let queue: Promise<unknown> = Promise.resolve();

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(operation, operation);
    queue = result.catch(() => undefined);
    return result;
  }

  let savepoints = 0;

  async function withinSavepoint<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    savepoints += 1;
    const name = `sp_${savepoints}`;
    await connection.exec(`SAVEPOINT ${name}`);
    try {
      const value = await work(transactionHandle);
      await connection.exec(`RELEASE ${name}`);
      return value;
    } catch (error) {
      await connection.exec(`ROLLBACK TO ${name}`);
      await connection.exec(`RELEASE ${name}`);
      throw error;
    }
  }

  const transactionHandle: SqlExecutor = {
    exec: (sql) => connection.exec(sql),
    run: (sql, params) => connection.run(sql, params),
    all: (sql, params) => connection.all(sql, params),
    get: (sql, params) => connection.get(sql, params),
    transaction: withinSavepoint,
  };

  return {
    exec: (sql) => enqueue(() => connection.exec(sql)),
    run: (sql, params) => enqueue(() => connection.run(sql, params)),
    all: <Row>(sql: string, params?: readonly SqlValue[]) =>
      enqueue(() => connection.all<Row>(sql, params)),
    get: <Row>(sql: string, params?: readonly SqlValue[]) =>
      enqueue(() => connection.get<Row>(sql, params)),
    transaction: (work) =>
      enqueue(async () => {
        await connection.exec('BEGIN IMMEDIATE');
        try {
          const value = await work(transactionHandle);
          await connection.exec('COMMIT');
          return value;
        } catch (error) {
          await connection.exec('ROLLBACK').catch(() => undefined);
          throw error;
        }
      }),
    close: () => enqueue(close),
  };
}
