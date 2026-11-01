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

import type { SplitStructure } from '../domain/split-structure';
import { useSplit } from './split-context';
import { pendingMovesLabel } from './split-model';

export function StructuresScreen() {
  const split = useSplit();
  const router = useRouter();
  const load = useCallback(async () => {
    const [structures, pending] = await Promise.all([
      split.listStructures(),
      split.countPendingMoves(),
    ]);
    return { structures, pending };
  }, [split]);
  const { state, reload } = useFocusQuery(load);

  const renderRow = (structure: SplitStructure) => (
    <ListRow
      key={structure.id}
      title={structure.name}
      subtitle={structure.lines.map(({ label }) => label).join(', ')}
      onPress={() => router.push({ pathname: '/split/[id]', params: { id: structure.id } })}
    />
  );

  return (
    <QueryBoundary state={state} onRetry={reload}>
      {({ structures, pending }) => {
        const active = structures.filter((structure) => structure.active);
        const archived = structures.filter((structure) => !structure.active);
        return (
          <Screen>
            <Muted>
              A split records a plan for your income and lists the moves to make. It never moves
              money: you confirm each move after making it.
            </Muted>
            <ListRow
              title={pendingMovesLabel(pending)}
              onPress={() => router.push('/split/moves')}
            />
            <SectionLabel>Structures</SectionLabel>
            {active.length === 0 ? (
              <EmptyState title="No structures yet" hint="Add one to start splitting income." />
            ) : null}
            {active.map(renderRow)}
            <Button label="Add structure" onPress={() => router.push('/split/new')} />
            {active.length > 0 ? (
              <Button
                label="Default structures"
                variant="secondary"
                onPress={() => router.push('/split/defaults')}
              />
            ) : null}
            {archived.length > 0 ? <SectionLabel>Archived</SectionLabel> : null}
            {archived.map(renderRow)}
          </Screen>
        );
      }}
    </QueryBoundary>
  );
}
