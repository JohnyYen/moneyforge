import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback } from 'react';

import { useLedger } from '@/features/ledger/ui/ledger-context';
import { useSplit } from '@/features/split/ui/split-context';
import { leaveScreen } from '@/shared/ui/leave-screen';
import { EmptyState, QueryBoundary, Screen } from '@/shared/ui/primitives';
import { useFocusQuery } from '@/shared/ui/use-focus-query';
import { useSubmit } from '@/shared/ui/use-submit';

import { RuleForm } from './rule-form';
import { useRules } from './rules-context';
import {
  emptyRuleDraft,
  ruleDraftFor,
  ruleDraftFromItem,
  toRuleInput,
  type RuleDraft,
} from './rules-model';

export function RuleEditorScreen() {
  const { id, sourceId, itemId } = useLocalSearchParams<{
    id?: string;
    sourceId?: string;
    itemId?: string;
  }>();
  const ledger = useLedger();
  const split = useSplit();
  const rules = useRules();
  const router = useRouter();

  const load = useCallback(async () => {
    const [accounts, categories, currencies, structures, rule, details] = await Promise.all([
      ledger.listAccounts(),
      ledger.listCategories(),
      ledger.listCurrencies(),
      split.listStructures(),
      id ? rules.getRule(id) : null,
      itemId ? rules.getItem(itemId) : null,
    ]);
    const kept = [rule?.accountId, rule?.counterpartAccountId];
    return {
      rule,
      item: details?.item ?? null,
      accounts: accounts.filter((account) => !account.archived || kept.includes(account.id)),
      categories,
      currencies,
      structures: structures.filter(
        (structure) => structure.active || structure.id === rule?.splitStructureId,
      ),
    };
  }, [id, itemId, ledger, rules, split]);
  const { state, reload } = useFocusQuery(load);

  const exit = () => leaveScreen(router);
  const save = useSubmit(
    (draft: RuleDraft) => {
      const input = toRuleInput(draft);
      return id
        ? rules.updateRule({ ...input, id })
        : rules.createRule(input, itemId ? { fromItemId: itemId } : undefined);
    },
    exit,
    { exitsOnSuccess: true },
  );
  const remove = useSubmit((ruleId: string) => rules.deleteRule(ruleId), exit, {
    exitsOnSuccess: true,
  });

  return (
    <QueryBoundary state={state} onRetry={reload}>
      {({ rule, item, accounts, categories, currencies, structures }) => {
        if (id && !rule) {
          return (
            <Screen>
              <EmptyState title="Rule not found" />
            </Screen>
          );
        }
        const initial = rule
          ? ruleDraftFor(rule)
          : item
            ? ruleDraftFromItem(item)
            : emptyRuleDraft(sourceId ?? '');
        return (
          <RuleForm
            initial={initial}
            sourceMessage={rule ? null : (item?.body ?? null)}
            accounts={accounts}
            categories={categories}
            currencies={currencies}
            structures={structures}
            error={save.error ?? remove.error}
            submitting={save.submitting || remove.submitting}
            onSubmit={(draft) => void save.submit(draft)}
            onDelete={rule ? () => void remove.submit(rule.id) : undefined}
          />
        );
      }}
    </QueryBoundary>
  );
}
