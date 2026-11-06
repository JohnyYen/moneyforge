import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback } from 'react';

import { leaveScreen } from '@/shared/ui/leave-screen';
import { EmptyState, QueryBoundary, Screen } from '@/shared/ui/primitives';
import { useFocusQuery } from '@/shared/ui/use-focus-query';
import { useSubmit } from '@/shared/ui/use-submit';

import { formatDecimal } from '../../domain/money';
import { withGroupErrorCopy } from '../account-groups/group-model';
import { useLedger } from '../ledger-context';
import { AccountForm, type AccountFormValues } from './account-form';

export function EditAccountScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const ledger = useLedger();
  const router = useRouter();
  const load = useCallback(async () => {
    const [account, currencies, accounts, groups] = await Promise.all([
      ledger.getAccount(id),
      ledger.listCurrencies(),
      ledger.listAccounts(),
      ledger.listAccountGroups(),
    ]);
    return {
      account,
      groups,
      currency: currencies.find((currency) => currency.code === account?.currencyCode) ?? null,
      types: [...new Set(accounts.map(({ type }) => type))],
    };
  }, [id, ledger]);
  const { state, reload } = useFocusQuery(load);
  const { submit, error, submitting } = useSubmit(
    async (values: AccountFormValues) =>
      withGroupErrorCopy(await ledger.updateAccount({ ...values, id })),
    () => leaveScreen(router),
    { exitsOnSuccess: true },
  );

  return (
    <QueryBoundary state={state} onRetry={reload}>
      {({ account, currency, groups, types }) =>
        account && currency ? (
          <AccountForm
            initial={{
              name: account.name,
              type: account.type,
              currencyCode: account.currencyCode,
              openingBalance: formatDecimal(account.openingBalance, currency.decimals),
              archived: account.archived,
              groupId: account.groupId,
            }}
            currencies={[currency]}
            groups={groups}
            typeSuggestions={types}
            error={error}
            submitting={submitting}
            onSubmit={submit}
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
