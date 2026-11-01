import { useRouter } from 'expo-router';
import { useCallback } from 'react';

import { leaveScreen } from '@/shared/ui/leave-screen';
import { QueryBoundary } from '@/shared/ui/primitives';
import { useFocusQuery } from '@/shared/ui/use-focus-query';
import { useSubmit } from '@/shared/ui/use-submit';

import { useLedger } from '../ledger-context';
import { AccountForm, type AccountFormValues } from './account-form';

export function AddAccountScreen() {
  const ledger = useLedger();
  const router = useRouter();
  const load = useCallback(async () => {
    const [currencies, accounts] = await Promise.all([ledger.listCurrencies(), ledger.listAccounts()]);
    return { currencies, types: [...new Set(accounts.map((account) => account.type))] };
  }, [ledger]);
  const { state, reload } = useFocusQuery(load);
  const { submit, error, submitting } = useSubmit(
    (values: AccountFormValues) => ledger.createAccount(values),
    () => leaveScreen(router),
    { exitsOnSuccess: true },
  );

  return (
    <QueryBoundary state={state} onRetry={reload}>
      {({ currencies, types }) => (
        <AccountForm
          currencies={currencies}
          typeSuggestions={types}
          error={error}
          submitting={submitting}
          onSubmit={submit}
        />
      )}
    </QueryBoundary>
  );
}
