import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback } from 'react';

import { err, type Result } from '@/shared/result';
import { QueryBoundary } from '@/shared/ui/primitives';
import { useFocusQuery } from '@/shared/ui/use-focus-query';
import { useSubmit } from '@/shared/ui/use-submit';

import { toLocalDay } from '../../application/overview-use-cases';
import type { Transaction } from '../../domain/journal';
import { ledgerError, type LedgerError } from '../../domain/ledger-error';
import { occurredAtFromDay } from '../entry-date';
import { useLedger } from '../ledger-context';
import { AddTransactionView, type EntryValues } from './add-transaction-view';

export function AddTransactionScreen() {
  const { accountId } = useLocalSearchParams<{ accountId?: string }>();
  const ledger = useLedger();
  const router = useRouter();
  const load = useCallback(async () => {
    const [accounts, categories] = await Promise.all([ledger.listAccounts(), ledger.listCategories()]);
    return {
      accounts: accounts.filter((account) => !account.archived),
      categories: categories.filter((category) => !category.archived),
    };
  }, [ledger]);
  const { state, reload } = useFocusQuery(load);

  const today = toLocalDay(new Date());

  const record = async (values: EntryValues): Promise<Result<Transaction, LedgerError>> => {
    const occurredAt = occurredAtFromDay(values.day, today);
    if (!occurredAt.ok) return occurredAt;
    if (!values.accountId) return err(ledgerError('not-found', 'Choose an account.'));
    const entry = { description: values.description, occurredAt: occurredAt.value };

    if (values.kind === 'income' || values.kind === 'expense') {
      const input = {
        ...entry,
        accountId: values.accountId,
        amount: values.amount,
        categoryId: values.categoryId,
      };
      return values.kind === 'income' ? ledger.recordIncome(input) : ledger.recordExpense(input);
    }
    if (!values.toAccountId) return err(ledgerError('not-found', 'Choose a destination account.'));
    const accounts = { fromAccountId: values.accountId, toAccountId: values.toAccountId };
    if (values.kind === 'transfer') {
      return ledger.recordTransfer({ ...entry, ...accounts, amount: values.amount, fee: values.fee });
    }
    return ledger.recordConversion({
      ...entry,
      ...accounts,
      sourceAmount: values.amount,
      targetAmount: values.targetAmount,
      rate: values.rate,
      fee: values.fee,
      feeCurrency: values.feeCurrency ?? undefined,
    });
  };
  const { submit, error, submitting } = useSubmit(record, () => router.back());

  return (
    <QueryBoundary state={state} onRetry={reload}>
      {({ accounts, categories }) => (
        <AddTransactionView
          accounts={accounts}
          categories={categories}
          initialAccountId={accountId ?? null}
          today={today}
          error={error}
          submitting={submitting}
          onSubmit={submit}
        />
      )}
    </QueryBoundary>
  );
}
