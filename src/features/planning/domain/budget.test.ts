import type { Currency } from '@/features/ledger/domain/currency';
import type { ExchangeRate } from '@/features/ledger/domain/exchange-rate';

import {
  belongsTo,
  computeBudgetStatus,
  rolloverRestarts,
  validateBudget,
  type Budget,
  type Expense,
} from './budget';

const usd: Currency = { code: 'USD', name: 'Dollar', decimals: 2, symbol: '$', kind: 'fiat' };
const cop: Currency = { code: 'COP', name: 'Peso', decimals: 2, symbol: '$', kind: 'fiat' };
const usdt: Currency = { code: 'USDT', name: 'Tether', decimals: 18, symbol: 'T', kind: 'stablecoin' };
const currencies = [usd, cop, usdt];

const budget = (change: Partial<Budget> = {}): Budget => ({
  id: 'b1',
  name: 'Food',
  currencyCode: 'USD',
  amount: 100_00n,
  categoryIds: ['food'],
  period: { kind: 'monthly', startDay: null },
  startsOn: '2026-01-01',
  rollover: false,
  active: true,
  ...change,
});

const expense = (day: string, minor: bigint, change: Partial<Expense> = {}): Expense => ({
  day,
  minor,
  currency: 'USD',
  categoryId: 'food',
  ...change,
});

const rate = (fromCode: string, toCode: string, value: string, effectiveOn = '2026-01-01') =>
  ({ id: `${fromCode}${toCode}`, fromCode, toCode, rate: value, effectiveOn }) as ExchangeRate;

const statusOf = (
  input: Budget,
  expenses: readonly Expense[],
  rates: readonly ExchangeRate[] = [],
  asOf = '2026-03-10',
  parents: ReadonlyMap<string, string | null> = new Map(),
) => computeBudgetStatus({ budget: input, expenses, rates, currencies, asOf, parents });

describe('computeBudgetStatus', () => {
  it('sums expenses in the period exactly', () => {
    const status = statusOf(budget(), [expense('2026-03-02', 10_10n), expense('2026-03-03', 20_20n)]);
    expect(status.spent).toBe(30_30n);
    expect(status.available).toBe(100_00n);
    expect(status.remaining).toBe(69_70n);
    expect(status.missingRates).toEqual([]);
  });

  it('counts the first and last day of the period and neither neighbour', () => {
    const status = statusOf(budget(), [
      expense('2026-02-28', 1n),
      expense('2026-03-01', 10n),
      expense('2026-03-31', 100n),
      expense('2026-04-01', 1000n),
    ]);
    expect(status.period).toEqual({ startOn: '2026-03-01', endOn: '2026-03-31' });
    expect(status.spent).toBe(110n);
  });

  it('keeps every digit of an 18 decimal budget', () => {
    const huge = 123_456_789_012_345_678_901_234_567_890n;
    const status = statusOf(budget({ currencyCode: 'USDT', amount: huge + 1n }), [
      expense('2026-03-02', huge, { currency: 'USDT' }),
    ]);
    expect(status.remaining).toBe(1n);
  });

  it('counts only its categories, and subcategories of them', () => {
    const parents = new Map([
      ['groceries', 'food'],
      ['fruit', 'groceries'],
      ['rent', null],
    ]);
    const status = statusOf(
      budget(),
      [
        expense('2026-03-02', 1n),
        expense('2026-03-02', 10n, { categoryId: 'groceries' }),
        expense('2026-03-02', 100n, { categoryId: 'fruit' }),
        expense('2026-03-02', 1000n, { categoryId: 'rent' }),
        expense('2026-03-02', 10000n, { categoryId: null }),
      ],
      [],
      '2026-03-10',
      parents,
    );
    expect(status.spent).toBe(111n);
  });

  it('survives a cycle in the category parents', () => {
    const parents = new Map([
      ['a', 'b'],
      ['b', 'a'],
    ]);
    const status = statusOf(budget(), [expense('2026-03-02', 5n, { categoryId: 'a' })], [], '2026-03-10', parents);
    expect(status.spent).toBe(0n);
  });

  it('converts with the rate of the expense day', () => {
    const status = statusOf(
      budget(),
      [
        expense('2026-03-02', 4000_00n, { currency: 'COP' }),
        expense('2026-03-09', 4000_00n, { currency: 'COP' }),
      ],
      [rate('USD', 'COP', '4000'), rate('USD', 'COP', '2000', '2026-03-05')],
    );
    expect(status.spent).toBe(1_00n + 2_00n);
  });

  it('reports a currency with no rate as missing and never as zero', () => {
    const status = statusOf(budget(), [
      expense('2026-03-02', 5_00n),
      expense('2026-03-02', 999_00n, { currency: 'COP' }),
    ]);
    expect(status.spent).toBe(5_00n);
    expect(status.missingRates).toEqual(['COP']);
  });

  it('treats a rate from after the expense as missing', () => {
    const status = statusOf(
      budget(),
      [expense('2026-03-02', 4000_00n, { currency: 'COP' })],
      [rate('USD', 'COP', '4000', '2026-03-05')],
    );
    expect(status.spent).toBe(0n);
    expect(status.missingRates).toEqual(['COP']);
  });

  it('reports a budget in overspend as a negative remainder', () => {
    expect(statusOf(budget(), [expense('2026-03-02', 150_00n)]).remaining).toBe(-50_00n);
  });

  describe('rollover', () => {
    const history = [expense('2026-01-15', 60_00n), expense('2026-02-15', 130_00n)];

    it('ignores earlier periods when off', () => {
      const status = statusOf(budget(), history);
      expect(status.carried).toBe(0n);
      expect(status.available).toBe(100_00n);
    });

    it('carries surplus and overspend from the first period', () => {
      const status = statusOf(budget({ rollover: true }), history);
      expect(status.carried).toBe(40_00n - 30_00n);
      expect(status.available).toBe(110_00n);
    });

    it('does not reach before the period the budget started in', () => {
      const status = statusOf(budget({ rollover: true, startsOn: '2026-02-20' }), [
        expense('2026-01-15', 60_00n),
        expense('2026-02-15', 30_00n),
      ]);
      expect(status.carried).toBe(70_00n);
    });

    it('carries nothing before the budget starts', () => {
      const status = statusOf(budget({ rollover: true, startsOn: '2026-06-01' }), []);
      expect(status.carried).toBe(0n);
      expect(status.available).toBe(100_00n);
    });

    it('reports a missing rate from a carried period', () => {
      const status = statusOf(budget({ rollover: true }), [
        expense('2026-01-15', 5_00n, { currency: 'COP' }),
      ]);
      expect(status.missingRates).toEqual(['COP']);
    });
  });

  it('runs on a custom period', () => {
    const status = statusOf(
      budget({ period: { kind: 'custom', startOn: '2026-03-05', lengthDays: 3 } }),
      [expense('2026-03-07', 1n), expense('2026-03-08', 10n), expense('2026-03-10', 100n)],
    );
    expect(status.period).toEqual({ startOn: '2026-03-08', endOn: '2026-03-10' });
    expect(status.spent).toBe(110n);
  });
});

describe('validateBudget', () => {
  it('trims the name and accepts a whole budget', () => {
    const result = validateBudget(budget({ name: '  Food ' }));
    expect(result).toEqual({ ok: true, value: expect.objectContaining({ name: 'Food' }) });
  });

  it.each([
    ['no name', { name: ' ' }],
    ['a zero amount', { amount: 0n }],
    ['a negative amount', { amount: -1n }],
    ['no categories', { categoryIds: [] }],
    ['a bad period', { period: { kind: 'monthly', startDay: 40 } as const }],
  ])('refuses %s', (_, change) => {
    expect(validateBudget(budget(change)).ok).toBe(false);
  });
});

describe('rolloverRestarts', () => {
  it('stays false for a change that leaves the carry alone', () => {
    expect(rolloverRestarts(budget(), budget({ name: 'Other', categoryIds: ['x'] }))).toBe(false);
  });

  it('sees the same period written in another key order as unchanged', () => {
    const before = budget({ period: { kind: 'yearly', startMonth: 2, startDay: 1 } });
    const after = budget({ period: { startDay: 1, startMonth: 2, kind: 'yearly' } });
    expect(rolloverRestarts(before, after)).toBe(false);
  });

  it.each<[string, Partial<Budget>]>([
    ['the amount', { amount: 1n }],
    ['the period', { period: { kind: 'weekly', startDay: null } }],
    ['the start of the period', { period: { kind: 'monthly', startDay: 5 } }],
    ['rollover', { rollover: true }],
  ])('restarts on %s', (_, change) => {
    expect(rolloverRestarts(budget(), budget(change))).toBe(true);
  });
});

describe('belongsTo', () => {
  it('reaches a chosen parent', () => {
    expect(belongsTo('c', new Set(['a']), new Map([['c', 'b'], ['b', 'a']]))).toBe(true);
    expect(belongsTo('c', new Set(['z']), new Map([['c', 'b']]))).toBe(false);
  });
});
