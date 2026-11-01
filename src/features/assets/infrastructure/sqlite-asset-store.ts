import {
  createLedgerRepositories,
  type ChangeGuardFactory,
  type CurrencyUsageFactory,
} from '@/features/ledger/infrastructure/sqlite-ledger-store';
import type { RulePostHookFactory } from '@/features/rules/infrastructure/sqlite-rule-store';
import type { SqlExecutor } from '@/shared/persistence/sql-driver';

import { createAssetChangeGuard, linkFromRule } from '../application/link-use-cases';
import type { AssetRepositories, AssetStore } from '../application/ports';
import { createSqliteAssetRepository } from './sqlite-asset-repository';

export const assetCurrencyUsage: CurrencyUsageFactory = (sql) => {
  const assets = createSqliteAssetRepository(sql);
  return { isInUse: (code) => assets.isCurrencyInUse(code) };
};

const createRepositories = (sql: SqlExecutor): AssetRepositories => ({
  ...createLedgerRepositories(sql),
  assets: createSqliteAssetRepository(sql),
});

export const assetRulePostHook: RulePostHookFactory = (sql) => {
  const repositories = createRepositories(sql);
  return { afterPost: (ruleId, transaction) => linkFromRule(repositories, ruleId, transaction) };
};

export const assetChangeGuard: ChangeGuardFactory = (sql) =>
  createAssetChangeGuard(createRepositories(sql));

export function createSqliteAssetStore(driver: SqlExecutor): AssetStore {
  return {
    ...createRepositories(driver),
    atomic: (work) => driver.transaction((tx) => work(createRepositories(tx))),
  };
}
