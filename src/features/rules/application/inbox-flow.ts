import type { Clock, IdGenerator, SettingsRepository } from '@/features/ledger/application/ports';
import {
  buildEntry,
  type TransactionEntry,
} from '@/features/ledger/application/transaction-use-cases';
import type { Transaction } from '@/features/ledger/domain/journal';
import { formatDecimal, parseDecimal } from '@/features/ledger/domain/money';
import { deriveRate } from '@/features/ledger/domain/rate';
import { applySplit } from '@/features/split/application/split-service';
import { err, ok, type Result } from '@/shared/result';

import { pairingKind, pickPair, type InboxItem } from '../domain/inbox-item';
import {
  DEDUP_SECRET_KEY,
  DEFAULT_MESSAGE_SETTINGS,
  hoursToMs,
  readSetting,
  SETTING_KEYS,
  type MessageSettings,
} from '../domain/message-settings';
import { isTransferKind, type ExtractedFields, type Rule, type RuleLookups } from '../domain/rule';
import { ruleError, type RuleError } from '../domain/rule-error';
import type { RuleDeps, RuleRepositories } from './ports';

/** What a running write needs. Everything here awaits only that write's own statements. */
export type FlowContext = {
  readonly repositories: RuleRepositories;
  readonly clock: Clock;
  readonly generateId: IdGenerator;
};

export type PostedItem = { readonly transaction: Transaction; readonly item: InboxItem };

export async function loadMessageSettings(settings: SettingsRepository): Promise<MessageSettings> {
  const read = async (key: keyof MessageSettings) =>
    readSetting(await settings.get(SETTING_KEYS[key]), DEFAULT_MESSAGE_SETTINGS[key]);
  return {
    retentionDays: await read('retentionDays'),
    dedupWindowMinutes: await read('dedupWindowMinutes'),
    transferWindowHours: await read('transferWindowHours'),
  };
}

/**
 * The install's secret, created on first need. Run this before opening a write: generating
 * it awaits something other than the database. A write decides who wins a first-use race.
 */
export async function loadDedupSecret({
  store,
  generateSecret,
}: Pick<RuleDeps, 'store' | 'generateSecret'>): Promise<string> {
  const stored = await store.settings.get(DEDUP_SECRET_KEY);
  if (stored) return stored;
  const fresh = await generateSecret();
  return store.atomic(async ({ settings }) => {
    const raced = await settings.get(DEDUP_SECRET_KEY);
    if (raced) return raced;
    await settings.set(DEDUP_SECRET_KEY, fresh);
    return fresh;
  });
}

export async function loadLookups({
  accounts,
  currencies,
}: RuleRepositories): Promise<RuleLookups> {
  return { accounts: await accounts.listUser(), currencies: await currencies.list() };
}

export const withProposal = (
  item: InboxItem,
  rule: Rule,
  fields: ExtractedFields,
  referenceKey: string | null,
): InboxItem => ({
  ...item,
  ruleId: rule.id,
  note: null,
  referenceKey,
  kind: rule.kind,
  accountId: rule.accountId,
  categoryId: rule.categoryId,
  counterpartAccountId: rule.counterpartAccountId,
  amountMinor: fields.amountMinor,
  currencyCode: fields.currencyCode,
  reference: fields.reference,
  counterparty: fields.counterparty,
  balance: fields.balance,
  description: fields.counterparty ?? rule.name,
  autoPost: rule.autoPost,
  splitMode: rule.splitMode,
  splitStructureId: rule.splitStructureId,
});

const incomplete = (message: string) => err(ruleError('item-incomplete', message));

type Side = { readonly minor: bigint; readonly code: string };

const sideOf = (item: InboxItem): Side | null =>
  item.amountMinor === null || !item.currencyCode
    ? null
    : { minor: item.amountMinor, code: item.currencyCode };

type Movement = {
  readonly fromAccountId: string | null;
  readonly toAccountId: string | null;
  readonly sent: Side | null;
  readonly received: Side | null;
  /** The message that names the movement: the outgoing side when there is one. */
  readonly lead: InboxItem;
};

function movementOf(item: InboxItem, partner: InboxItem | null): Movement {
  if (partner) {
    const [outgoing, incoming] = item.kind === 'transfer_out' ? [item, partner] : [partner, item];
    return {
      fromAccountId: outgoing.accountId,
      toAccountId: incoming.accountId,
      sent: sideOf(outgoing),
      received: sideOf(incoming),
      lead: outgoing,
    };
  }
  const outgoing = item.kind === 'transfer_out';
  return {
    fromAccountId: outgoing ? item.accountId : item.counterpartAccountId,
    toAccountId: outgoing ? item.counterpartAccountId : item.accountId,
    sent: outgoing ? sideOf(item) : null,
    received: outgoing ? null : sideOf(item),
    lead: item,
  };
}

/** A pair, or one side posted alone, always becomes a single movement. */
async function movementEntry(
  { accounts, currencies }: RuleRepositories,
  movement: Movement,
  counterAmount: string | undefined,
): Promise<Result<TransactionEntry, RuleError>> {
  const { fromAccountId, toAccountId, lead } = movement;
  const from = fromAccountId ? await accounts.get(fromAccountId) : null;
  const to = toAccountId ? await accounts.get(toAccountId) : null;
  if (!from || !to) return err(ruleError('not-found', 'Account not found.'));
  const source = await currencies.get(from.currencyCode);
  const target = await currencies.get(to.currencyCode);
  if (!source || !target) return err(ruleError('not-found', 'Currency not found.'));
  const accountsAndText = {
    fromAccountId: from.id,
    toAccountId: to.id,
    description: lead.description,
    occurredAt: lead.receivedAt,
  };

  if (source.code === target.code) {
    const side = movement.sent ?? movement.received;
    if (!side) return incomplete('Enter the amount.');
    const amount = formatDecimal(side.minor, source.decimals);
    return ok({ ...accountsAndText, kind: 'transfer', amount });
  }

  let { sent, received } = movement;
  if (!sent || !received) {
    const missing = sent ? target : source;
    if (!counterAmount?.trim()) return incomplete(`Enter the amount in ${missing.code}.`);
    const parsed = parseDecimal(counterAmount, missing.decimals);
    if (!parsed.ok) return parsed;
    const side = { minor: parsed.value, code: missing.code };
    sent ??= side;
    received ??= side;
  }
  return ok({
    ...accountsAndText,
    kind: 'conversion',
    sourceAmount: formatDecimal(sent.minor, source.decimals),
    targetAmount: formatDecimal(received.minor, target.decimals),
    rate: deriveRate(sent.minor, received.minor, source.decimals, target.decimals),
  });
}

async function itemEntry(
  repositories: RuleRepositories,
  item: InboxItem,
  partner: InboxItem | null,
  counterAmount: string | undefined,
): Promise<Result<TransactionEntry, RuleError>> {
  const { kind, accountId, amountMinor, currencyCode } = item;
  if (!kind || !accountId || amountMinor === null || !currencyCode) {
    return incomplete('Choose an account, a type, and an amount first.');
  }
  if (isTransferKind(kind)) {
    return movementEntry(repositories, movementOf(item, partner), counterAmount);
  }
  const currency = await repositories.currencies.get(currencyCode);
  if (!currency) return err(ruleError('not-found', `Unknown currency ${currencyCode}.`));
  return ok({
    kind,
    accountId,
    categoryId: item.categoryId,
    amount: formatDecimal(amountMinor, currency.decimals),
    description: item.description,
    occurredAt: item.receivedAt,
  });
}

/**
 * Splits inside the write that posts, so an income is never left half handled. A refusal
 * writes nothing, so it downgrades to asking the user and the income stays recorded.
 */
async function applySplitMode(
  { repositories, clock, generateId }: FlowContext,
  item: InboxItem,
  transaction: Transaction,
): Promise<Pick<InboxItem, 'splitRequested' | 'note'>> {
  const { splitMode, splitStructureId: structureId } = item;
  if (splitMode === 'ask') return { splitRequested: true, note: null };
  if (splitMode !== 'auto' || !structureId) return { splitRequested: false, note: null };
  const applied = await applySplit(
    repositories,
    { clock, generateId },
    { transactionId: transaction.id, structureId },
  );
  if (applied.ok) return { splitRequested: false, note: null };
  return { splitRequested: true, note: `Could not split automatically: ${applied.error.message}` };
}

/** Posts through the ledger's own validation. A refusal happens before anything is written. */
export async function postItem(
  context: FlowContext,
  item: InboxItem,
  partner: InboxItem | null,
  counterAmount?: string,
): Promise<Result<PostedItem, RuleError>> {
  const { repositories, clock, generateId } = context;
  const entry = await itemEntry(repositories, item, partner, counterAmount);
  if (!entry.ok) return entry;
  const transaction = await buildEntry(repositories, entry.value, {
    id: generateId(),
    occurredAt: clock.now().toISOString(),
    existing: null,
  });
  if (!transaction.ok) return transaction;
  await repositories.journal.save(transaction.value);

  const posted = {
    status: 'posted',
    body: null,
    note: null,
    transactionId: transaction.value.id,
  } as const;
  const split = await applySplitMode(context, item, transaction.value);
  const updated: InboxItem = { ...item, ...posted, ...split };
  await repositories.rules.saveItem(updated);
  if (partner) await repositories.rules.saveItem({ ...partner, ...posted });
  return ok({ transaction: transaction.value, item: updated });
}

/** Links a side to the movement its other side already posted, which adds no money. */
export async function joinPosted(
  { rules }: RuleRepositories,
  item: InboxItem,
  other: InboxItem,
): Promise<InboxItem> {
  const joined: InboxItem = {
    ...item,
    status: 'posted',
    body: null,
    note: null,
    pairItemId: other.id,
    transactionId: other.transactionId,
  };
  await rules.saveItem(joined);
  await rules.saveItem({ ...other, pairItemId: item.id });
  return joined;
}

/** What to tell the user when a message disagrees with the movement it would join. */
async function joinMismatch(
  { journal, currencies }: RuleRepositories,
  item: InboxItem,
  other: InboxItem,
): Promise<string | null> {
  const transaction = other.transactionId ? await journal.get(other.transactionId) : null;
  const posting = transaction?.postings.find(({ accountId }) => accountId === item.accountId);
  if (!posting || item.amountMinor === null) return null;
  const recorded = posting.amount < 0n ? -posting.amount : posting.amount;
  if (recorded === item.amountMinor) return null;
  const decimals = (await currencies.get(posting.currency))?.decimals ?? 0;
  const [said, kept] = [item.amountMinor, recorded].map((minor) => formatDecimal(minor, decimals));
  return `This message says ${said} ${posting.currency}, but the posted movement records ${kept} ${posting.currency}.`;
}

/** Null when the rate cannot be worked out, which still sends the pair to review. */
async function impliedRateNote(
  { currencies }: RuleRepositories,
  item: InboxItem,
  other: InboxItem,
): Promise<string | null> {
  const { sent, received } = movementOf(item, other);
  if (!sent || !received) return null;
  const source = await currencies.get(sent.code);
  const target = await currencies.get(received.code);
  if (!source || !target) return null;
  const rate = deriveRate(sent.minor, received.minor, source.decimals, target.decimals);
  const shown = rate.includes('.') ? rate.replace(/\.?0+$/, '') : rate;
  return `Implied rate: 1 ${source.code} = ${shown} ${target.code}. Check it before approving.`;
}

/**
 * Looks for the other side of a transfer. A side the user already posted alone counts, so a
 * message arriving late joins that transfer instead of creating another, unless they disagree.
 * A rate nobody typed is unproven, so a pair across currencies always waits for a person.
 */
async function tryPair(
  context: FlowContext,
  item: InboxItem,
  { transferWindowHours }: MessageSettings,
): Promise<InboxItem> {
  const { repositories } = context;
  const { rules } = repositories;
  const kind = pairingKind(item.kind);
  if (!kind) return item;
  const windowMs = hoursToMs(transferWindowHours);
  const arrival = Date.parse(item.receivedAt);
  const candidates = await rules.listPairCandidates(
    kind,
    new Date(arrival - windowMs).toISOString(),
    new Date(arrival + windowMs).toISOString(),
  );
  const other = pickPair(item, candidates, windowMs);
  if (!other) return item;

  if (other.status === 'posted') {
    const mismatch = await joinMismatch(repositories, item, other);
    if (!mismatch) return joinPosted(repositories, item, other);
    const held: InboxItem = { ...item, status: 'proposed', autoPost: false, note: mismatch };
    await rules.saveItem(held);
    return held;
  }

  const crossCurrency = item.currencyCode !== other.currencyCode;
  const rateNote = crossCurrency ? await impliedRateNote(repositories, item, other) : null;
  const first: InboxItem = {
    ...item,
    status: 'proposed',
    pairItemId: other.id,
    note: rateNote ?? item.note,
  };
  const second: InboxItem = {
    ...other,
    status: 'proposed',
    pairItemId: item.id,
    note: rateNote ?? other.note,
  };
  await rules.saveItem(first);
  await rules.saveItem(second);
  if (crossCurrency || !first.autoPost || !second.autoPost) return first;
  const posted = await postItem(context, first, second);
  if (posted.ok) return posted.value.item;
  const noted = { ...first, note: posted.error.message };
  await rules.saveItem(noted);
  await rules.saveItem({ ...second, note: posted.error.message });
  return noted;
}

/** Stores a complete proposal and takes it as far as its rule allows. */
export async function placeItem(
  context: FlowContext,
  item: InboxItem,
  settings: MessageSettings,
): Promise<InboxItem> {
  const { rules } = context.repositories;
  if (item.kind && isTransferKind(item.kind)) {
    const waiting: InboxItem = { ...item, status: 'waiting_pair' };
    await rules.saveItem(waiting);
    return tryPair(context, waiting, settings);
  }
  const proposed: InboxItem = { ...item, status: 'proposed' };
  await rules.saveItem(proposed);
  if (!proposed.autoPost) return proposed;
  const posted = await postItem(context, proposed, null);
  if (posted.ok) return posted.value.item;
  const noted = { ...proposed, note: posted.error.message };
  await rules.saveItem(noted);
  return noted;
}

/** Sends the other side of a pair back to waiting. */
export async function releasePartner(
  { rules }: RuleRepositories,
  item: InboxItem,
): Promise<void> {
  if (!item.pairItemId) return;
  const partner = await rules.getItem(item.pairItemId);
  if (partner) await rules.saveItem({ ...partner, status: 'waiting_pair', pairItemId: null });
}
