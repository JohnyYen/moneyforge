import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { Account } from '@/features/ledger/domain/account';
import type { Category } from '@/features/ledger/domain/category';
import type { Currency } from '@/features/ledger/domain/currency';
import type { SplitStructure } from '@/features/split/domain/split-structure';
import {
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

import { isTransferKind } from '../domain/rule';
import {
  formatKey,
  KIND_OPTIONS,
  NUMBER_FORMATS,
  sampleResults,
  SPLIT_OPTIONS,
  templateProblem,
  type RuleDraft,
  type SampleResult,
} from './rules-model';

const AUTO_POST_OPTIONS = [
  { value: 'review', label: 'Review first' },
  { value: 'post', label: 'Post at once' },
] as const;

const NONE = '';

const accountOptions = (accounts: readonly Account[]) =>
  accounts.map(({ id, name, currencyCode }) => ({
    value: id,
    label: `${name} (${currencyCode})`,
  }));

function SampleResultCard({ result }: { result: SampleResult }) {
  const colors = useColors();
  return (
    <View style={[styles.card, { borderColor: colors.border }]}>
      <Text style={{ color: result.matched ? colors.positive : colors.negative }}>
        {result.matched ? 'Matches' : 'Does not match'}
      </Text>
      {result.lines.map((line) => (
        <Muted key={line}>{line}</Muted>
      ))}
    </View>
  );
}

export function RuleForm({
  initial,
  accounts,
  categories,
  currencies,
  structures,
  error,
  submitting,
  onSubmit,
  onDelete,
}: {
  initial: RuleDraft;
  accounts: readonly Account[];
  categories: readonly Category[];
  currencies: readonly Currency[];
  structures: readonly SplitStructure[];
  error: string | null;
  submitting: boolean;
  onSubmit: (draft: RuleDraft) => void;
  onDelete?: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const update = (change: Partial<RuleDraft>) => setDraft((current) => ({ ...current, ...change }));

  const results = useMemo(
    () => sampleResults(draft, { accounts, currencies }),
    [accounts, currencies, draft],
  );

  if (accounts.length === 0) {
    return (
      <Screen>
        <EmptyState title="No accounts yet" hint="Add an account before writing a rule." />
      </Screen>
    );
  }

  const transfer = isTransferKind(draft.kind);
  const categoryOptions = categories
    .filter(({ kind, archived, id }) => kind === draft.kind && (!archived || id === draft.categoryId))
    .map(({ id, name }) => ({ value: id, label: name }));

  return (
    <Screen>
      <TextField
        label="Name"
        value={draft.name}
        onChangeText={(name) => update({ name })}
      />
      <TextField
        label="Template"
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        value={draft.template}
        onChangeText={(template) => update({ template })}
      />
      <Muted>
        Copy the message and replace what changes with {'{amount}'}, {'{currency}'},{' '}
        {'{reference}'}, {'{counterparty}'}, {'{balance}'}, or {'{*}'} for anything else.
      </Muted>
      <ErrorBanner message={templateProblem(draft.template)} />
      <ChoiceChips
        label="Number format"
        options={NUMBER_FORMATS.map(({ label, format }) => ({
          value: formatKey(format),
          label,
        }))}
        value={formatKey(draft.format)}
        onChange={(key) => {
          const chosen = NUMBER_FORMATS.find(({ format }) => formatKey(format) === key);
          if (chosen) update({ format: chosen.format });
        }}
      />
      <SectionLabel>Test</SectionLabel>
      {draft.samples.map((sample, index) => (
        <TextField
          key={index}
          label={`Sample ${index + 1}`}
          multiline
          value={sample}
          onChangeText={(text) =>
            update({
              samples: draft.samples.map((value, position) =>
                position === index ? text : value,
              ),
            })
          }
        />
      ))}
      <Button
        label="Add sample"
        variant="secondary"
        onPress={() => update({ samples: [...draft.samples, ''] })}
      />
      {results.map((result, index) => (
        <SampleResultCard key={index} result={result} />
      ))}
      <SectionLabel>What it means</SectionLabel>
      <ChoiceChips
        label="Type"
        options={KIND_OPTIONS}
        value={draft.kind}
        onChange={(kind) => update({ kind, categoryId: null })}
      />
      <ChoiceChips
        label={transfer ? 'Account in this message' : 'Account'}
        options={accountOptions(accounts)}
        value={draft.accountId}
        onChange={(accountId) => update({ accountId })}
      />
      {transfer ? (
        <ChoiceChips
          label="Other account"
          options={accountOptions(accounts)}
          value={draft.counterpartAccountId}
          onChange={(counterpartAccountId) => update({ counterpartAccountId })}
        />
      ) : (
        <ChoiceChips
          label="Category"
          options={[{ value: NONE, label: 'None' }, ...categoryOptions]}
          value={draft.categoryId ?? NONE}
          onChange={(categoryId) => update({ categoryId: categoryId || null })}
        />
      )}
      <ChoiceChips
        label="Currency when the message has none"
        options={[
          { value: NONE, label: 'Account currency' },
          ...currencies.map(({ code }) => ({ value: code, label: code })),
        ]}
        value={draft.currencyCode ?? NONE}
        onChange={(currencyCode) => update({ currencyCode: currencyCode || null })}
      />
      <TextField
        label="Priority"
        keyboardType="numbers-and-punctuation"
        value={draft.priority}
        onChangeText={(priority) => update({ priority })}
      />
      <Muted>When several rules fit a message, the highest priority wins.</Muted>
      <ChoiceChips
        label="When it matches"
        options={AUTO_POST_OPTIONS}
        value={draft.autoPost ? 'post' : 'review'}
        onChange={(choice) => update({ autoPost: choice === 'post' })}
      />
      {draft.kind === 'income' ? (
        <>
          <ChoiceChips
            label="Split"
            options={SPLIT_OPTIONS}
            value={draft.splitMode}
            onChange={(splitMode) => update({ splitMode })}
          />
          {draft.splitMode === 'auto' ? (
            <ChoiceChips
              label="Structure"
              options={structures.map(({ id, name }) => ({ value: id, label: name }))}
              value={draft.splitStructureId}
              onChange={(splitStructureId) => update({ splitStructureId })}
            />
          ) : null}
        </>
      ) : null}
      <ErrorBanner message={error} />
      <Button
        label="Save"
        disabled={submitting || !draft.accountId}
        onPress={() => onSubmit(draft)}
      />
      {onDelete ? (
        <Button
          label="Delete rule"
          variant="secondary"
          disabled={submitting}
          onPress={onDelete}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 10, padding: 12, gap: 4 },
});
