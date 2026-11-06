import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback } from 'react';

import { EmptyState, QueryBoundary, Screen } from '@/shared/ui/primitives';
import { unwrapOrThrow } from '@/shared/ui/unwrap';
import { useFocusQuery } from '@/shared/ui/use-focus-query';
import { useSubmit } from '@/shared/ui/use-submit';

import type { SubAccountInput } from '../../application/account-group-use-cases';
import { useLedger } from '../ledger-context';
import { GroupDetailView } from './group-detail-view';
import { groupDetailModel, withGroupErrorCopy } from './group-model';

export function GroupDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const ledger = useLedger();
  const router = useRouter();
  const load = useCallback(async () => {
    const [overview, base, currencies] = await Promise.all([
      ledger.accountsOverview(),
      ledger.getBaseCurrency(),
      ledger.listCurrencies(),
    ]);
    const group = unwrapOrThrow(overview).groups.find((item) => item.group.id === id);
    return { model: group ? groupDetailModel(group, base, currencies) : null };
  }, [id, ledger]);
  const { state, reload } = useFocusQuery(load);
  const addSubAccount = useSubmit(
    async (input: SubAccountInput) => withGroupErrorCopy(await ledger.addSubAccount(id, input)),
    reload,
  );
  const setArchived = useSubmit(
    async (archived: boolean) =>
      withGroupErrorCopy(await ledger.setAccountGroupArchived(id, archived)),
    reload,
  );

  return (
    <QueryBoundary state={state} onRetry={reload}>
      {({ model }) =>
        model ? (
          <GroupDetailView
            model={model}
            error={addSubAccount.error ?? setArchived.error}
            submitting={addSubAccount.submitting || setArchived.submitting}
            onOpenAccount={(accountId) =>
              router.push({ pathname: '/accounts/[id]', params: { id: accountId } })
            }
            onAddSubAccount={(input) => void addSubAccount.submit(input)}
            onEdit={() => router.push({ pathname: '/account-groups/[id]/edit', params: { id } })}
            onSetArchived={(archived) => void setArchived.submit(archived)}
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
