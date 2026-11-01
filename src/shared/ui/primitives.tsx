import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
  type TextInputProps,
} from 'react-native';

import { colorsFor } from './theme';
import type { QueryState } from './use-focus-query';

export function useColors() {
  return colorsFor(useColorScheme());
}

export function Screen({ children }: { children: ReactNode }) {
  const colors = useColors();
  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.screen}
      keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
}

export function Title({ children }: { children: ReactNode }) {
  const colors = useColors();
  return <Text style={[styles.title, { color: colors.text }]}>{children}</Text>;
}

export function SectionLabel({ children }: { children: ReactNode }) {
  const colors = useColors();
  return <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>{children}</Text>;
}

export function Muted({ children }: { children: ReactNode }) {
  const colors = useColors();
  return <Text style={{ color: colors.textMuted }}>{children}</Text>;
}

export function Button({
  label,
  onPress,
  disabled = false,
  variant = 'primary',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
}) {
  const colors = useColors();
  const primary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        { backgroundColor: primary ? colors.accent : colors.backgroundElement },
        disabled && styles.disabled,
      ]}>
      <Text style={[styles.buttonLabel, { color: primary ? colors.onAccent : colors.text }]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function TextField({
  label,
  ...input
}: TextInputProps & { label: string }) {
  const colors = useColors();
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.textMuted}
        {...input}
        style={[
          styles.input,
          { color: colors.text, borderColor: colors.border, backgroundColor: colors.background },
        ]}
      />
    </View>
  );
}

/**
 * A decimal field. Some Android keyboards only offer a comma, so it maps to the point.
 * That makes `1,500` read as 1.5, so `preview` shows what the text will be stored as.
 */
export function AmountField({
  onChangeText,
  preview,
  ...field
}: Omit<TextInputProps, 'onChangeText'> & {
  label: string;
  onChangeText: (text: string) => void;
  preview?: string | null;
}) {
  return (
    <View style={styles.field}>
      <TextField
        keyboardType="numeric"
        autoCorrect={false}
        {...field}
        onChangeText={(text) => onChangeText(text.replace(/,/g, '.'))}
      />
      {preview ? <Muted>{preview}</Muted> : null}
    </View>
  );
}

export function ChoiceChips<Value extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label?: string;
  options: readonly { value: Value; label: string }[];
  value: Value | null;
  onChange: (value: Value) => void;
}) {
  const colors = useColors();
  return (
    <View style={styles.field}>
      {label ? <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>{label}</Text> : null}
      <View style={styles.chips}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => onChange(option.value)}
              style={[
                styles.chip,
                { backgroundColor: selected ? colors.accent : colors.backgroundElement },
              ]}>
              <Text style={{ color: selected ? colors.onAccent : colors.text }}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function ListRow({
  title,
  subtitle,
  trailing,
  trailingColor,
  onPress,
}: {
  title: string;
  subtitle?: string;
  trailing?: string;
  trailingColor?: string;
  onPress?: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={[styles.row, { borderBottomColor: colors.border }]}>
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, { color: colors.text }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={{ color: colors.textMuted }} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing ? (
        <Text style={[styles.rowTrailing, { color: trailingColor ?? colors.text }]}>
          {trailing}
        </Text>
      ) : null}
    </Pressable>
  );
}

export function ErrorBanner({ message }: { message: string | null }) {
  const colors = useColors();
  if (!message) return null;
  return (
    <Text accessibilityRole="alert" style={[styles.error, { color: colors.negative }]}>
      {message}
    </Text>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  const colors = useColors();
  return (
    <View style={[styles.notice, { backgroundColor: colors.warningBackground }]}>
      <Text style={{ color: colors.warningText }}>{children}</Text>
    </View>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  const colors = useColors();
  return (
    <View style={styles.empty}>
      <Text style={[styles.rowTitle, { color: colors.text }]}>{title}</Text>
      {hint ? <Text style={[styles.emptyHint, { color: colors.textMuted }]}>{hint}</Text> : null}
    </View>
  );
}

export function LoadingState() {
  const colors = useColors();
  return (
    <View style={[styles.centered, { backgroundColor: colors.background }]}>
      <ActivityIndicator color={colors.accent} accessibilityLabel="Loading" />
    </View>
  );
}

export function FailureState({ message, onRetry }: { message: string; onRetry: () => void }) {
  const colors = useColors();
  return (
    <View style={[styles.centered, { backgroundColor: colors.background }]}>
      <ErrorBanner message={message} />
      <Button label="Try again" variant="secondary" onPress={onRetry} />
    </View>
  );
}

/** Renders the loading and failure states of a query, and `children` once data is ready. */
export function QueryBoundary<T>({
  state,
  onRetry,
  children,
}: {
  state: QueryState<T>;
  onRetry: () => void;
  children: (data: T) => ReactNode;
}) {
  if (state.status === 'loading') return <LoadingState />;
  if (state.status === 'error') return <FailureState message={state.message} onRetry={onRetry} />;
  return <>{children(state.data)}</>;
}

const styles = StyleSheet.create({
  screen: { padding: 16, gap: 12, paddingBottom: 32 },
  title: { fontSize: 24, fontWeight: '600' },
  sectionLabel: { fontSize: 13, fontWeight: '600', marginTop: 8 },
  button: { borderRadius: 10, paddingVertical: 14, paddingHorizontal: 16, alignItems: 'center' },
  buttonLabel: { fontSize: 16, fontWeight: '600' },
  disabled: { opacity: 0.5 },
  field: { gap: 6 },
  fieldLabel: { fontSize: 13 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 16, fontWeight: '500' },
  rowTrailing: { fontSize: 16, flexShrink: 1, textAlign: 'right' },
  error: { fontSize: 14 },
  notice: { borderRadius: 10, padding: 12 },
  empty: { alignItems: 'center', gap: 6, paddingVertical: 32 },
  emptyHint: { textAlign: 'center' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 16 },
});
