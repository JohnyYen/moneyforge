import { useRouter } from 'expo-router';
import { useCallback, type ReactNode } from 'react';

import { QueryBoundary } from '@/shared/ui/primitives';
import { useFocusQuery } from '@/shared/ui/use-focus-query';

import { useLedger } from '../ledger-context';
import { accountsListModel } from './accounts-list-model';
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
    const [overview, netWorth, base] = await Promise.all([
      ledger.accountsOverview(),
      ledger.netWorth(),
      ledger.getBaseCurrency(),
    ]);
    // Without a base currency there are no group totals, so every account is listed on its own.
    const accounts = overview.ok
      ? overview.value
      : { baseCurrency: '', groups: [], ungrouped: await ledger.accountBalancesForDisplay() };
    return {
      list: accountsListModel(accounts, base),
      summary: netWorth.ok && base ? { netWorth: netWorth.value, base } : null,
    };
  }, [ledger]);
  const { state, reload } = useFocusQuery(load);

  return (
    <QueryBoundary state={state} onRetry={reload}>
      {({ list, summary }) => (
        <AccountsView
          header={header}
          summaryExtra={summaryExtra}
          list={list}
          summary={summary}
          onOpenAccount={(id) => router.push({ pathname: '/accounts/[id]', params: { id } })}
          onOpenGroup={(id) => router.push({ pathname: '/account-groups/[id]', params: { id } })}
          onAddAccount={() => router.push('/accounts/new')}
          onAddTransaction={() => router.push('/transactions/new')}
        />
      )}
    </QueryBoundary>
  );
}
