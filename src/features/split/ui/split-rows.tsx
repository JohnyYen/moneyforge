import { useRouter } from 'expo-router';

import { ListRow } from '@/shared/ui/primitives';

import type { SplitRow } from './split-model';

export function SplitRows({ rows }: { rows: readonly SplitRow[] }) {
  const router = useRouter();
  return (
    <>
      {rows.map(({ key, title, subtitle, amount, moveId }) => (
        <ListRow
          key={key}
          title={title}
          subtitle={subtitle}
          trailing={amount}
          onPress={
            moveId
              ? () => router.push({ pathname: '/split/moves/[id]', params: { id: moveId } })
              : undefined
          }
        />
      ))}
    </>
  );
}
