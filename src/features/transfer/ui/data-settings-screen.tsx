import { useRouter } from 'expo-router';

import { ListRow, Muted, Screen, SectionLabel } from '@/shared/ui/primitives';

export function DataSettingsScreen() {
  const router = useRouter();
  return (
    <Screen>
      <Muted>Everything here stays on this device until you choose to share it.</Muted>
      <SectionLabel>Transactions</SectionLabel>
      <ListRow
        title="Import CSV"
        subtitle="Add a statement to an account, with a preview first"
        onPress={() => router.push('/data/csv-import')}
      />
      <ListRow
        title="Export CSV"
        subtitle="Share transactions for a range"
        onPress={() => router.push('/data/csv-export')}
      />
    </Screen>
  );
}
