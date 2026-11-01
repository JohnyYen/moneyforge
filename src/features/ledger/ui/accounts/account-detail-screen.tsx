import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback } from 'react';

import { EmptyState, QueryBoundary, Screen } from '@/shared/ui/primitives';
import { useFocusQuery } from '@/shared/ui/use-focus-query';

import { useLedger } from '../ledger-context';
import { toTransactionRow } from '../transaction-row-model';
import { AccountDetailView } from './account-detail-view';

export function AccountDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const ledger = useLedger();
  const router = useRouter();
  const load = useCallback(async () => {
    const [balances, transactions, accounts, categories, currencies] = await Promise.all([
      ledger.accountBalances(),
      ledger.listTransactions({ accountId: id }),
      ledger.listAccounts(),
      ledger.listCategories(),
      ledger.listCurrencies(),
    ]);
    const lookups = { accounts, categories, currencies };
    return {
      detail: balances.find(({ account }) => account.id === id) ?? null,
      rows: transactions.map((transaction) => toTransactionRow(transaction, lookups, id)),
    };
  }, [id, ledger]);
  const { state, reload } = useFocusQuery(load);

  return (
    <QueryBoundary state={state} onRetry={reload}>
      {({ detail, rows }) =>
        detail ? (
          <AccountDetailView
            account={detail.account}
            currency={detail.currency}
            balance={detail.balance}
            rows={rows}
            onAddTransaction={() =>
              router.push({ pathname: '/transactions/new', params: { accountId: id } })
            }
            onReconcile={() => router.push({ pathname: '/accounts/[id]/reconcile', params: { id } })}
            onEdit={() => router.push({ pathname: '/accounts/[id]/edit', params: { id } })}
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
