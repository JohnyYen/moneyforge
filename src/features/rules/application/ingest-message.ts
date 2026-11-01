import { repeatNote, type InboxItem } from '../domain/inbox-item';
import {
  acceptsChannel,
  hashBody,
  looksLikeOneTimeCode,
  MAX_MESSAGE_LENGTH,
  normalizeBody,
  normalizeSender,
  referenceKeyFor,
  type MessageChannel,
} from '../domain/message';
import { minutesToMs } from '../domain/message-settings';
import { selectRule, type RuleEvaluation, type RuleSelection } from '../domain/rule';
import type { MessageSource } from '../domain/source';
import {
  loadDedupSecret,
  loadLookups,
  loadMessageSettings,
  placeItem,
  withProposal,
  type FlowContext,
} from './inbox-flow';
import type { RuleDeps, RuleRepository } from './ports';

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

const joinNotes = (...notes: readonly (string | null)[]) =>
  notes.filter((note) => note !== null).join(' ') || null;

function arrivalTime(receivedAt: string, now: Date): string {
  const time = Date.parse(receivedAt);
  const known = Number.isNaN(time) ? now.getTime() : time;
  return new Date(Math.min(known, now.getTime())).toISOString();
}

async function allowedSource(
  rules: Pick<RuleRepository, 'findSourceBySender'>,
  { sender, channel }: IncomingMessage,
): Promise<MessageSource | null> {
  const source = await rules.findSourceBySender(normalizeSender(sender));
  return source?.enabled && acceptsChannel(source, channel) ? source : null;
}

export function createIngestMessage(deps: RuleDeps) {
  const { store, clock, generateId } = deps;

  /**
   * The one way a message enters the app. Nothing is written, not even the secret, before the
   * checks that may discard the message. The rest is one write, so two copies arriving together
   * cannot both pass dedup. The reference key is hashed inside it, because the rule that reads
   * the reference is chosen there, but that hash is synchronous and awaits nothing.
   */
  return async (message: IncomingMessage): Promise<IngestResult> => {
    if (!(await allowedSource(store.rules, message))) return { outcome: 'dropped' };

    const tooLong = message.body.length > MAX_MESSAGE_LENGTH;
    const text = normalizeBody(message.body.slice(0, MAX_MESSAGE_LENGTH));
    if (looksLikeOneTimeCode(text)) return { outcome: 'one-time-code' };

    const secret = await loadDedupSecret(deps);
    const bodyHash = hashBody(message.body, secret);

    return store.atomic(async (repositories): Promise<IngestResult> => {
      const { rules, settings } = repositories;
      const source = await allowedSource(rules, message);
      if (!source) return { outcome: 'dropped' };

      const selection = tooLong
        ? null
        : selectRule(await rules.listRules(source.id), text, await loadLookups(repositories));
      const matched = isMatched(selection) ? selection : null;

      const referenceKey = matched
        ? referenceKeyFor(matched.rule.kind, matched.evaluation.fields.reference, secret)
        : null;
      if (referenceKey && (await rules.findItemByReference(source.id, referenceKey))) {
        return { outcome: 'duplicate' };
      }
      const receivedAt = arrivalTime(message.receivedAt, clock.now());
      const messageSettings = await loadMessageSettings(settings);
      const repeat = repeatNote(
        receivedAt,
        await rules.listItemsByBodyHash(source.id, bodyHash),
        minutesToMs(messageSettings.dedupWindowMinutes),
      );

      const item: InboxItem = {
        id: generateId(),
        sourceId: source.id,
        ruleId: null,
        status: 'unmatched',
        channel: message.channel,
        receivedAt,
        body: tooLong ? null : text,
        bodyHash,
        referenceKey: null,
        note: matched ? null : joinNotes(unmatchedNote(selection, tooLong), repeat),
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

      const proposal = withProposal(item, matched.rule, matched.evaluation.fields, referenceKey);
      if (repeat) {
        // Text seen before never moves money or claims a side on its own: a person decides.
        const held: InboxItem = { ...proposal, status: 'proposed', autoPost: false, note: repeat };
        await rules.saveItem(held);
        return { outcome: 'inbox', itemId: held.id, status: held.status };
      }
      const context: FlowContext = { repositories, clock, generateId };
      const placed = await placeItem(context, proposal, messageSettings);
      return placed.status === 'posted' && placed.transactionId
        ? { outcome: 'posted', itemId: placed.id, transactionId: placed.transactionId }
        : { outcome: 'inbox', itemId: placed.id, status: placed.status };
    });
  };
}
