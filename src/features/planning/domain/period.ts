import { isValidDate } from '@/features/ledger/domain/exchange-rate';
import { err, ok, type Result } from '@/shared/result';

import { addDays, clampedDay, daysBetween, monthOf, partsOf, weekdayOf, type Day } from './calendar';
import { planningError, type PlanningError } from './planning-error';

export const PERIOD_KINDS = ['weekly', 'monthly', 'yearly', 'custom'] as const;
export type PeriodKind = (typeof PERIOD_KINDS)[number];

export type BudgetPeriod =
  /** `startDay` is a weekday, Monday 1 to Sunday 7. */
  | { readonly kind: 'weekly'; readonly startDay: number | null }
  /** `startDay` is a day of the month, clamped at short months. */
  | { readonly kind: 'monthly'; readonly startDay: number | null }
  | { readonly kind: 'yearly'; readonly startMonth: number | null; readonly startDay: number | null }
  | { readonly kind: 'custom'; readonly startOn: Day; readonly lengthDays: number };

export type PeriodRange = { readonly startOn: Day; readonly endOn: Day };

function monthlyRange(startDay: number, day: Day): PeriodRange {
  const { year, month } = partsOf(day);
  const current = clampedDay(year, month, startDay);
  const startMonth = current <= day ? { year, month } : monthOf(year, month - 1);
  const following = monthOf(startMonth.year, startMonth.month + 1);
  return {
    startOn: clampedDay(startMonth.year, startMonth.month, startDay),
    endOn: addDays(clampedDay(following.year, following.month, startDay), -1),
  };
}

function yearlyRange(startMonth: number, startDay: number, day: Day): PeriodRange {
  const { year } = partsOf(day);
  const startYear = clampedDay(year, startMonth, startDay) <= day ? year : year - 1;
  return {
    startOn: clampedDay(startYear, startMonth, startDay),
    endOn: addDays(clampedDay(startYear + 1, startMonth, startDay), -1),
  };
}

export function periodContaining(period: BudgetPeriod, day: Day): PeriodRange {
  switch (period.kind) {
    case 'weekly': {
      const startOn = addDays(day, -((weekdayOf(day) - (period.startDay ?? 1) + 7) % 7));
      return { startOn, endOn: addDays(startOn, 6) };
    }
    case 'monthly':
      return monthlyRange(period.startDay ?? 1, day);
    case 'yearly':
      return yearlyRange(period.startMonth ?? 1, period.startDay ?? 1, day);
    case 'custom': {
      const index = Math.floor(daysBetween(period.startOn, day) / period.lengthDays);
      const startOn = addDays(period.startOn, index * period.lengthDays);
      return { startOn, endOn: addDays(startOn, period.lengthDays - 1) };
    }
  }
}

export function nextPeriod(period: BudgetPeriod, current: PeriodRange): PeriodRange {
  return periodContaining(period, addDays(current.endOn, 1));
}

/** Oldest first, and the last one contains `day`. */
export function recentPeriods(period: BudgetPeriod, day: Day, count: number): PeriodRange[] {
  const ranges = [periodContaining(period, day)];
  while (ranges.length < count) {
    ranges.unshift(periodContaining(period, addDays(ranges[0].startOn, -1)));
  }
  return ranges;
}

const inRange = (value: number | null, last: number) =>
  value === null || (Number.isInteger(value) && value >= 1 && value <= last);

const MAX_LENGTH_DAYS = 3660;

export function validatePeriod(period: BudgetPeriod): Result<BudgetPeriod, PlanningError> {
  const invalid = (message: string) => err(planningError('invalid-period', message));
  switch (period.kind) {
    case 'weekly':
      return inRange(period.startDay, 7) ? ok(period) : invalid('A week starts on day 1 to 7.');
    case 'monthly':
      return inRange(period.startDay, 31) ? ok(period) : invalid('A month starts on day 1 to 31.');
    case 'yearly':
      if (!inRange(period.startMonth, 12)) return invalid('Enter a start month from 1 to 12.');
      return inRange(period.startDay, 31) ? ok(period) : invalid('Enter a start day from 1 to 31.');
    case 'custom':
      if (!isValidDate(period.startOn)) return invalid('Enter the start date as YYYY-MM-DD.');
      return inRange(period.lengthDays, MAX_LENGTH_DAYS)
        ? ok(period)
        : invalid(`Enter a length from 1 to ${MAX_LENGTH_DAYS} days.`);
    default:
      return invalid('Choose a period.');
  }
}
