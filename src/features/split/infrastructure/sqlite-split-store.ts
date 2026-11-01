import {
  createLedgerRepositories,
  type ChangeGuardFactory,
} from '@/features/ledger/infrastructure/sqlite-ledger-store';
import type { SqlExecutor } from '@/shared/persistence/sql-driver';

import type { SplitRepositories, SplitStore } from '../application/ports';
import { createSplitChangeGuard } from '../application/split-change-guard';
import { createSqliteSplitRepository } from './sqlite-split-repository';

export const splitChangeGuard: ChangeGuardFactory = (sql) =>
  createSplitChangeGuard(createSqliteSplitRepository(sql));

const createRepositories = (sql: SqlExecutor): SplitRepositories => ({
  ...createLedgerRepositories(sql, splitChangeGuard),
  splits: createSqliteSplitRepository(sql),
});

export function createSqliteSplitStore(driver: SqlExecutor): SplitStore {
  return {
    ...createRepositories(driver),
    atomic: (work) => driver.transaction((tx) => work(createRepositories(tx))),
  };
}
