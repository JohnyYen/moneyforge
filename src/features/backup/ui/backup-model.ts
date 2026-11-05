import { RESTORE_CONFIRMATION, type RestoreSummary } from '../application/backup-service';

/** Held only in screen state, and cleared once a submit has used it. */
export type ExportDraft = {
  readonly passphrase: string;
  readonly confirmation: string;
};

export const emptyExportDraft: ExportDraft = { passphrase: '', confirmation: '' };

export type RestoreDraft = {
  readonly text: string;
  readonly passphrase: string;
  readonly typed: string;
};

export const emptyRestoreDraft: RestoreDraft = { text: '', passphrase: '', typed: '' };

/** Strength and matching are the service's to judge, so its message is the one shown. */
export function canExport({ passphrase, confirmation }: ExportDraft): boolean {
  return passphrase !== '' && confirmation !== '';
}

export function canCheckRestore({ text, passphrase }: RestoreDraft): boolean {
  return text.trim() !== '' && passphrase !== '';
}

/** A keyboard may add a trailing space; the word itself must still be typed exactly. */
export function isConfirmed(typed: string): boolean {
  return typed.trim() === RESTORE_CONFIRMATION;
}

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

function madeOn(createdAt: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(createdAt);
  return match ? `${match[1]} ${match[2]} UTC` : createdAt;
}

/** What a checked backup will put in place, shown before anything is replaced. */
export function restoreLines(summary: RestoreSummary): string[] {
  return [
    `Made on ${madeOn(summary.createdAt)}.`,
    `${plural(summary.accounts, 'account', 'accounts')} and ` +
      `${plural(summary.transactions, 'transaction', 'transactions')}.`,
    ...(summary.upgrades
      ? ['It comes from an older version of the app and will be upgraded as it is restored.']
      : []),
    'Everything on this device will be replaced by this backup.',
  ];
}
