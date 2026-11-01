import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';

import { leaveScreen } from '@/shared/ui/leave-screen';
import {
  Button,
  ErrorBanner,
  Muted,
  QueryBoundary,
  Screen,
  TextField,
} from '@/shared/ui/primitives';
import { useFocusQuery } from '@/shared/ui/use-focus-query';
import { useSubmit } from '@/shared/ui/use-submit';

import { useRules } from './rules-context';
import { settingsDraftFor, toSettings, type SettingsDraft } from './rules-model';

function SettingsForm({
  initial,
  error,
  submitting,
  onSubmit,
}: {
  initial: SettingsDraft;
  error: string | null;
  submitting: boolean;
  onSubmit: (draft: SettingsDraft) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const field = (label: string, key: keyof SettingsDraft, hint: string) => (
    <>
      <TextField
        label={label}
        keyboardType="number-pad"
        value={draft[key]}
        onChangeText={(text) => setDraft((current) => ({ ...current, [key]: text }))}
      />
      <Muted>{hint}</Muted>
    </>
  );

  return (
    <Screen>
      {field(
        'Keep unresolved messages (days)',
        'retentionDays',
        'Older messages with no rule are deleted, and older pending items lose their text. Handled messages lose their text at once.',
      )}
      {field(
        'Duplicate window (minutes)',
        'dedupWindowMinutes',
        'A message with no reference is always held for review if its text arrived before. Within this time it is called a likely copy.',
      )}
      {field(
        'Transfer window (hours)',
        'transferWindowHours',
        'How long one side of a transfer waits for the other before asking you.',
      )}
      <ErrorBanner message={error} />
      <Button label="Save" disabled={submitting} onPress={() => onSubmit(draft)} />
    </Screen>
  );
}

export function MessageSettingsScreen() {
  const rules = useRules();
  const router = useRouter();
  const load = useCallback(() => rules.getMessageSettings(), [rules]);
  const { state, reload } = useFocusQuery(load);
  const save = useSubmit(
    (draft: SettingsDraft) => rules.updateMessageSettings(toSettings(draft)),
    () => leaveScreen(router),
    { exitsOnSuccess: true },
  );

  return (
    <QueryBoundary state={state} onRetry={reload}>
      {(settings) => (
        <SettingsForm
          initial={settingsDraftFor(settings)}
          error={save.error}
          submitting={save.submitting}
          onSubmit={(draft) => void save.submit(draft)}
        />
      )}
    </QueryBoundary>
  );
}
