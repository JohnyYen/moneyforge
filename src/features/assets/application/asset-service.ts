import { createAssetReportUseCases } from './asset-report-use-cases';
import { createAssetUseCases } from './asset-use-cases';
import { createLinkUseCases } from './link-use-cases';
import type { AssetDeps } from './ports';

export function createAssetService(deps: AssetDeps) {
  return {
    ...createAssetUseCases(deps),
    ...createLinkUseCases(deps),
    ...createAssetReportUseCases(deps),
  };
}

export type AssetService = ReturnType<typeof createAssetService>;
