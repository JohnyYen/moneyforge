import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useColorScheme } from 'react-native';

import { LedgerProvider } from '@/features/ledger/ui/ledger-context';
import { SetupGate } from '@/features/ledger/ui/setup/setup-gate';

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <LedgerProvider>
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
          </Stack>
        </SetupGate>
      </LedgerProvider>
    </ThemeProvider>
  );
}
