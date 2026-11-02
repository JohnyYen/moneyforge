import type { Migration } from '../migrator';

/** A row's fingerprint leaves with its transaction, so a deleted entry can be imported again. */
export const transferMigration: Migration = {
  version: 7,
  name: 'transfer',
  sql: `
    CREATE TABLE imported_rows (
      fingerprint TEXT PRIMARY KEY,
      transaction_id TEXT NOT NULL REFERENCES transactions (id) ON DELETE CASCADE
    );
    CREATE INDEX imported_rows_transaction ON imported_rows (transaction_id);
  `,
};
