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

export type SqlDriverOptions = {
  /** How long a transaction may sit with no statement running while another caller waits. */
  readonly stallTimeoutMs?: number;
};

/** A transaction may still be open. Nothing runs until a later rollback succeeds. */
export class TransactionRollbackError extends Error {
  constructor(
    readonly workError: unknown,
    readonly rollbackError: unknown,
  ) {
    super('The database could not undo a failed change. Restart the app if this persists.');
    this.name = 'TransactionRollbackError';
  }
}

export class ReentrantTransactionError extends Error {
  constructor() {
    super(
      'A database call waited on a running transaction. ' +
        'Inside a transaction, use only the handle passed to its work.',
    );
    this.name = 'ReentrantTransactionError';
  }
}

export async function assertForeignKeysEnabled(connection: Pick<SqlStatements, 'get'>) {
  const row = await connection.get<{ foreign_keys: number }>('PRAGMA foreign_keys');
  if (row?.foreign_keys !== 1) {
    throw new Error('SQLite foreign keys are off, so the ledger cannot be opened safely.');
  }
}

const DEFAULT_STALL_TIMEOUT_MS = 2000;

/** SQLite undoes the transaction itself on some errors, which makes ROLLBACK fail harmlessly. */
const ALREADY_ROLLED_BACK = /no transaction is active/i;

type Waiter = { readonly reject: (reason: unknown) => void };

/**
 * Wraps one connection. Every top-level operation runs through a queue, so a
 * statement issued during a transaction can never land inside it.
 *
 * That queue deadlocks if a transaction's work awaits a top-level call, because
 * the call waits for the transaction and the transaction waits for the call.
 * Hermes has no `AsyncLocalStorage`, so a call cannot be traced to the work that
 * made it, and an unrelated caller must keep queueing. A stall gives it away
 * instead: statements resume in microtasks, so a timer only fires while the work
 * awaits something else. Then every waiter is rejected, which frees the work.
 */
export function createSqlDriver(
  connection: SqlStatements,
  close: () => Promise<void>,
  { stallTimeoutMs = DEFAULT_STALL_TIMEOUT_MS }: SqlDriverOptions = {},
): SqlDriver {
  let queue: Promise<unknown> = Promise.resolve();
  const waiters = new Set<Waiter>();
  let workRunning = false;
  let statementsRunning = 0;
  let stallTimer: ReturnType<typeof setTimeout> | null = null;
  let rollbackPending = false;

  function stopStallTimer() {
    if (stallTimer !== null) clearTimeout(stallTimer);
    stallTimer = null;
  }

  /** Leaves a running timer alone, so later arrivals cannot postpone the deadline. */
  function watchForStall() {
    if (!workRunning || statementsRunning > 0 || waiters.size === 0) {
      stopStallTimer();
      return;
    }
    if (stallTimer !== null) return;
    stallTimer = setTimeout(() => {
      stallTimer = null;
      const rejected = [...waiters];
      waiters.clear();
      for (const waiter of rejected) waiter.reject(new ReentrantTransactionError());
    }, stallTimeoutMs);
  }

  function schedule<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(operation, operation);
    queue = result.catch(() => undefined);
    return result;
  }

  /** Resolves to the failure, if any. A transaction SQLite already undid is not one. */
  async function tryRollback(): Promise<{ readonly error: unknown } | null> {
    try {
      await connection.exec('ROLLBACK');
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      return ALREADY_ROLLED_BACK.test(message) ? null : { error };
    }
  }

  async function settlePendingRollback() {
    if (!rollbackPending) return;
    const failure = await tryRollback();
    if (failure) throw new TransactionRollbackError(null, failure.error);
    rollbackPending = false;
  }

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const waiter: Waiter = { reject };
      waiters.add(waiter);
      watchForStall();
      void schedule(async () => {
        if (!waiters.delete(waiter)) return;
        try {
          await settlePendingRollback();
          resolve(await operation());
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  function tracked<T>(statement: () => Promise<T>): Promise<T> {
    statementsRunning += 1;
    stopStallTimer();
    return statement().finally(() => {
      statementsRunning -= 1;
      watchForStall();
    });
  }

  let savepoints = 0;

  async function withinSavepoint<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    savepoints += 1;
    const name = `sp_${savepoints}`;
    await transactionHandle.exec(`SAVEPOINT ${name}`);
    try {
      const value = await work(transactionHandle);
      await transactionHandle.exec(`RELEASE ${name}`);
      return value;
    } catch (error) {
      await transactionHandle.exec(`ROLLBACK TO ${name}`);
      await transactionHandle.exec(`RELEASE ${name}`);
      throw error;
    }
  }

  const transactionHandle: SqlExecutor = {
    exec: (sql) => tracked(() => connection.exec(sql)),
    run: (sql, params) => tracked(() => connection.run(sql, params)),
    all: <Row>(sql: string, params?: readonly SqlValue[]) =>
      tracked(() => connection.all<Row>(sql, params)),
    get: <Row>(sql: string, params?: readonly SqlValue[]) =>
      tracked(() => connection.get<Row>(sql, params)),
    transaction: withinSavepoint,
  };

  function finishWork() {
    workRunning = false;
    stopStallTimer();
  }

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
        workRunning = true;
        watchForStall();
        try {
          const value = await work(transactionHandle);
          finishWork();
          await connection.exec('COMMIT');
          return value;
        } catch (error) {
          finishWork();
          const failure = await tryRollback();
          if (failure) {
            rollbackPending = true;
            throw new TransactionRollbackError(error, failure.error);
          }
          throw error;
        }
      }),
    // Skips the pending rollback: closing the connection discards the transaction anyway.
    close: () => schedule(close),
  };
}
