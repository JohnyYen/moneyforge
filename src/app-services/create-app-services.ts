import { createLedgerService } from '@/features/ledger/application/ledger-service';
import type { Clock, IdGenerator } from '@/features/ledger/application/ports';
import {
  absentMessageCapture,
  createMessageCapture,
  type MessageCapturePort,
} from '@/features/rules/application/message-capture';
import type { ExpectedCashFlowSource } from '@/features/planning/application/ports';
import { createPlanningService } from '@/features/planning/application/planning-service';
import { createSqlitePlanningStore } from '@/features/planning/infrastructure/sqlite-planning-store';
import type { SecretGenerator } from '@/features/rules/application/ports';
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
  readonly generateSecret: SecretGenerator;
  readonly messageCapture?: MessageCapturePort;
  readonly expectedSources?: readonly ExpectedCashFlowSource[];
}) {
  const { driver, clock, generateId, generateSecret } = deps;
  const rules = createRulesService({
    store: createSqliteRuleStore(driver),
    clock,
    generateId,
    generateSecret,
    // A failed sync runs again on the next foreground, and must not fail a saved source.
    onSourcesChanged: () => capture.syncSenders().catch(() => undefined),
  });
  const capture = createMessageCapture({
    port: deps.messageCapture ?? absentMessageCapture,
    rules,
  });
  return {
    ledger: createLedgerService({
      store: createSqliteLedgerStore(driver, splitChangeGuard),
      clock,
      generateId,
    }),
    split: createSplitService({ store: createSqliteSplitStore(driver), clock, generateId }),
    planning: createPlanningService({
      store: createSqlitePlanningStore(driver),
      clock,
      generateId,
      expectedSources: deps.expectedSources,
    }),
    rules,
    capture,
  };
}

export type AppServices = ReturnType<typeof createAppServices>;
