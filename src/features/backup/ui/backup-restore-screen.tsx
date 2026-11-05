import { useState } from 'react';
import { Alert } from 'react-native';

import {
  Button,
  ErrorBanner,
  Muted,
  Notice,
  Screen,
  SectionLabel,
  TextField,
} from '@/shared/ui/primitives';
import { useSubmit } from '@/shared/ui/use-submit';

import { RESTORE_CONFIRMATION, type PreparedRestore } from '../application/backup-service';
import { useBackup } from './backup-context';
import {
  canCheckRestore,
  confirmedRestore,
  editRestoreInputs,
  initialRestoreState,
  restoreLines,
  settleRestoreCheck,
  typeRestoreConfirmation,
  type RestoreDraft,
  type RestoreScreenState,
} from './backup-model';

type CheckInput = Pick<RestoreDraft, 'text' | 'passphrase'> & {
  /** The input revision the check started from; a later edit makes its result stale. */
  readonly revision: number;
};

function askToReplace(onReplace: () => void) {
  Alert.alert('Replace everything?', 'This device will hold only what the backup holds.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Replace', style: 'destructive', onPress: onReplace },
  ]);
}

export function BackupRestoreScreen() {
  const { backup, reopen } = useBackup();
  // Updates go through the model as functions of the latest state, so a check that
  // settles late sees every edit made while it ran.
  const [state, setState] = useState<RestoreScreenState>(initialRestoreState);
  const { draft, prepared } = state;
  const confirmed = confirmedRestore(state);

  const edit = (patch: Partial<Pick<RestoreDraft, 'text' | 'passphrase'>>) =>
    setState((current) => editRestoreInputs(current, patch));

  const check = useSubmit(
    async ({ text, passphrase, revision }: CheckInput) => {
      let opened: PreparedRestore | null = null;
      try {
        const result = await backup.prepareRestore({ text: text.trim(), passphrase });
        if (result.ok) opened = result.value;
        return result;
      } finally {
        setState((current) => settleRestoreCheck(current, revision, opened));
      }
    },
    // The model already stored the result, or dropped it as stale.
    () => undefined,
  );
  const replace = useSubmit(
    ({ checked, typed }: { checked: PreparedRestore; typed: string }) =>
      backup.applyRestore(checked, typed),
    // Services open again from the restored database, as on a fresh launch.
    reopen,
    { exitsOnSuccess: true },
  );

  return (
    <Screen>
      <Muted>
        Paste a backup made by MoneyForge. Nothing is replaced until you check it, type{' '}
        {RESTORE_CONFIRMATION}, and confirm.
      </Muted>
      <TextField
        label="Backup text"
        multiline
        value={draft.text}
        onChangeText={(text) => edit({ text })}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <TextField
        label="Passphrase"
        value={draft.passphrase}
        onChangeText={(passphrase) => edit({ passphrase })}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
      />
      <ErrorBanner message={check.error ?? replace.error} />
      <Button
        label="Check backup"
        variant={prepared ? 'secondary' : 'primary'}
        disabled={check.submitting || !canCheckRestore(draft)}
        onPress={() =>
          void check.submit({
            text: draft.text,
            passphrase: draft.passphrase,
            revision: state.revision,
          })
        }
      />
      {prepared ? (
        <>
          <SectionLabel>This backup</SectionLabel>
          {restoreLines(prepared.summary).map((line) => (
            <Notice key={line}>{line}</Notice>
          ))}
          <TextField
            label={`Type ${RESTORE_CONFIRMATION} to confirm`}
            value={draft.typed}
            onChangeText={(typed) =>
              setState((current) => typeRestoreConfirmation(current, typed))
            }
            autoCapitalize="characters"
            autoCorrect={false}
          />
          <Button
            label="Replace everything"
            disabled={replace.submitting || !confirmed}
            onPress={() => {
              if (confirmed) askToReplace(() => void replace.submit(confirmed));
            }}
          />
        </>
      ) : null}
    </Screen>
  );
}
