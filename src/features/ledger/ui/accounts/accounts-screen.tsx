import { useRouter } from 'expo-router';
import { useCallback, type ReactNode } from 'react';

import { QueryBoundary } from '@/shared/ui/primitives';
import { useFocusQuery } from '@/shared/ui/use-focus-query';

import { useLedger } from '../ledger-context';
import { AccountsView } from './accounts-view';

export function AccountsScreen({
  header,
  summaryExtra,
}: {
  header?: ReactNode;
  summaryExtra?: ReactNode;
}) {
  const ledger = useLedger();
  const router = useRouter();
  const load = useCallback(async () => {
    const [balances, netWorth, base] = await Promise.all([
      ledger.accountBalances(),
      ledger.netWorth(),
      ledger.getBaseCurrency(),
    ]);
    return { balances, summary: netWorth.ok && base ? { netWorth: netWorth.value, base } : null };
  }, [ledger]);
  const { state, reload } = useFocusQuery(load);

  return (
    <QueryBoundary state={state} onRetry={reload}>
      {({ balances, summary }) => (
        <AccountsView
          header={header}
          summaryExtra={summaryExtra}
          balances={balances}
          summary={summary}
          onOpenAccount={(id) => router.push({ pathname: '/accounts/[id]', params: { id } })}
          onAddAccount={() => router.push('/accounts/new')}
          onAddTransaction={() => router.push('/transactions/new')}
        />
      )}
    </QueryBoundary>
  );
}
