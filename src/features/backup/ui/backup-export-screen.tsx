import { useState } from 'react';

import { Button, ErrorBanner, Muted, Notice, Screen, TextField } from '@/shared/ui/primitives';
import { useSubmit } from '@/shared/ui/use-submit';

import { useBackup } from './backup-context';
import { canExport, emptyExportDraft, type ExportDraft } from './backup-model';

export function BackupExportScreen() {
  const { backup } = useBackup();
  const [draft, setDraft] = useState<ExportDraft>(emptyExportDraft);
  const [notice, setNotice] = useState<string | null>(null);
  const share = useSubmit(
    async (current: ExportDraft) => {
      const exported = await backup.exportBackup(current);
      // The passphrase leaves the screen either way; a retry types it again.
      setDraft(emptyExportDraft);
      return exported;
    },
    () =>
      setNotice('Backup prepared. Keep the passphrase safe: without it, nobody can open the file.'),
  );

  const change = (patch: Partial<ExportDraft>) => {
    setDraft({ ...draft, ...patch });
    setNotice(null);
  };

  return (
    <Screen>
      <Muted>
        A backup holds your whole ledger, encrypted with a passphrase you choose. It is shared as
        text, so save it somewhere only you can reach. Message text from SMS is never included.
      </Muted>
      <TextField
        label="Passphrase, at least 12 characters"
        value={draft.passphrase}
        onChangeText={(passphrase) => change({ passphrase })}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
      />
      <TextField
        label="Passphrase again"
        value={draft.confirmation}
        onChangeText={(confirmation) => change({ confirmation })}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
      />
      {notice ? <Notice>{notice}</Notice> : null}
      <ErrorBanner message={share.error} />
      <Button
        label="Share backup"
        disabled={share.submitting || !canExport(draft)}
        onPress={() => void share.submit(draft)}
      />
    </Screen>
  );
}
