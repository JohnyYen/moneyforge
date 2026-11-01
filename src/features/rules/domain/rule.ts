import type { Account } from '@/features/ledger/domain/account';
import type { Currency } from '@/features/ledger/domain/currency';
import { parseDecimal } from '@/features/ledger/domain/money';
import { err, ok, type Result } from '@/shared/result';

import { MAX_MESSAGE_LENGTH, normalizeBody } from './message';
import { isValidNumberFormat, parseAmountText, type NumberFormat } from './number-format';
import { ruleError, type RuleError } from './rule-error';
import { compileTemplate, matchTemplate } from './template';

export const RULE_KINDS = ['income', 'expense', 'transfer_out', 'transfer_in'] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

export const SPLIT_MODES = ['none', 'ask', 'auto'] as const;
export type SplitMode = (typeof SPLIT_MODES)[number];

export const MAX_SAMPLES = 20;

export type Rule = {
  readonly id: string;
  readonly sourceId: string;
  readonly name: string;
  readonly priority: number;
  readonly template: string;
  readonly format: NumberFormat;
  readonly kind: RuleKind;
  readonly accountId: string;
  readonly categoryId: string | null;
  readonly counterpartAccountId: string | null;
  /** Used when the text carries no currency. Null means the currency of the account. */
  readonly currencyCode: string | null;
  readonly autoPost: boolean;
  readonly splitMode: SplitMode;
  readonly splitStructureId: string | null;
  readonly samples: readonly string[];
};

export type ExtractedFields = {
  readonly amountMinor: bigint;
  readonly currencyCode: string;
  readonly reference: string | null;
  readonly counterparty: string | null;
  readonly balance: string | null;
};

export type RuleLookups = {
  readonly accounts: readonly Pick<Account, 'id' | 'currencyCode'>[];
  readonly currencies: readonly Pick<Currency, 'code' | 'decimals'>[];
};

export type RuleEvaluation =
  | { readonly status: 'matched'; readonly fields: ExtractedFields }
  /** The shape of the message is not this rule's. Another rule may still fit. */
  | { readonly status: 'no-match'; readonly reason: string }
  /** This is the rule's message, but what it says cannot be trusted. */
  | { readonly status: 'failed'; readonly reason: string };

export const isTransferKind = (kind: RuleKind) => kind === 'transfer_out' || kind === 'transfer_in';

const invalid = (message: string) => err(ruleError('invalid-rule', message));

/** Checks everything that needs no storage. The application checks the references. */
export function validateRule(rule: Rule): Result<Rule, RuleError> {
  const name = rule.name.trim();
  if (!name) return invalid('Give the rule a name.');
  if (!Number.isSafeInteger(rule.priority)) return invalid('Priority must be a whole number.');
  if (!RULE_KINDS.includes(rule.kind)) return invalid('Choose what this message means.');
  if (!isValidNumberFormat(rule.format)) {
    return invalid('Choose two different separators for the number format.');
  }
  const template = compileTemplate(rule.template);
  if (!template.ok) return template;

  if (!isTransferKind(rule.kind) && rule.counterpartAccountId !== null) {
    return invalid('Only a transfer has a counterpart account.');
  }
  if (isTransferKind(rule.kind)) {
    if (!rule.counterpartAccountId) return invalid('A transfer needs a counterpart account.');
    if (rule.counterpartAccountId === rule.accountId) {
      return invalid('Choose two different accounts.');
    }
    if (rule.categoryId !== null) return invalid('A transfer has no category.');
  }
  if (rule.splitMode !== 'none' && rule.kind !== 'income') {
    return invalid('Only income can be split.');
  }
  if (rule.splitMode === 'auto' && !rule.splitStructureId) {
    return invalid('Choose the structure to apply.');
  }
  const samples = rule.samples.map(normalizeBody).filter(Boolean);
  if (samples.length > MAX_SAMPLES) return invalid(`A rule can keep ${MAX_SAMPLES} samples.`);
  if (samples.some((sample) => sample.length > MAX_MESSAGE_LENGTH)) {
    return invalid(`A sample can have up to ${MAX_MESSAGE_LENGTH} characters.`);
  }
  return ok({
    ...rule,
    name,
    template: normalizeBody(rule.template),
    splitStructureId: rule.splitMode === 'none' ? null : rule.splitStructureId,
    samples,
  });
}

const failed = (reason: string): RuleEvaluation => ({ status: 'failed', reason });

export function evaluateRule(rule: Rule, text: string, lookups: RuleLookups): RuleEvaluation {
  const template = compileTemplate(rule.template);
  if (!template.ok) return { status: 'no-match', reason: template.error.message };
  const match = matchTemplate(template.value, text, rule.format);
  if (!match.ok) return { status: 'no-match', reason: match.error };

  const { amount = '', currency, reference, counterparty, balance } = match.value;
  const account = lookups.accounts.find(({ id }) => id === rule.accountId);
  if (!account) return failed('The account of this rule no longer exists.');
  const code = currency ?? rule.currencyCode ?? account.currencyCode;
  const known = lookups.currencies.find((item) => item.code === code);
  if (!known) return failed(`${code} is not one of your currencies.`);
  if (code !== account.currencyCode) {
    return failed(`The message is in ${code}, but the account uses ${account.currencyCode}.`);
  }

  const plain = parseAmountText(amount, rule.format);
  if (plain === null) return failed(`Cannot read the amount "${amount}" with this number format.`);
  const amountMinor = parseDecimal(plain, known.decimals);
  if (!amountMinor.ok) {
    return failed(`Cannot read the amount "${amount}": ${amountMinor.error.message}`);
  }
  if (amountMinor.value <= 0n) return failed('The amount must be greater than zero.');

  return {
    status: 'matched',
    fields: {
      amountMinor: amountMinor.value,
      currencyCode: code,
      reference: reference ?? null,
      counterparty: counterparty ?? null,
      balance: balance ?? null,
    },
  };
}

export function rankRules(rules: readonly Rule[]): Rule[] {
  return [...rules].sort(
    (a, b) => b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

export type RuleSelection = { readonly rule: Rule; readonly evaluation: RuleEvaluation };

/**
 * The first rule whose shape fits decides, even when it then fails: trying a looser rule on
 * an amount its rule could not read would be a guess at what the amount means.
 */
export function selectRule(
  rules: readonly Rule[],
  text: string,
  lookups: RuleLookups,
): RuleSelection | null {
  for (const rule of rankRules(rules)) {
    const evaluation = evaluateRule(rule, text, lookups);
    if (evaluation.status !== 'no-match') return { rule, evaluation };
  }
  return null;
}
