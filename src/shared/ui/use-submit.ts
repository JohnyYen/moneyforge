import { useRef, useState } from 'react';

import type { Result } from '@/shared/result';

import { createSubmitGate, runSubmission } from './submit-gate';

/**
 * Runs a use case from a form, surfacing rule errors and storage failures the same way.
 * Set `exitsOnSuccess` when `onSuccess` leaves the screen: the form stays live during
 * the exit, and this keeps a late tap from submitting again.
 */
export function useSubmit<Input, Value>(
  action: (input: Input) => Promise<Result<Value, { readonly message: string }>>,
  onSuccess: (value: Value) => void | Promise<void>,
  { exitsOnSuccess = false }: { exitsOnSuccess?: boolean } = {},
) {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // State updates land after the next render, too late to stop a second tap.
  const gate = useRef(createSubmitGate(exitsOnSuccess));

  async function submit(input: Input) {
    if (!gate.current.tryEnter()) return;
    setSubmitting(true);
    setError(null);
    await runSubmission(gate.current, {
      action: () => action(input),
      onSuccess,
      onError: setError,
    });
    setSubmitting(gate.current.isClosed());
  }

  return { submit, error, submitting, clearError: () => setError(null) };
}
