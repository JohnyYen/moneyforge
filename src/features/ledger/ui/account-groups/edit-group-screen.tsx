import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback } from 'react';

import { leaveScreen } from '@/shared/ui/leave-screen';
import { EmptyState, QueryBoundary, Screen } from '@/shared/ui/primitives';
import { useFocusQuery } from '@/shared/ui/use-focus-query';
import { useSubmit } from '@/shared/ui/use-submit';

import { useLedger } from '../ledger-context';
import { GroupForm, type GroupFormSubmit } from './group-form';
import { withGroupErrorCopy } from './group-model';

/** Renames and retypes a group; its sub-accounts take the new type. */
export function EditGroupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const ledger = useLedger();
  const router = useRouter();
  const load = useCallback(async () => {
    const [group, accounts] = await Promise.all([
      ledger.getAccountGroup(id),
      ledger.listAccounts(),
    ]);
    return { group, types: [...new Set(accounts.map(({ type }) => type))] };
  }, [id, ledger]);
  const { state, reload } = useFocusQuery(load);
  const { submit, error, submitting } = useSubmit(
    async ({ name, type }: GroupFormSubmit) =>
      withGroupErrorCopy(await ledger.updateAccountGroup(id, { name, type })),
    () => leaveScreen(router),
    { exitsOnSuccess: true },
  );

  return (
    <QueryBoundary state={state} onRetry={reload}>
      {({ group, types }) =>
        group ? (
          <GroupForm
            initial={{ name: group.name, type: group.type }}
            currencies={[]}
            typeSuggestions={types}
            error={error}
            submitting={submitting}
            onSubmit={submit}
          />
        ) : (
          <Screen>
            <EmptyState title="Account group not found" />
          </Screen>
        )
      }
    </QueryBoundary>
  );
}
