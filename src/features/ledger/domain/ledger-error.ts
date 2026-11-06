export type LedgerErrorCode =
  | 'invalid-amount'
  | 'too-precise'
  | 'invalid-decimals'
  | 'invalid-rate'
  | 'inconsistent-conversion'
  | 'invalid-date'
  | 'invalid-currency'
  | 'invalid-account'
  | 'invalid-category'
  | 'invalid-group'
  | 'non-positive-amount'
  | 'zero-posting'
  | 'too-few-postings'
  | 'unbalanced'
  | 'same-account'
  | 'currency-mismatch'
  | 'account-archived'
  | 'category-mismatch'
  | 'transaction-locked'
  | 'confirmation-required'
  | 'not-found'
  | 'already-exists'
  | 'currency-in-use'
  | 'setup-required'
  | 'group-not-found'
  | 'group-empty'
  | 'duplicate-currency'
  | 'group-currency-taken'
  | 'group-archived';

export type LedgerError = { readonly code: LedgerErrorCode; readonly message: string };

export function ledgerError(code: LedgerErrorCode, message: string): LedgerError {
  return { code, message };
}
