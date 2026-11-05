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
      <SectionLabel>Rule packs</SectionLabel>
      <ListRow
        title="Import a rule pack"
        subtitle="Add sources and rules someone shared"
        onPress={() => router.push('/data/pack-import')}
      />
      <ListRow
        title="Export a rule pack"
        subtitle="Share your rules, without your messages or accounts"
        onPress={() => router.push('/data/pack-export')}
      />
      <SectionLabel>Backup</SectionLabel>
      <ListRow
        title="Export a backup"
        subtitle="Your whole ledger, encrypted with a passphrase"
        onPress={() => router.push('/data/backup-export')}
      />
      <ListRow
        title="Restore a backup"
        subtitle="Replace everything here with a backup, after a check"
        onPress={() => router.push('/data/backup-restore')}
      />
    </Screen>
  );
}
