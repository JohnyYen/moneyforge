import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useColorScheme } from 'react-native';

import { AppServicesProvider } from '@/app-services/app-services-provider';
import { SetupGate } from '@/features/ledger/ui/setup/setup-gate';

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AppServicesProvider>
        <SetupGate>
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
          </Stack>
        </SetupGate>
      </AppServicesProvider>
    </ThemeProvider>
  );
}
