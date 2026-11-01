import type { Account } from '@/features/ledger/domain/account';
import { err, ok, type Result } from '@/shared/result';

import type { InboxItem } from '../domain/inbox-item';
import { normalizeReference } from '../domain/message';
import {
  SETTING_KEYS,
  validateSettings,
  type MessageSettings,
} from '../domain/message-settings';
import { evaluateRule, validateRule, type Rule } from '../domain/rule';
import { ruleError, type RuleError } from '../domain/rule-error';
import { createMessageSource, type MessageSource } from '../domain/source';
import {
  loadLookups,
  loadMessageSettings,
  placeItem,
  withProposal,
  type FlowContext,
} from './inbox-flow';
import type { RuleDeps, RuleRepositories } from './ports';

export type SourceInput = Omit<MessageSource, 'id'>;
export type RuleInput = Omit<Rule, 'id'>;

type RuleResult<T> = Result<T, RuleError>;

const notFound = (what: string) => err(ruleError('not-found', `${what} not found.`));

async function checkAccount(
  { accounts }: RuleRepositories,
  id: string,
  usedBefore: boolean,
): Promise<RuleResult<Account>> {
  const account = await accounts.get(id);
  if (!account || account.systemRole !== null) return notFound('Account');
  if (account.archived && !usedBefore) {
    return err(ruleError('account-archived', `${account.name} is archived.`));
  }
  return ok(account);
}

/** Everything that only storage can answer. A rule keeps a reference retired after it was set. */
async function checkReferences(
  repositories: RuleRepositories,
  rule: Rule,
  existing: Rule | null,
): Promise<RuleResult<void>> {
  const { rules, categories, currencies, splits } = repositories;
  if (!(await rules.getSource(rule.sourceId))) return notFound('Source');
  const account = await checkAccount(
    repositories,
    rule.accountId,
    existing?.accountId === rule.accountId,
  );
  if (!account.ok) return account;
  if (rule.counterpartAccountId) {
    const usedBefore = existing?.counterpartAccountId === rule.counterpartAccountId;
    const counterpart = await checkAccount(repositories, rule.counterpartAccountId, usedBefore);
    if (!counterpart.ok) return counterpart;
  }
  if (rule.currencyCode) {
    if (!(await currencies.get(rule.currencyCode))) return notFound('Currency');
    if (rule.currencyCode !== account.value.currencyCode) {
      return err(ruleError('currency-mismatch', `The account uses ${account.value.currencyCode}.`));
    }
  }
  if (rule.categoryId) {
    const category = await categories.get(rule.categoryId);
    const retired = category?.archived && category.id !== existing?.categoryId;
    if (!category || retired || category.kind !== rule.kind) {
      return err(ruleError('category-mismatch', `Choose an active ${rule.kind} category.`));
    }
  }
  if (rule.splitStructureId) {
    const structure = await splits.getStructure(rule.splitStructureId);
    if (!structure) return notFound('Structure');
    if (!structure.active && structure.id !== existing?.splitStructureId) {
      return err(ruleError('structure-archived', 'This split structure is archived.'));
    }
  }
  return ok(undefined);
}

async function writeRule(
  repositories: RuleRepositories,
  input: Rule,
  existing: Rule | null,
): Promise<RuleResult<Rule>> {
  const rule = validateRule(input);
  if (!rule.ok) return rule;
  const references = await checkReferences(repositories, rule.value, existing);
  if (!references.ok) return references;
  await repositories.rules.saveRule(rule.value);
  return rule;
}

async function writeSource(
  { rules }: RuleRepositories,
  input: MessageSource,
): Promise<RuleResult<MessageSource>> {
  const source = createMessageSource(input);
  if (!source.ok) return source;
  const holder = await rules.findSourceBySender(source.value.sender);
  if (holder && holder.id !== source.value.id) {
    return err(ruleError('already-exists', `${holder.name} already uses this sender.`));
  }
  await rules.saveSource(source.value);
  return source;
}

/** Runs a new rule on the item it was built from, as if the message had just arrived. */
async function rematchItem(context: FlowContext, item: InboxItem, rule: Rule): Promise<void> {
  const { repositories } = context;
  const { rules } = repositories;
  if (item.status !== 'unmatched' || !item.body || item.sourceId !== rule.sourceId) return;
  const evaluation = evaluateRule(rule, item.body, await loadLookups(repositories));
  if (evaluation.status !== 'matched') {
    await rules.saveItem({ ...item, note: evaluation.reason });
    return;
  }
  const referenceKey = normalizeReference(evaluation.fields.reference);
  const taken = referenceKey && (await rules.findItemByReference(rule.sourceId, referenceKey));
  // The reference says this may be a message already handled, so a person decides.
  const proposal = taken
    ? { ...withProposal(item, rule, evaluation.fields, null), autoPost: false }
    : withProposal(item, rule, evaluation.fields, referenceKey);
  await placeItem(context, proposal, await loadMessageSettings(repositories.settings));
}

export function createRuleUseCases({ store, clock, generateId }: RuleDeps) {
  return {
    listSources: () => store.rules.listSources(),
    getSource: (id: string) => store.rules.getSource(id),

    createSource: (input: SourceInput): Promise<RuleResult<MessageSource>> =>
      store.atomic((repositories) => writeSource(repositories, { ...input, id: generateId() })),

    updateSource: (input: MessageSource): Promise<RuleResult<MessageSource>> =>
      store.atomic(async (repositories) => {
        if (!(await repositories.rules.getSource(input.id))) return notFound('Source');
        return writeSource(repositories, input);
      }),

    listRules: (sourceId: string) => store.rules.listRules(sourceId),
    getRule: (id: string) => store.rules.getRule(id),

    /** With `fromItemId`, the new rule also runs on that item. */
    createRule: (
      input: RuleInput,
      { fromItemId }: { readonly fromItemId?: string } = {},
    ): Promise<RuleResult<Rule>> =>
      store.atomic(async (repositories) => {
        const rule = await writeRule(repositories, { ...input, id: generateId() }, null);
        if (!rule.ok || !fromItemId) return rule;
        const item = await repositories.rules.getItem(fromItemId);
        if (item) await rematchItem({ repositories, clock, generateId }, item, rule.value);
        return rule;
      }),

    updateRule: (input: Rule): Promise<RuleResult<Rule>> =>
      store.atomic(async (repositories) => {
        const existing = await repositories.rules.getRule(input.id);
        if (!existing) return notFound('Rule');
        return writeRule(repositories, input, existing);
      }),

    deleteRule: (id: string): Promise<RuleResult<void>> =>
      store.atomic(async ({ rules }) => {
        if (!(await rules.getRule(id))) return notFound('Rule');
        await rules.removeRule(id);
        return ok(undefined);
      }),

    getMessageSettings: () => loadMessageSettings(store.settings),

    updateMessageSettings: (input: MessageSettings): Promise<RuleResult<MessageSettings>> =>
      store.atomic(async ({ settings }) => {
        const valid = validateSettings(input);
        if (!valid.ok) return valid;
        await settings.set(SETTING_KEYS.retentionDays, String(input.retentionDays));
        await settings.set(SETTING_KEYS.dedupWindowHours, String(input.dedupWindowHours));
        await settings.set(SETTING_KEYS.transferWindowHours, String(input.transferWindowHours));
        return valid;
      }),
  };
}
