import { createLedgerRepositories } from '@/features/ledger/infrastructure/sqlite-ledger-store';
import { createSqliteSplitRepository } from '@/features/split/infrastructure/sqlite-split-repository';
import { splitChangeGuard } from '@/features/split/infrastructure/sqlite-split-store';
import type { SqlExecutor } from '@/shared/persistence/sql-driver';

import type { RuleRepositories, RuleStore } from '../application/ports';
import { createSqliteRuleRepository } from './sqlite-rule-repository';

const createRepositories = (sql: SqlExecutor): RuleRepositories => ({
  ...createLedgerRepositories(sql, splitChangeGuard),
  splits: createSqliteSplitRepository(sql),
  rules: createSqliteRuleRepository(sql),
});

export function createSqliteRuleStore(driver: SqlExecutor): RuleStore {
  return {
    ...createRepositories(driver),
    atomic: (work) => driver.transaction((tx) => work(createRepositories(tx))),
  };
}
