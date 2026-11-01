import { createLedgerRepositories } from '@/features/ledger/infrastructure/sqlite-ledger-store';
import { createSqliteSplitRepository } from '@/features/split/infrastructure/sqlite-split-repository';
import { splitChangeGuard } from '@/features/split/infrastructure/sqlite-split-store';
import type { SqlExecutor } from '@/shared/persistence/sql-driver';

import type { RulePostHook, RuleRepositories, RuleStore } from '../application/ports';
import { createSqliteRuleRepository } from './sqlite-rule-repository';

/** Builds a hook bound to one connection or transaction. */
export type RulePostHookFactory = (sql: SqlExecutor) => RulePostHook;

const noHook: RulePostHookFactory = () => ({ afterPost: async () => undefined });

export function createSqliteRuleStore(
  driver: SqlExecutor,
  postHook: RulePostHookFactory = noHook,
): RuleStore {
  const createRepositories = (sql: SqlExecutor): RuleRepositories => ({
    ...createLedgerRepositories(sql, splitChangeGuard),
    splits: createSqliteSplitRepository(sql),
    rules: createSqliteRuleRepository(sql),
    postHook: postHook(sql),
  });
  return {
    ...createRepositories(driver),
    atomic: (work) => driver.transaction((tx) => work(createRepositories(tx))),
  };
}
