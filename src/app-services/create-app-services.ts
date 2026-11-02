import { createAssetService } from '@/features/assets/application/asset-service';
import {
  assetChangeGuard,
  assetCurrencyUsage,
  assetRulePostHook,
  createSqliteAssetStore,
} from '@/features/assets/infrastructure/sqlite-asset-store';
import { createLedgerService } from '@/features/ledger/application/ledger-service';
import type { Clock, IdGenerator } from '@/features/ledger/application/ports';
import {
  absentMessageCapture,
  createMessageCapture,
  type MessageCapturePort,
} from '@/features/rules/application/message-capture';
import { createOnChainService } from '@/features/onchain/application/onchain-service';
import {
  absentOnChainClient,
  type OnChainClient,
} from '@/features/onchain/application/ports';
import { createSqliteOnChainStore } from '@/features/onchain/infrastructure/sqlite-onchain-store';
import type { ExpectedCashFlowSource } from '@/features/planning/application/ports';
import { createPlanningService } from '@/features/planning/application/planning-service';
import {
  createSqlitePlanningStore,
  planningCurrencyUsage,
} from '@/features/planning/infrastructure/sqlite-planning-store';
import type { SecretGenerator } from '@/features/rules/application/ports';
import {
  createSqliteLedgerStore,
  type ChangeGuardFactory,
  type CurrencyUsageFactory,
} from '@/features/ledger/infrastructure/sqlite-ledger-store';
import { createRulesService } from '@/features/rules/application/rules-service';
import { createSqliteRuleStore } from '@/features/rules/infrastructure/sqlite-rule-store';
import { createSplitService } from '@/features/split/application/split-service';
import { createTransferService } from '@/features/transfer/application/transfer-service';
import { createSqliteTransferStore } from '@/features/transfer/infrastructure/sqlite-transfer-store';
import {
  createSqliteSplitStore,
  splitChangeGuard,
} from '@/features/split/infrastructure/sqlite-split-store';
import type { SqlExecutor } from '@/shared/persistence/sql-driver';

const currencyUsage: CurrencyUsageFactory = (sql) => {
  const [planning, assets] = [planningCurrencyUsage(sql), assetCurrencyUsage(sql)];
  return {
    isInUse: async (code) => (await planning.isInUse(code)) || assets.isInUse(code),
  };
};

/** Split may refuse, and refusing must come before any write, so assets adapt after it. */
const transactionGuard: ChangeGuardFactory = (sql) => {
  const [split, assets] = [splitChangeGuard(sql), assetChangeGuard(sql)];
  return {
    beforeUpdate: async (existing, next, options) => {
      const allowed = await split.beforeUpdate(existing, next, options);
      return allowed.ok ? assets.beforeUpdate(existing, next, options) : allowed;
    },
    beforeDelete: async (existing, options) => {
      const allowed = await split.beforeDelete(existing, options);
      return allowed.ok ? assets.beforeDelete(existing, options) : allowed;
    },
  };
};

/** The one place that knows which features exist and how they depend on each other. */
export function createAppServices(deps: {
  readonly driver: SqlExecutor;
  readonly clock: Clock;
  readonly generateId: IdGenerator;
  readonly generateSecret: SecretGenerator;
  readonly messageCapture?: MessageCapturePort;
  readonly onChainClient?: OnChainClient;
  readonly expectedSources?: readonly ExpectedCashFlowSource[];
}) {
  const { driver, clock, generateId, generateSecret } = deps;
  const rules = createRulesService({
    store: createSqliteRuleStore(driver, assetRulePostHook),
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
  const assets = createAssetService({ store: createSqliteAssetStore(driver), clock, generateId });
  return {
    ledger: createLedgerService({
      store: createSqliteLedgerStore(driver, transactionGuard, currencyUsage),
      clock,
      generateId,
    }),
    split: createSplitService({ store: createSqliteSplitStore(driver), clock, generateId }),
    planning: createPlanningService({
      store: createSqlitePlanningStore(driver),
      clock,
      generateId,
      expectedSources: [assets.expectedSource, ...(deps.expectedSources ?? [])],
    }),
    assets,
    rules,
    capture,
    onchain: createOnChainService({
      store: createSqliteOnChainStore(driver),
      clock,
      generateId,
      client: deps.onChainClient ?? absentOnChainClient,
    }),
    transfer: createTransferService({
      store: createSqliteTransferStore(driver),
      clock,
      generateId,
      // One secret to carry through a backup, or stored keys would stop matching.
      loadSecret: rules.loadDedupSecret,
    }),
  };
}

export type AppServices = ReturnType<typeof createAppServices>;
