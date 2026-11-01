import { toLocalDay } from '@/features/ledger/application/overview-use-cases';
import { isSystemAccountId } from '@/features/ledger/domain/account';
import type { Transaction } from '@/features/ledger/domain/journal';

import { addDays, type Day } from '../domain/calendar';
import type { Expense } from '../domain/budget';

/**
 * A moment that lands on `day` in the device's zone. Noon always exists on the clock, however
 * daylight saving moves that day.
 */
export function localNoonOf(day: Day): string {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date, 12).toISOString();
}

export const todayOf = (clock: { now(): Date }): Day => toLocalDay(clock.now());

/** Stored moments are in UTC, so a local day can start a day earlier than its date reads. */
export const queryStartOf = (day: Day): string => `${addDays(day, -2)}T00:00:00.000Z`;

/** Positive, from the one posting on a real account. */
export function recordedAmount(transaction: Transaction): Omit<Expense, 'categoryId'> | null {
  const posting = transaction.postings.find(({ accountId }) => !isSystemAccountId(accountId));
  if (!posting) return null;
  return {
    day: toLocalDay(new Date(transaction.occurredAt)),
    minor: posting.amount < 0n ? -posting.amount : posting.amount,
    currency: posting.currency,
  };
}
