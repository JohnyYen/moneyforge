import { BASE_CURRENCY_KEY } from '@/features/ledger/application/setup-use-cases';
import type { Currency } from '@/features/ledger/domain/currency';
import { isValidDate } from '@/features/ledger/domain/exchange-rate';
import { computeNetWorth, type NetWorth } from '@/features/ledger/domain/net-worth';
import {
  queryStartOf,
  recordedAmount,
  todayOf,
} from '@/features/planning/application/recorded-movements';
import type { ExpectedCashFlowSource } from '@/features/planning/application/ports';
import { addDays, type Day } from '@/features/planning/domain/calendar';
import type { Movement } from '@/features/planning/domain/cash-flow';
import { periodContaining } from '@/features/planning/domain/period';
import { err, ok, type Result } from '@/shared/result';

import { STREAM_KINDS, type TransactionLink } from '../domain/asset';
import { assetError, type AssetError } from '../domain/asset-error';
import { expectedAssetFlows } from '../domain/asset-flows';
import {
  assetValues,
  computeAssetReport,
  computePortfolio,
  portfolioRows,
  type AssetReport,
  type Portfolio,
} from '../domain/asset-report';
import type { AssetDeps } from './ports';

export function createAssetReportUseCases({ store, clock }: AssetDeps) {
  async function baseCurrency(): Promise<Result<Currency, AssetError>> {
    const code = await store.settings.get(BASE_CURRENCY_KEY);
    const base = code ? await store.currencies.get(code) : null;
    return base ? ok(base) : err(assetError('setup-required', 'Choose a base currency first.'));
  }

  /** What `links` really moved. A stored moment can fall a day either side of its local day. */
  async function linkedMovements(
    links: readonly TransactionLink[],
    from: Day,
    to: Day,
  ): Promise<Movement[]> {
    const linked = new Set(links.map(({ transactionId }) => transactionId));
    const range = { from: queryStartOf(from), to: `${addDays(to, 2)}T00:00:00.000Z` };
    const found = await Promise.all(
      STREAM_KINDS.map(async (kind) => {
        const recorded = await store.journal.list({ ...range, kind });
        return recorded.flatMap((transaction) => {
          const amount = linked.has(transaction.id) ? recordedAmount(transaction) : null;
          return amount ? [{ ...amount, kind }] : [];
        });
      }),
    );
    return found.flat();
  }

  const expectedSource: ExpectedCashFlowSource = {
    async expectedFlows({ from, to }) {
      const [assets, streams, payments, rates, currencies] = await Promise.all([
        store.assets.listAssets(),
        store.assets.listStreams(),
        store.assets.listPayments(),
        store.exchangeRates.list(),
        store.currencies.list(),
      ]);
      return expectedAssetFlows({ assets, streams, payments, rates, currencies, from, to });
    },
  };

  return {
    expectedSource,

    async assetReport(
      id: string,
      { from, to }: { readonly from: Day; readonly to: Day },
    ): Promise<Result<AssetReport, AssetError>> {
      if (!isValidDate(from) || !isValidDate(to) || from > to) {
        return err(assetError('invalid-date', 'Enter a start date on or before the end date.'));
      }
      const asset = await store.assets.getAsset(id);
      if (!asset) return err(assetError('not-found', 'Asset not found.'));
      const [currency, streams, valuations, links, rates, currencies] = await Promise.all([
        store.currencies.get(asset.currencyCode),
        store.assets.listStreams(),
        store.assets.listValuations(),
        store.assets.listLinks(),
        store.exchangeRates.list(),
        store.currencies.list(),
      ]);
      if (!currency) return err(assetError('not-found', 'Currency not found.'));
      const belongs = <Row extends { assetId: string }>(rows: readonly Row[]) =>
        rows.filter(({ assetId }) => assetId === id);
      return ok(
        computeAssetReport({
          asset,
          currency,
          streams: belongs(streams),
          valuations: belongs(valuations),
          movements: await linkedMovements(belongs(links), from, to),
          period: { startOn: from, endOn: to },
          rates,
          currencies,
        }),
      );
    },

    async portfolio(): Promise<Result<Portfolio, AssetError>> {
      const base = await baseCurrency();
      if (!base.ok) return base;
      const today = todayOf(clock);
      const month = periodContaining({ kind: 'monthly', startDay: null }, today);
      const [assets, valuations, links, rates, currencies] = await Promise.all([
        store.assets.listAssets(),
        store.assets.listValuations(),
        store.assets.listLinks(),
        store.exchangeRates.list(),
        store.currencies.list(),
      ]);
      const movements = await linkedMovements(links, month.startOn, month.endOn);
      return ok(
        computePortfolio({
          assets,
          valuations,
          movements,
          month,
          base: base.value,
          today,
          rates,
          currencies,
        }),
      );
    },

    /** Accounts stay the default net worth, so this is a separate number the user opts into. */
    async netWorthWithAssets(): Promise<Result<NetWorth, AssetError>> {
      const base = await baseCurrency();
      if (!base.ok) return base;
      const [accounts, balances, assets, valuations, rates, currencies] = await Promise.all([
        store.accounts.listUser(),
        store.journal.balances(),
        store.assets.listAssets(),
        store.assets.listValuations(),
        store.exchangeRates.list(),
        store.currencies.list(),
      ]);
      const cash = accounts
        .filter(({ archived }) => !archived)
        .map(({ id, currencyCode }) => ({ minor: balances[id] ?? 0n, currency: currencyCode }));
      return ok(
        computeNetWorth({
          base: base.value,
          currencies,
          rates,
          asOf: todayOf(clock),
          balances: [...cash, ...assetValues(portfolioRows(assets, valuations))],
        }),
      );
    },
  };
}
