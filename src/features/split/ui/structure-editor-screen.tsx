import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback } from 'react';

import { useLedger } from '@/features/ledger/ui/ledger-context';
import { leaveScreen } from '@/shared/ui/leave-screen';
import { EmptyState, QueryBoundary, Screen } from '@/shared/ui/primitives';
import { useFocusQuery } from '@/shared/ui/use-focus-query';
import { useSubmit } from '@/shared/ui/use-submit';

import { useSplit } from './split-context';
import { emptyDraft, toDraft, toStructureInput, type StructureDraft } from './structure-draft';
import { StructureForm } from './structure-form';

export function StructureEditorScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const ledger = useLedger();
  const split = useSplit();
  const router = useRouter();
  const load = useCallback(async () => {
    const [accounts, structure] = await Promise.all([
      ledger.listAccounts(),
      id ? split.getStructure(id) : null,
    ]);
    const used = new Set(structure?.lines.map(({ targetAccountId }) => targetAccountId));
    return {
      structure,
      accounts: accounts.filter((account) => !account.archived || used.has(account.id)),
    };
  }, [id, ledger, split]);
  const { state, reload } = useFocusQuery(load);

  const exit = () => leaveScreen(router);
  const save = useSubmit(
    (draft: StructureDraft) =>
      id
        ? split.updateStructure({ id, ...toStructureInput(draft) })
        : split.createStructure(toStructureInput(draft)),
    exit,
    { exitsOnSuccess: true },
  );
  const setActive = useSubmit(
    (active: boolean) => split.setStructureActive(id ?? '', active),
    exit,
    { exitsOnSuccess: true },
  );

  return (
    <QueryBoundary state={state} onRetry={reload}>
      {({ structure, accounts }) => {
        if (id && !structure) {
          return (
            <Screen>
              <EmptyState title="Structure not found" />
            </Screen>
          );
        }
        return (
          <StructureForm
            initial={structure ? toDraft(structure) : emptyDraft()}
            accounts={accounts}
            error={save.error ?? setActive.error}
            submitting={save.submitting || setActive.submitting}
            onSubmit={(draft) => void save.submit(draft)}
            archiveLabel={structure?.active ? 'Archive structure' : 'Restore structure'}
            onArchive={structure ? () => void setActive.submit(!structure.active) : undefined}
          />
        );
      }}
    </QueryBoundary>
  );
}
