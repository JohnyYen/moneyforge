import type { Transaction } from '@/features/ledger/domain/journal';
import { parseDecimal } from '@/features/ledger/domain/money';
import { err, ok, type Result } from '@/shared/result';

import {
  clearForRejection,
  inboxSections,
  isResolved,
  needsAttention,
  pairingKind,
  pickPair,
  type InboxItem,
  type InboxSections,
} from '../domain/inbox-item';
import { daysToMs, hoursToMs } from '../domain/message-settings';
import { isTransferKind, RULE_KINDS, type RuleKind } from '../domain/rule';
import { ruleError, type RuleError } from '../domain/rule-error';
import {
  joinPosted,
  loadMessageSettings,
  placeItem,
  postItem,
  releasePartner,
  type FlowContext,
} from './inbox-flow';
import type { RuleDeps, RuleRepositories } from './ports';

/** What the user may change before approving. The amount is a plain decimal. */
export type ItemDraft = {
  readonly kind: RuleKind;
  readonly accountId: string;
  readonly counterpartAccountId: string | null;
  readonly categoryId: string | null;
  readonly amount: string;
  readonly description: string;
};

export type ApproveOptions = {
  /** The amount on the other side, for one side of a conversion posted alone. */
  readonly counterAmount?: string;
  /** The answer to `confirmation-required`: is the opposite side found the same movement? */
  readonly otherSide?: 'same' | 'different';
};

export type ItemDetails = {
  readonly item: InboxItem;
  readonly partner: InboxItem | null;
};

type ItemResult<T> = Result<T, RuleError>;

const notFound = () => err(ruleError('not-found', 'Item not found.'));
const alreadyResolved = () =>
  err(ruleError('item-resolved', 'This item was already posted or rejected.'));

async function applyDraft(
  { accounts, currencies }: RuleRepositories,
  item: InboxItem,
  draft: ItemDraft,
): Promise<ItemResult<InboxItem>> {
  if (!RULE_KINDS.includes(draft.kind)) {
    return err(ruleError('item-incomplete', 'Choose what this message means.'));
  }
  const transfer = isTransferKind(draft.kind);
  if (transfer && !draft.counterpartAccountId) {
    return err(ruleError('item-incomplete', 'Choose the other account.'));
  }
  if (transfer && draft.counterpartAccountId === draft.accountId) {
    return err(ruleError('same-account', 'Choose two different accounts.'));
  }
  const account = await accounts.get(draft.accountId);
  if (!account || account.systemRole !== null) {
    return err(ruleError('not-found', 'Account not found.'));
  }
  const currency = await currencies.get(account.currencyCode);
  if (!currency) return err(ruleError('not-found', `Unknown currency ${account.currencyCode}.`));
  const amount = parseDecimal(draft.amount, currency.decimals);
  if (!amount.ok) return amount;
  if (amount.value <= 0n) {
    return err(ruleError('non-positive-amount', 'The amount must be greater than zero.'));
  }
  const keepsSplit = draft.kind === 'income';
  return ok({
    ...item,
    note: null,
    kind: draft.kind,
    accountId: account.id,
    counterpartAccountId: transfer ? draft.counterpartAccountId : null,
    categoryId: transfer ? null : draft.categoryId,
    amountMinor: amount.value,
    currencyCode: currency.code,
    description: draft.description.trim(),
    // The user has taken over this item, so it no longer posts by itself.
    autoPost: false,
    pairItemId: null,
    splitMode: keepsSplit ? item.splitMode : 'none',
    splitStructureId: keepsSplit ? item.splitStructureId : null,
  });
}

/**
 * An opposite side at any distance. The pairing window decides what links by itself, but
 * posting a side alone is the last chance to notice that its other side already arrived.
 */
async function findFarSide(
  { rules }: RuleRepositories,
  item: InboxItem,
): Promise<InboxItem | null> {
  const kind = pairingKind(item.kind);
  if (!kind) return null;
  return pickPair(item, await rules.listUnpairedSides(kind), Number.POSITIVE_INFINITY);
}

const askAboutFarSide = (other: InboxItem) =>
  err(
    ruleError(
      'confirmation-required',
      `A message from ${other.receivedAt.slice(0, 10)} looks like the other side of this transfer.`,
    ),
  );

async function joinFarSide(
  context: FlowContext,
  item: InboxItem,
  other: InboxItem,
  counterAmount: string | undefined,
): Promise<ItemResult<Transaction>> {
  const { repositories } = context;
  if (other.status === 'posted') {
    const { transactionId } = other;
    const transaction = transactionId ? await repositories.journal.get(transactionId) : null;
    if (!transaction) return err(ruleError('not-found', 'Transaction not found.'));
    await joinPosted(repositories, item, other);
    return ok(transaction);
  }
  const posted = await postItem(
    context,
    { ...item, pairItemId: other.id },
    { ...other, pairItemId: item.id },
    counterAmount,
  );
  return posted.ok ? ok(posted.value.transaction) : posted;
}

export function createInboxUseCases({ store, clock, generateId }: RuleDeps) {
  const contextOf = (repositories: RuleRepositories): FlowContext => ({
    repositories,
    clock,
    generateId,
  });

  const openItem = async (
    repositories: RuleRepositories,
    id: string,
  ): Promise<ItemResult<InboxItem>> => {
    const item = await repositories.rules.getItem(id);
    if (!item) return notFound();
    return isResolved(item) ? alreadyResolved() : ok(item);
  };

  const listInbox = async (): Promise<InboxSections> => {
    const { transferWindowHours } = await loadMessageSettings(store.settings);
    const items = await store.rules.listOpenItems();
    return inboxSections(items, clock.now(), hoursToMs(transferWindowHours));
  };

  return {
    listInbox,
    countInbox: async () => needsAttention(await listInbox()),

    getItem: async (id: string): Promise<ItemDetails | null> => {
      const item = await store.rules.getItem(id);
      if (!item) return null;
      const partner = item.pairItemId ? await store.rules.getItem(item.pairItemId) : null;
      return { item, partner };
    },

    /** A change can undo a pairing or make a new one, so the item is placed again. */
    editItem: (id: string, draft: ItemDraft): Promise<ItemResult<InboxItem>> =>
      store.atomic(async (repositories) => {
        const item = await openItem(repositories, id);
        if (!item.ok) return item;
        const edited = await applyDraft(repositories, item.value, draft);
        if (!edited.ok) return edited;
        await releasePartner(repositories, item.value);
        const settings = await loadMessageSettings(repositories.settings);
        return ok(await placeItem(contextOf(repositories), edited.value, settings));
      }),

    /**
     * Approves the whole movement when the item is one side of a pair. A lone side with an
     * opposite side anywhere answers `confirmation-required` until `otherSide` says which.
     */
    approveItem: (
      id: string,
      { counterAmount, otherSide }: ApproveOptions = {},
    ): Promise<ItemResult<Transaction>> =>
      store.atomic(async (repositories) => {
        const item = await openItem(repositories, id);
        if (!item.ok) return item;
        const { pairItemId } = item.value;
        const partner = pairItemId ? await repositories.rules.getItem(pairItemId) : null;
        const context = contextOf(repositories);
        const farSide = partner ? null : await findFarSide(repositories, item.value);
        if (farSide && !otherSide) return askAboutFarSide(farSide);
        if (farSide && otherSide === 'same') {
          return joinFarSide(context, item.value, farSide, counterAmount);
        }
        const posted = await postItem(context, item.value, partner, counterAmount);
        return posted.ok ? ok(posted.value.transaction) : posted;
      }),

    rejectItem: (id: string): Promise<ItemResult<void>> =>
      store.atomic(async (repositories) => {
        const item = await openItem(repositories, id);
        if (!item.ok) return item;
        await releasePartner(repositories, item.value);
        await repositories.rules.saveItem(clearForRejection(item.value));
        return ok(undefined);
      }),

    dismissSplit: (id: string): Promise<ItemResult<void>> =>
      store.atomic(async ({ rules }) => {
        const item = await rules.getItem(id);
        if (!item) return notFound();
        await rules.saveItem({ ...item, splitRequested: false, note: null });
        return ok(undefined);
      }),

    /** Deterministic in `now`. Only messages with no money on them go; see the repository. */
    purgeExpired: (now: Date): Promise<number> =>
      store.atomic(async ({ rules, settings }) => {
        const { retentionDays } = await loadMessageSettings(settings);
        const cutoff = new Date(now.getTime() - daysToMs(retentionDays));
        return rules.purgeUnresolvedBefore(cutoff.toISOString());
      }),
  };
}
