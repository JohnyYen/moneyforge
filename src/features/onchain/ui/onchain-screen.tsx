import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';

import {
  Button,
  EmptyState,
  ErrorBanner,
  ListRow,
  Muted,
  Notice,
  QueryBoundary,
  Screen,
} from '@/shared/ui/primitives';
import { useFocusQuery } from '@/shared/ui/use-focus-query';
import { useSubmit } from '@/shared/ui/use-submit';

import { useOnChain } from './onchain-context';
import {
  refreshFailures,
  shortAddress,
  watchedSubtitle,
  type RefreshFailure,
} from './onchain-model';

export function OnChainScreen() {
  const onchain = useOnChain();
  const router = useRouter();
  const load = useCallback(async () => {
    const [watched, enabled] = await Promise.all([
      onchain.listWatched(),
      onchain.networkEnabled(),
    ]);
    return { watched, enabled };
  }, [onchain]);
  const { state, reload } = useFocusQuery(load);
  const [failures, setFailures] = useState<RefreshFailure[]>([]);
  const refresh = useSubmit(
    () => onchain.refreshAll(),
    (outcomes) => {
      setFailures(refreshFailures(outcomes));
      reload();
    },
  );

  return (
    <QueryBoundary state={state} onRetry={reload}>
      {({ watched, enabled }) => (
        <Screen>
          <Muted>Read-only. MoneyForge never holds keys, signs, or sends anything.</Muted>
          {enabled ? null : (
            <Notice>Network reads are off. Values here are the last ones read.</Notice>
          )}
          {watched.length === 0 ? (
            <EmptyState title="No addresses yet" hint="Watch a public address to read its balance." />
          ) : null}
          {watched.map((view) => (
            <ListRow
              key={view.watched.id}
              title={`${view.watched.label} ${shortAddress(view.watched.address)}`}
              subtitle={watchedSubtitle(view)}
              onPress={() =>
                router.push({ pathname: '/onchain/[id]', params: { id: view.watched.id } })
              }
            />
          ))}
          <ErrorBanner message={refresh.error} />
          {failures.map(({ id, message }) => (
            <Notice key={id}>{message}</Notice>
          ))}
          {watched.length > 0 ? (
            <Button
              label={refresh.submitting ? 'Reading...' : 'Refresh all'}
              disabled={refresh.submitting}
              onPress={() => void refresh.submit(undefined)}
            />
          ) : null}
          <Button label="Watch an address" onPress={() => router.push('/onchain/new')} />
          <Button
            label="Network settings"
            variant="secondary"
            onPress={() => router.push('/onchain/network')}
          />
        </Screen>
      )}
    </QueryBoundary>
  );
}
