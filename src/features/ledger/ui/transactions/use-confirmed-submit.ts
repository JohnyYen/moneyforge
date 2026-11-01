import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';

import type { Result } from '@/shared/result';
import { useSubmit } from '@/shared/ui/use-submit';

import type { LedgerError } from '../../domain/ledger-error';

type Attempt<Input> = { readonly input: Input; readonly confirmed: boolean };

function askToContinue(message: string, onContinue: () => void) {
  Alert.alert('Are you sure?', message, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Continue', style: 'destructive', onPress: onContinue },
  ]);
}

/**
 * `useSubmit` for a change a guard may question. When the action answers
 * `confirmation-required`, the user is asked, and accepting runs it again as confirmed.
 */
export function useConfirmedSubmit<Input, Value>(
  action: (input: Input, confirmed: boolean) => Promise<Result<Value, LedgerError>>,
  onSuccess: (value: Value) => void | Promise<void>,
) {
  const retry = useRef<(attempt: Attempt<Input>) => void>(() => undefined);
  const { submit, ...rest } = useSubmit(
    async ({ input, confirmed }: Attempt<Input>) => {
      const result = await action(input, confirmed);
      if (!result.ok && result.error.code === 'confirmation-required') {
        const { message } = result.error;
        askToContinue(message, () => retry.current({ input, confirmed: true }));
      }
      return result;
    },
    onSuccess,
    { exitsOnSuccess: true },
  );
  useEffect(() => {
    retry.current = (attempt) => void submit(attempt);
  });

  return { ...rest, submit: (input: Input) => submit({ input, confirmed: false }) };
}
