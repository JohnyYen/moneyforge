import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useColors } from '@/shared/ui/primitives';

import { barFraction } from './plan-model';

export function ProgressBar({ fraction, alert }: { fraction: number; alert: boolean }) {
  const colors = useColors();
  return (
    <View style={[styles.track, { backgroundColor: colors.backgroundElement }]}>
      <View
        style={[
          styles.fill,
          {
            width: `${Math.round(fraction * 100)}%`,
            backgroundColor: alert ? colors.negative : colors.accent,
          },
        ]}
      />
    </View>
  );
}

/** One column per value, measured from the largest. Negative values turn the alert color. */
export function BalanceBars({ values }: { values: readonly bigint[] }) {
  const colors = useColors();
  const largest = values.reduce<bigint>(
    (current, value) => {
      const size = value < 0n ? -value : value;
      return size > current ? size : current;
    },
    0n,
  );
  return (
    <View style={styles.chart}>
      {values.map((value, index) => (
        <View
          key={index}
          style={[
            styles.column,
            {
              height: `${Math.max(2, Math.round(barFraction(value, largest) * 100))}%`,
              backgroundColor: value < 0n ? colors.negative : colors.accent,
            },
          ]}
        />
      ))}
    </View>
  );
}

/** Any number of options can be on. `ChoiceChips` picks exactly one. */
export function ToggleChips({
  label,
  options,
  values,
  onToggle,
}: {
  label: string;
  options: readonly { value: string; label: string }[];
  values: readonly string[];
  onToggle: (value: string) => void;
}) {
  const colors = useColors();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.textMuted }]}>{label}</Text>
      <View style={styles.chips}>
        {options.map((option) => {
          const checked = values.includes(option.value);
          return (
            <Pressable
              key={option.value}
              accessibilityRole="checkbox"
              accessibilityState={{ checked }}
              onPress={() => onToggle(option.value)}
              style={[
                styles.chip,
                { backgroundColor: checked ? colors.accent : colors.backgroundElement },
              ]}>
              <Text style={{ color: checked ? colors.onAccent : colors.text }}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: '100%' },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 96 },
  column: { flex: 1, borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  field: { gap: 6 },
  label: { fontSize: 13 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 },
});
