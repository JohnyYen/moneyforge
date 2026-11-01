import { useRouter } from 'expo-router';
import { useCallback } from 'react';

import type { Transaction } from '@/features/ledger/domain/journal';
import { useLedger } from '@/features/ledger/ui/ledger-context';
import { Button, ListRow, Muted, QueryBoundary, SectionLabel } from '@/shared/ui/primitives';
import { useFocusQuery } from '@/shared/ui/use-focus-query';

import { hasDoneMoves } from '../domain/split-run';
import { useSplit } from './split-context';
import { runRows } from './split-model';
import { SplitRows } from './split-rows';

export function TransactionSplitSection({ transaction }: { transaction: Transaction }) {
  const { id } = transaction;
  const ledger = useLedger();
  const split = useSplit();
  const router = useRouter();
  const load = useCallback(async () => {
    const [details, proposal, completes, accounts, currencies] = await Promise.all([
      split.splitDetails(id),
      split.splitProposal(id),
      split.moveCompletedBy(id),
      ledger.listAccounts(),
      ledger.listCurrencies(),
    ]);
    return { details, proposal, completes, lookups: { accounts, currencies } };
  }, [id, ledger, split]);
  const { state, reload } = useFocusQuery(load);

  return (
    <QueryBoundary state={state} onRetry={reload}>
      {({ details, proposal, completes, lookups }) => (
        <>
          {details ? (
            <>
              <SectionLabel>Split: {details.run.structureName}</SectionLabel>
              <SplitRows rows={runRows(details, lookups)} />
              <Muted>
                {hasDoneMoves(details.moves)
                  ? 'Amount, account, and type stay fixed while a move is done.'
                  : 'Changing the amount, account, or type cancels this split.'}
              </Muted>
            </>
          ) : null}
          {proposal ? (
            <Button
              label="Split this income"
              variant="secondary"
              onPress={() =>
                router.push({
                  pathname: '/split/apply/[transactionId]',
                  params: { transactionId: id },
                })
              }
            />
          ) : null}
          {completes ? (
            <>
              <SectionLabel>Split</SectionLabel>
              <ListRow
                title={completes.label}
                subtitle="Completes this split move. Deleting this makes it pending again."
                onPress={() =>
                  router.push({ pathname: '/split/moves/[id]', params: { id: completes.id } })
                }
              />
            </>
          ) : null}
        </>
      )}
    </QueryBoundary>
  );
}
