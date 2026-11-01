import type { Currency } from '@/features/ledger/domain/currency';
import type { ExchangeRate } from '@/features/ledger/domain/exchange-rate';

import { projectCashFlow, summarizeHistory, type ProjectedAccount } from './cash-flow';

const usd: Currency = { code: 'USD', name: 'Dollar', decimals: 2, symbol: '$', kind: 'fiat' };
const cop: Currency = { code: 'COP', name: 'Peso', decimals: 2, symbol: '$', kind: 'fiat' };
const eur: Currency = { code: 'EUR', name: 'Euro', decimals: 2, symbol: 'E', kind: 'fiat' };
const currencies = [usd, cop, eur];
const rate = (fromCode: string, toCode: string, value: string, effectiveOn = '2026-01-01') =>
  ({ id: `${fromCode}${toCode}`, fromCode, toCode, rate: value, effectiveOn }) as ExchangeRate;

describe('summarizeHistory', () => {
  const periods = [
    { startOn: '2026-01-01', endOn: '2026-01-31' },
    { startOn: '2026-02-01', endOn: '2026-02-28' },
  ];

  it('totals each period per currency and in the base currency', () => {
    const rows = summarizeHistory({
      periods,
      base: usd,
      currencies,
      rates: [rate('USD', 'COP', '4000')],
      movements: [
        { day: '2026-01-01', kind: 'income', minor: 100_00n, currency: 'USD' },
        { day: '2026-01-31', kind: 'expense', minor: 30_00n, currency: 'USD' },
        { day: '2026-01-15', kind: 'expense', minor: 4000_00n, currency: 'COP' },
        { day: '2026-02-01', kind: 'income', minor: 8000_00n, currency: 'COP' },
      ],
    });
    expect(rows[0].byCurrency).toEqual([
      { currency: 'COP', income: 0n, expense: 4000_00n, net: -4000_00n },
      { currency: 'USD', income: 100_00n, expense: 30_00n, net: 70_00n },
    ]);
    expect(rows[0].base).toEqual({ income: 100_00n, expense: 31_00n, net: 69_00n });
    expect(rows[1].base).toEqual({ income: 2_00n, expense: 0n, net: 2_00n });
    expect(rows[1].missingRates).toEqual([]);
  });

  it('keeps an empty period, so a chart has no holes', () => {
    const rows = summarizeHistory({ periods, base: usd, currencies, rates: [], movements: [] });
    expect(rows).toHaveLength(2);
    expect(rows[0].byCurrency).toEqual([]);
    expect(rows[0].base).toEqual({ income: 0n, expense: 0n, net: 0n });
  });

  it('reports a currency with no rate, per period, and leaves it out of the base total', () => {
    const rows = summarizeHistory({
      periods,
      base: usd,
      currencies,
      rates: [],
      movements: [
        { day: '2026-02-10', kind: 'income', minor: 5_00n, currency: 'EUR' },
        { day: '2026-02-11', kind: 'income', minor: 1_00n, currency: 'USD' },
      ],
    });
    expect(rows[0].missingRates).toEqual([]);
    expect(rows[1].missingRates).toEqual(['EUR']);
    expect(rows[1].base.income).toBe(1_00n);
    expect(rows[1].byCurrency).toContainEqual({
      currency: 'EUR',
      income: 5_00n,
      expense: 0n,
      net: 5_00n,
    });
  });
});

describe('projectCashFlow', () => {
  const checking: ProjectedAccount = { accountId: 'a', currency: 'USD', balance: 100_00n };
  const savings: ProjectedAccount = { accountId: 'b', currency: 'USD', balance: 50_00n };
  const pesos: ProjectedAccount = { accountId: 'c', currency: 'COP', balance: 4000_00n };
  const today = '2026-03-10';
  const project = (change: Partial<Parameters<typeof projectCashFlow>[0]> = {}) =>
    projectCashFlow({
      today,
      horizonDays: 3,
      accounts: [checking],
      flows: [],
      totalOutflows: [],
      base: usd,
      currencies,
      rates: [],
      ...change,
    });

  it('lists one balance a day from today through the horizon', () => {
    const projection = project();
    expect(projection.days).toEqual(['2026-03-10', '2026-03-11', '2026-03-12', '2026-03-13']);
    expect(projection.accounts[0].balances).toEqual([100_00n, 100_00n, 100_00n, 100_00n]);
    expect(projection.accounts[0].firstNegativeOn).toBeNull();
  });

  it('applies flows on their day and keeps them after', () => {
    const projection = project({
      flows: [
        { day: '2026-03-10', accountId: 'a', minor: 1n, label: 'x' },
        { day: '2026-03-12', accountId: 'a', minor: -30_00n, label: 'y' },
      ],
    });
    expect(projection.accounts[0].balances).toEqual([100_01n, 100_01n, 70_01n, 70_01n]);
  });

  it('ignores flows outside the horizon and for unknown accounts', () => {
    const projection = project({
      flows: [
        { day: '2026-03-09', accountId: 'a', minor: -1n, label: 'x' },
        { day: '2026-03-14', accountId: 'a', minor: -1n, label: 'x' },
        { day: '2026-03-11', accountId: 'gone', minor: -1n, label: 'x' },
      ],
    });
    expect(projection.accounts[0].balances.at(-1)).toBe(100_00n);
  });

  it('finds the first date an account goes negative', () => {
    const projection = project({
      flows: [
        { day: '2026-03-12', accountId: 'a', minor: -100_01n, label: 'rent' },
        { day: '2026-03-13', accountId: 'a', minor: 500_00n, label: 'pay' },
      ],
    });
    expect(projection.accounts[0].firstNegativeOn).toBe('2026-03-12');
    expect(projection.accounts[0].balances.at(-1)).toBe(499_99n);
  });

  it('does not call exactly zero negative', () => {
    const projection = project({
      flows: [{ day: '2026-03-12', accountId: 'a', minor: -100_00n, label: 'rent' }],
    });
    expect(projection.accounts[0].firstNegativeOn).toBeNull();
  });

  it('reports an already negative balance on today', () => {
    const projection = project({ accounts: [{ ...checking, balance: -1n }] });
    expect(projection.accounts[0].firstNegativeOn).toBe(today);
  });

  it('totals accounts in the base currency at today rates', () => {
    const projection = project({
      accounts: [checking, savings, pesos],
      rates: [rate('USD', 'COP', '4000')],
    });
    expect(projection.total.balances[0]).toBe(151_00n);
    expect(projection.total.missingRates).toEqual([]);
  });

  it('reports a currency with no rate and leaves it out of the total', () => {
    const projection = project({ accounts: [checking, pesos] });
    expect(projection.total.balances[0]).toBe(100_00n);
    expect(projection.total.missingRates).toEqual(['COP']);
  });

  it('finds the first date the total goes negative, which one account can hide', () => {
    const projection = project({
      accounts: [checking, savings],
      flows: [{ day: '2026-03-11', accountId: 'a', minor: -120_00n, label: 'x' }],
    });
    expect(projection.accounts[0].firstNegativeOn).toBe('2026-03-11');
    expect(projection.total.firstNegativeOn).toBeNull();
  });

  it('takes reserved outflows from the total only, from their day on', () => {
    const projection = project({
      totalOutflows: [{ day: '2026-03-12', minor: 150_00n }],
    });
    expect(projection.accounts[0].firstNegativeOn).toBeNull();
    expect(projection.total.balances).toEqual([100_00n, 100_00n, -50_00n, -50_00n]);
    expect(projection.total.firstNegativeOn).toBe('2026-03-12');
  });

  it('projects a whole year day by day', () => {
    const projection = project({ horizonDays: 365 });
    expect(projection.days).toHaveLength(366);
    expect(projection.days.at(-1)).toBe('2027-03-10');
  });
});
