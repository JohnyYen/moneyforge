import { occurrencesBetween, validateSchedule, type Schedule } from './schedule';

const schedule = (change: Partial<Schedule>): Schedule => ({
  unit: 'month',
  every: 1,
  startOn: '2026-01-01',
  endOn: null,
  dayOfMonth: null,
  ...change,
});

describe('occurrencesBetween', () => {
  it('runs daily with both ends included', () => {
    const daily = schedule({ unit: 'day', startOn: '2026-03-07' });
    expect(occurrencesBetween(daily, '2026-03-07', '2026-03-09')).toEqual([
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
    ]);
  });

  it('runs every N days and weeks from the start, wherever the window opens', () => {
    const everyThird = schedule({ unit: 'day', every: 3, startOn: '2026-01-01' });
    expect(occurrencesBetween(everyThird, '2026-01-05', '2026-01-11')).toEqual([
      '2026-01-07',
      '2026-01-10',
    ]);
    const fortnight = schedule({ unit: 'week', every: 2, startOn: '2026-03-02' });
    expect(occurrencesBetween(fortnight, '2026-03-03', '2026-04-01')).toEqual([
      '2026-03-16',
      '2026-03-30',
    ]);
  });

  it('clamps at short months and returns to the day afterwards', () => {
    const monthly = schedule({ startOn: '2026-01-31' });
    expect(occurrencesBetween(monthly, '2026-01-01', '2026-05-31')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
    ]);
  });

  it('uses the 29th of a leap February', () => {
    const monthly = schedule({ startOn: '2028-01-31' });
    expect(occurrencesBetween(monthly, '2028-02-01', '2028-02-29')).toEqual(['2028-02-29']);
  });

  it('takes the day of the month over the day of the start', () => {
    const monthly = schedule({ startOn: '2026-01-15', dayOfMonth: 10 });
    expect(occurrencesBetween(monthly, '2026-01-01', '2026-03-31')).toEqual([
      '2026-02-10',
      '2026-03-10',
    ]);
  });

  it('keeps every third month across a year', () => {
    const quarterly = schedule({ every: 3, startOn: '2026-11-30' });
    expect(occurrencesBetween(quarterly, '2026-11-01', '2027-06-01')).toEqual([
      '2026-11-30',
      '2027-02-28',
      '2027-05-30',
    ]);
  });

  it('runs yearly from a leap day, clamped in other years', () => {
    const yearly = schedule({ unit: 'year', startOn: '2024-02-29' });
    expect(occurrencesBetween(yearly, '2024-01-01', '2028-12-31')).toEqual([
      '2024-02-29',
      '2025-02-28',
      '2026-02-28',
      '2027-02-28',
      '2028-02-29',
    ]);
  });

  it('stops at the end date, included', () => {
    const daily = schedule({ unit: 'day', startOn: '2026-01-01', endOn: '2026-01-02' });
    expect(occurrencesBetween(daily, '2026-01-01', '2026-01-09')).toEqual([
      '2026-01-01',
      '2026-01-02',
    ]);
  });

  it('returns nothing before the start or for an inverted window', () => {
    const monthly = schedule({ startOn: '2026-06-01' });
    expect(occurrencesBetween(monthly, '2026-01-01', '2026-05-31')).toEqual([]);
    expect(occurrencesBetween(monthly, '2026-08-01', '2026-07-01')).toEqual([]);
  });

  it('finds a far window without missing a clamped date', () => {
    const monthly = schedule({ startOn: '2000-01-31' });
    expect(occurrencesBetween(monthly, '2030-02-01', '2030-02-28')).toEqual(['2030-02-28']);
    const yearly = schedule({ unit: 'year', startOn: '2000-02-29' });
    expect(occurrencesBetween(yearly, '2030-01-01', '2030-12-31')).toEqual(['2030-02-28']);
  });
});

describe('validateSchedule', () => {
  it('accepts a whole schedule', () => {
    expect(validateSchedule(schedule({ every: 2, dayOfMonth: 31 })).ok).toBe(true);
  });

  it.each([
    ['a bad unit', { unit: 'hour' as Schedule['unit'] }],
    ['zero every', { every: 0 }],
    ['fractional every', { every: 1.5 }],
    ['a bad start', { startOn: '2026-02-30' }],
    ['a bad end', { endOn: 'soon' }],
    ['an end before the start', { startOn: '2026-02-01', endOn: '2026-01-01' }],
    ['day 0', { dayOfMonth: 0 }],
    ['day 32', { dayOfMonth: 32 }],
  ])('refuses %s', (_, change) => {
    expect(validateSchedule(schedule(change)).ok).toBe(false);
  });

  it('drops a day of the month outside monthly schedules', () => {
    const result = validateSchedule(schedule({ unit: 'week', dayOfMonth: 5 }));
    expect(result).toEqual({ ok: true, value: expect.objectContaining({ dayOfMonth: null }) });
  });
});
