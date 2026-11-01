import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback } from 'react';

import { EmptyState, QueryBoundary, Screen } from '@/shared/ui/primitives';
import { useFocusQuery } from '@/shared/ui/use-focus-query';
import { useSubmit } from '@/shared/ui/use-submit';

import { formatDecimal } from '../../domain/money';
import { useLedger } from '../ledger-context';
import { AccountForm, type AccountFormValues } from './account-form';

export function EditAccountScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const ledger = useLedger();
  const router = useRouter();
  const load = useCallback(async () => {
    const [account, currencies, accounts] = await Promise.all([
      ledger.getAccount(id),
      ledger.listCurrencies(),
      ledger.listAccounts(),
    ]);
    return {
      account,
      currency: currencies.find((currency) => currency.code === account?.currencyCode) ?? null,
      types: [...new Set(accounts.map(({ type }) => type))],
    };
  }, [id, ledger]);
  const { state, reload } = useFocusQuery(load);
  const { submit, error, submitting } = useSubmit(
    (values: AccountFormValues) => ledger.updateAccount({ ...values, id }),
    () => router.back(),
  );

  return (
    <QueryBoundary state={state} onRetry={reload}>
      {({ account, currency, types }) =>
        account && currency ? (
          <AccountForm
            initial={{
              name: account.name,
              type: account.type,
              currencyCode: account.currencyCode,
              openingBalance: formatDecimal(account.openingBalance, currency.decimals),
              archived: account.archived,
            }}
            currencies={[currency]}
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
