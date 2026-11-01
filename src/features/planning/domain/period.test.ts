import { nextPeriod, periodContaining, recentPeriods, validatePeriod } from './period';

describe('periodContaining', () => {
  it('defaults a week to Monday through Sunday', () => {
    const week = { kind: 'weekly', startDay: null } as const;
    expect(periodContaining(week, '2026-03-09')).toEqual({
      startOn: '2026-03-09',
      endOn: '2026-03-15',
    });
    expect(periodContaining(week, '2026-03-15')).toEqual({
      startOn: '2026-03-09',
      endOn: '2026-03-15',
    });
    expect(periodContaining(week, '2026-03-16').startOn).toBe('2026-03-16');
  });

  it('starts a week on the chosen day', () => {
    const week = { kind: 'weekly', startDay: 7 } as const;
    expect(periodContaining(week, '2026-03-14')).toEqual({
      startOn: '2026-03-08',
      endOn: '2026-03-14',
    });
    expect(periodContaining(week, '2026-03-15').startOn).toBe('2026-03-15');
  });

  it('defaults a month to the calendar month, in a leap year too', () => {
    const month = { kind: 'monthly', startDay: null } as const;
    expect(periodContaining(month, '2026-02-15')).toEqual({
      startOn: '2026-02-01',
      endOn: '2026-02-28',
    });
    expect(periodContaining(month, '2028-02-29')).toEqual({
      startOn: '2028-02-01',
      endOn: '2028-02-29',
    });
  });

  it('runs a month from a start day, on both sides of it', () => {
    const month = { kind: 'monthly', startDay: 25 } as const;
    expect(periodContaining(month, '2026-03-24')).toEqual({
      startOn: '2026-02-25',
      endOn: '2026-03-24',
    });
    expect(periodContaining(month, '2026-03-25')).toEqual({
      startOn: '2026-03-25',
      endOn: '2026-04-24',
    });
  });

  it('clamps a start day at short months and leaves no gap', () => {
    const month = { kind: 'monthly', startDay: 31 } as const;
    expect(periodContaining(month, '2026-02-28')).toEqual({
      startOn: '2026-02-28',
      endOn: '2026-03-30',
    });
    expect(periodContaining(month, '2026-02-27')).toEqual({
      startOn: '2026-01-31',
      endOn: '2026-02-27',
    });
    expect(periodContaining(month, '2026-03-31')).toEqual({
      startOn: '2026-03-31',
      endOn: '2026-04-29',
    });
  });

  it('covers every day of two years once with any start day', () => {
    for (const startDay of [1, 15, 29, 30, 31]) {
      const month = { kind: 'monthly', startDay } as const;
      let period = periodContaining(month, '2027-01-01');
      for (let index = 0; index < 30; index += 1) {
        const next = nextPeriod(month, period);
        const dayAfter = new Date(`${period.endOn}T00:00:00Z`);
        dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
        expect(next.startOn).toBe(dayAfter.toISOString().slice(0, 10));
        period = next;
      }
    }
  });

  it('defaults a year to the calendar year', () => {
    expect(periodContaining({ kind: 'yearly', startMonth: null, startDay: null }, '2026-06-01')).toEqual(
      { startOn: '2026-01-01', endOn: '2026-12-31' },
    );
  });

  it('runs a year from a chosen month and day', () => {
    const year = { kind: 'yearly', startMonth: 4, startDay: 6 } as const;
    expect(periodContaining(year, '2026-04-05')).toEqual({
      startOn: '2025-04-06',
      endOn: '2026-04-05',
    });
    expect(periodContaining(year, '2026-04-06').startOn).toBe('2026-04-06');
  });

  it('clamps a leap day start in other years', () => {
    const year = { kind: 'yearly', startMonth: 2, startDay: 29 } as const;
    expect(periodContaining(year, '2027-03-01')).toEqual({
      startOn: '2027-02-28',
      endOn: '2028-02-28',
    });
    expect(periodContaining(year, '2028-02-29').startOn).toBe('2028-02-29');
  });

  it('repeats a custom length from its start, in both directions', () => {
    const custom = { kind: 'custom', startOn: '2026-01-10', lengthDays: 14 } as const;
    expect(periodContaining(custom, '2026-01-10')).toEqual({
      startOn: '2026-01-10',
      endOn: '2026-01-23',
    });
    expect(periodContaining(custom, '2026-01-24').startOn).toBe('2026-01-24');
    expect(periodContaining(custom, '2026-01-09')).toEqual({
      startOn: '2025-12-27',
      endOn: '2026-01-09',
    });
  });
});

describe('recentPeriods', () => {
  it('lists periods oldest first, ending with the current one', () => {
    expect(recentPeriods({ kind: 'monthly', startDay: null }, '2026-03-10', 3)).toEqual([
      { startOn: '2026-01-01', endOn: '2026-01-31' },
      { startOn: '2026-02-01', endOn: '2026-02-28' },
      { startOn: '2026-03-01', endOn: '2026-03-31' },
    ]);
  });
});

describe('validatePeriod', () => {
  it.each([
    [{ kind: 'weekly', startDay: 1 }],
    [{ kind: 'weekly', startDay: null }],
    [{ kind: 'monthly', startDay: 31 }],
    [{ kind: 'yearly', startMonth: 12, startDay: 31 }],
    [{ kind: 'custom', startOn: '2026-01-01', lengthDays: 1 }],
  ] as const)('accepts %j', (period) => {
    expect(validatePeriod(period).ok).toBe(true);
  });

  it.each([
    [{ kind: 'weekly', startDay: 0 }],
    [{ kind: 'weekly', startDay: 8 }],
    [{ kind: 'monthly', startDay: 32 }],
    [{ kind: 'yearly', startMonth: 13, startDay: 1 }],
    [{ kind: 'custom', startOn: '2026-02-30', lengthDays: 7 }],
    [{ kind: 'custom', startOn: '2026-01-01', lengthDays: 0 }],
    [{ kind: 'custom', startOn: '2026-01-01', lengthDays: 2.5 }],
  ] as const)('refuses %j', (period) => {
    expect(validatePeriod(period).ok).toBe(false);
  });
});
