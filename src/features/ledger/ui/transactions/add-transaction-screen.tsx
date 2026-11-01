import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, type ReactNode } from 'react';

import { leaveScreen } from '@/shared/ui/leave-screen';
import { QueryBoundary } from '@/shared/ui/primitives';
import { useFocusQuery } from '@/shared/ui/use-focus-query';
import { useSubmit } from '@/shared/ui/use-submit';

import { toLocalDay } from '../../application/overview-use-cases';
import type { Transaction } from '../../domain/journal';
import { occurredAtFromDay } from '../entry-date';
import { useLedger } from '../ledger-context';
import { EntryForm } from './entry-form';
import { emptyEntryValues, toEntryInput, type EntryValues } from './entry-values';

export function AddTransactionScreen({
  onRecorded,
  extraFields,
}: {
  /** Replaces the default of going back, and must leave this screen. */
  onRecorded?: (transaction: Transaction) => void | Promise<void>;
  extraFields?: ReactNode;
}) {
  const { accountId } = useLocalSearchParams<{ accountId?: string }>();
  const ledger = useLedger();
  const router = useRouter();
  const load = useCallback(async () => {
    const [accounts, categories, currencies] = await Promise.all([
      ledger.listAccounts(),
      ledger.listCategories(),
      ledger.listCurrencies(),
    ]);
    return {
      currencies,
      accounts: accounts.filter((account) => !account.archived),
      categories: categories.filter((category) => !category.archived),
    };
  }, [ledger]);
  const { state, reload } = useFocusQuery(load);

  const today = toLocalDay(new Date());

  const record = async (values: EntryValues) => {
    const occurredAt = occurredAtFromDay(values.day, today);
    if (!occurredAt.ok) return occurredAt;
    const entry = toEntryInput(values, occurredAt.value);
    return entry.ok ? ledger.recordEntry(entry.value) : entry;
  };
  const { submit, error, submitting } = useSubmit(
    record,
    (transaction) => (onRecorded ? onRecorded(transaction) : leaveScreen(router)),
    { exitsOnSuccess: true },
  );

  return (
    <QueryBoundary state={state} onRetry={reload}>
      {({ accounts, categories, currencies }) => (
        <EntryForm
          accounts={accounts}
          categories={categories}
          currencies={currencies}
          initial={emptyEntryValues(accountId ?? accounts[0]?.id ?? null, today)}
          error={error}
          submitting={submitting}
          extraFields={extraFields}
          onSubmit={submit}
        />
      )}
    </QueryBoundary>
  );
}
