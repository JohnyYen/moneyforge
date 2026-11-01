import type { Account } from '@/features/ledger/domain/account';
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
import type { RecurringItem } from '@/features/planning/domain/recurring';
import type { Result } from '@/shared/result';

import type { LinkInput } from '../application/link-use-cases';
import type { AssetInput, StreamInput } from '../application/asset-use-cases';
import type { Asset, AssetType, ExpectedStream, StreamKind, Valuation } from '../domain/asset';
import { overlapsRecurring } from '../domain/asset-flows';
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
  /** Empty means none. */
  readonly categoryId: string;
};

export const emptyStreamDraft = (today: Day): StreamDraft => ({
  name: '',
  kind: 'income',
  amount: '',
  categoryId: '',
  ...emptyScheduleDraft(today),
});

export const toStreamDraft = (stream: ExpectedStream, currency: Currency): StreamDraft => ({
  name: stream.name,
  kind: stream.kind,
  amount: formatDecimal(stream.amount, currency.decimals),
  categoryId: stream.categoryId ?? '',
  ...toScheduleDraft(stream.schedule),
});

export const toStreamInput = (draft: StreamDraft): StreamInput => ({
  name: draft.name,
  kind: draft.kind,
  amount: draft.amount,
  categoryId: draft.categoryId || null,
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

/** Why what the user chose did not fully apply, once the entry's kind is known. */
export function droppedSelectionNotice(
  { kind }: Pick<Transaction, 'kind'>,
  { assetId, stream }: AssetSelection,
): string | null {
  if (!assetId) return null;
  if (kind !== 'income' && kind !== 'expense') {
    return 'Saved, not linked. Only income and expenses link to an asset.';
  }
  if (stream && stream.kind !== kind) {
    return `This links to the asset alone: ${stream.name} is ${stream.kind}, this entry is ${kind}.`;
  }
  return null;
}

/** The entry is already saved, so a failure here is a notice, never an error on the form. */
export async function linkAfterSave(
  transaction: Pick<Transaction, 'id' | 'kind'>,
  selection: AssetSelection,
  link: (input: LinkInput) => Promise<Result<unknown, { readonly message: string }>>,
): Promise<string | null> {
  const input = linkInputFor(transaction, selection);
  if (input) {
    try {
      const linked = await link(input);
      if (!linked.ok) return `Saved, not linked. ${linked.error.message}`;
    } catch {
      return 'Saved, not linked. Link it from the transaction.';
    }
  }
  return droppedSelectionNotice(transaction, selection);
}

export type ProjectionNotice = { readonly assetId: string; readonly message: string };

function unprojectedReason(asset: Asset, accounts: readonly Account[], names: string) {
  const linked = accounts.find(({ id }) => id === asset.accountId);
  if (linked?.archived) return `${linked.name} is archived, so the projection leaves out ${names}.`;
  if (asset.accountId) return null;
  const { currencyCode } = asset;
  return accounts.some((account) => !account.archived && account.currencyCode === currencyCode)
    ? `link an account to see ${names} in the projection.`
    : `no account in ${currencyCode}, so the projection leaves out ${names}.`;
}

/** What a person should know about how an active asset's streams reach the projection. */
export function projectionNotices(input: {
  readonly assets: readonly Asset[];
  readonly streams: readonly ExpectedStream[];
  readonly accounts: readonly Account[];
  readonly items: readonly RecurringItem[];
  readonly today: Day;
}): ProjectionNotice[] {
  const { assets, streams, accounts, items, today } = input;
  return assets.flatMap((asset) => {
    const running = streams.filter(
      ({ assetId, schedule }) =>
        assetId === asset.id && (schedule.endOn === null || schedule.endOn >= today),
    );
    if (asset.status !== 'active' || running.length === 0) return [];
    const reason = unprojectedReason(asset, accounts, running.map(({ name }) => name).join(', '));
    if (reason) return [{ assetId: asset.id, message: `${asset.name}: ${reason}` }];
    const { accountId } = asset;
    return running.flatMap((stream) =>
      items
        .filter((item) => accountId && overlapsRecurring(stream, accountId, item))
        .map(({ name }) => ({
          assetId: asset.id,
          message: `${asset.name}: ${stream.name} looks like the recurring item ${name} on the same account. Both count in the projection.`,
        })),
    );
  });
}

/** Messages to show, once each, because a message also keys its row. */
export function shownNotices(notices: readonly ProjectionNotice[], assetId?: string): string[] {
  const shown = notices.filter((notice) => !assetId || notice.assetId === assetId);
  return [...new Set(shown.map(({ message }) => message))];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function rangeLabel(from: Day, to: Day): string {
  const label = (day: Day) => {
    const { year, month, date } = partsOf(day);
    return `${MONTHS[month - 1]} ${date}, ${year}`;
  };
  return `${label(from)} to ${label(to)}`;
}
