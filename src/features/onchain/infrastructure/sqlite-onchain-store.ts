import { createLedgerRepositories } from '@/features/ledger/infrastructure/sqlite-ledger-store';
import type { SqlExecutor } from '@/shared/persistence/sql-driver';

import type { OnChainRepositories, OnChainStore } from '../application/ports';
import { createSqliteOnChainRepository } from './sqlite-onchain-repository';

const createRepositories = (sql: SqlExecutor): OnChainRepositories => ({
  ...createLedgerRepositories(sql),
  onchain: createSqliteOnChainRepository(sql),
});

export function createSqliteOnChainStore(driver: SqlExecutor): OnChainStore {
  return {
    ...createRepositories(driver),
    atomic: (work) => driver.transaction((tx) => work(createRepositories(tx))),
  };
}
