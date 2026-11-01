import { err, ok, type Result } from '@/shared/result';

import { systemAccountId, type AccountRef } from './account';
import { ledgerError, type LedgerError } from './ledger-error';
import type { Money } from './money';
import { parseRate } from './rate';

export const TRANSACTION_KINDS = [
  'income',
  'expense',
  'transfer',
  'conversion',
  'adjustment',
] as const;
export type TransactionKind = (typeof TRANSACTION_KINDS)[number];

export type Posting = {
  readonly accountId: string;
  readonly amount: bigint;
  readonly currency: string;
};

export type TransactionMetadata = Readonly<Record<string, string>>;

export type Transaction = {
  readonly id: string;
  readonly occurredAt: string;
  readonly kind: TransactionKind;
  readonly description: string;
  readonly categoryId: string | null;
  readonly metadata: TransactionMetadata | null;
  readonly postings: readonly Posting[];
};

type EntryFields = {
  readonly id: string;
  readonly occurredAt: string;
  readonly description: string;
  readonly categoryId?: string | null;
  readonly metadata?: TransactionMetadata | null;
};

type TransactionResult = Result<Transaction, LedgerError>;

export function isBalanced(postings: readonly Posting[]): boolean {
  const totals = new Map<string, bigint>();
  for (const { currency, amount } of postings) {
    totals.set(currency, (totals.get(currency) ?? 0n) + amount);
  }
  return [...totals.values()].every((total) => total === 0n);
}

export function createTransaction(
  input: EntryFields & {
    readonly kind: TransactionKind;
    readonly postings: readonly Posting[];
  },
): TransactionResult {
  if (Number.isNaN(Date.parse(input.occurredAt))) {
    return err(ledgerError('invalid-date', 'Enter a valid date.'));
  }
  if (input.postings.length < 2) {
    return err(ledgerError('too-few-postings', 'An entry needs at least two postings.'));
  }
  if (input.postings.some((posting) => posting.amount === 0n)) {
    return err(ledgerError('zero-posting', 'A posting cannot be zero.'));
  }
  if (!isBalanced(input.postings)) {
    return err(ledgerError('unbalanced', 'Postings must sum to zero per currency.'));
  }
  return ok({
    id: input.id,
    occurredAt: input.occurredAt,
    kind: input.kind,
    description: input.description.trim(),
    categoryId: input.categoryId ?? null,
    metadata: input.metadata ?? null,
    postings: input.postings,
  });
}

const nonPositive = () =>
  err(ledgerError('non-positive-amount', 'The amount must be greater than zero.'));

const posting = (accountId: string, amount: bigint, currency: string): Posting => ({
  accountId,
  amount,
  currency,
});

export function createIncome(
  input: EntryFields & { readonly account: AccountRef; readonly amount: bigint },
): TransactionResult {
  const { account, amount, ...fields } = input;
  if (amount <= 0n) return nonPositive();
  const currency = account.currencyCode;
  return createTransaction({
    ...fields,
    kind: 'income',
    postings: [
      posting(account.id, amount, currency),
      posting(systemAccountId(currency, 'income'), -amount, currency),
    ],
  });
}

export function createExpense(
  input: EntryFields & { readonly account: AccountRef; readonly amount: bigint },
): TransactionResult {
  const { account, amount, ...fields } = input;
  if (amount <= 0n) return nonPositive();
  const currency = account.currencyCode;
  return createTransaction({
    ...fields,
    kind: 'expense',
    postings: [
      posting(account.id, -amount, currency),
      posting(systemAccountId(currency, 'expense'), amount, currency),
    ],
  });
}

export function createTransfer(
  input: EntryFields & {
    readonly from: AccountRef;
    readonly to: AccountRef;
    readonly amount: bigint;
    readonly fee?: bigint;
  },
): TransactionResult {
  const { from, to, amount, fee = 0n, ...fields } = input;
  if (amount <= 0n || fee < 0n) return nonPositive();
  if (from.id === to.id) {
    return err(ledgerError('same-account', 'Choose two different accounts.'));
  }
  if (from.currencyCode !== to.currencyCode) {
    return err(ledgerError('currency-mismatch', 'A transfer needs accounts in one currency.'));
  }
  const currency = from.currencyCode;
  const feePostings = fee > 0n ? [posting(systemAccountId(currency, 'expense'), fee, currency)] : [];
  return createTransaction({
    ...fields,
    kind: 'transfer',
    postings: [
      posting(from.id, -(amount + fee), currency),
      posting(to.id, amount, currency),
      ...feePostings,
    ],
  });
}

export function createConversion(
  input: EntryFields & {
    readonly from: AccountRef;
    readonly to: AccountRef;
    readonly sourceAmount: bigint;
    readonly targetAmount: bigint;
    readonly rate: string;
    readonly fee?: Money;
  },
): TransactionResult {
  const { from, to, sourceAmount, targetAmount, rate, fee, metadata, ...fields } = input;
  const source = from.currencyCode;
  const target = to.currencyCode;
  if (source === target) {
    return err(ledgerError('currency-mismatch', 'A conversion needs two different currencies.'));
  }
  if (sourceAmount <= 0n || targetAmount <= 0n) return nonPositive();
  const parsedRate = parseRate(rate);
  if (!parsedRate.ok) return parsedRate;

  const feeMinor = fee?.minor ?? 0n;
  if (feeMinor < 0n) return nonPositive();
  if (fee && fee.currency !== source && fee.currency !== target) {
    return err(ledgerError('currency-mismatch', 'The fee must be in one of the two currencies.'));
  }
  const sourceFee = fee?.currency === source ? feeMinor : 0n;
  const targetFee = fee?.currency === target ? feeMinor : 0n;
  if (targetFee >= targetAmount) return nonPositive();

  const feePostings =
    fee && feeMinor > 0n
      ? [posting(systemAccountId(fee.currency, 'expense'), feeMinor, fee.currency)]
      : [];
  return createTransaction({
    ...fields,
    kind: 'conversion',
    metadata: { ...metadata, rate: rate.trim(), rateFrom: source, rateTo: target },
    postings: [
      posting(from.id, -(sourceAmount + sourceFee), source),
      posting(systemAccountId(source, 'conversion'), sourceAmount, source),
      posting(systemAccountId(target, 'conversion'), -targetAmount, target),
      posting(to.id, targetAmount - targetFee, target),
      ...feePostings,
    ],
  });
}

export function createAdjustment(
  input: EntryFields & { readonly account: AccountRef; readonly difference: bigint },
): TransactionResult {
  const { account, difference, ...fields } = input;
  const currency = account.currencyCode;
  return createTransaction({
    ...fields,
    kind: 'adjustment',
    postings: [
      posting(account.id, difference, currency),
      posting(systemAccountId(currency, 'equity'), -difference, currency),
    ],
  });
}
