import { isDuplicate, type InboxItem } from '../domain/inbox-item';
import {
  acceptsChannel,
  hashBody,
  looksLikeOneTimeCode,
  MAX_MESSAGE_LENGTH,
  normalizeBody,
  normalizeReference,
  normalizeSender,
  type MessageChannel,
} from '../domain/message';
import { hoursToMs } from '../domain/message-settings';
import { selectRule, type RuleEvaluation, type RuleSelection } from '../domain/rule';
import {
  loadLookups,
  loadMessageSettings,
  placeItem,
  withProposal,
  type FlowContext,
} from './inbox-flow';
import type { RuleDeps } from './ports';

export type IncomingMessage = {
  readonly channel: MessageChannel;
  readonly sender: string;
  readonly body: string;
  /** Any date text `Date.parse` reads. An unreadable one counts as now. */
  readonly receivedAt: string;
};

export type IngestResult =
  /** The sender is not on the allowlist. */
  | { readonly outcome: 'dropped' }
  | { readonly outcome: 'one-time-code' }
  | { readonly outcome: 'duplicate' }
  | {
      readonly outcome: 'inbox';
      readonly itemId: string;
      readonly status: InboxItem['status'];
    }
  | { readonly outcome: 'posted'; readonly itemId: string; readonly transactionId: string };

type Matched = RuleSelection & {
  readonly evaluation: Extract<RuleEvaluation, { status: 'matched' }>;
};

const isMatched = (selection: RuleSelection | null): selection is Matched =>
  selection?.evaluation.status === 'matched';

function unmatchedNote(selection: RuleSelection | null, tooLong: boolean): string | null {
  if (tooLong) return `This message is over ${MAX_MESSAGE_LENGTH} characters, so no rule ran.`;
  if (!selection || selection.evaluation.status === 'matched') return null;
  return `${selection.rule.name}: ${selection.evaluation.reason}`;
}

function arrivalTime(receivedAt: string, now: Date): string {
  const time = Date.parse(receivedAt);
  return new Date(Number.isNaN(time) ? now.getTime() : time).toISOString();
}

export function createIngestMessage({ store, clock, generateId }: RuleDeps) {
  /**
   * The one way a message enters the app. Nothing below the allowlist check runs for an
   * unknown sender, and nothing is written before the checks that may discard the message.
   * All of it is one write, so two copies arriving together cannot both pass dedup.
   */
  return (message: IncomingMessage): Promise<IngestResult> =>
    store.atomic(async (repositories): Promise<IngestResult> => {
      const { rules, settings } = repositories;
      const source = await rules.findSourceBySender(normalizeSender(message.sender));
      if (!source?.enabled || !acceptsChannel(source, message.channel)) {
        return { outcome: 'dropped' };
      }

      const tooLong = message.body.length > MAX_MESSAGE_LENGTH;
      const text = normalizeBody(message.body.slice(0, MAX_MESSAGE_LENGTH));
      const selection = tooLong
        ? null
        : selectRule(await rules.listRules(source.id), text, await loadLookups(repositories));
      const matched = isMatched(selection) ? selection : null;
      if (!matched && looksLikeOneTimeCode(text)) return { outcome: 'one-time-code' };

      const referenceKey = normalizeReference(matched?.evaluation.fields.reference ?? null);
      if (referenceKey && (await rules.findItemByReference(source.id, referenceKey))) {
        return { outcome: 'duplicate' };
      }
      const receivedAt = arrivalTime(message.receivedAt, clock.now());
      const bodyHash = hashBody(text);
      const messageSettings = await loadMessageSettings(settings);
      const sameBody = await rules.listItemsByBodyHash(source.id, bodyHash);
      if (isDuplicate(receivedAt, sameBody, hoursToMs(messageSettings.dedupWindowHours))) {
        return { outcome: 'duplicate' };
      }

      const item: InboxItem = {
        id: generateId(),
        sourceId: source.id,
        ruleId: null,
        status: 'unmatched',
        channel: message.channel,
        receivedAt,
        body: text,
        bodyHash,
        referenceKey: null,
        note: matched ? null : unmatchedNote(selection, tooLong),
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
      };
      if (!matched) {
        await rules.saveItem(item);
        return { outcome: 'inbox', itemId: item.id, status: item.status };
      }

      const context: FlowContext = { repositories, clock, generateId };
      const proposal = withProposal(item, matched.rule, matched.evaluation.fields, referenceKey);
      const placed = await placeItem(context, proposal, messageSettings);
      return placed.status === 'posted' && placed.transactionId
        ? { outcome: 'posted', itemId: placed.id, transactionId: placed.transactionId }
        : { outcome: 'inbox', itemId: placed.id, status: placed.status };
    });
}
