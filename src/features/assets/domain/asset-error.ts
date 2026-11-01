import type { PlanningErrorCode } from '@/features/planning/domain/planning-error';

export type AssetErrorCode =
  | PlanningErrorCode
  | 'invalid-asset'
  | 'invalid-asset-type'
  | 'invalid-valuation'
  | 'invalid-stream'
  | 'invalid-link';

export type AssetError = { readonly code: AssetErrorCode; readonly message: string };

export function assetError(code: AssetErrorCode, message: string): AssetError {
  return { code, message };
}
