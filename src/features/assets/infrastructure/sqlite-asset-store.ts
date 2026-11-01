import {
  createLedgerRepositories,
  type CurrencyUsageFactory,
} from '@/features/ledger/infrastructure/sqlite-ledger-store';
import type { RulePostHookFactory } from '@/features/rules/infrastructure/sqlite-rule-store';
import type { SqlExecutor } from '@/shared/persistence/sql-driver';

import { linkFromRule } from '../application/link-use-cases';
import type { AssetRepositories, AssetStore } from '../application/ports';
import { createSqliteAssetRepository } from './sqlite-asset-repository';

export const assetCurrencyUsage: CurrencyUsageFactory = (sql) => {
  const assets = createSqliteAssetRepository(sql);
  return { isInUse: (code) => assets.isCurrencyInUse(code) };
};

export const assetRulePostHook: RulePostHookFactory = (sql) => {
  const assets = createSqliteAssetRepository(sql);
  return { afterPost: (ruleId, transaction) => linkFromRule(assets, ruleId, transaction) };
};

const createRepositories = (sql: SqlExecutor): AssetRepositories => ({
  ...createLedgerRepositories(sql),
  assets: createSqliteAssetRepository(sql),
});

export function createSqliteAssetStore(driver: SqlExecutor): AssetStore {
  return {
    ...createRepositories(driver),
    atomic: (work) => driver.transaction((tx) => work(createRepositories(tx))),
  };
}
