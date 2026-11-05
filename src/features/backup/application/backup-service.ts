import type { Clock } from '@/features/ledger/application/ports';
import type { MessageCapture } from '@/features/rules/application/message-capture';
import { err, ok, type Result } from '@/shared/result';

import { parseContainer } from '../domain/backup-container';
import { schemaAt } from '../domain/backup-tables';
import {
  checkAgainstSchema,
  checkPassphrase,
  validateSnapshot,
  type BackupSnapshot,
} from '../domain/backup-snapshot';
import { openContainer, sealSnapshot } from './backup-codec';
import type { BackupCipher, BackupTransport } from './ports';
import type { BackupStore } from '../infrastructure/sqlite-backup-store';

/** Typed by the person restoring, so a tap cannot do what a decision should. */
export const RESTORE_CONFIRMATION = 'REPLACE';

export type BackupErrorCode =
  | 'weak-passphrase'
  | 'passphrase-mismatch'
  | 'export-failed'
  | 'too-large'
  | 'confirmation-required'
  | 'restore-failed'
  | 'not-a-backup'
  | 'newer-format'
  | 'newer-schema'
  | 'damaged'
  | 'cannot-open'
  | 'invalid-contents'
  | 'unbalanced';

export type BackupError = {
  readonly code: BackupErrorCode;
  readonly message: string;
};

export type RestoreSummary = {
  readonly createdAt: string;
  readonly schemaVersion: number;
  readonly upgrades: boolean;
  readonly accounts: number;
  readonly transactions: number;
};

/** Everything a confirmed restore needs, and never the passphrase that opened it. */
export type PreparedRestore = {
  readonly snapshot: BackupSnapshot;
  readonly summary: RestoreSummary;
};

export type BackupService = ReturnType<typeof createBackupService>;

const exportFailed = () =>
  err<BackupError>({
    code: 'export-failed',
    message: 'This backup could not be written on this device.',
  });

const restoreFailed = () =>
  err<BackupError>({
    code: 'restore-failed',
    message: 'This backup could not be written to the ledger, so nothing was changed.',
  });

/** Used only when the platform has no cipher wired, which is never a build we ship. */
const absentCipher: BackupCipher = {
  deriveKey: () => Promise.reject(new Error('no backup cipher')),
  seal: () => Promise.reject(new Error('no backup cipher')),
  open: () => Promise.reject(new Error('no backup cipher')),
  randomBytes: () => Promise.reject(new Error('no backup cipher')),
};

export function createBackupService({
  store,
  cipher = absentCipher,
  transport,
  clock,
  capture,
}: {
  readonly store: BackupStore;
  readonly cipher?: BackupCipher;
  readonly transport?: BackupTransport;
  readonly clock: Clock;
  readonly capture: Pick<MessageCapture, 'syncSenders'>;
}) {
  async function exportBackup({
    passphrase,
    confirmation,
  }: {
    readonly passphrase: string;
    readonly confirmation: string;
  }): Promise<Result<void, BackupError>> {
    const checked = checkPassphrase(passphrase, confirmation);
    if (!checked.ok) return err(checked.error);

    // Other features hide behind a share sheet too, so this device may simply have none.
    if (!transport) return exportFailed();

    try {
      const schemaVersion = await store.version();
      const snapshot: BackupSnapshot = {
        schemaVersion,
        createdAt: clock.now().toISOString(),
        tables: await store.read(schemaVersion),
      };
      const valid = validateSnapshot(snapshot, schemaVersion);
      if (!valid.ok) return err(valid.error);

      const text = await sealSnapshot(snapshot, passphrase, cipher);

      // Read back before sharing: a file that cannot open here cannot open anywhere.
      const parsed = parseContainer(text, schemaVersion);
      if (!parsed.ok) return exportFailed();
      const reopened = await openContainer(parsed.value, passphrase, cipher);
      if (!reopened.ok) return exportFailed();

      if (text.length > transport.maxChars) {
        return err({
          code: 'too-large',
          message:
            `This backup is ${text.length} characters, past the ` +
            `${transport.maxChars} this device can share in one piece.`,
        });
      }

      const sent = await transport.send(text);
      return sent.ok ? ok(undefined) : exportFailed();
    } catch {
      return exportFailed();
    }
  }

  async function prepareRestore({
    text,
    passphrase,
  }: {
    readonly text: string;
    readonly passphrase: string;
  }): Promise<Result<PreparedRestore, BackupError>> {
    const current = await store.version();

    // Refused by name before the passphrase costs anything, so a newer file says why.
    const parsed = parseContainer(text, current);
    if (!parsed.ok) return err(parsed.error);

    const opened = await openContainer(parsed.value, passphrase, cipher);
    if (!opened.ok) return err(opened.error);

    const snapshot = opened.value;
    const fitted = checkAgainstSchema(snapshot, schemaAt(snapshot.schemaVersion));
    if (!fitted.ok) return err(fitted.error);

    const count = (name: string) => snapshot.tables.find((table) => table.name === name)?.rows.length ?? 0;
    return ok({
      snapshot,
      summary: {
        createdAt: snapshot.createdAt,
        schemaVersion: snapshot.schemaVersion,
        upgrades: snapshot.schemaVersion < current,
        accounts: count('accounts'),
        transactions: count('transactions'),
      },
    });
  }

  async function applyRestore(
    prepared: PreparedRestore,
    typed: string,
  ): Promise<Result<void, BackupError>> {
    if (typed !== RESTORE_CONFIRMATION) {
      return err({
        code: 'confirmation-required',
        message: `Type ${RESTORE_CONFIRMATION} to confirm that everything will be replaced.`,
      });
    }

    try {
      await store.replaceAll(prepared.snapshot);
    } catch {
      return restoreFailed();
    }

    // Capture must not keep an allowlist that no longer exists, and a failure here is retried.
    await capture.syncSenders().catch(() => undefined);
    return ok(undefined);
  }

  return { exportBackup, prepareRestore, applyRestore };
}
