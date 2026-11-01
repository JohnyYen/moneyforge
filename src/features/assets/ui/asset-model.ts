import type { Currency } from '@/features/ledger/domain/currency';
import type { Transaction } from '@/features/ledger/domain/journal';
import { formatDecimal, formatDisplay } from '@/features/ledger/domain/money';
import { convertMinor, type ExactRate } from '@/features/ledger/domain/rate';
import { addDays, partsOf, type Day } from '@/features/planning/domain/calendar';
import { periodContaining } from '@/features/planning/domain/period';
import {
  emptyScheduleDraft,
  toSchedule,
  toScheduleDraft,
  type ScheduleDraft,
} from '@/features/planning/ui/plan-model';

import type { LinkInput } from '../application/link-use-cases';
import type { AssetInput, StreamInput } from '../application/asset-use-cases';
import type { Asset, AssetType, ExpectedStream, StreamKind, Valuation } from '../domain/asset';
import type { PortfolioRow } from '../domain/asset-report';

export type Currencies = ReadonlyMap<string, Currency>;

export const showMoney = (minor: bigint, code: string, currencies: Currencies) => {
  const currency = currencies.get(code);
  return currency ? formatDisplay(minor, currency) : `${minor} ${code}`;
};

const PERCENT_DECIMALS = 2;

/** The exact ratio stays in the domain. Only this label rounds it, and only to read it. */
export function percentLabel(ratio: ExactRate | null): string | null {
  if (!ratio) return null;
  return `${formatDecimal(convertMinor(100n, ratio, 0, PERCENT_DECIMALS), PERCENT_DECIMALS)}%`;
}

export const REPORT_RANGES = ['month', 'year', 'twelve-months'] as const;
export type ReportRange = (typeof REPORT_RANGES)[number];

export const REPORT_RANGE_LABELS: Record<ReportRange, string> = {
  month: 'This month',
  year: 'This year',
  'twelve-months': 'Last 12 months',
};

export function reportRange(range: ReportRange, today: Day): { from: Day; to: Day } {
  if (range === 'twelve-months') return { from: addDays(today, -364), to: today };
  const kind = range === 'month' ? 'monthly' : 'yearly';
  const period = periodContaining({ kind, startMonth: null, startDay: null }, today);
  return { from: period.startOn, to: period.endOn };
}

export function assetRow(
  { asset, latest }: PortfolioRow,
  types: readonly AssetType[],
  currencies: Currencies,
) {
  const type = types.find(({ id }) => id === asset.typeId)?.name ?? 'Asset';
  return {
    key: asset.id,
    title: asset.name,
    subtitle: asset.soldOn ? `${type}. Sold on ${asset.soldOn}` : type,
    trailing: latest ? showMoney(latest.amount, asset.currencyCode, currencies) : 'No value yet',
  };
}

export const valuationRow = ({ id, valuedOn, amount }: Valuation, asset: Asset, currencies: Currencies) => ({
  key: id,
  title: valuedOn,
  trailing: showMoney(amount, asset.currencyCode, currencies),
});

export type AssetDraft = {
  readonly name: string;
  readonly typeId: string;
  readonly currencyCode: string;
  readonly accountId: string;
  readonly notes: string;
};

export const emptyAssetDraft = (typeId: string, currencyCode: string): AssetDraft => ({
  name: '',
  typeId,
  currencyCode,
  accountId: '',
  notes: '',
});

export const toAssetDraft = (asset: Asset): AssetDraft => ({
  name: asset.name,
  typeId: asset.typeId,
  currencyCode: asset.currencyCode,
  accountId: asset.accountId ?? '',
  notes: asset.notes,
});

export const toAssetInput = (draft: AssetDraft): AssetInput => ({
  ...draft,
  accountId: draft.accountId || null,
});

export type StreamDraft = ScheduleDraft & {
  readonly name: string;
  readonly kind: StreamKind;
  readonly amount: string;
};

export const emptyStreamDraft = (today: Day): StreamDraft => ({
  name: '',
  kind: 'income',
  amount: '',
  ...emptyScheduleDraft(today),
});

export const toStreamDraft = (stream: ExpectedStream, currency: Currency): StreamDraft => ({
  name: stream.name,
  kind: stream.kind,
  amount: formatDecimal(stream.amount, currency.decimals),
  ...toScheduleDraft(stream.schedule),
});

export const toStreamInput = (draft: StreamDraft): StreamInput => ({
  name: draft.name,
  kind: draft.kind,
  amount: draft.amount,
  schedule: toSchedule(draft),
});

export type AssetSelection = {
  readonly assetId: string | null;
  readonly stream: ExpectedStream | null;
};

export const NO_SELECTION: AssetSelection = { assetId: null, stream: null };

/**
 * What to link once a transaction exists. The form cannot know its kind in advance, so a transfer
 * links nothing, and a stream of the other kind falls back to the asset alone.
 */
export function linkInputFor(
  { id, kind }: Pick<Transaction, 'id' | 'kind'>,
  { assetId, stream }: AssetSelection,
): LinkInput | null {
  if (!assetId || (kind !== 'income' && kind !== 'expense')) return null;
  return { transactionId: id, assetId, streamId: stream?.kind === kind ? stream.id : null };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function rangeLabel(from: Day, to: Day): string {
  const label = (day: Day) => {
    const { year, month, date } = partsOf(day);
    return `${MONTHS[month - 1]} ${date}, ${year}`;
  };
  return `${label(from)} to ${label(to)}`;
}
