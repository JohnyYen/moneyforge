import { useRouter } from 'expo-router';
import { useCallback } from 'react';

import type { Transaction } from '@/features/ledger/domain/journal';
import { AccountsScreen } from '@/features/ledger/ui/accounts/accounts-screen';
import { AddTransactionScreen } from '@/features/ledger/ui/transactions/add-transaction-screen';
import { TransactionDetailScreen } from '@/features/ledger/ui/transactions/transaction-detail-screen';
import { leaveScreen } from '@/shared/ui/leave-screen';
import { ListRow } from '@/shared/ui/primitives';
import { useFocusQuery } from '@/shared/ui/use-focus-query';

import { useSplit } from './split-context';
import { pendingMovesLabel } from './split-model';
import { TransactionSplitSection } from './transaction-split-section';

/** Ledger screens with the split features plugged in, so the ledger never imports them. */
function PendingMovesLink() {
  const split = useSplit();
  const router = useRouter();
  const load = useCallback(() => split.countPendingMoves(), [split]);
  const { state } = useFocusQuery(load);

  if (state.status !== 'ready' || state.data === 0) return null;
  return (
    <ListRow title={pendingMovesLabel(state.data)} onPress={() => router.push('/split/moves')} />
  );
}

export function MainScreen() {
  return <AccountsScreen header={<PendingMovesLink />} />;
}

export function NewTransactionScreen() {
  const split = useSplit();
  const router = useRouter();

  const proposeOrLeave = ({ id }: Transaction) =>
    split.splitProposal(id).then(
      (proposal) => {
        if (!proposal) leaveScreen(router);
        else {
          router.replace({
            pathname: '/split/apply/[transactionId]',
            params: { transactionId: id },
          });
        }
      },
      () => leaveScreen(router),
    );

  return <AddTransactionScreen onRecorded={proposeOrLeave} />;
}

export function TransactionScreen() {
  return (
    <TransactionDetailScreen
      renderFooter={(transaction) => <TransactionSplitSection transaction={transaction} />}
    />
  );
}
