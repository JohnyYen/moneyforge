import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';

import { leaveScreen } from '@/shared/ui/leave-screen';
import { ChoiceChips, QueryBoundary } from '@/shared/ui/primitives';
import { useFocusQuery } from '@/shared/ui/use-focus-query';
import { useSubmit } from '@/shared/ui/use-submit';

import { GroupForm, type GroupFormSubmit } from '../account-groups/group-form';
import { withGroupErrorCopy } from '../account-groups/group-model';
import { useLedger } from '../ledger-context';
import { AccountForm, type AccountFormValues } from './account-form';

type Kind = 'single' | 'group';

const KINDS: readonly { value: Kind; label: string }[] = [
  { value: 'single', label: 'Single currency' },
  { value: 'group', label: 'Multi-currency' },
];

/** Adds an ordinary account, or a multi-currency one: a group with a sub-account per currency. */
export function AddAccountScreen() {
  const ledger = useLedger();
  const router = useRouter();
  const [kind, setKind] = useState<Kind>('single');
  const load = useCallback(async () => {
    const [currencies, accounts, groups] = await Promise.all([
      ledger.listCurrencies(),
      ledger.listAccounts(),
      ledger.listAccountGroups(),
    ]);
    return { currencies, groups, types: [...new Set(accounts.map((account) => account.type))] };
  }, [ledger]);
  const { state, reload } = useFocusQuery(load);
  const single = useSubmit(
    async (values: AccountFormValues) => withGroupErrorCopy(await ledger.createAccount(values)),
    () => leaveScreen(router),
    { exitsOnSuccess: true },
  );
  const group = useSubmit(
    async (values: GroupFormSubmit) => withGroupErrorCopy(await ledger.createAccountGroup(values)),
    () => leaveScreen(router),
    { exitsOnSuccess: true },
  );
  const header = (
    <ChoiceChips label="Kind" options={KINDS} value={kind} onChange={setKind} />
  );

  return (
    <QueryBoundary state={state} onRetry={reload}>
      {({ currencies, groups, types }) =>
        kind === 'single' ? (
          <AccountForm
            header={header}
            currencies={currencies}
            groups={groups}
            typeSuggestions={types}
            error={single.error}
            submitting={single.submitting}
            onSubmit={single.submit}
          />
        ) : (
          <GroupForm
            header={header}
            currencies={currencies}
            typeSuggestions={types}
            error={group.error}
            submitting={group.submitting}
            onSubmit={group.submit}
          />
        )
      }
    </QueryBoundary>
  );
}
