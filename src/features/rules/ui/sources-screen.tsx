import { useRouter } from 'expo-router';
import { useCallback } from 'react';

import {
  Button,
  EmptyState,
  ListRow,
  Muted,
  QueryBoundary,
  Screen,
  SectionLabel,
} from '@/shared/ui/primitives';
import { useFocusQuery } from '@/shared/ui/use-focus-query';

import { useRules } from './rules-context';

export function SourcesScreen() {
  const rules = useRules();
  const router = useRouter();
  const load = useCallback(() => rules.listSources(), [rules]);
  const { state, reload } = useFocusQuery(load);

  return (
    <QueryBoundary state={state} onRetry={reload}>
      {(sources) => (
        <Screen>
          <Muted>
            A source is a sender you trust. Messages from anyone else are discarded and never
            saved. Rules turn what a source sends into transactions.
          </Muted>
          <SectionLabel>Sources</SectionLabel>
          {sources.length === 0 ? (
            <EmptyState title="No sources yet" hint="Add your bank as a source to start." />
          ) : null}
          {sources.map((source) => (
            <ListRow
              key={source.id}
              title={source.name}
              subtitle={`${source.sender} · ${source.channel === 'sms' ? 'SMS' : 'Paste'}`}
              trailing={source.enabled ? undefined : 'Off'}
              onPress={() =>
                router.push({ pathname: '/rules/sources/[id]', params: { id: source.id } })
              }
            />
          ))}
          <Button label="Add source" onPress={() => router.push('/rules/sources/new')} />
          <Button
            label="Message settings"
            variant="secondary"
            onPress={() => router.push('/rules/settings')}
          />
        </Screen>
      )}
    </QueryBoundary>
  );
}
