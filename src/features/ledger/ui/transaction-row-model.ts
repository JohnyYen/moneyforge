import { toLocalDay } from '../application/overview-use-cases';
import { isSystemAccountId, type Account } from '../domain/account';
import type { Category } from '../domain/category';
import type { Currency } from '../domain/currency';
import type { Posting, Transaction, TransactionKind } from '../domain/journal';
import { formatDecimal, formatDisplay } from '../domain/money';

export const TRANSACTION_PAGE_SIZE = 50;

export type TransactionRowModel = {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly amount: string;
  readonly direction: 'in' | 'out' | 'neutral';
};

export type RowLookups = {
  readonly accounts: readonly Account[];
  readonly categories: readonly Category[];
  readonly currencies: readonly Currency[];
};

export const KIND_LABELS: Record<TransactionKind, string> = {
  income: 'Income',
  expense: 'Expense',
  transfer: 'Transfer',
  conversion: 'Conversion',
  adjustment: 'Adjustment',
};

function directionOf(postings: readonly Posting[]): TransactionRowModel['direction'] {
  if (postings.length !== 1) return 'neutral';
  return postings[0].amount > 0n ? 'in' : 'out';
}

export function toTransactionRow(
  transaction: Transaction,
  lookups: RowLookups,
  focusAccountId?: string,
): TransactionRowModel {
  const visible = transaction.postings.filter((posting) => !isSystemAccountId(posting.accountId));
  const focused = focusAccountId
    ? visible.filter((posting) => posting.accountId === focusAccountId)
    : visible;

  const amountOf = ({ amount, currency: code }: Posting) => {
    const currency = lookups.currencies.find((candidate) => candidate.code === code);
    return currency ? formatDisplay(amount, currency) : `${formatDecimal(amount, 0)} ${code}`;
  };
  const accountName = ({ accountId }: Posting) =>
    lookups.accounts.find((account) => account.id === accountId)?.name ?? 'Unknown account';
  const category = lookups.categories.find(({ id }) => id === transaction.categoryId);
  const kind = KIND_LABELS[transaction.kind];
  const day = toLocalDay(new Date(transaction.occurredAt));

  return {
    id: transaction.id,
    title: transaction.description || category?.name || kind,
    subtitle: [kind, visible.map(accountName).join(' → '), day].join(' · '),
    amount: focused.map(amountOf).join(' → '),
    direction: directionOf(focused),
  };
}
