import {
  addDays,
  clampedDay,
  daysBetween,
  daysInMonth,
  monthOf,
  weekdayOf,
} from './calendar';

describe('calendar', () => {
  it('walks across a month, a year, and a leap day', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('has every day exactly once across daylight saving changes', () => {
    const days = Array.from({ length: 400 }, (_, index) => addDays('2026-01-01', index));
    expect(new Set(days).size).toBe(400);
    expect(days).toContain('2026-03-08');
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
  });

  it('counts days in both directions', () => {
    expect(daysBetween('2026-01-01', '2027-01-01')).toBe(365);
    expect(daysBetween('2028-01-01', '2029-01-01')).toBe(366);
    expect(daysBetween('2026-01-10', '2026-01-01')).toBe(-9);
  });

  it('knows month lengths and leap years', () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2100, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it('clamps a day to its month', () => {
    expect(clampedDay(2026, 2, 31)).toBe('2026-02-28');
    expect(clampedDay(2028, 2, 31)).toBe('2028-02-29');
    expect(clampedDay(2026, 4, 31)).toBe('2026-04-30');
    expect(clampedDay(2026, 1, 5)).toBe('2026-01-05');
  });

  it('rolls a month index over the year', () => {
    expect(monthOf(2026, 13)).toEqual({ year: 2027, month: 1 });
    expect(monthOf(2026, 0)).toEqual({ year: 2025, month: 12 });
    expect(monthOf(2026, 25)).toEqual({ year: 2028, month: 1 });
  });

  it('numbers weekdays from Monday', () => {
    expect(weekdayOf('2026-03-09')).toBe(1);
    expect(weekdayOf('2026-03-15')).toBe(7);
    expect(weekdayOf('2024-02-29')).toBe(4);
  });
});
