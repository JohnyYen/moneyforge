import type { LedgerErrorCode } from '@/features/ledger/domain/ledger-error';

export type SplitErrorCode =
  | LedgerErrorCode
  | 'invalid-percentage'
  | 'invalid-structure'
  | 'not-income'
  | 'structure-archived'
  | 'already-split'
  | 'move-not-pending'
  | 'move-not-reversible';

export type SplitError = { readonly code: SplitErrorCode; readonly message: string };

export function splitError(code: SplitErrorCode, message: string): SplitError {
  return { code, message };
}
