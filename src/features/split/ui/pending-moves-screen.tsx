import { useRouter } from 'expo-router';
import { useCallback } from 'react';

import { useLedger } from '@/features/ledger/ui/ledger-context';
import { EmptyState, ListRow, Muted, QueryBoundary, Screen } from '@/shared/ui/primitives';
import { useFocusQuery } from '@/shared/ui/use-focus-query';

import { useSplit } from './split-context';
import { toMoveRow } from './split-model';

export function PendingMovesScreen() {
  const ledger = useLedger();
  const split = useSplit();
  const router = useRouter();
  const load = useCallback(async () => {
    const [moves, accounts, currencies] = await Promise.all([
      split.listPendingMoves(),
      ledger.listAccountsForDisplay(),
      ledger.listCurrencies(),
    ]);
    return { moves, lookups: { accounts, currencies } };
  }, [ledger, split]);
  const { state, reload } = useFocusQuery(load);

  return (
    <QueryBoundary state={state} onRetry={reload}>
      {({ moves, lookups }) => (
        <Screen>
          <Muted>Make each move in your bank or wallet, then confirm it here.</Muted>
          {moves.length === 0 ? <EmptyState title="No pending moves" /> : null}
          {moves.map((move) => {
            const { id, title, subtitle, amount } = toMoveRow(move, lookups);
            return (
              <ListRow
                key={id}
                title={title}
                subtitle={subtitle}
                trailing={amount}
                onPress={() => router.push({ pathname: '/split/moves/[id]', params: { id } })}
              />
            );
          })}
        </Screen>
      )}
    </QueryBoundary>
  );
}
