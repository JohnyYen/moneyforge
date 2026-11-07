import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';

import { EmptyState, QueryBoundary, Screen } from '@/shared/ui/primitives';
import { useFocusQuery } from '@/shared/ui/use-focus-query';

import { useLedger } from '../ledger-context';
import { TRANSACTION_PAGE_SIZE, toTransactionRow } from '../transaction-row-model';
import { AccountDetailView } from './account-detail-view';

export function AccountDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const ledger = useLedger();
  const router = useRouter();
  const [limit, setLimit] = useState(TRANSACTION_PAGE_SIZE);
  const load = useCallback(async () => {
    const [balances, transactions, accounts, categories, currencies] = await Promise.all([
      ledger.accountBalancesForDisplay(),
      ledger.listTransactions({ accountId: id, limit: limit + 1 }),
      ledger.listAccountsForDisplay(),
      ledger.listCategories(),
      ledger.listCurrencies(),
    ]);
    const lookups = { accounts, categories, currencies };
    return {
      detail: balances.find(({ account }) => account.id === id) ?? null,
      canLoadMore: transactions.length > limit,
      rows: transactions
        .slice(0, limit)
        .map((transaction) => toTransactionRow(transaction, lookups, id)),
    };
  }, [id, ledger, limit]);
  const { state, reload } = useFocusQuery(load);

  return (
    <QueryBoundary state={state} onRetry={reload}>
      {({ detail, rows, canLoadMore }) =>
        detail ? (
          <AccountDetailView
            account={detail.account}
            currency={detail.currency}
            balance={detail.balance}
            rows={rows}
            canLoadMore={canLoadMore}
            onLoadMore={() => setLimit((value) => value + TRANSACTION_PAGE_SIZE)}
            onOpenTransaction={(transactionId) =>
              router.push({ pathname: '/transactions/[id]', params: { id: transactionId } })
            }
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
