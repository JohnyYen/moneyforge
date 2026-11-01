import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { Alert } from 'react-native';

import {
  Button,
  EmptyState,
  ErrorBanner,
  Muted,
  QueryBoundary,
  Screen,
} from '@/shared/ui/primitives';
import { useFocusQuery } from '@/shared/ui/use-focus-query';
import { useSubmit } from '@/shared/ui/use-submit';

import { isDeletable } from '../../domain/journal';
import { occurredAtFromDay } from '../entry-date';
import { useLedger } from '../ledger-context';
import { EntryForm } from './entry-form';
import { toEntryInput, toEntryValues, type EntryValues } from './entry-values';

function confirmDelete(onConfirm: () => void) {
  Alert.alert('Delete this transaction?', 'Balances will change. This cannot be undone.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: onConfirm },
  ]);
}

export function TransactionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const ledger = useLedger();
  const router = useRouter();
  const load = useCallback(async () => {
    const [transaction, accounts, categories, currencies] = await Promise.all([
      ledger.getTransaction(id),
      ledger.listAccounts(),
      ledger.listCategories(),
      ledger.listCurrencies(),
    ]);
    const used = new Set(transaction?.postings.map(({ accountId }) => accountId));
    return {
      transaction,
      currencies,
      accounts: accounts.filter((account) => !account.archived || used.has(account.id)),
      categories: categories.filter(
        (category) => !category.archived || category.id === transaction?.categoryId,
      ),
      initial: transaction && toEntryValues(transaction, currencies),
    };
  }, [id, ledger]);
  const { state, reload } = useFocusQuery(load);

  const exit = () => router.back();
  const save = useSubmit(
    async ({ values, initialDay }: { values: EntryValues; initialDay: string }) => {
      const occurredAt = occurredAtFromDay(values.day, initialDay);
      if (!occurredAt.ok) return occurredAt;
      const entry = toEntryInput(values, occurredAt.value);
      return entry.ok ? ledger.updateTransaction(id, entry.value) : entry;
    },
    exit,
    { exitsOnSuccess: true },
  );
  const remove = useSubmit<void, void>(() => ledger.deleteTransaction(id), exit, {
    exitsOnSuccess: true,
  });
  const askToDelete = () => confirmDelete(() => void remove.submit());
  const submitting = save.submitting || remove.submitting;

  return (
    <QueryBoundary state={state} onRetry={reload}>
      {({ transaction, accounts, categories, currencies, initial }) => {
        if (!transaction) {
          return (
            <Screen>
              <EmptyState title="Transaction not found" />
            </Screen>
          );
        }
        if (!initial) {
          return (
            <Screen>
              <Muted>
                {isDeletable(transaction)
                  ? 'A reconciliation cannot be edited. Delete it and reconcile again.'
                  : 'This is an opening balance. Change it by editing the account.'}
              </Muted>
              <ErrorBanner message={remove.error} />
              {isDeletable(transaction) ? (
                <Button
                  label="Delete transaction"
                  variant="secondary"
                  disabled={submitting}
                  onPress={askToDelete}
                />
              ) : null}
            </Screen>
          );
        }
        return (
          <EntryForm
            accounts={accounts}
            categories={categories}
            currencies={currencies}
            initial={initial}
            error={save.error ?? remove.error}
            submitting={submitting}
            submitLabel="Save changes"
            onSubmit={(values) => void save.submit({ values, initialDay: initial.day })}
            onDelete={askToDelete}
          />
        );
      }}
    </QueryBoundary>
  );
}
