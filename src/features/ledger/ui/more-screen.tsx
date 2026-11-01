import { useRouter } from 'expo-router';

import { ListRow, Screen } from '@/shared/ui/primitives';

export function MoreScreen() {
  const router = useRouter();
  return (
    <Screen>
      <ListRow title="Inbox" onPress={() => router.push('/inbox')} />
      <ListRow title="Messages and rules" onPress={() => router.push('/rules')} />
      <ListRow title="Income split" onPress={() => router.push('/split')} />
      <ListRow title="Categories" onPress={() => router.push('/categories')} />
      <ListRow title="Currencies" onPress={() => router.push('/currencies')} />
      <ListRow title="Exchange rates" onPress={() => router.push('/exchange-rates')} />
    </Screen>
  );
}
