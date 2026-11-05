import type { SqlDriver, SqlExecutor } from '@/shared/persistence/sql-driver';
import { runMigrations, type Migration } from '@/shared/persistence/migrator';

import { schemaAt } from '../domain/backup-tables';
import type { BackupCell, BackupSnapshot, BackupTable } from '../domain/backup-snapshot';

/** What the service needs from the database, kept narrow so it can be tested on its own. */
export type BackupStore = {
  /** The schema version the database is at right now. */
  version(): Promise<number>;
  /** Every table of the schema at that version, ready to be sealed into a file. */
  read(version: number): Promise<readonly BackupTable[]>;
  /** Replaces everything, in one transaction: a failure leaves the previous data untouched. */
  replaceAll(snapshot: BackupSnapshot): Promise<void>;
};

/** Identifiers come from the migrations, but a quote keeps a stray name from changing the SQL. */
const quote = (name: string): string => `"${name.replace(/"/g, '""')}"`;

const TABLES = "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'";

/**
 * Message text is never written to a backup, and an unmatched entry carries no ledged fact, so
 * it is left behind. The column stays, holding nothing, so the file fits the same schema.
 */
function withoutMessageText(table: BackupTable): BackupTable {
  const [statusAt, bodyAt] = ['status', 'body'].map((column) => table.columns.indexOf(column));
  const rows = table.rows
    .filter((row) => statusAt < 0 || row[statusAt] !== 'unmatched')
    .map((row) => (bodyAt < 0 ? [...row] : row.map((cell, at) => (at === bodyAt ? null : cell))));
  return { ...table, rows };
}

export function createSqliteBackupStore(
  driver: SqlExecutor,
  migrations: readonly Migration[],
): BackupStore {
  async function read(version: number): Promise<readonly BackupTable[]> {
    const tables: BackupTable[] = [];
    for (const table of schemaAt(version)) {
      const columns = table.columns.map((column) => column.name);
      const rows = await driver.all<Record<string, BackupCell>>(
        `SELECT ${columns.map(quote).join(', ')} FROM ${quote(table.name)}`,
      );
      const tuples = rows.map((row) => columns.map((column) => row[column] ?? null));
      const read = { name: table.name, columns, rows: tuples };
      tables.push(table.name === 'inbox_items' ? withoutMessageText(read) : read);
    }
    return tables;
  }

  async function replaceAll(snapshot: BackupSnapshot): Promise<void> {
    // SQLite cannot toggle foreign key enforcement inside a transaction. Dropping a parent
    // before its children would make the remaining constraints unresolvable, so enforcement is
    // turned off for the rebuild and the restored rows are checked explicitly before commit.
    await driver.exec('PRAGMA foreign_keys = OFF');
    try {
      await driver.transaction(async (tx) => {
        // The whole schema is dropped and rebuilt from the file's own version, so every later
        // migration runs over the restored rows and a half-applied one is never left behind.
        const existing = await tx.all<{ name: string }>(TABLES);
        for (const { name } of existing) await tx.exec(`DROP TABLE IF EXISTS ${quote(name)}`);

        // Migrations run through savepoints on the same handle, so a failure undoes the drop too.
        const sql = tx as unknown as SqlDriver;
        const base = migrations.filter(({ version }) => version <= snapshot.schemaVersion);
        await runMigrations(sql, base);

        // Migrations seed rows of their own; a restore replaces them with what the file holds.
        for (const table of snapshot.tables) {
          await tx.exec(`DELETE FROM ${quote(table.name)}`);
        }

        for (const table of snapshot.tables) {
          const columns = table.columns.map(quote).join(', ');
          const placeholders = table.columns.map(() => '?').join(', ');
          const insert = `INSERT INTO ${quote(table.name)} (${columns}) VALUES (${placeholders})`;
          for (const row of table.rows) await tx.run(insert, row);
        }

        await runMigrations(sql, migrations);

        const violations = await tx.all('PRAGMA foreign_key_check');
        if (violations.length > 0) throw new Error('A restored row points at nothing.');
      });
    } finally {
      await driver.exec('PRAGMA foreign_keys = ON');
    }
  }

  return {
    version: async () => {
      const row = await driver.get<{ version: number | null }>(
        'SELECT MAX(version) AS version FROM schema_migrations',
      );
      return row?.version ?? 0;
    },
    read,
    replaceAll,
  };
}
