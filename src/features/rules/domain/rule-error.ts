import type { SplitErrorCode } from '@/features/split/domain/split-error';

export type RuleErrorCode =
  | SplitErrorCode
  | 'invalid-source'
  | 'invalid-rule'
  | 'invalid-template'
  | 'invalid-pack'
  | 'invalid-settings'
  | 'item-resolved'
  | 'item-incomplete';

export type RuleError = { readonly code: RuleErrorCode; readonly message: string };

export function ruleError(code: RuleErrorCode, message: string): RuleError {
  return { code, message };
}
