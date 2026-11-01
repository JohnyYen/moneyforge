import { isValidDate } from '@/features/ledger/domain/exchange-rate';
import { err, ok, type Result } from '@/shared/result';

import { addDays, clampedDay, daysBetween, earlierDay, laterDay, monthOf, partsOf, type Day } from './calendar';
import { planningError, type PlanningError } from './planning-error';

export const SCHEDULE_UNITS = ['day', 'week', 'month', 'year'] as const;
export type ScheduleUnit = (typeof SCHEDULE_UNITS)[number];

export type Schedule = {
  readonly unit: ScheduleUnit;
  /** Every N units, counted from `startOn`. */
  readonly every: number;
  readonly startOn: Day;
  readonly endOn: Day | null;
  /** Monthly only. Empty means the day of `startOn`. */
  readonly dayOfMonth: number | null;
};

const MAX_EVERY = 1000;

export function validateSchedule(schedule: Schedule): Result<Schedule, PlanningError> {
  const invalid = (message: string) => err(planningError('invalid-schedule', message));
  const { unit, every, startOn, endOn, dayOfMonth } = schedule;
  if (!SCHEDULE_UNITS.includes(unit)) return invalid('Choose how often this repeats.');
  if (!Number.isInteger(every) || every < 1 || every > MAX_EVERY) {
    return invalid(`Enter a whole number from 1 to ${MAX_EVERY} for how often this repeats.`);
  }
  if (!isValidDate(startOn)) return invalid('Enter the start date as YYYY-MM-DD.');
  if (endOn !== null && !isValidDate(endOn)) return invalid('Enter the end date as YYYY-MM-DD.');
  if (endOn !== null && endOn < startOn) return invalid('The end date is before the start date.');
  const monthly = unit === 'month';
  if (monthly && dayOfMonth !== null) {
    if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
      return invalid('Enter a day of the month from 1 to 31.');
    }
  }
  return ok({ ...schedule, dayOfMonth: monthly ? dayOfMonth : null });
}

/** Always from the start, never from the last date, so one clamped date cannot shift the rest. */
function occurrenceAt(schedule: Schedule, index: number): Day {
  const { unit, every, startOn, dayOfMonth } = schedule;
  const steps = index * every;
  if (unit === 'day') return addDays(startOn, steps);
  if (unit === 'week') return addDays(startOn, steps * 7);
  const { year, month, date } = partsOf(startOn);
  if (unit === 'year') return clampedDay(year + steps, month, date);
  const target = monthOf(year, month + steps);
  return clampedDay(target.year, target.month, dayOfMonth ?? date);
}

/** An index at or before the first occurrence on `day`, so a far window skips the walk there. */
function firstIndexNear({ unit, every, startOn }: Schedule, day: Day): number {
  const start = partsOf(startOn);
  const target = partsOf(day);
  const elapsed = {
    day: daysBetween(startOn, day),
    week: Math.floor(daysBetween(startOn, day) / 7),
    month: (target.year - start.year) * 12 + target.month - start.month,
    year: target.year - start.year,
  }[unit];
  return Math.max(0, Math.floor(elapsed / every) - 1);
}

/** Every occurrence from `from` through `to`, both included. */
export function occurrencesBetween(schedule: Schedule, from: Day, to: Day): Day[] {
  const first = laterDay(from, schedule.startOn);
  const last = schedule.endOn ? earlierDay(to, schedule.endOn) : to;
  const days: Day[] = [];
  if (first > last) return days;
  for (let index = firstIndexNear(schedule, first); ; index += 1) {
    const day = occurrenceAt(schedule, index);
    if (day > last) return days;
    if (day >= first) days.push(day);
  }
}
