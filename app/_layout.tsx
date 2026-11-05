import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useColorScheme } from 'react-native';

import { AppServicesProvider } from '@/app-services/app-services-provider';
import { SetupGate } from '@/features/ledger/ui/setup/setup-gate';
import { CaptureHost } from '@/features/rules/ui/capture-host';

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AppServicesProvider>
        <SetupGate>
          <CaptureHost />
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="accounts/new" options={{ title: 'Add account' }} />
            <Stack.Screen name="accounts/[id]/index" options={{ title: 'Account' }} />
            <Stack.Screen name="accounts/[id]/edit" options={{ title: 'Edit account' }} />
            <Stack.Screen name="accounts/[id]/reconcile" options={{ title: 'Reconcile' }} />
            <Stack.Screen name="transactions/new" options={{ title: 'Add transaction' }} />
            <Stack.Screen name="transactions/[id]" options={{ title: 'Transaction' }} />
            <Stack.Screen name="categories" options={{ title: 'Categories' }} />
            <Stack.Screen name="currencies" options={{ title: 'Currencies' }} />
            <Stack.Screen name="exchange-rates" options={{ title: 'Exchange rates' }} />
            <Stack.Screen name="split/index" options={{ title: 'Income split' }} />
            <Stack.Screen name="split/new" options={{ title: 'New structure' }} />
            <Stack.Screen name="split/[id]" options={{ title: 'Edit structure' }} />
            <Stack.Screen name="split/defaults" options={{ title: 'Default structures' }} />
            <Stack.Screen name="split/apply/[transactionId]" options={{ title: 'Split income' }} />
            <Stack.Screen name="split/moves/index" options={{ title: 'Pending moves' }} />
            <Stack.Screen name="split/moves/[id]" options={{ title: 'Move' }} />
            <Stack.Screen name="plan/budgets/new" options={{ title: 'New budget' }} />
            <Stack.Screen name="plan/budgets/[id]" options={{ title: 'Edit budget' }} />
            <Stack.Screen name="plan/recurring/index" options={{ title: 'Recurring items' }} />
            <Stack.Screen name="plan/recurring/new" options={{ title: 'New recurring item' }} />
            <Stack.Screen name="plan/recurring/[id]" options={{ title: 'Edit recurring item' }} />
            <Stack.Screen name="plan/occurrences/[id]" options={{ title: 'Occurrence' }} />
            <Stack.Screen name="plan/cash-flow/index" options={{ title: 'Cash flow' }} />
            <Stack.Screen name="plan/cash-flow/planned" options={{ title: 'Planned item' }} />
            <Stack.Screen name="assets/new" options={{ title: 'Add asset' }} />
            <Stack.Screen name="assets/types" options={{ title: 'Asset types' }} />
            <Stack.Screen name="assets/[id]/index" options={{ title: 'Asset' }} />
            <Stack.Screen name="assets/[id]/edit" options={{ title: 'Edit asset' }} />
            <Stack.Screen name="assets/[id]/valuation" options={{ title: 'Add value' }} />
            <Stack.Screen name="assets/[id]/stream" options={{ title: 'Expected flow' }} />
            <Stack.Screen name="assets/[id]/rules" options={{ title: 'Rules that link here' }} />
            <Stack.Screen name="onchain/index" options={{ title: 'On-chain balances' }} />
            <Stack.Screen name="onchain/new" options={{ title: 'Watch an address' }} />
            <Stack.Screen name="onchain/network" options={{ title: 'Network settings' }} />
            <Stack.Screen name="onchain/chain" options={{ title: 'Chain' }} />
            <Stack.Screen name="onchain/token" options={{ title: 'Token' }} />
            <Stack.Screen name="onchain/[id]/index" options={{ title: 'Address' }} />
            <Stack.Screen name="onchain/[id]/edit" options={{ title: 'Edit address' }} />
            <Stack.Screen name="data/index" options={{ title: 'Data' }} />
            <Stack.Screen name="data/csv-import" options={{ title: 'Import CSV' }} />
            <Stack.Screen name="data/csv-export" options={{ title: 'Export CSV' }} />
            <Stack.Screen name="data/pack-import" options={{ title: 'Import rule pack' }} />
            <Stack.Screen name="data/pack-export" options={{ title: 'Export rule pack' }} />
            <Stack.Screen name="data/backup-export" options={{ title: 'Export backup' }} />
            <Stack.Screen name="data/backup-restore" options={{ title: 'Restore backup' }} />
            <Stack.Screen name="inbox/index" options={{ title: 'Inbox' }} />
            <Stack.Screen name="inbox/paste" options={{ title: 'Paste a message' }} />
            <Stack.Screen name="inbox/[id]" options={{ title: 'Review message' }} />
            <Stack.Screen name="rules/index" options={{ title: 'Messages and rules' }} />
            <Stack.Screen name="rules/settings" options={{ title: 'Message settings' }} />
            <Stack.Screen name="rules/capture" options={{ title: 'SMS capture' }} />
            <Stack.Screen name="rules/new" options={{ title: 'New rule' }} />
            <Stack.Screen name="rules/[id]" options={{ title: 'Edit rule' }} />
            <Stack.Screen name="rules/sources/new" options={{ title: 'New source' }} />
            <Stack.Screen name="rules/sources/[id]" options={{ title: 'Edit source' }} />
          </Stack>
        </SetupGate>
      </AppServicesProvider>
    </ThemeProvider>
  );
}
