import { openDatabaseAsync } from 'expo-sqlite';

import { createSqlDriver, type SqlDriver, type SqlValue } from './sql-driver';

/**
 * Uses one connection on purpose: `withExclusiveTransactionAsync` opens a second
 * connection, where `PRAGMA foreign_keys` would not apply. `createSqlDriver`
 * serializes access instead.
 */
export async function openExpoSqliteDriver(databaseName: string): Promise<SqlDriver> {
  const db = await openDatabaseAsync(databaseName);
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

  return createSqlDriver(
    {
      exec: (sql) => db.execAsync(sql),
      run: async (sql, params: readonly SqlValue[] = []) => {
        await db.runAsync(sql, [...params]);
      },
      all: <Row>(sql: string, params: readonly SqlValue[] = []) =>
        db.getAllAsync<Row>(sql, [...params]),
      get: async <Row>(sql: string, params: readonly SqlValue[] = []) =>
        (await db.getFirstAsync<Row>(sql, [...params])) ?? undefined,
    },
    () => db.closeAsync(),
  );
}
