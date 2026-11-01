import { useState } from 'react';

import type { Result } from '@/shared/result';

import { messageOf } from './use-focus-query';

/** Runs a use case from a form, surfacing rule errors and storage failures the same way. */
export function useSubmit<Input, Value>(
  action: (input: Input) => Promise<Result<Value, { readonly message: string }>>,
  onSuccess: (value: Value) => void,
) {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(input: Input) {
    setSubmitting(true);
    setError(null);
    try {
      const result = await action(input);
      if (result.ok) onSuccess(result.value);
      else setError(result.error.message);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setSubmitting(false);
    }
  }

  return { submit, error, submitting };
}
