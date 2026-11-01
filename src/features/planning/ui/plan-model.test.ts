import type { Currency } from '@/features/ledger/domain/currency';

import type { BudgetStatus } from '../domain/budget';
import type { Occurrence, RecurringItem } from '../domain/recurring';
import {
  barFraction,
  budgetRow,
  bucketBalances,
  emptyBudgetDraft,
  emptyRecurringDraft,
  firstNegativeLabel,
  flowTotalsLabel,
  missingRatesLabel,
  occurrenceRow,
  occurrencesLabel,
  scheduleLabel,
  toBudgetDraft,
  toBudgetInput,
  toggled,
  toRecurringDraft,
  toRecurringInput,
} from './plan-model';

const usd: Currency = { code: 'USD', name: 'Dollar', decimals: 2, symbol: '$', kind: 'fiat' };
const currencies = new Map([['USD', usd]]);

const status = (change: Partial<BudgetStatus> = {}): BudgetStatus => ({
  budget: {
    id: 'b1',
    name: 'Food',
    currencyCode: 'USD',
    amount: 100_00n,
    categoryIds: ['c'],
    period: { kind: 'monthly', startDay: null },
    startsOn: '2026-01-01',
    rollover: false,
    active: true,
  },
  period: { startOn: '2026-03-01', endOn: '2026-03-31' },
  spent: 25_00n,
  carried: 0n,
  available: 100_00n,
  remaining: 75_00n,
  missingRates: [],
  ...change,
});

describe('barFraction', () => {
  it('scales exactly and stays in bounds', () => {
    expect(barFraction(25n, 100n)).toBe(0.25);
    expect(barFraction(150n, 100n)).toBe(1);
    expect(barFraction(-25n, 100n)).toBe(0.25);
    expect(barFraction(0n, 100n)).toBe(0);
  });

  it('survives a zero or negative limit and huge values', () => {
    expect(barFraction(5n, 0n)).toBe(0);
    expect(barFraction(5n, -1n)).toBe(0);
    const huge = 10n ** 30n;
    expect(barFraction(huge, huge * 2n)).toBe(0.5);
  });
});

describe('budgetRow', () => {
  it('shows spent against what is available', () => {
    expect(budgetRow(status(), currencies)).toEqual({
      key: 'b1',
      title: 'Food',
      subtitle: 'Mar 1 to Mar 31. $75.00 left',
      amount: '$25.00 of $100.00',
      fraction: 0.25,
      overspent: false,
      warning: null,
    });
  });

  it('flags overspending', () => {
    const row = budgetRow(status({ spent: 120_00n, remaining: -20_00n }), currencies);
    expect(row.overspent).toBe(true);
    expect(row.fraction).toBe(1);
    expect(row.subtitle).toContain('$20.00 over');
  });

  it('warns that a missing rate leaves spending out', () => {
    const row = budgetRow(status({ missingRates: ['COP', 'EUR'] }), currencies);
    expect(row.warning).toBe('No rate for COP, EUR, so spending in them is not counted.');
  });
});

describe('labels', () => {
  it('counts pending occurrences', () => {
    expect(occurrencesLabel(1)).toBe('1 occurrence to confirm');
    expect(occurrencesLabel(3)).toBe('3 occurrences to confirm');
  });

  it('explains a missing rate', () => {
    expect(missingRatesLabel([])).toBeNull();
    expect(missingRatesLabel(['COP'])).toBe('No rate for COP, so it is not included here.');
  });

  it('surfaces the first negative date', () => {
    expect(firstNegativeLabel(null)).toBe('Stays positive through this horizon.');
    expect(firstNegativeLabel('2026-04-02')).toBe('Goes negative on 2026-04-02.');
  });

  it('writes flow totals', () => {
    expect(flowTotalsLabel({ income: 10_00n, expense: 2_50n, net: 7_50n }, usd)).toBe(
      'In $10.00, out $2.50, net $7.50',
    );
    expect(flowTotalsLabel({ income: 0n, expense: 1_00n, net: -1_00n }, usd)).toContain('net -$1.00');
  });
});

describe('scheduleLabel', () => {
  const schedule = (change = {}) => ({
    unit: 'day' as const,
    every: 1,
    startOn: '2026-01-31',
    endOn: null,
    dayOfMonth: null,
    ...change,
  });

  it.each([
    [{}, 'Every day'],
    [{ unit: 'week' }, 'Every week'],
    [{ unit: 'week', every: 2 }, 'Every 2 weeks'],
    [{ unit: 'month' }, 'Every month on day 31'],
    [{ unit: 'month', dayOfMonth: 5 }, 'Every month on day 5'],
    [{ unit: 'month', every: 3, dayOfMonth: 5 }, 'Every 3 months on day 5'],
    [{ unit: 'year' }, 'Every year'],
    [{ endOn: '2026-05-01' }, 'Every day until 2026-05-01'],
  ])('describes %j', (change, label) => {
    expect(scheduleLabel(schedule(change))).toBe(label);
  });
});

describe('occurrenceRow', () => {
  const occurrence: Occurrence = {
    id: 'o1',
    itemId: 'r1',
    dueOn: '2026-03-10',
    status: 'pending',
    kind: 'expense',
    accountId: 'a',
    toAccountId: null,
    amount: 10_00n,
    currencyCode: 'USD',
    categoryId: null,
    description: 'Rent',
    applySplit: false,
    transactionId: null,
    note: null,
  };

  it('shows the date, the amount, and any note', () => {
    expect(occurrenceRow(occurrence, currencies)).toEqual({
      key: 'o1',
      title: 'Rent',
      subtitle: '2026-03-10',
      amount: '-$10.00',
    });
    expect(occurrenceRow({ ...occurrence, note: 'Could not post' }, currencies).subtitle).toBe(
      '2026-03-10. Could not post',
    );
  });

  it('signs income and leaves transfers plain', () => {
    expect(occurrenceRow({ ...occurrence, kind: 'income' }, currencies).amount).toBe('$10.00');
    expect(occurrenceRow({ ...occurrence, kind: 'transfer' }, currencies).amount).toBe('$10.00');
  });
});

describe('bucketBalances', () => {
  const days = ['d1', 'd2', 'd3', 'd4', 'd5'];

  it('keeps every day when they fit', () => {
    expect(bucketBalances(days, [1n, 2n, 3n, 4n, 5n], 5)).toHaveLength(5);
  });

  it('keeps the lowest of each bucket, so a dip below zero stays visible', () => {
    expect(bucketBalances(days, [5n, -1n, 3n, 4n, 6n], 2)).toEqual([
      { day: 'd1', balance: -1n },
      { day: 'd4', balance: 4n },
    ]);
  });
});

describe('budget draft', () => {
  it('parses optional numbers, and leaves bad ones for validation', () => {
    const draft = { ...emptyBudgetDraft('USD'), name: 'Food', amount: '10', startDay: '25' };
    expect(toBudgetInput(draft).period).toEqual({ kind: 'monthly', startDay: 25 });
    expect(toBudgetInput({ ...draft, startDay: '' }).period).toEqual({
      kind: 'monthly',
      startDay: null,
    });
    const bad = toBudgetInput({ ...draft, startDay: 'x' }).period;
    expect(bad).toEqual({ kind: 'monthly', startDay: Number.NaN });
  });

  it('builds each period shape', () => {
    const draft = emptyBudgetDraft('USD');
    expect(
      toBudgetInput({ ...draft, periodKind: 'yearly', startMonth: '4', startDay: '6' }).period,
    ).toEqual({ kind: 'yearly', startMonth: 4, startDay: 6 });
    expect(
      toBudgetInput({
        ...draft,
        periodKind: 'custom',
        customStartOn: ' 2026-01-01 ',
        customLengthDays: '10',
      }).period,
    ).toEqual({ kind: 'custom', startOn: '2026-01-01', lengthDays: 10 });
  });

  it('round-trips through a stored budget', () => {
    const { budget } = status({
      budget: { ...status().budget, period: { kind: 'custom', startOn: '2026-01-01', lengthDays: 9 } },
    });
    const input = toBudgetInput(toBudgetDraft(budget, usd));
    expect(input).toEqual({
      name: 'Food',
      currencyCode: 'USD',
      amount: '100.00',
      categoryIds: ['c'],
      period: budget.period,
      rollover: false,
    });
  });
});

describe('toggled', () => {
  it('adds what is absent and removes what is present', () => {
    expect(toggled(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggled(['a', 'b'], 'a')).toEqual(['b']);
  });
});

describe('recurring draft', () => {
  const item: RecurringItem = {
    id: 'r1',
    name: 'Rent',
    kind: 'transfer',
    accountId: 'a',
    toAccountId: 'b',
    amount: 10_50n,
    currencyCode: 'USD',
    categoryId: null,
    schedule: { unit: 'month', every: 2, startOn: '2026-01-31', endOn: '2027-01-01', dayOfMonth: 15 },
    mode: 'auto',
    applySplit: false,
    active: true,
    materializedThrough: null,
  };

  it('round-trips through a stored item', () => {
    const { id, active, materializedThrough, currencyCode, ...rest } = item;
    expect(toRecurringInput(toRecurringDraft(item, usd))).toEqual({ ...rest, amount: '10.50' });
    expect([id, active, materializedThrough, currencyCode]).toHaveLength(4);
  });

  it('starts today, asking first', () => {
    expect(emptyRecurringDraft('2026-03-10', 'a')).toMatchObject({
      startOn: '2026-03-10',
      accountId: 'a',
      mode: 'ask',
      kind: 'expense',
      unit: 'month',
      every: '1',
    });
  });

  it('turns empty optional fields into nothing', () => {
    const input = toRecurringInput(emptyRecurringDraft('2026-03-10', 'a'));
    expect(input.schedule).toMatchObject({ endOn: null, dayOfMonth: null, every: 1 });
    expect(input.toAccountId).toBeNull();
    expect(input.categoryId).toBeNull();
  });

  it('drops a split that no longer applies', () => {
    const draft = { ...emptyRecurringDraft('2026-03-10', 'a'), kind: 'expense' as const, applySplit: true };
    expect(toRecurringInput(draft).applySplit).toBe(false);
  });
});
