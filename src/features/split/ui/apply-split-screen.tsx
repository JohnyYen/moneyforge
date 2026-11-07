import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';

import { formatDisplay } from '@/features/ledger/domain/money';
import { useLedger } from '@/features/ledger/ui/ledger-context';
import { leaveScreen } from '@/shared/ui/leave-screen';
import {
  Button,
  ChoiceChips,
  EmptyState,
  ErrorBanner,
  Muted,
  QueryBoundary,
  Screen,
  Title,
} from '@/shared/ui/primitives';
import { useFocusQuery } from '@/shared/ui/use-focus-query';
import { useSubmit } from '@/shared/ui/use-submit';

import type { SplitProposal } from '../application/split-service';
import { useSplit } from './split-context';
import { previewRows, type SplitLookups } from './split-model';
import { SplitRows } from './split-rows';

function ProposalForm({
  proposal,
  lookups,
  error,
  submitting,
  onApply,
  onSkip,
}: {
  proposal: SplitProposal;
  lookups: SplitLookups;
  error: string | null;
  submitting: boolean;
  onApply: (structureId: string) => void;
  onSkip: () => void;
}) {
  const [structureId, setStructureId] = useState(proposal.proposedStructureId);
  const { structures, amount, sourceAccountId, currencyCode } = proposal;
  const structure = structures.find(({ id }) => id === structureId);
  const currency = lookups.currencies.find(({ code }) => code === currencyCode);

  return (
    <Screen>
      <Muted>Split this income?</Muted>
      {currency ? <Title>{formatDisplay(amount, currency)}</Title> : null}
      <ChoiceChips
        label="Structure"
        options={structures.map(({ id, name }) => ({ value: id, label: name }))}
        value={structureId}
        onChange={setStructureId}
      />
      {structure ? (
        <SplitRows rows={previewRows(amount, sourceAccountId, currencyCode, structure, lookups)} />
      ) : null}
      <ErrorBanner message={error} />
      <Button
        label="Apply split"
        disabled={!structureId || submitting}
        onPress={() => structureId && onApply(structureId)}
      />
      <Button label="Skip" variant="secondary" onPress={onSkip} />
    </Screen>
  );
}

export function ApplySplitScreen() {
  const { transactionId } = useLocalSearchParams<{ transactionId: string }>();
  const ledger = useLedger();
  const split = useSplit();
  const router = useRouter();
  const load = useCallback(async () => {
    const [proposal, accounts, currencies] = await Promise.all([
      split.splitProposal(transactionId),
      ledger.listAccountsForDisplay(),
      ledger.listCurrencies(),
    ]);
    return { proposal, lookups: { accounts, currencies } };
  }, [ledger, split, transactionId]);
  const { state, reload } = useFocusQuery(load);

  const exit = () => leaveScreen(router);
  const apply = useSubmit(
    (structureId: string) => split.applyStructure({ transactionId, structureId }),
    exit,
    { exitsOnSuccess: true },
  );

  return (
    <QueryBoundary state={state} onRetry={reload}>
      {({ proposal, lookups }) =>
        proposal ? (
          <ProposalForm
            proposal={proposal}
            lookups={lookups}
            error={apply.error}
            submitting={apply.submitting}
            onApply={(structureId) => void apply.submit(structureId)}
            onSkip={exit}
          />
        ) : (
          <Screen>
            <EmptyState title="Nothing to split" hint="This income cannot be split right now." />
            <Button label="Back" variant="secondary" onPress={exit} />
          </Screen>
        )
      }
    </QueryBoundary>
  );
}
