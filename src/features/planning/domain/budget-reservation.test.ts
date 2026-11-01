import type { Currency } from '@/features/ledger/domain/currency';
import type { ExchangeRate } from '@/features/ledger/domain/exchange-rate';

import type { Budget, BudgetStatus } from './budget';
import { reserveBudgets } from './budget-reservation';
import type { ExpectedFlow } from './cash-flow';

const usd: Currency = { code: 'USD', name: 'Dollar', decimals: 2, symbol: '$', kind: 'fiat' };
const eur: Currency = { code: 'EUR', name: 'Euro', decimals: 2, symbol: 'E', kind: 'fiat' };
const today = '2026-03-10';
const until = '2026-04-09';
const period = { startOn: '2026-03-01', endOn: '2026-03-31' };

const status = (
  id: string,
  categoryIds: readonly string[],
  change: Partial<Omit<BudgetStatus, 'budget'>> & { readonly budget?: Partial<Budget> } = {},
): BudgetStatus => ({
  period,
  spent: 0n,
  carried: 0n,
  available: 100_00n,
  remaining: 100_00n,
  missingRates: [],
  ...change,
  budget: {
    id,
    name: id,
    currencyCode: 'USD',
    amount: 100_00n,
    categoryIds,
    period: { kind: 'monthly', startDay: null },
    startsOn: '2026-01-01',
    rollover: false,
    active: true,
    ...change.budget,
  },
});

const out = (categoryId: string | null, minor: bigint, day = '2026-03-15'): ExpectedFlow => ({
  day,
  accountId: 'a',
  minor: -minor,
  label: 'x',
  categoryId,
});

const reserve = (
  statuses: readonly BudgetStatus[],
  flows: readonly ExpectedFlow[] = [],
  change: { rates?: readonly ExchangeRate[]; parents?: ReadonlyMap<string, string | null> } = {},
) =>
  reserveBudgets({
    statuses,
    flows,
    accountCurrencies: new Map([
      ['a', 'USD'],
      ['e', 'EUR'],
    ]),
    parents: change.parents ?? new Map(),
    base: usd,
    today,
    until,
    rates: change.rates ?? [],
    currencies: [usd, eur],
  });

const minors = (result: ReturnType<typeof reserve>) => result.outflows.map(({ minor }) => minor);

describe('reserveBudgets', () => {
  it('reserves what remains on the day the period ends', () => {
    expect(reserve([status('a', ['food'])]).outflows).toEqual([
      { day: '2026-03-31', minor: 100_00n },
    ]);
  });

  it('stops at the horizon', () => {
    const longer = status('a', ['food'], {
      period: { startOn: '2026-01-01', endOn: '2026-12-31' },
    });
    expect(reserve([longer]).outflows).toEqual([{ day: until, minor: 100_00n }]);
  });

  it('takes out what expected expenses in the budget already cover', () => {
    expect(minors(reserve([status('a', ['food'])], [out('food', 40_00n)]))).toEqual([60_00n]);
  });

  it('reaches a flow in a subcategory', () => {
    const parents = new Map([['groceries', 'food']]);
    const result = reserve([status('a', ['food'])], [out('groceries', 40_00n)], { parents });
    expect(minors(result)).toEqual([60_00n]);
  });

  it('never reserves below zero', () => {
    expect(minors(reserve([status('a', ['food'])], [out('food', 500_00n)]))).toEqual([]);
  });

  it.each<[string, ExpectedFlow]>([
    ['another category', out('fun', 40_00n)],
    ['no category', out(null, 40_00n)],
    ['after the period ends', out('food', 40_00n, '2026-04-01')],
    ['an account that is not projected', { ...out('food', 40_00n), accountId: 'gone' }],
    ['income', { ...out('food', 40_00n), minor: 40_00n }],
  ])('ignores a flow in %s', (_, flow) => {
    expect(minors(reserve([status('a', ['food'])], [flow]))).toEqual([100_00n]);
  });

  it('compares across currencies at today', () => {
    const rates = [
      { id: 'r', fromCode: 'EUR', toCode: 'USD', rate: '2', effectiveOn: '2026-01-01' },
    ];
    const euros = status('a', ['food'], { budget: { currencyCode: 'EUR' } });
    const flow = { ...out('food', 10_00n), accountId: 'e' };
    expect(minors(reserve([euros], [flow], { rates }))).toEqual([180_00n]);
  });

  it('reports a flow it cannot convert', () => {
    const result = reserve([status('a', ['food'])], [{ ...out('food', 10_00n), accountId: 'e' }]);
    expect(minors(result)).toEqual([100_00n]);
    expect(result.missing).toEqual(['EUR']);
  });

  it('reports a budget it cannot convert, and reserves nothing for it', () => {
    const result = reserve([status('a', ['food'], { budget: { currencyCode: 'EUR' } })]);
    expect(result).toEqual({ outflows: [], missing: ['EUR'] });
  });

  it('reports rates the status left out, even with nothing left to reserve', () => {
    const spent = status('a', ['food'], { remaining: 0n, missingRates: ['COP'] });
    expect(reserve([spent])).toEqual({ outflows: [], missing: ['COP'] });
  });

  it('skips a budget before its first day', () => {
    const later = status('a', ['food'], { budget: { startsOn: '2026-03-11' }, missingRates: ['COP'] });
    expect(reserve([later])).toEqual({ outflows: [], missing: [] });
  });

  describe('overlapping budgets', () => {
    it('reserves once, on the first budget, with the flow counted once', () => {
      const result = reserve(
        [status('a', ['food']), status('b', ['food'])],
        [out('food', 40_00n)],
      );
      expect(minors(result)).toEqual([60_00n]);
    });

    it('reserves only what a later budget has beyond the first', () => {
      const bigger = status('b', ['food'], { remaining: 150_00n });
      expect(minors(reserve([status('a', ['food']), bigger]))).toEqual([100_00n, 50_00n]);
    });

    it('overlaps through one shared category', () => {
      expect(minors(reserve([status('a', ['food']), status('b', ['food', 'fun'])]))).toEqual([
        100_00n,
      ]);
    });

    it('overlaps through a subcategory, in both orders', () => {
      const parents = new Map([['groceries', 'food']]);
      const food = status('a', ['food']);
      const groceries = status('b', ['groceries']);
      expect(minors(reserve([food, groceries], [], { parents }))).toEqual([100_00n]);
      expect(minors(reserve([groceries, food], [], { parents }))).toEqual([100_00n]);
    });

    it('keeps budgets on separate categories apart', () => {
      expect(minors(reserve([status('a', ['food']), status('b', ['fun'])]))).toEqual([
        100_00n,
        100_00n,
      ]);
    });
  });
});
