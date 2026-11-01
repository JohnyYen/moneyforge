import { StyleSheet, Text, useColorScheme, View } from 'react-native';

import { colorsFor } from '@/shared/ui/theme';

export function HomeScreen() {
  const colors = colorsFor(useColorScheme());

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[styles.title, { color: colors.text }]}>MoneyForge</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: '600',
  },
});
