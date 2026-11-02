import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback } from 'react';

import {
  Button,
  EmptyState,
  ErrorBanner,
  Muted,
  Notice,
  QueryBoundary,
  Screen,
  Title,
} from '@/shared/ui/primitives';
import { useFocusQuery } from '@/shared/ui/use-focus-query';
import { useSubmit } from '@/shared/ui/use-submit';

import type { WatchedView } from '../application/watch-use-cases';
import { useOnChain } from './onchain-context';
import { amountLabel, differenceLabel, reconcileTarget } from './onchain-model';

function Detail({ view, error }: { view: WatchedView; error: string | null }) {
  const router = useRouter();
  const { watched, chain, token, stale } = view;
  const difference = differenceLabel(view);
  const target = reconcileTarget(view);
  return (
    <>
      <Muted>
        {watched.label}, {token.symbol} on {chain.name}
      </Muted>
      <Title>{amountLabel(watched.lastRead, token.symbol)}</Title>
      <Muted>{watched.address}</Muted>
      {watched.lastRead ? (
        <Muted>Read {new Date(watched.lastRead.readAt).toLocaleString()}</Muted>
      ) : null}
      {stale ? <Notice>This value may be out of date. Refresh before relying on it.</Notice> : null}
      {difference ? <Muted>{difference}</Muted> : null}
      <ErrorBanner message={error} />
      {target ? (
        <Button
          label="Open reconcile"
          onPress={() =>
            router.push({
              pathname: '/accounts/[id]/reconcile',
              params: { id: target.id, counted: target.counted },
            })
          }
        />
      ) : null}
    </>
  );
}

export function WatchedDetailScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const onchain = useOnChain();
  const router = useRouter();
  const load = useCallback(() => onchain.getWatched(id), [id, onchain]);
  const { state, reload } = useFocusQuery(load);
  const refresh = useSubmit(() => onchain.refresh(id), reload);

  return (
    <QueryBoundary state={state} onRetry={reload}>
      {(view) =>
        view ? (
          <Screen>
            <Detail view={view} error={refresh.error} />
            <Button
              label={refresh.submitting ? 'Reading...' : 'Refresh'}
              variant={reconcileTarget(view) ? 'secondary' : 'primary'}
              disabled={refresh.submitting}
              onPress={() => void refresh.submit(undefined)}
            />
            <Button
              label="Edit"
              variant="secondary"
              onPress={() => router.push({ pathname: '/onchain/[id]/edit', params: { id } })}
            />
          </Screen>
        ) : (
          <Screen>
            <EmptyState title="Address not found" />
          </Screen>
        )
      }
    </QueryBoundary>
  );
}
