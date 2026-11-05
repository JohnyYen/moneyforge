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
  emptyRestoreDraft,
  isConfirmed,
  restoreLines,
  type RestoreDraft,
} from './backup-model';

function askToReplace(onReplace: () => void) {
  Alert.alert('Replace everything?', 'This device will hold only what the backup holds.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Replace', style: 'destructive', onPress: onReplace },
  ]);
}

export function BackupRestoreScreen() {
  const { backup, reopen } = useBackup();
  const [draft, setDraft] = useState<RestoreDraft>(emptyRestoreDraft);
  /** Holds the opened snapshot, never the passphrase that opened it. */
  const [prepared, setPrepared] = useState<PreparedRestore | null>(null);

  /** Any change leaves the check behind, so what is replaced is always what was shown. */
  const change = (patch: Partial<RestoreDraft>) => {
    setDraft({ ...draft, ...patch });
    setPrepared(null);
  };

  const check = useSubmit(
    async ({ text, passphrase }: RestoreDraft) => {
      const opened = await backup.prepareRestore({ text: text.trim(), passphrase });
      // Once checked, the passphrase has done its work and leaves the screen.
      setDraft((current) => ({ ...current, passphrase: '', typed: '' }));
      return opened;
    },
    setPrepared,
  );
  const replace = useSubmit(
    ({ checked, typed }: { checked: PreparedRestore; typed: string }) =>
      backup.applyRestore(checked, typed.trim()),
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
        onChangeText={(text) => change({ text })}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <TextField
        label="Passphrase"
        value={draft.passphrase}
        onChangeText={(passphrase) => change({ passphrase })}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
      />
      <ErrorBanner message={check.error ?? replace.error} />
      <Button
        label="Check backup"
        variant={prepared ? 'secondary' : 'primary'}
        disabled={check.submitting || !canCheckRestore(draft)}
        onPress={() => void check.submit(draft)}
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
            onChangeText={(typed) => setDraft({ ...draft, typed })}
            autoCapitalize="characters"
            autoCorrect={false}
          />
          <Button
            label="Replace everything"
            disabled={replace.submitting || !isConfirmed(draft.typed)}
            onPress={() =>
              askToReplace(() => void replace.submit({ checked: prepared, typed: draft.typed }))
            }
          />
        </>
      ) : null}
    </Screen>
  );
}
