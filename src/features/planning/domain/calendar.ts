/**
 * Calendar days as `YYYY-MM-DD`, with no time and no zone. Arithmetic goes through UTC, which has
 * no daylight saving, so a day can never be skipped or repeated.
 */
export type Day = string;

const MS_PER_DAY = 86_400_000;

function epochDay(day: Day): number {
  const [year, month, date] = day.split('-').map(Number);
  return Date.UTC(year, month - 1, date) / MS_PER_DAY;
}

const fromEpochDay = (value: number): Day =>
  new Date(value * MS_PER_DAY).toISOString().slice(0, 10);

export function addDays(day: Day, count: number): Day {
  return fromEpochDay(epochDay(day) + count);
}

export function daysBetween(from: Day, to: Day): number {
  return epochDay(to) - epochDay(from);
}

export function partsOf(day: Day): { year: number; month: number; date: number } {
  const [year, month, date] = day.split('-').map(Number);
  return { year, month, date };
}

/** Day zero of the next month is the last day of this one. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

const pad = (value: number, width = 2) => String(value).padStart(width, '0');

export function clampedDay(year: number, month: number, date: number): Day {
  return `${pad(year, 4)}-${pad(month)}-${pad(Math.min(date, daysInMonth(year, month)))}`;
}

/** Normalizes a month count past either end of a year. */
export function monthOf(year: number, month: number): { year: number; month: number } {
  const zeroBased = year * 12 + (month - 1);
  return { year: Math.floor(zeroBased / 12), month: (((zeroBased % 12) + 12) % 12) + 1 };
}

/** Monday is 1 and Sunday is 7. Day zero of the epoch was a Thursday. */
export function weekdayOf(day: Day): number {
  return ((((epochDay(day) + 3) % 7) + 7) % 7) + 1;
}

export const laterDay = (first: Day, second: Day): Day => (first > second ? first : second);
export const earlierDay = (first: Day, second: Day): Day => (first < second ? first : second);
