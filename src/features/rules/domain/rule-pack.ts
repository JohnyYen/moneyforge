import { err, ok, type Result } from '@/shared/result';

import { MESSAGE_CHANNELS, normalizeSender, type MessageChannel } from './message';
import { isValidNumberFormat, type NumberFormat } from './number-format';
import { RULE_KINDS, validateRule, type Rule, type RuleKind } from './rule';
import { ruleError, type RuleError } from './rule-error';
import type { MessageSource } from './source';

export const RULE_PACK_FORMAT = 'moneyforge-rule-pack';
export const RULE_PACK_VERSION = 1;

export const MAX_PACK_CHARS = 200_000;
export const MAX_PACK_SOURCES = 50;
export const MAX_PACK_RULES = 500;
const MAX_PACK_SLOTS = 50;
const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_PRIORITY = 1_000_000;
/** A shorter sender is one a person could share with a contact, or a whole app. */
const MIN_SENDER_LENGTH = 3;

/** `account`, `category`, and `counterpart` name slots, which a person maps on import. */
export type PackRule = {
  readonly name: string;
  readonly priority: number;
  readonly template: string;
  readonly format: NumberFormat;
  readonly kind: RuleKind;
  readonly account: string;
  readonly category: string | null;
  readonly counterpart: string | null;
};

export type PackSource = {
  readonly name: string;
  readonly channel: MessageChannel;
  readonly sender: string;
  readonly rules: readonly PackRule[];
};

/**
 * Holds what a stranger may reuse and nothing else. A pack is untrusted, so the format has no way
 * to say auto-post, split mode, samples, or ids: such a field is refused as unknown.
 */
export type RulePack = {
  readonly format: typeof RULE_PACK_FORMAT;
  readonly version: typeof RULE_PACK_VERSION;
  readonly name: string;
  readonly description?: string;
  readonly sources: readonly PackSource[];
};

export type CategorySlot = { readonly name: string; readonly kind: 'income' | 'expense' };
export type PackSlots = {
  readonly accounts: readonly string[];
  readonly categories: readonly CategorySlot[];
};

type Checked<T> = Result<T, RuleError>;

const invalid = (message: string) => err(ruleError('invalid-pack', message));

/** Object.keys sees an own `__proto__`, so it is refused like any other unknown field. */
function record(value: unknown, allowed: readonly string[], where: string) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid(`${where} must be an object.`);
  }
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown !== undefined) {
    return invalid(`${where} has an unknown field: ${unknown.slice(0, MAX_NAME_LENGTH)}.`);
  }
  return ok(new Map(Object.entries(value)));
}

const CONTROL_CHARACTERS = [
  [0x00, 0x1f],
  [0x7f, 0x9f], // Delete and the C1 controls, with U+0085 next line.
  [0x061c, 0x061c], // Arabic letter mark.
  [0x200e, 0x200f], // Direction marks.
  [0x2028, 0x202e], // Line and paragraph separators, then direction embeddings and overrides.
  [0x2066, 0x2069], // Direction isolates.
] as const;

/** Line breaks and direction controls could make a preview read as something else. */
function hasControlCharacter(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (CONTROL_CHARACTERS.some(([low, high]) => code >= low && code <= high)) return true;
  }
  return false;
}

function text(value: unknown, where: string, max = MAX_NAME_LENGTH): Checked<string> {
  if (typeof value !== 'string' || !value.trim()) return invalid(`${where} must be text.`);
  if (value.length > max) return invalid(`${where} can have up to ${max} characters.`);
  if (hasControlCharacter(value)) return invalid(`${where} has a control character.`);
  return ok(value.trim());
}

function optionalSlot(value: unknown, where: string): Checked<string | null> {
  return value === undefined || value === null ? ok(null) : text(value, where);
}

const parseFormat = (value: unknown, where: string): Checked<NumberFormat> => {
  const fields = record(value, ['decimal', 'thousands'], `${where} format`);
  if (!fields.ok) return fields;
  const decimal = fields.value.get('decimal');
  const thousands = fields.value.get('thousands');
  if (typeof decimal !== 'string' || typeof thousands !== 'string') {
    return invalid(`${where} needs a decimal and a thousands separator.`);
  }
  const format = { decimal, thousands };
  return isValidNumberFormat(format)
    ? ok(format as NumberFormat)
    : invalid(`${where} has an invalid number format.`);
};

/** Ids here are placeholders: every check that needs no storage still runs, by the same code. */
function parseRule(value: unknown, where: string): Checked<PackRule> {
  const fields = record(
    value,
    ['name', 'priority', 'template', 'format', 'kind', 'account', 'category', 'counterpart'],
    where,
  );
  if (!fields.ok) return fields;
  const get = (key: string) => fields.value.get(key);
  const name = text(get('name'), `${where} name`);
  if (!name.ok) return name;
  const priority = get('priority');
  if (typeof priority !== 'number' || !Number.isInteger(priority)) {
    return invalid(`${where} priority must be a whole number.`);
  }
  if (Math.abs(priority) > MAX_PRIORITY) return invalid(`${where} priority is out of range.`);
  const template = get('template');
  if (typeof template !== 'string') return invalid(`${where} template must be text.`);
  if (hasControlCharacter(template)) return invalid(`${where} template has a control character.`);
  const format = parseFormat(get('format'), where);
  if (!format.ok) return format;
  const kind = RULE_KINDS.find((known) => known === get('kind'));
  if (!kind) return invalid(`${where} has an unknown kind.`);
  const account = text(get('account'), `${where} account`);
  if (!account.ok) return account;
  const category = optionalSlot(get('category'), `${where} category`);
  if (!category.ok) return category;
  const counterpart = optionalSlot(get('counterpart'), `${where} counterpart`);
  if (!counterpart.ok) return counterpart;

  const checked = validateRule({
    id: 'pack',
    sourceId: 'pack',
    name: name.value,
    priority,
    template,
    format: format.value,
    kind,
    accountId: account.value,
    categoryId: category.value,
    counterpartAccountId: counterpart.value,
    currencyCode: null,
    autoPost: false,
    splitMode: 'none',
    splitStructureId: null,
    samples: [],
  });
  if (!checked.ok) return invalid(`${where}: ${checked.error.message}`);
  return ok({
    name: checked.value.name,
    priority,
    template: checked.value.template,
    format: format.value,
    kind,
    account: account.value,
    category: category.value,
    counterpart: counterpart.value,
  });
}

export const packRuleKey = ({ template, kind, format }: {
  readonly template: string;
  readonly kind: RuleKind;
  readonly format: NumberFormat;
}) => [kind, format.decimal, format.thousands, template].join('\0');

/**
 * How far to lower new rules, as one group so their order holds. A pack never outranks a rule a
 * source already has, since priority alone decides which rule reads a message.
 */
export function packPriorityShift(
  incoming: readonly number[],
  existing: readonly number[],
): number {
  if (incoming.length === 0 || existing.length === 0) return 0;
  return Math.min(Math.min(...existing) - 1 - Math.max(...incoming), 0);
}

function parseSource(value: unknown, where: string): Checked<PackSource> {
  const fields = record(value, ['name', 'channel', 'sender', 'rules'], where);
  if (!fields.ok) return fields;
  const name = text(fields.value.get('name'), `${where} name`);
  if (!name.ok) return name;
  const channel = MESSAGE_CHANNELS.find((known) => known === fields.value.get('channel'));
  if (!channel) return invalid(`${where} has an unknown channel.`);
  const senderText = text(fields.value.get('sender'), `${where} sender`);
  if (!senderText.ok) return senderText;
  const sender = normalizeSender(senderText.value);
  if (!sender) return invalid(`${where} sender is empty.`);
  if (sender.length < MIN_SENDER_LENGTH) {
    return invalid(`${where} sender needs at least ${MIN_SENDER_LENGTH} characters.`);
  }
  const list = fields.value.get('rules');
  if (!Array.isArray(list)) return invalid(`${where} rules must be a list.`);
  if (list.length > MAX_PACK_RULES) return invalid(`A pack can hold ${MAX_PACK_RULES} rules.`);

  const rules: PackRule[] = [];
  const keys = new Set<string>();
  for (const [index, item] of (list as unknown[]).entries()) {
    const rule = parseRule(item, `${where}, rule ${index + 1}`);
    if (!rule.ok) return rule;
    const key = packRuleKey(rule.value);
    if (keys.has(key)) return invalid(`${where} repeats rule ${index + 1}.`);
    keys.add(key);
    rules.push(rule.value);
  }
  return ok({ name: name.value, channel, sender, rules });
}

/** Derived from the rules, so no slot can be declared and left unexplained. */
export function packSlots({ sources }: Pick<RulePack, 'sources'>): PackSlots {
  const accounts = new Set<string>();
  const categories = new Map<string, CategorySlot>();
  for (const { account, counterpart, category, kind } of sources.flatMap(({ rules }) => rules)) {
    accounts.add(account);
    if (counterpart) accounts.add(counterpart);
    if (category && (kind === 'income' || kind === 'expense')) {
      categories.set(category, { name: category, kind });
    }
  }
  return { accounts: [...accounts], categories: [...categories.values()] };
}

function checkSlots(sources: readonly PackSource[]): Checked<void> {
  const kinds = new Map<string, RuleKind>();
  for (const { category, kind } of sources.flatMap(({ rules }) => rules)) {
    if (!category) continue;
    if (kinds.has(category) && kinds.get(category) !== kind) {
      return invalid(`The category slot ${category} is used for two kinds of rule.`);
    }
    kinds.set(category, kind);
  }
  const { accounts, categories } = packSlots({ sources });
  return accounts.length + categories.length > MAX_PACK_SLOTS
    ? invalid(`A pack can name ${MAX_PACK_SLOTS} accounts and categories.`)
    : ok(undefined);
}

/** Pure, so a hostile pack is refused before anything can touch storage. */
export function parseRulePack(input: string): Checked<RulePack> {
  if (input.length > MAX_PACK_CHARS) return invalid('This pack is too large.');
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    return invalid('This is not a valid pack: it is not JSON.');
  }
  const fields = record(value, ['format', 'version', 'name', 'description', 'sources'], 'A pack');
  if (!fields.ok) return fields;
  if (fields.value.get('format') !== RULE_PACK_FORMAT) return invalid('This is not a rule pack.');
  if (fields.value.get('version') !== RULE_PACK_VERSION) {
    return invalid('This pack needs another version of MoneyForge.');
  }
  const name = text(fields.value.get('name'), 'The pack name');
  if (!name.ok) return name;
  const rawDescription = fields.value.get('description');
  const description =
    rawDescription === undefined
      ? ok(undefined)
      : text(rawDescription, 'The description', MAX_DESCRIPTION_LENGTH);
  if (!description.ok) return description;
  const list = fields.value.get('sources');
  if (!Array.isArray(list) || list.length === 0) return invalid('A pack needs a list of sources.');
  if (list.length > MAX_PACK_SOURCES) return invalid(`A pack can hold ${MAX_PACK_SOURCES} sources.`);

  const sources: PackSource[] = [];
  const senders = new Set<string>();
  for (const [index, item] of (list as unknown[]).entries()) {
    const source = parseSource(item, `Source ${index + 1}`);
    if (!source.ok) return source;
    if (senders.has(source.value.sender)) return invalid(`Source ${index + 1} repeats a sender.`);
    senders.add(source.value.sender);
    sources.push(source.value);
  }
  if (sources.flatMap(({ rules }) => rules).length > MAX_PACK_RULES) {
    return invalid(`A pack can hold ${MAX_PACK_RULES} rules.`);
  }
  const slots = checkSlots(sources);
  if (!slots.ok) return slots;
  return ok({
    format: RULE_PACK_FORMAT,
    version: RULE_PACK_VERSION,
    name: name.value,
    ...(description.value === undefined ? {} : { description: description.value }),
    sources,
  });
}

/**
 * Slots get neutral names, because an account's own name can hold a bank or the last digits of a
 * card. Fields are copied one by one, so a new field on a rule never leaks into a pack.
 */
export function buildRulePack(
  { name, description }: { readonly name: string; readonly description?: string },
  chosen: readonly { readonly source: MessageSource; readonly rules: readonly Rule[] }[],
): RulePack {
  const slots = new Map<string, string>();
  const slotFor = (id: string, prefix: string) => {
    const known = slots.get(id);
    if (known) return known;
    const count = [...slots.values()].filter((slot) => slot.startsWith(prefix)).length;
    const slot = `${prefix} ${count + 1}`;
    slots.set(id, slot);
    return slot;
  };
  return {
    format: RULE_PACK_FORMAT,
    version: RULE_PACK_VERSION,
    name,
    ...(description ? { description } : {}),
    sources: chosen.map(({ source, rules }) => ({
      name: source.name,
      channel: source.channel,
      sender: source.sender,
      rules: rules.map((rule) => ({
        name: rule.name,
        priority: rule.priority,
        template: rule.template,
        format: { decimal: rule.format.decimal, thousands: rule.format.thousands },
        kind: rule.kind,
        account: slotFor(rule.accountId, 'Account'),
        category:
          rule.categoryId === null
            ? null
            : slotFor(rule.categoryId, rule.kind === 'income' ? 'Income category' : 'Expense category'),
        counterpart:
          rule.counterpartAccountId === null ? null : slotFor(rule.counterpartAccountId, 'Account'),
      })),
    })),
  };
}
