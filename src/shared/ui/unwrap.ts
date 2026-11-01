import type { Result } from '@/shared/result';

/** For a query: a refused result reaches `useFocusQuery` as a failure with its message. */
export function unwrapOrThrow<T>(result: Result<T, { readonly message: string }>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
