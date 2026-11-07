import { useCallback, useState } from 'react';

import { useLedger } from '@/features/ledger/ui/ledger-context';
import {
  ChoiceChips,
  ErrorBanner,
  Muted,
  QueryBoundary,
  Screen,
  SectionLabel,
} from '@/shared/ui/primitives';
import { messageOf, useFocusQuery } from '@/shared/ui/use-focus-query';

import type { SplitDefaultScope } from '../application/ports';
import { useSplit } from './split-context';

const NONE = 'none';

export function SplitDefaultsScreen() {
  const ledger = useLedger();
  const split = useSplit();
  const load = useCallback(async () => {
    const [accounts, categories, structures, defaults] = await Promise.all([
      ledger.listAccountsForDisplay(),
      ledger.listCategories(),
      split.listStructures(),
      split.listSplitDefaults(),
    ]);
    return {
      defaults,
      structures: structures.filter(({ active }) => active),
      accounts: accounts.filter(({ archived }) => !archived),
      categories: categories.filter(({ kind, archived }) => kind === 'income' && !archived),
    };
  }, [ledger, split]);
  const { state, reload } = useFocusQuery(load);
  const [error, setError] = useState<string | null>(null);

  const choose = async (scope: SplitDefaultScope, scopeId: string, value: string) => {
    setError(null);
    try {
      const result = await split.setSplitDefault({
        scope,
        scopeId,
        structureId: value === NONE ? null : value,
      });
      if (result.ok) reload();
      else setError(result.error.message);
    } catch (cause) {
      setError(messageOf(cause));
    }
  };

  return (
    <QueryBoundary state={state} onRetry={reload}>
      {({ defaults, structures, accounts, categories }) => {
        const options = [
          { value: NONE, label: 'None' },
          ...structures.map(({ id, name }) => ({ value: id, label: name })),
        ];
        const picker = (scope: SplitDefaultScope, scopeId: string, label: string) => {
          const chosen = defaults.find(
            (entry) => entry.scope === scope && entry.scopeId === scopeId,
          );
          const active = structures.some(({ id }) => id === chosen?.structureId);
          return (
            <ChoiceChips
              key={`${scope}:${scopeId}`}
              label={label}
              options={options}
              value={active && chosen ? chosen.structureId : NONE}
              onChange={(value) => void choose(scope, scopeId, value)}
            />
          );
        };
        return (
          <Screen>
            <Muted>
              A default is proposed when you record income. A category default wins over an account
              default, and you can always change or skip it.
            </Muted>
            <ErrorBanner message={error} />
            <SectionLabel>By income category</SectionLabel>
            {categories.map(({ id, name }) => picker('category', id, name))}
            <SectionLabel>By account</SectionLabel>
            {accounts.map(({ id, name }) => picker('account', id, name))}
          </Screen>
        );
      }}
    </QueryBoundary>
  );
}
