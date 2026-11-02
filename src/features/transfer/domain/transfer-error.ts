export type TransferErrorCode =
  | 'invalid-csv'
  | 'invalid-mapping'
  | 'invalid-range'
  | 'too-large'
  | 'import-failed'
  | 'mixed-accounts'
  | 'not-found'
  | 'account-archived';

export type TransferError = { readonly code: TransferErrorCode; readonly message: string };

export function transferError(code: TransferErrorCode, message: string): TransferError {
  return { code, message };
}
