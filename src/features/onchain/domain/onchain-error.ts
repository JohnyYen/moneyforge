export type OnChainErrorCode =
  | 'not-found'
  | 'invalid-chain'
  | 'invalid-token'
  | 'invalid-address'
  | 'invalid-watched'
  | 'secret-refused'
  | 'currency-mismatch'
  | 'network-disabled'
  | 'timeout'
  | 'network-failed'
  | 'endpoint-refused'
  | 'malformed-response'
  | 'oversized-response'
  | 'no-contract'
  | 'chain-mismatch'
  | 'decimals-mismatch';

export type OnChainError = { readonly code: OnChainErrorCode; readonly message: string };

export function onChainError(code: OnChainErrorCode, message: string): OnChainError {
  return { code, message };
}
