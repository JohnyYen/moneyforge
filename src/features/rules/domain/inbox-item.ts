import type { MessageChannel } from './message';
import type { RuleKind, SplitMode } from './rule';

export const ITEM_STATUSES = [
  'unmatched',
  'proposed',
  'waiting_pair',
  'posted',
  'rejected',
] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export type InboxItem = {
  readonly id: string;
  readonly sourceId: string;
  readonly ruleId: string | null;
  readonly status: ItemStatus;
  readonly channel: MessageChannel;
  readonly receivedAt: string;
  /**
   * Null once resolved, once expired, and for a message over the length limit. The hash and
   * the reference key stay, so a replay is recognized.
   */
  readonly body: string | null;
  readonly bodyHash: string;
  readonly referenceKey: string | null;
  /** Why the item needs attention, shown as it is. */
  readonly note: string | null;
  readonly kind: RuleKind | null;
  readonly accountId: string | null;
  readonly categoryId: string | null;
  readonly counterpartAccountId: string | null;
  readonly amountMinor: bigint | null;
  readonly currencyCode: string | null;
  readonly reference: string | null;
  readonly counterparty: string | null;
  readonly balance: string | null;
  readonly description: string;
  readonly autoPost: boolean;
  readonly splitMode: SplitMode;
  readonly splitStructureId: string | null;
  /** A posted income waiting for the user to split it. */
  readonly splitRequested: boolean;
  readonly pairItemId: string | null;
  readonly transactionId: string | null;
};

export const isResolved = ({ status }: Pick<InboxItem, 'status'>) =>
  status === 'posted' || status === 'rejected';

const gapMs = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b));

/**
 * Why a message with text already seen needs a person, or null if the text is new. Nothing
 * without a reference can tell a copy from a second purchase, so this never decides alone.
 * The body already holds the amount, so an edited amount on the stored item changes nothing.
 */
export function repeatNote(
  receivedAt: string,
  sameBody: readonly Pick<InboxItem, 'receivedAt'>[],
  windowMs: number,
): string | null {
  if (sameBody.length === 0) return null;
  const close = sameBody.some((item) => gapMs(receivedAt, item.receivedAt) <= windowMs);
  const when = close ? `within ${Math.round(windowMs / 60_000)} minutes` : 'earlier';
  return `Possible repeat: the same text arrived ${when}. Approve it only if this is a second movement.`;
}

/** Keeps what recognizes a replay and nothing the message said. */
export const clearForRejection = (item: InboxItem): InboxItem => ({
  ...item,
  ruleId: null,
  status: 'rejected',
  body: null,
  note: null,
  kind: null,
  accountId: null,
  categoryId: null,
  counterpartAccountId: null,
  amountMinor: null,
  currencyCode: null,
  reference: null,
  counterparty: null,
  balance: null,
  description: '',
  autoPost: false,
  splitMode: 'none',
  splitStructureId: null,
  splitRequested: false,
  pairItemId: null,
  transactionId: null,
});

export const pairingKind = (kind: RuleKind | null): RuleKind | null =>
  kind === 'transfer_out' ? 'transfer_in' : kind === 'transfer_in' ? 'transfer_out' : null;

function isOtherSide(item: InboxItem, other: InboxItem, windowMs: number): boolean {
  if (item.id === other.id || other.kind !== pairingKind(item.kind)) return false;
  if (item.accountId !== other.counterpartAccountId) return false;
  if (item.counterpartAccountId !== other.accountId) return false;
  if (gapMs(item.receivedAt, other.receivedAt) > windowMs) return false;
  return item.currencyCode !== other.currencyCode || item.amountMinor === other.amountMinor;
}

const byArrival = (a: InboxItem, b: InboxItem) =>
  Date.parse(a.receivedAt) - Date.parse(b.receivedAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The oldest candidate wins, so a burst of equal transfers pairs off in arrival order. */
export function pickPair(
  item: InboxItem,
  candidates: readonly InboxItem[],
  windowMs: number,
): InboxItem | null {
  return (
    candidates.filter((other) => isOtherSide(item, other, windowMs)).sort(byArrival)[0] ?? null
  );
}

export type InboxSections = {
  readonly review: readonly InboxItem[];
  readonly waiting: readonly InboxItem[];
  readonly splits: readonly InboxItem[];
};

export const isOverdue = (item: InboxItem, now: Date, windowMs: number) =>
  item.status === 'waiting_pair' && now.getTime() - Date.parse(item.receivedAt) > windowMs;

export function inboxSections(
  items: readonly InboxItem[],
  now: Date,
  windowMs: number,
): InboxSections {
  const waiting = items.filter(
    (item) => item.status === 'waiting_pair' && !isOverdue(item, now, windowMs),
  );
  const review = items.filter(
    (item) =>
      item.status === 'unmatched' ||
      isOverdue(item, now, windowMs) ||
      // A pair is one movement, so its second message adds no second row.
      (item.status === 'proposed' && !(item.pairItemId && item.kind === 'transfer_in')),
  );
  return { review, waiting, splits: items.filter(({ splitRequested }) => splitRequested) };
}

export const needsAttention = ({ review, splits }: InboxSections) => review.length + splits.length;
