import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { Account } from '@/features/ledger/domain/account';
import {
  AmountField,
  Button,
  ChoiceChips,
  EmptyState,
  ErrorBanner,
  Muted,
  Screen,
  SectionLabel,
  TextField,
  useColors,
} from '@/shared/ui/primitives';

import {
  addDraftLine,
  draftTotal,
  removeDraftLine,
  toggleRemainder,
  updateDraftLine,
  type DraftLine,
  type StructureDraft,
} from './structure-draft';

function LineCard({
  line,
  accounts,
  canRemove,
  onChange,
  onToggleRemainder,
  onRemove,
}: {
  line: DraftLine;
  accounts: readonly Account[];
  canRemove: boolean;
  onChange: (change: Partial<Omit<DraftLine, 'key'>>) => void;
  onToggleRemainder: () => void;
  onRemove: () => void;
}) {
  const colors = useColors();
  return (
    <View style={[styles.card, { borderColor: colors.border }]}>
      <TextField
        label="Label"
        value={line.label}
        onChangeText={(label) => onChange({ label })}
      />
      <ChoiceChips
        label="Target account"
        options={accounts.map((account) => ({
          value: account.id,
          label: `${account.name} (${account.currencyCode})`,
        }))}
        value={line.targetAccountId}
        onChange={(targetAccountId) => onChange({ targetAccountId })}
      />
      {line.isRemainder ? (
        <Muted>This line takes whatever the others leave.</Muted>
      ) : (
        <AmountField
          label="Percentage"
          value={line.percentage}
          onChangeText={(percentage) => onChange({ percentage })}
        />
      )}
      <Button
        label={line.isRemainder ? 'Use a percentage' : 'Make this the remainder'}
        variant="secondary"
        onPress={onToggleRemainder}
      />
      {canRemove ? <Button label="Remove line" variant="secondary" onPress={onRemove} /> : null}
    </View>
  );
}

export function StructureForm({
  initial,
  accounts,
  error,
  submitting,
  onSubmit,
  archiveLabel,
  onArchive,
}: {
  initial: StructureDraft;
  accounts: readonly Account[];
  error: string | null;
  submitting: boolean;
  onSubmit: (draft: StructureDraft) => void;
  archiveLabel?: string;
  onArchive?: () => void;
}) {
  const [draft, setDraft] = useState(initial);

  if (accounts.length === 0) {
    return (
      <Screen>
        <EmptyState title="No accounts yet" hint="Add an account before building a split." />
      </Screen>
    );
  }

  return (
    <Screen>
      <TextField
        label="Name"
        value={draft.name}
        onChangeText={(name) => setDraft((current) => ({ ...current, name }))}
      />
      <SectionLabel>Lines</SectionLabel>
      {draft.lines.map((line) => (
        <LineCard
          key={line.key}
          line={line}
          accounts={accounts}
          canRemove={draft.lines.length > 1}
          onChange={(change) => setDraft((current) => updateDraftLine(current, line.key, change))}
          onToggleRemainder={() => setDraft((current) => toggleRemainder(current, line.key))}
          onRemove={() => setDraft((current) => removeDraftLine(current, line.key))}
        />
      ))}
      <Button
        label="Add line"
        variant="secondary"
        onPress={() => setDraft((current) => addDraftLine(current))}
      />
      <Muted>{draftTotal(draft)}</Muted>
      <ErrorBanner message={error} />
      <Button label="Save" disabled={submitting} onPress={() => onSubmit(draft)} />
      {onArchive && archiveLabel ? (
        <Button
          label={archiveLabel}
          variant="secondary"
          disabled={submitting}
          onPress={onArchive}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 10, padding: 12, gap: 12 },
});
