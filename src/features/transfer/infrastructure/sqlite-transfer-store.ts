import { createLedgerRepositories } from '@/features/ledger/infrastructure/sqlite-ledger-store';
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
    save: (fingerprint, transactionId) =>
      sql.run('INSERT INTO imported_rows (fingerprint, transaction_id) VALUES (?, ?)', [
        fingerprint,
        transactionId,
      ]),
  };
}

export function createSqliteTransferStore(driver: SqlExecutor): TransferStore {
  const repositories = (sql: SqlExecutor): TransferRepositories => ({
    ...createLedgerRepositories(sql),
    importedRows: createImportedRowRepository(sql),
  });
  return {
    ...repositories(driver),
    atomic: (work) => driver.transaction((tx) => work(repositories(tx))),
  };
}
