import { createLedgerService } from '@/features/ledger/application/ledger-service';
import type { Clock, IdGenerator } from '@/features/ledger/application/ports';
import { createSqliteLedgerStore } from '@/features/ledger/infrastructure/sqlite-ledger-store';
import { createRulesService } from '@/features/rules/application/rules-service';
import { createSqliteRuleStore } from '@/features/rules/infrastructure/sqlite-rule-store';
import { createSplitService } from '@/features/split/application/split-service';
import {
  createSqliteSplitStore,
  splitChangeGuard,
} from '@/features/split/infrastructure/sqlite-split-store';
import type { SqlExecutor } from '@/shared/persistence/sql-driver';

/** The one place that knows which features exist and how they depend on each other. */
export function createAppServices(deps: {
  readonly driver: SqlExecutor;
  readonly clock: Clock;
  readonly generateId: IdGenerator;
}) {
  const { driver, clock, generateId } = deps;
  return {
    ledger: createLedgerService({
      store: createSqliteLedgerStore(driver, splitChangeGuard),
      clock,
      generateId,
    }),
    split: createSplitService({ store: createSqliteSplitStore(driver), clock, generateId }),
    rules: createRulesService({ store: createSqliteRuleStore(driver), clock, generateId }),
  };
}

export type AppServices = ReturnType<typeof createAppServices>;
