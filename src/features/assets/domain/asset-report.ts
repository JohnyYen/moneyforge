import type { Currency } from '@/features/ledger/domain/currency';
import type { Money } from '@/features/ledger/domain/money';
import { computeNetWorth } from '@/features/ledger/domain/net-worth';
import type { ExactRate } from '@/features/ledger/domain/rate';
import type { Day } from '@/features/planning/domain/calendar';
import {
  summarizeHistory,
  type FlowTotals,
  type Movement,
} from '@/features/planning/domain/cash-flow';
import type { ConversionContext } from '@/features/planning/domain/conversion';
import type { PeriodRange } from '@/features/planning/domain/period';

import { latestValuation, type Asset, type ExpectedStream, type Valuation } from './asset';
import { expectedMovements } from './asset-flows';

function greatestDivisor(first: bigint, second: bigint): bigint {
  let [a, b] = [first < 0n ? -first : first, second];
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

/** Reduced, with a positive denominator. `null` when there is nothing to divide by. */
export function exactRatio(numerator: bigint, denominator: bigint): ExactRate | null {
  if (denominator <= 0n) return null;
  const divisor = greatestDivisor(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

export type AssetReport = {
  readonly asset: Asset;
  readonly period: PeriodRange;
  /** Both totals are in the currency of the asset. */
  readonly actual: FlowTotals;
  readonly expected: FlowTotals;
  /** Actual net less expected net. */
  readonly difference: bigint;
  readonly latest: Valuation | null;
  /** Net over the latest value. Empty with no value, or while `actual` leaves a currency out. */
  readonly netYield: ExactRate | null;
  /** While this has entries, `actual` leaves those currencies out. */
  readonly missingRates: readonly string[];
};

export function computeAssetReport(
  input: ConversionContext & {
    readonly asset: Asset;
    readonly currency: Currency;
    readonly streams: readonly ExpectedStream[];
    readonly valuations: readonly Valuation[];
    /** Linked to this asset. Each converts at the rate of its own day. */
    readonly movements: readonly Movement[];
    readonly period: PeriodRange;
  },
): AssetReport {
  const { asset, currency, streams, valuations, movements, period, ...context } = input;
  const summarize = (moved: readonly Movement[]) => {
    const summary = { periods: [period], movements: moved, base: currency, ...context };
    return summarizeHistory(summary)[0];
  };
  const actual = summarize(movements);
  const { startOn, endOn } = period;
  const expected = summarize(expectedMovements(asset, streams, startOn, endOn)).base;
  const latest = latestValuation(valuations);
  const complete = actual.missingRates.length === 0;
  return {
    asset,
    period,
    actual: actual.base,
    expected,
    difference: actual.base.net - expected.net,
    latest,
    netYield: latest && complete ? exactRatio(actual.base.net, latest.amount) : null,
    missingRates: actual.missingRates,
  };
}

export type PortfolioRow = { readonly asset: Asset; readonly latest: Valuation | null };

export type Portfolio = {
  readonly rows: readonly PortfolioRow[];
  /** The latest value of every active asset. */
  readonly totalValue: Money;
  readonly monthlyNet: Money;
  /** While this has entries, the two totals leave those currencies out. */
  readonly missingRates: readonly string[];
};

export const assetValues = (rows: readonly PortfolioRow[]): Money[] =>
  rows.flatMap(({ asset, latest }) =>
    asset.status === 'active' && latest
      ? [{ minor: latest.amount, currency: asset.currencyCode }]
      : [],
  );

export function portfolioRows(
  assets: readonly Asset[],
  valuations: readonly Valuation[],
): PortfolioRow[] {
  return assets.map((asset) => ({
    asset,
    latest: latestValuation(valuations.filter(({ assetId }) => assetId === asset.id)),
  }));
}

export function computePortfolio(
  input: ConversionContext & {
    readonly assets: readonly Asset[];
    readonly valuations: readonly Valuation[];
    /** Everything linked to any asset, sold ones too: that money really moved. */
    readonly movements: readonly Movement[];
    readonly month: PeriodRange;
    readonly base: Currency;
    readonly today: Day;
  },
): Portfolio {
  const { assets, valuations, movements, month, base, today, rates, currencies } = input;
  const rows = portfolioRows(assets, valuations);
  const worth = computeNetWorth({ base, currencies, rates, asOf: today, balances: assetValues(rows) });
  const [flow] = summarizeHistory({ periods: [month], movements, base, rates, currencies });
  return {
    rows,
    totalValue: worth.total,
    monthlyNet: { minor: flow.base.net, currency: base.code },
    missingRates: [...new Set([...worth.missingRates, ...flow.missingRates])].sort(),
  };
}
