import { err, ok, type Result } from '@/shared/result';

import { toLocalDay } from '../../application/overview-use-cases';
import type { TransactionEntry } from '../../application/transaction-use-cases';
import { isSystemAccountId, systemAccountId } from '../../domain/account';
import type { Currency } from '../../domain/currency';
import type { Posting, Transaction } from '../../domain/journal';
import { ledgerError, type LedgerError } from '../../domain/ledger-error';
import { formatDecimal } from '../../domain/money';

export const ENTRY_KINDS = ['expense', 'income', 'transfer', 'conversion'] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

export type EntryValues = {
  kind: EntryKind;
  accountId: string | null;
  toAccountId: string | null;
  categoryId: string | null;
  amount: string;
  targetAmount: string;
  rate: string;
  fee: string;
  feeCurrency: string | null;
  description: string;
  day: string;
};

export function emptyEntryValues(accountId: string | null, today: string): EntryValues {
  return {
    kind: 'expense',
    accountId,
    toAccountId: null,
    categoryId: null,
    amount: '',
    targetAmount: '',
    rate: '',
    fee: '',
    feeCurrency: null,
    description: '',
    day: today,
  };
}

/** Reads the form back out of the postings; `null` for a kind the form cannot edit. */
export function toEntryValues(
  transaction: Transaction,
  currencies: readonly Currency[],
): EntryValues | null {
  const { kind, postings } = transaction;
  if (kind === 'adjustment') return null;

  const text = ({ amount, currency }: Posting) => {
    const decimals = currencies.find(({ code }) => code === currency)?.decimals ?? 0;
    return formatDecimal(amount < 0n ? -amount : amount, decimals);
  };
  const [from, to] = postings.filter(({ accountId }) => !isSystemAccountId(accountId));
  const fee = postings.find(
    ({ accountId, currency }) => accountId === systemAccountId(currency, 'expense'),
  );
  const clearing = postings.filter(
    ({ accountId, currency }) => accountId === systemAccountId(currency, 'conversion'),
  );
  const sent = clearing.find(({ amount }) => amount > 0n);
  const received = clearing.find(({ amount }) => amount < 0n);

  const values: EntryValues = {
    ...emptyEntryValues(from?.accountId ?? null, toLocalDay(new Date(transaction.occurredAt))),
    kind,
    categoryId: transaction.categoryId,
    description: transaction.description,
  };
  if (kind === 'transfer') {
    return {
      ...values,
      toAccountId: to.accountId,
      amount: text(to),
      fee: fee ? text(fee) : '',
    };
  }
  if (kind === 'conversion' && sent && received) {
    return {
      ...values,
      toAccountId: to.accountId,
      amount: text(sent),
      targetAmount: text(received),
      rate: transaction.metadata?.rate ?? '',
      fee: fee ? text(fee) : '',
      feeCurrency: fee?.currency ?? null,
    };
  }
  return { ...values, amount: text(from) };
}

export function toEntryInput(
  values: EntryValues,
  occurredAt: string | undefined,
): Result<TransactionEntry, LedgerError> {
  const { accountId, toAccountId, categoryId, description } = values;
  if (!accountId) return err(ledgerError('not-found', 'Choose an account.'));
  const entry = { description, occurredAt, categoryId };

  if (values.kind === 'income' || values.kind === 'expense') {
    return ok({ ...entry, kind: values.kind, accountId, amount: values.amount });
  }
  if (!toAccountId) return err(ledgerError('not-found', 'Choose a destination account.'));
  const accounts = { fromAccountId: accountId, toAccountId };
  if (values.kind === 'transfer') {
    return ok({ ...entry, ...accounts, kind: 'transfer', amount: values.amount, fee: values.fee });
  }
  return ok({
    ...entry,
    ...accounts,
    kind: 'conversion',
    sourceAmount: values.amount,
    targetAmount: values.targetAmount,
    rate: values.rate,
    fee: values.fee,
    feeCurrency: values.feeCurrency ?? undefined,
  });
}
