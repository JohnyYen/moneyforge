import { err, ok, type Result } from '@/shared/result';

import {
  buildRulePack,
  packPriorityShift,
  packRuleKey,
  packSlots,
  parseRulePack,
  type PackRule,
  type PackSlots,
  type PackSource,
  type RulePack,
} from '../domain/rule-pack';
import type { Rule } from '../domain/rule';
import { ruleError, type RuleError } from '../domain/rule-error';
import type { MessageSource } from '../domain/source';
import type { RuleDeps, RuleRepositories } from './ports';
import { writeRule, writeSource } from './rule-use-cases';

export type PackRulePreview = Pick<PackRule, 'name' | 'priority' | 'template'>;

export type PackSourcePreview = {
  readonly name: string;
  readonly sender: string;
  readonly isNew: boolean;
  /** What importing adds, at the priority it would get. */
  readonly rules: readonly PackRulePreview[];
  readonly knownRules: number;
};

export type PackPreview = {
  readonly name: string;
  readonly description: string | null;
  readonly slots: PackSlots;
  readonly sources: readonly PackSourcePreview[];
};

/** Maps, because a slot name comes from the pack and may be `__proto__`. */
export type PackImportInput = {
  readonly text: string;
  readonly accounts: ReadonlyMap<string, string>;
  /** A slot left out gives its rules no category. */
  readonly categories: ReadonlyMap<string, string>;
  /** Normalized senders to turn on. Any other new source stays off, so it stores nothing. */
  readonly enabledSenders: ReadonlySet<string>;
};

export type PackReport = {
  readonly sources: number;
  readonly enabled: number;
  readonly rules: number;
  readonly skipped: number;
};

type PackResult<T> = Result<T, RuleError>;

/** Thrown inside the write, because a returned error commits what the pack already wrote. */
class PackRefused extends Error {
  constructor(readonly error: RuleError) {
    super(error.message);
  }
}

const unwritten = <T>(result: PackResult<T>): T => {
  if (!result.ok) throw new PackRefused(result.error);
  return result.value;
};

/**
 * What a pack cannot decide. Auto-post stays off and a split is asked about, because a rule from a
 * stranger must not move money unseen. Only income can split, so anything else keeps `none`.
 */
const toRule = (rule: PackRule, id: string, sourceId: string, input: PackImportInput): Rule => ({
  id,
  sourceId,
  name: rule.name,
  priority: rule.priority,
  template: rule.template,
  format: rule.format,
  kind: rule.kind,
  accountId: input.accounts.get(rule.account) ?? '',
  categoryId: (rule.category && input.categories.get(rule.category)) || null,
  counterpartAccountId: rule.counterpart ? (input.accounts.get(rule.counterpart) ?? '') : null,
  currencyCode: null,
  autoPost: false,
  splitMode: rule.kind === 'income' ? 'ask' : 'none',
  splitStructureId: null,
  samples: [],
});

/** Shared by preview and import, so what is shown is what gets written. */
async function incomingRules(
  { rules }: RuleRepositories,
  source: MessageSource | null,
  packed: PackSource,
) {
  const stored = source ? await rules.listRules(source.id) : [];
  const known = new Set(stored.map(packRuleKey));
  const fresh = packed.rules.filter((rule) => !known.has(packRuleKey(rule)));
  const shift = packPriorityShift(
    fresh.map(({ priority }) => priority),
    stored.map(({ priority }) => priority),
  );
  return {
    fresh: fresh.map((rule) => ({ ...rule, priority: rule.priority + shift })),
    knownRules: packed.rules.length - fresh.length,
  };
}

export function createRulePackUseCases({ store, generateId, onSourcesChanged }: RuleDeps) {
  async function writePack(
    repositories: RuleRepositories,
    pack: RulePack,
    input: PackImportInput,
  ): Promise<PackReport> {
    const report = { sources: 0, enabled: 0, rules: 0, skipped: 0 };
    for (const packed of pack.sources) {
      const { name, channel, sender } = packed;
      const existing = await repositories.rules.findSourceBySender(sender);
      const enabled = input.enabledSenders.has(sender);
      const source =
        existing ??
        unwritten(
          await writeSource(repositories, { id: generateId(), name, channel, sender, enabled }),
        );
      if (!existing) {
        report.sources += 1;
        if (enabled) report.enabled += 1;
      }
      const { fresh, knownRules } = await incomingRules(repositories, existing, packed);
      report.skipped += knownRules;
      for (const rule of fresh) {
        unwritten(
          await writeRule(repositories, toRule(rule, generateId(), source.id, input), null),
        );
        report.rules += 1;
      }
    }
    return report;
  }

  return {
    exportRulePack: async ({
      name,
      description,
      sourceIds,
    }: {
      readonly name: string;
      readonly description?: string;
      readonly sourceIds: readonly string[];
    }): Promise<PackResult<string>> => {
      const chosen = [];
      for (const id of sourceIds) {
        const source = await store.rules.getSource(id);
        if (!source) return err(ruleError('not-found', 'Source not found.'));
        chosen.push({ source, rules: await store.rules.listRules(id) });
      }
      const text = JSON.stringify(buildRulePack({ name, description }, chosen), null, 2);
      // A rule saved before a limit existed must not leave as a pack nobody can import.
      const accepted = parseRulePack(text);
      return accepted.ok ? ok(text) : accepted;
    },

    /** Only reads. Nothing a pack holds reaches storage before `importRulePack`. */
    previewRulePack: async (text: string): Promise<PackResult<PackPreview>> => {
      const pack = parseRulePack(text);
      if (!pack.ok) return pack;
      const sources: PackSourcePreview[] = [];
      for (const packed of pack.value.sources) {
        const { name, sender } = packed;
        const existing = await store.rules.findSourceBySender(sender);
        const { fresh, knownRules } = await incomingRules(store, existing, packed);
        sources.push({
          name,
          sender,
          isNew: !existing,
          rules: fresh.map(({ name: title, priority, template }) => ({
            name: title,
            priority,
            template,
          })),
          knownRules,
        });
      }
      return ok({
        name: pack.value.name,
        description: pack.value.description ?? null,
        slots: packSlots(pack.value),
        sources,
      });
    },

    /** One write: a rule refused by the person's mapping leaves nothing of the pack behind. */
    importRulePack: async (input: PackImportInput): Promise<PackResult<PackReport>> => {
      const pack = parseRulePack(input.text);
      if (!pack.ok) return pack;
      const unmapped = packSlots(pack.value).accounts.find((slot) => !input.accounts.has(slot));
      if (unmapped !== undefined) {
        return err(ruleError('invalid-pack', `Choose an account for ${unmapped}.`));
      }
      try {
        const report = await store.atomic((repositories) =>
          writePack(repositories, pack.value, input),
        );
        if (report.enabled > 0) await onSourcesChanged?.();
        return ok(report);
      } catch (error) {
        if (error instanceof PackRefused) return err(error.error);
        throw error;
      }
    },
  };
}
