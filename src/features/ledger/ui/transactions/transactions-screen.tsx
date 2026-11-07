import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';

import { QueryBoundary } from '@/shared/ui/primitives';
import { useFocusQuery } from '@/shared/ui/use-focus-query';

import { useLedger } from '../ledger-context';
import { TRANSACTION_PAGE_SIZE, toTransactionRow } from '../transaction-row-model';
import { ALL, TransactionsView, type KindFilter } from './transactions-view';

export function TransactionsScreen() {
  const ledger = useLedger();
  const router = useRouter();
  const [kind, setKind] = useState<KindFilter>(ALL);
  const [accountId, setAccountId] = useState<string>(ALL);
  const [limit, setLimit] = useState(TRANSACTION_PAGE_SIZE);

  const load = useCallback(async () => {
    const [transactions, accounts, categories, currencies] = await Promise.all([
      ledger.listTransactions({
        kind: kind === ALL ? undefined : kind,
        accountId: accountId === ALL ? undefined : accountId,
        limit: limit + 1,
      }),
      ledger.listAccountsForDisplay(),
      ledger.listCategories(),
      ledger.listCurrencies(),
    ]);
    const lookups = { accounts, categories, currencies };
    return {
      accounts,
      canLoadMore: transactions.length > limit,
      rows: transactions.slice(0, limit).map((item) => toTransactionRow(item, lookups)),
    };
  }, [accountId, kind, ledger, limit]);
  const { state, reload } = useFocusQuery(load);

  return (
    <QueryBoundary state={state} onRetry={reload}>
      {({ rows, accounts, canLoadMore }) => (
        <TransactionsView
          rows={rows}
          accounts={accounts}
          kind={kind}
          accountId={accountId}
          canLoadMore={canLoadMore}
          onKindChange={setKind}
          onAccountChange={setAccountId}
          onLoadMore={() => setLimit((value) => value + TRANSACTION_PAGE_SIZE)}
          onAdd={() => router.push('/transactions/new')}
          onOpen={(id) => router.push({ pathname: '/transactions/[id]', params: { id } })}
        />
      )}
    </QueryBoundary>
  );
}
