import { useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';

import { useRules } from '@/features/rules/ui/rules-context';
import {
  ChoiceChips,
  EmptyState,
  ErrorBanner,
  Muted,
  QueryBoundary,
  Screen,
} from '@/shared/ui/primitives';
import { useFocusQuery } from '@/shared/ui/use-focus-query';
import { useSubmit } from '@/shared/ui/use-submit';

import { useAssets } from './assets-context';

const NOT_LINKED = 'none';
const ASSET_ONLY = 'asset';

type Choice = { readonly ruleId: string; readonly value: string };

export function AssetRulesScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const assets = useAssets();
  const rules = useRules();
  const load = useCallback(async () => {
    const sources = await rules.listSources();
    const lists = await Promise.all(sources.map(({ id: sourceId }) => rules.listRules(sourceId)));
    const [links, streams] = await Promise.all([assets.listRuleLinks(id), assets.listStreams(id)]);
    return {
      links,
      streams,
      rules: lists.flat().filter(({ kind }) => kind === 'income' || kind === 'expense'),
    };
  }, [assets, id, rules]);
  const { state, reload } = useFocusQuery(load);
  const save = useSubmit(
    ({ ruleId, value }: Choice) =>
      assets.setRuleLink(
        ruleId,
        value === NOT_LINKED
          ? null
          : { assetId: id, streamId: value === ASSET_ONLY ? null : value },
      ),
    reload,
  );

  return (
    <QueryBoundary state={state} onRetry={reload}>
      {({ links, streams, rules: list }) => (
        <Screen>
          <Muted>What a rule posts from now on links here. Choose a flow to mark its date as paid.</Muted>
          <ErrorBanner message={save.error} />
          {list.length === 0 ? <EmptyState title="No income or expense rules yet" /> : null}
          {list.map((rule) => {
            const link = links.find(({ ruleId }) => ruleId === rule.id);
            const options = [
              { value: NOT_LINKED, label: 'Not linked' },
              { value: ASSET_ONLY, label: 'This asset' },
              ...streams
                .filter(({ kind }) => kind === rule.kind)
                .map((stream) => ({ value: stream.id, label: stream.name })),
            ];
            return (
              <ChoiceChips
                key={rule.id}
                label={rule.name}
                options={options}
                value={link ? (link.streamId ?? ASSET_ONLY) : NOT_LINKED}
                onChange={(value) => void save.submit({ ruleId: rule.id, value })}
              />
            );
          })}
        </Screen>
      )}
    </QueryBoundary>
  );
}
