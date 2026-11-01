import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';

import { leaveScreen } from '@/shared/ui/leave-screen';
import {
  Button,
  ChoiceChips,
  EmptyState,
  ErrorBanner,
  ListRow,
  Muted,
  QueryBoundary,
  Screen,
  SectionLabel,
  TextField,
} from '@/shared/ui/primitives';
import { useFocusQuery } from '@/shared/ui/use-focus-query';
import { useSubmit } from '@/shared/ui/use-submit';

import type { SourceInput } from '../application/rule-use-cases';
import type { MessageChannel } from '../domain/message';
import type { Rule } from '../domain/rule';
import type { MessageSource } from '../domain/source';
import { useRules } from './rules-context';
import { KIND_LABELS } from './rules-model';

const CHANNELS: readonly { value: MessageChannel; label: string }[] = [
  { value: 'sms', label: 'SMS and paste' },
  { value: 'paste', label: 'Paste only' },
];

const STATES = [
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
] as const;

function SourceForm({
  source,
  rules,
  error,
  submitting,
  onSubmit,
  onOpenRule,
  onAddRule,
}: {
  source: MessageSource | null;
  rules: readonly Rule[];
  error: string | null;
  submitting: boolean;
  onSubmit: (input: SourceInput) => void;
  onOpenRule: (id: string) => void;
  onAddRule: () => void;
}) {
  const [name, setName] = useState(source?.name ?? '');
  const [sender, setSender] = useState(source?.sender ?? '');
  const [channel, setChannel] = useState<MessageChannel>(source?.channel ?? 'sms');
  const [enabled, setEnabled] = useState(source?.enabled ?? true);

  return (
    <Screen>
      <TextField label="Name" value={name} onChangeText={setName} />
      <TextField
        label="Sender"
        value={sender}
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setSender}
      />
      <Muted>The sender must match exactly. Case, spaces, and dashes do not count.</Muted>
      <ChoiceChips label="Accept" options={CHANNELS} value={channel} onChange={setChannel} />
      <ChoiceChips
        label="State"
        options={STATES}
        value={enabled ? 'on' : 'off'}
        onChange={(state) => setEnabled(state === 'on')}
      />
      <ErrorBanner message={error} />
      <Button
        label="Save"
        disabled={submitting}
        onPress={() => onSubmit({ name, sender, channel, enabled })}
      />
      {source ? (
        <>
          <SectionLabel>Rules</SectionLabel>
          {rules.length === 0 ? (
            <EmptyState title="No rules yet" hint="Messages stay unmatched until a rule fits." />
          ) : null}
          {rules.map((rule) => (
            <ListRow
              key={rule.id}
              title={rule.name}
              subtitle={`${KIND_LABELS[rule.kind]} · Priority ${rule.priority}`}
              trailing={rule.autoPost ? 'Auto' : undefined}
              onPress={() => onOpenRule(rule.id)}
            />
          ))}
          <Button label="Add rule" variant="secondary" onPress={onAddRule} />
        </>
      ) : null}
    </Screen>
  );
}

export function SourceEditorScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const rules = useRules();
  const router = useRouter();
  const load = useCallback(async () => {
    if (!id) return { source: null, sourceRules: [] };
    const [source, sourceRules] = await Promise.all([rules.getSource(id), rules.listRules(id)]);
    return { source, sourceRules };
  }, [id, rules]);
  const { state, reload } = useFocusQuery(load);
  const save = useSubmit(
    (input: SourceInput) =>
      id ? rules.updateSource({ ...input, id }) : rules.createSource(input),
    () => leaveScreen(router),
    { exitsOnSuccess: true },
  );

  return (
    <QueryBoundary state={state} onRetry={reload}>
      {({ source, sourceRules }) => {
        if (id && !source) {
          return (
            <Screen>
              <EmptyState title="Source not found" />
            </Screen>
          );
        }
        return (
          <SourceForm
            source={source}
            rules={sourceRules}
            error={save.error}
            submitting={save.submitting}
            onSubmit={(input) => void save.submit(input)}
            onOpenRule={(ruleId) =>
              router.push({ pathname: '/rules/[id]', params: { id: ruleId } })
            }
            onAddRule={() =>
              router.push({ pathname: '/rules/new', params: { sourceId: source?.id ?? '' } })
            }
          />
        );
      }}
    </QueryBoundary>
  );
}
