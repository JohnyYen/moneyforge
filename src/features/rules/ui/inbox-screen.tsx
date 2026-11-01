import { useRouter } from 'expo-router';
import { useCallback } from 'react';

import { useLedger } from '@/features/ledger/ui/ledger-context';
import {
  Button,
  EmptyState,
  ListRow,
  QueryBoundary,
  Screen,
  SectionLabel,
} from '@/shared/ui/primitives';
import { useFocusQuery } from '@/shared/ui/use-focus-query';

import type { InboxItem } from '../domain/inbox-item';
import { useRules } from './rules-context';
import { itemRow } from './rules-model';

export function InboxScreen() {
  const ledger = useLedger();
  const rules = useRules();
  const router = useRouter();
  const load = useCallback(async () => {
    const [sections, sources, accounts, currencies] = await Promise.all([
      rules.listInbox(),
      rules.listSources(),
      ledger.listAccounts(),
      ledger.listCurrencies(),
    ]);
    return { sections, sources, lookups: { accounts, currencies } };
  }, [ledger, rules]);
  const { state, reload } = useFocusQuery(load);

  return (
    <QueryBoundary state={state} onRetry={reload}>
      {({ sections, sources, lookups }) => {
        const { review, waiting, splits } = sections;
        const renderRow = (item: InboxItem) => {
          const source = sources.find(({ id }) => id === item.sourceId);
          return (
            <ListRow
              key={item.id}
              {...itemRow(item, lookups, source?.name ?? 'Unknown source')}
              onPress={() => router.push({ pathname: '/inbox/[id]', params: { id: item.id } })}
            />
          );
        };
        return (
          <Screen>
            <Button label="Paste a message" onPress={() => router.push('/inbox/paste')} />
            {review.length + waiting.length + splits.length === 0 ? (
              <EmptyState
                title="Nothing to review"
                hint="Messages that need you appear here."
              />
            ) : null}
            {review.length > 0 ? <SectionLabel>To review</SectionLabel> : null}
            {review.map(renderRow)}
            {splits.length > 0 ? <SectionLabel>Ready to split</SectionLabel> : null}
            {splits.map(renderRow)}
            {waiting.length > 0 ? <SectionLabel>Waiting for the other side</SectionLabel> : null}
            {waiting.map(renderRow)}
          </Screen>
        );
      }}
    </QueryBoundary>
  );
}
