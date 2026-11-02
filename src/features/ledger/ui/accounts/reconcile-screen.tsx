import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback } from 'react';

import { leaveScreen } from '@/shared/ui/leave-screen';
import { EmptyState, QueryBoundary, Screen } from '@/shared/ui/primitives';
import { useFocusQuery } from '@/shared/ui/use-focus-query';
import { useSubmit } from '@/shared/ui/use-submit';

import { useLedger } from '../ledger-context';
import { ReconcileView } from './reconcile-view';

export function ReconcileScreen() {
  const { id, counted } = useLocalSearchParams<{ id: string; counted?: string }>();
  const ledger = useLedger();
  const router = useRouter();
  const load = useCallback(
    async () =>
      (await ledger.accountBalances()).find(({ account }) => account.id === id) ?? null,
    [id, ledger],
  );
  const { state, reload } = useFocusQuery(load);
  const { submit, error, submitting } = useSubmit(
    (countedBalance: string) => ledger.reconcile({ accountId: id, countedBalance }),
    () => leaveScreen(router),
    { exitsOnSuccess: true },
  );

  return (
    <QueryBoundary state={state} onRetry={reload}>
      {(detail) =>
        detail ? (
          <ReconcileView
            accountName={detail.account.name}
            currency={detail.currency}
            balance={detail.balance}
            initialCounted={counted}
            error={error}
            submitting={submitting}
            onSubmit={submit}
          />
        ) : (
          <Screen>
            <EmptyState title="Account not found" />
          </Screen>
        )
      }
    </QueryBoundary>
  );
}
