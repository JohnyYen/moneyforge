import { Tabs } from 'expo-router/js-tabs';
import { useColorScheme } from 'react-native';

import { colorsFor } from './theme';

/**
 * Web dev preview only. NativeTabs renders a floating tab list at the top on web,
 * over the screen header, so the browser gets a bottom JS tab bar instead.
 * Labels only: the Material symbols used on Android have no web font here.
 */
export function AppTabs() {
  const colors = colorsFor(useColorScheme());

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarActiveBackgroundColor: colors.backgroundElement,
        tabBarStyle: { backgroundColor: colors.background },
        tabBarIcon: () => null,
        tabBarIconStyle: { display: 'none' },
        tabBarLabelStyle: { fontSize: 13 },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Accounts' }} />
      <Tabs.Screen name="transactions" options={{ title: 'Transactions' }} />
      <Tabs.Screen name="plan" options={{ title: 'Plan' }} />
      <Tabs.Screen name="assets" options={{ title: 'Assets' }} />
      <Tabs.Screen name="more" options={{ title: 'More' }} />
    </Tabs>
  );
}
