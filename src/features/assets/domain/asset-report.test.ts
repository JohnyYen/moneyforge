import type { Currency } from '@/features/ledger/domain/currency';
import type { ExchangeRate } from '@/features/ledger/domain/exchange-rate';
import { powerOfTen } from '@/features/ledger/domain/rate';
import type { Movement } from '@/features/planning/domain/cash-flow';

import type { Asset, ExpectedStream, Valuation } from './asset';
import { computeAssetReport, computePortfolio, exactRatio } from './asset-report';

const usd: Currency = { code: 'USD', name: 'Dollar', decimals: 2, symbol: '$', kind: 'fiat' };
const cop: Currency = { code: 'COP', name: 'Peso', decimals: 2, symbol: '$', kind: 'fiat' };
const dai: Currency = { code: 'DAI', name: 'Dai', decimals: 18, symbol: 'DAI', kind: 'stablecoin' };
const currencies = [usd, cop, dai];

const rate = (fromCode: string, rateText: string, effectiveOn = '2026-01-01'): ExchangeRate => ({
  id: `${fromCode}-${effectiveOn}`,
  fromCode,
  toCode: 'USD',
  rate: rateText,
  effectiveOn,
});

const asset = (change: Partial<Asset> = {}): Asset => ({
  id: 'a1',
  name: 'Flat',
  typeId: 't1',
  currencyCode: 'USD',
  accountId: null,
  status: 'active',
  soldOn: null,
  notes: '',
  ...change,
});

const value = (amount: bigint, change: Partial<Valuation> = {}): Valuation => ({
  id: 'v1',
  assetId: 'a1',
  valuedOn: '2026-01-01',
  amount,
  ...change,
});

const rent: ExpectedStream = {
  id: 's1',
  assetId: 'a1',
  name: 'Rent',
  kind: 'income',
  amount: 100_00n,
  schedule: { unit: 'month', every: 1, startOn: '2026-01-05', endOn: null, dayOfMonth: null },
};

const moved = (
  kind: Movement['kind'],
  minor: bigint,
  currency = 'USD',
  day = '2026-03-05',
): Movement => ({ kind, minor, currency, day });

const period = { startOn: '2026-03-01', endOn: '2026-03-31' };

const report = (
  movements: readonly Movement[],
  change: {
    rates?: readonly ExchangeRate[];
    valuations?: readonly Valuation[];
    streams?: readonly ExpectedStream[];
    asset?: Asset;
  } = {},
) =>
  computeAssetReport({
    asset: change.asset ?? asset(),
    currency: usd,
    streams: change.streams ?? [rent],
    valuations: change.valuations ?? [value(40_000_00n)],
    movements,
    period,
    rates: change.rates ?? [],
    currencies,
  });

describe('exactRatio', () => {
  it('reduces in exact integers', () => {
    expect(exactRatio(1_200_00n, 240_000_00n)).toEqual({ numerator: 1n, denominator: 200n });
  });

  it('keeps a loss negative and holds values no float could', () => {
    const big = powerOfTen(30) + 1n;
    expect(exactRatio(-big, 3n * big)).toEqual({ numerator: -1n, denominator: 3n });
  });

  it('has no ratio on nothing', () => {
    expect(exactRatio(5n, 0n)).toBeNull();
  });
});

describe('computeAssetReport', () => {
  it('reports actual, expected, the difference, and an exact yield', () => {
    const result = report([moved('income', 90_00n), moved('expense', 10_00n)]);
    expect(result.actual).toEqual({ income: 90_00n, expense: 10_00n, net: 80_00n });
    expect(result.expected).toEqual({ income: 100_00n, expense: 0n, net: 100_00n });
    expect(result.difference).toBe(-20_00n);
    expect(result.netYield).toEqual({ numerator: 1n, denominator: 500n });
    expect(result.missingRates).toEqual([]);
  });

  it('leaves out what falls outside the period', () => {
    const result = report([moved('income', 1n, 'USD', '2026-02-28'), moved('income', 2n, 'USD', '2026-04-01')]);
    expect(result.actual.net).toBe(0n);
  });

  it('stops expecting from the day of the sale', () => {
    const sold = asset({ status: 'sold', soldOn: '2026-03-05' });
    expect(report([], { asset: sold }).expected.income).toBe(0n);
  });

  it('converts each movement at the rate of its own day', () => {
    const rates = [rate('COP', '0.00025'), rate('COP', '0.0005', '2026-03-10')];
    const result = report(
      [moved('income', 4_000_00n, 'COP'), moved('income', 4_000_00n, 'COP', '2026-03-12')],
      { rates },
    );
    expect(result.actual.income).toBe(1_00n + 2_00n);
  });

  it('reports a missing rate, never reads it as zero, and gives no yield on a partial net', () => {
    const result = report([moved('income', 90_00n), moved('expense', 5_00n, 'COP')]);
    expect(result.missingRates).toEqual(['COP']);
    expect(result.actual.expense).toBe(0n);
    expect(result.netYield).toBeNull();
  });

  it('uses the latest value, and has no yield with no value', () => {
    const newer = value(10_000_00n, { id: 'v2', valuedOn: '2026-02-01' });
    const income = [moved('income', 100_00n)];
    expect(report(income, { valuations: [value(1n), newer] }).netYield).toEqual({
      numerator: 1n,
      denominator: 100n,
    });
    expect(report(income, { valuations: [] }).netYield).toBeNull();
    expect(report(income, { valuations: [value(0n)] }).netYield).toBeNull();
  });
});

describe('computePortfolio', () => {
  const portfolio = (input: {
    assets: readonly Asset[];
    valuations: readonly Valuation[];
    movements?: readonly Movement[];
    rates?: readonly ExchangeRate[];
  }) =>
    computePortfolio({
      assets: input.assets,
      valuations: input.valuations,
      movements: input.movements ?? [],
      month: period,
      base: usd,
      today: '2026-03-10',
      rates: input.rates ?? [],
      currencies,
    });

  it('totals the latest values in the base currency, exactly', () => {
    const coin = asset({ id: 'a2', currencyCode: 'DAI' });
    const coinValue = value(1_500000000000000001n, { id: 'v2', assetId: 'a2' });
    const result = portfolio({
      assets: [asset(), coin],
      valuations: [value(1n), value(2_00n, { id: 'v3', valuedOn: '2026-02-01' }), coinValue],
      rates: [rate('DAI', '2')],
    });
    expect(result.totalValue).toEqual({ minor: 2_00n + 3_00n, currency: 'USD' });
    expect(result.missingRates).toEqual([]);
  });

  it('leaves sold assets out of the value', () => {
    const sold = asset({ status: 'sold', soldOn: '2026-03-01' });
    expect(portfolio({ assets: [sold], valuations: [value(5n)] }).totalValue.minor).toBe(0n);
  });

  it('nets this month in the base currency', () => {
    const movements = [
      moved('income', 100_00n),
      moved('expense', 4_000_00n, 'COP'),
      moved('income', 7n, 'USD', '2026-02-28'),
    ];
    const result = portfolio({
      assets: [],
      valuations: [],
      movements,
      rates: [rate('COP', '0.00025')],
    });
    expect(result.monthlyNet).toEqual({ minor: 99_00n, currency: 'USD' });
  });

  it('reports every missing rate once, from values and flows alike', () => {
    const peso = asset({ currencyCode: 'COP' });
    const result = portfolio({
      assets: [peso],
      valuations: [value(5n)],
      movements: [moved('income', 5n, 'COP'), moved('expense', 5n, 'DAI')],
    });
    expect(result.missingRates).toEqual(['COP', 'DAI']);
    expect(result.totalValue.minor).toBe(0n);
    expect(result.monthlyNet.minor).toBe(0n);
  });

  it('has a row for an asset with no value yet', () => {
    const result = portfolio({ assets: [asset()], valuations: [] });
    expect(result.rows).toEqual([{ asset: asset(), latest: null }]);
  });
});
