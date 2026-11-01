import type { SqlDriver } from './sql-driver';

export type Migration = {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
};

export async function runMigrations(
  driver: SqlDriver,
  migrations: readonly Migration[],
): Promise<void> {
  const ordered = [...migrations].sort((a, b) => a.version - b.version);
  ordered.forEach((migration, index) => {
    if (index > 0 && ordered[index - 1].version === migration.version) {
      throw new Error(`Duplicate migration version: ${migration.version}`);
    }
  });

  await driver.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version INTEGER PRIMARY KEY,
       name TEXT NOT NULL
     )`,
  );
  const applied = await driver.all<{ version: number }>('SELECT version FROM schema_migrations');
  const appliedVersions = new Set(applied.map((row) => row.version));

  for (const migration of ordered) {
    if (appliedVersions.has(migration.version)) continue;
    await driver.transaction(async (tx) => {
      await tx.exec(migration.sql);
      await tx.run('INSERT INTO schema_migrations (version, name) VALUES (?, ?)', [
        migration.version,
        migration.name,
      ]);
    });
  }
}
