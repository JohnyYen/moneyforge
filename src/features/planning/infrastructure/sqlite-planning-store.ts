import { createLedgerRepositories } from '@/features/ledger/infrastructure/sqlite-ledger-store';
import { createSqliteSplitRepository } from '@/features/split/infrastructure/sqlite-split-repository';
import { splitChangeGuard } from '@/features/split/infrastructure/sqlite-split-store';
import type { SqlExecutor } from '@/shared/persistence/sql-driver';

import type { PlanningRepositories, PlanningStore } from '../application/ports';
import { createSqlitePlanningRepository } from './sqlite-planning-repository';

const createRepositories = (sql: SqlExecutor): PlanningRepositories => ({
  ...createLedgerRepositories(sql, splitChangeGuard),
  splits: createSqliteSplitRepository(sql),
  planning: createSqlitePlanningRepository(sql),
});

export function createSqlitePlanningStore(driver: SqlExecutor): PlanningStore {
  return {
    ...createRepositories(driver),
    atomic: (work) => driver.transaction((tx) => work(createRepositories(tx))),
  };
}
