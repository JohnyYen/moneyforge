import { openDatabaseAsync } from 'expo-sqlite';

import {
  assertForeignKeysEnabled,
  createSqlDriver,
  type SqlDriver,
  type SqlStatements,
  type SqlValue,
} from './sql-driver';

/**
 * Uses one connection on purpose: `withExclusiveTransactionAsync` opens a second
 * connection, where `PRAGMA foreign_keys` would not apply. `createSqlDriver`
 * serializes access instead.
 */
export async function openExpoSqliteDriver(databaseName: string): Promise<SqlDriver> {
  const db = await openDatabaseAsync(databaseName);
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

  const connection: SqlStatements = {
    exec: (sql) => db.execAsync(sql),
    run: async (sql, params: readonly SqlValue[] = []) => {
      await db.runAsync(sql, [...params]);
    },
    all: <Row>(sql: string, params: readonly SqlValue[] = []) =>
      db.getAllAsync<Row>(sql, [...params]),
    get: async <Row>(sql: string, params: readonly SqlValue[] = []) =>
      (await db.getFirstAsync<Row>(sql, [...params])) ?? undefined,
  };

  try {
    await assertForeignKeysEnabled(connection);
  } catch (error) {
    await db.closeAsync();
    throw error;
  }

  return createSqlDriver(connection, () => db.closeAsync());
}
