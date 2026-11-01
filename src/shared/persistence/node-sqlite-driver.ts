import { DatabaseSync } from 'node:sqlite';

import {
  createSqlDriver,
  type SqlDriver,
  type SqlDriverOptions,
  type SqlValue,
} from './sql-driver';

/** Test adapter: runs the production SQL and driver logic on `node:sqlite`. */
export function createNodeSqliteDriver(path = ':memory:', options?: SqlDriverOptions): SqlDriver {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');

  return createSqlDriver(
    {
      exec: async (sql) => {
        db.exec(sql);
      },
      run: async (sql, params: readonly SqlValue[] = []) => {
        db.prepare(sql).run(...params);
      },
      all: async <Row>(sql: string, params: readonly SqlValue[] = []) =>
        db.prepare(sql).all(...params).map((row) => ({ ...row })) as Row[],
      get: async <Row>(sql: string, params: readonly SqlValue[] = []) => {
        const row = db.prepare(sql).get(...params);
        return (row ? { ...row } : undefined) as Row | undefined;
      },
    },
    async () => db.close(),
    options,
  );
}
