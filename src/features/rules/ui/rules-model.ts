import type { Account } from '@/features/ledger/domain/account';
import type { Currency } from '@/features/ledger/domain/currency';
import { formatDecimal, formatDisplay, groupThousands } from '@/features/ledger/domain/money';

import type { ItemDraft } from '../application/inbox-use-cases';
import type { IngestResult } from '../application/ingest-message';
import type { RuleInput } from '../application/rule-use-cases';
import type { InboxItem } from '../domain/inbox-item';
import { MAX_MESSAGE_LENGTH, normalizeBody } from '../domain/message';
import type { MessageSettings } from '../domain/message-settings';
import type { NumberFormat } from '../domain/number-format';
import {
  evaluateRule,
  isTransferKind,
  type ExtractedFields,
  type Rule,
  type RuleKind,
  type RuleLookups,
  type SplitMode,
} from '../domain/rule';
import { compileTemplate, templateFromMessage } from '../domain/template';

export const KIND_LABELS: Readonly<Record<RuleKind, string>> = {
  income: 'Income',
  expense: 'Expense',
  transfer_out: 'Transfer out',
  transfer_in: 'Transfer in',
};

export const KIND_OPTIONS = (Object.keys(KIND_LABELS) as RuleKind[]).map((value) => ({
  value,
  label: KIND_LABELS[value],
}));

export const SPLIT_OPTIONS: readonly { value: SplitMode; label: string }[] = [
  { value: 'none', label: 'Do nothing' },
  { value: 'ask', label: 'Ask me' },
  { value: 'auto', label: 'Apply a structure' },
];

export const NUMBER_FORMATS: readonly { label: string; format: NumberFormat }[] = [
  { label: '1,500.25', format: { decimal: '.', thousands: ',' } },
  { label: '1.500,25', format: { decimal: ',', thousands: '.' } },
  { label: '1 500,25', format: { decimal: ',', thousands: ' ' } },
  { label: "1'500.25", format: { decimal: '.', thousands: "'" } },
  { label: '1500.25', format: { decimal: '.', thousands: '' } },
  { label: '1500,25', format: { decimal: ',', thousands: '' } },
];

export const formatKey = ({ decimal, thousands }: NumberFormat) => `${decimal}|${thousands}`;

export type RuleDraft = {
  readonly sourceId: string;
  readonly name: string;
  readonly priority: string;
  readonly template: string;
  readonly format: NumberFormat;
  readonly kind: RuleKind;
  readonly accountId: string | null;
  readonly categoryId: string | null;
  readonly counterpartAccountId: string | null;
  readonly currencyCode: string | null;
  readonly autoPost: boolean;
  readonly splitMode: SplitMode;
  readonly splitStructureId: string | null;
  readonly samples: readonly string[];
};

export const emptyRuleDraft = (sourceId: string): RuleDraft => ({
  sourceId,
  name: '',
  priority: '0',
  template: '',
  format: NUMBER_FORMATS[0].format,
  kind: 'expense',
  accountId: null,
  categoryId: null,
  counterpartAccountId: null,
  currencyCode: null,
  autoPost: false,
  splitMode: 'none',
  splitStructureId: null,
  samples: [''],
});

export const ruleDraftFor = ({ id: _id, priority, samples, ...rule }: Rule): RuleDraft => ({
  ...rule,
  priority: String(priority),
  samples: samples.length > 0 ? samples : [''],
});

export const ruleDraftFromItem = ({ sourceId, body }: InboxItem): RuleDraft => ({
  ...emptyRuleDraft(sourceId),
  template: templateFromMessage(body ?? ''),
  samples: [body ?? ''],
});

/** Keeps a bad number as NaN, so the use case refuses it instead of a default replacing it. */
const toNumber = (text: string) => (text.trim() === '' ? 0 : Number(text));

export function toRuleInput(draft: RuleDraft): RuleInput {
  const transfer = isTransferKind(draft.kind);
  const income = draft.kind === 'income';
  return {
    ...draft,
    priority: toNumber(draft.priority),
    accountId: draft.accountId ?? '',
    categoryId: transfer ? null : draft.categoryId,
    counterpartAccountId: transfer ? draft.counterpartAccountId : null,
    splitMode: income ? draft.splitMode : 'none',
    splitStructureId: income && draft.splitMode !== 'none' ? draft.splitStructureId : null,
  };
}

export function templateProblem(template: string): string | null {
  if (!template.trim()) return null;
  const compiled = compileTemplate(template);
  return compiled.ok ? null : compiled.error.message;
}

export type SampleResult = {
  readonly sample: string;
  readonly matched: boolean;
  readonly lines: readonly string[];
};

function amountLine({ amountMinor, currencyCode }: ExtractedFields, lookups: RuleLookups) {
  const decimals = lookups.currencies.find(({ code }) => code === currencyCode)?.decimals ?? 0;
  const [whole, fraction] = formatDecimal(amountMinor, decimals).split('.');
  const amount = fraction ? `${groupThousands(whole)}.${fraction}` : groupThousands(whole);
  return `Amount: ${amount} ${currencyCode}`;
}

function fieldLines(fields: ExtractedFields, lookups: RuleLookups): string[] {
  const optional: readonly [string, string | null][] = [
    ['Counterparty', fields.counterparty],
    ['Reference', fields.reference],
    ['Balance', fields.balance],
  ];
  return [
    amountLine(fields, lookups),
    ...optional.flatMap(([label, value]) => (value === null ? [] : [`${label}: ${value}`])),
  ];
}

export function sampleResults(draft: RuleDraft, lookups: RuleLookups): SampleResult[] {
  const rule: Rule = { ...toRuleInput(draft), id: 'draft' };
  return draft.samples.flatMap((sample): SampleResult[] => {
    const text = normalizeBody(sample);
    if (!text) return [];
    if (!draft.accountId) {
      return [{ sample: text, matched: false, lines: ['Choose an account to test this rule.'] }];
    }
    if (text.length > MAX_MESSAGE_LENGTH) {
      const line = `Over ${MAX_MESSAGE_LENGTH} characters, so no rule runs on it.`;
      return [{ sample: text, matched: false, lines: [line] }];
    }
    const evaluation = evaluateRule(rule, text, lookups);
    return evaluation.status === 'matched'
      ? [{ sample: text, matched: true, lines: fieldLines(evaluation.fields, lookups) }]
      : [{ sample: text, matched: false, lines: [evaluation.reason] }];
  });
}

export type ItemForm = {
  readonly kind: RuleKind | null;
  readonly accountId: string | null;
  readonly counterpartAccountId: string | null;
  readonly categoryId: string | null;
  readonly amount: string;
  readonly description: string;
};

export const emptyItemForm: ItemForm = {
  kind: null,
  accountId: null,
  counterpartAccountId: null,
  categoryId: null,
  amount: '',
  description: '',
};

export function itemFormFor(item: InboxItem, currencies: readonly Currency[]): ItemForm {
  const currency = currencies.find(({ code }) => code === item.currencyCode);
  return {
    kind: item.kind,
    accountId: item.accountId,
    counterpartAccountId: item.counterpartAccountId,
    categoryId: item.categoryId,
    amount:
      item.amountMinor === null || !currency ? '' : formatDecimal(item.amountMinor, currency.decimals),
    description: item.description,
  };
}

/** Null until the form says enough to record a movement. */
export function toItemDraft(form: ItemForm): ItemDraft | null {
  const { kind, accountId, amount } = form;
  if (!kind || !accountId || !amount.trim()) return null;
  return { ...form, kind, accountId, amount };
}

export function needsCounterAmount(
  { kind, accountId, counterpartAccountId }: ItemForm,
  paired: boolean,
  accounts: readonly Pick<Account, 'id' | 'currencyCode'>[],
): boolean {
  if (paired || !kind || !isTransferKind(kind)) return false;
  const currencyOf = (id: string | null) =>
    accounts.find((account) => account.id === id)?.currencyCode;
  const own = currencyOf(accountId);
  const other = currencyOf(counterpartAccountId);
  return own !== undefined && other !== undefined && own !== other;
}

export type ItemRow = {
  readonly title: string;
  readonly subtitle: string;
  readonly trailing: string | undefined;
};

export function itemRow(
  item: InboxItem,
  lookups: { readonly accounts: readonly Account[]; readonly currencies: readonly Currency[] },
  sourceName: string,
): ItemRow {
  const account = lookups.accounts.find(({ id }) => id === item.accountId);
  const currency = lookups.currencies.find(({ code }) => code === item.currencyCode);
  const details = item.kind
    ? [KIND_LABELS[item.kind], ...(account ? [account.name] : [])]
    : ['No rule matched'];
  return {
    title: item.description || item.body || 'Message',
    subtitle: [sourceName, ...details].join(' · '),
    trailing:
      item.amountMinor !== null && currency ? formatDisplay(item.amountMinor, currency) : undefined,
  };
}

export const inboxLabel = (count: number) =>
  `${count} ${count === 1 ? 'message' : 'messages'} to review`;

/** What to tell the user when a message made no item to open. */
export function ingestResultLabel(result: IngestResult): string | null {
  switch (result.outcome) {
    case 'dropped':
      return 'This sender is not on your list, so nothing was saved.';
    case 'one-time-code':
      return 'This looks like a one-time code, so nothing was saved.';
    case 'duplicate':
      return 'This message is already in your inbox or history.';
    default:
      return null;
  }
}

export type SettingsDraft = Readonly<Record<keyof MessageSettings, string>>;

export const settingsDraftFor = (settings: MessageSettings): SettingsDraft => ({
  retentionDays: String(settings.retentionDays),
  dedupWindowHours: String(settings.dedupWindowHours),
  transferWindowHours: String(settings.transferWindowHours),
});

export const toSettings = (draft: SettingsDraft): MessageSettings => ({
  retentionDays: Number(draft.retentionDays.trim() || Number.NaN),
  dedupWindowHours: Number(draft.dedupWindowHours.trim() || Number.NaN),
  transferWindowHours: Number(draft.transferWindowHours.trim() || Number.NaN),
});
