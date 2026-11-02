import {
  createLedgerRepositories,
  type ChangeGuardFactory,
} from '@/features/ledger/infrastructure/sqlite-ledger-store';
import type { SqlExecutor } from '@/shared/persistence/sql-driver';

import type {
  ImportedRowRepository,
  TransferRepositories,
  TransferStore,
} from '../application/ports';

/** Below the 999 bound parameters some SQLite builds allow in one statement. */
const CHUNK_SIZE = 500;

function createImportedRowRepository(sql: SqlExecutor): ImportedRowRepository {
  return {
    findKnown: async (fingerprints) => {
      const known = new Set<string>();
      for (let start = 0; start < fingerprints.length; start += CHUNK_SIZE) {
        const chunk = fingerprints.slice(start, start + CHUNK_SIZE);
        const marks = chunk.map(() => '?').join(', ');
        const rows = await sql.all<{ fingerprint: string }>(
          `SELECT fingerprint FROM imported_rows WHERE fingerprint IN (${marks})`,
          chunk,
        );
        for (const { fingerprint } of rows) known.add(fingerprint);
      }
      return known;
    },
    save: (fingerprint, transactionId, batchId) =>
      sql.run('INSERT INTO imported_rows (fingerprint, transaction_id, batch_id) VALUES (?, ?, ?)', [
        fingerprint,
        transactionId,
        batchId,
      ]),
    listBatch: async (batchId) => {
      const rows = await sql.all<{ transaction_id: string }>(
        'SELECT transaction_id FROM imported_rows WHERE batch_id = ?',
        [batchId],
      );
      return rows.map(({ transaction_id: id }) => id);
    },
  };
}

/** The guard is required, because undoing an import deletes transactions other features use. */
export function createSqliteTransferStore(
  driver: SqlExecutor,
  changeGuard: ChangeGuardFactory,
): TransferStore {
  const repositories = (sql: SqlExecutor): TransferRepositories => ({
    ...createLedgerRepositories(sql, changeGuard),
    importedRows: createImportedRowRepository(sql),
  });
  return {
    ...repositories(driver),
    atomic: (work) => driver.transaction((tx) => work(repositories(tx))),
  };
}
