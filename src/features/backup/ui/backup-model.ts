import {
  RESTORE_CONFIRMATION,
  type PreparedRestore,
  type RestoreSummary,
} from '../application/backup-service';

/** Held only in screen state, and cleared after every submit, whether it worked or not. */
export type ExportDraft = {
  readonly passphrase: string;
  readonly confirmation: string;
};

export const emptyExportDraft: ExportDraft = { passphrase: '', confirmation: '' };

/** The passphrase leaves the screen after any export attempt; a retry types it again. */
export function exportDraftAfterAttempt(): ExportDraft {
  return emptyExportDraft;
}

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

export type RestoreScreenState = {
  readonly draft: RestoreDraft;
  /** Counts edits to the text or passphrase, so a check can tell it was overtaken. */
  readonly revision: number;
  /** The opened snapshot, never the passphrase that opened it. */
  readonly prepared: PreparedRestore | null;
};

export const initialRestoreState: RestoreScreenState = {
  draft: emptyRestoreDraft,
  revision: 0,
  prepared: null,
};

/** Any edit leaves the check behind, so what is replaced is always what was shown. */
export function editRestoreInputs(
  state: RestoreScreenState,
  patch: Partial<Pick<RestoreDraft, 'text' | 'passphrase'>>,
): RestoreScreenState {
  return {
    draft: { ...state.draft, ...patch, typed: '' },
    revision: state.revision + 1,
    prepared: null,
  };
}

/** The confirmation word is not an input of the check, so it neither starts nor drops one. */
export function typeRestoreConfirmation(
  state: RestoreScreenState,
  typed: string,
): RestoreScreenState {
  return { ...state, draft: { ...state.draft, typed } };
}

/**
 * Applies a check that started at `startedAt`. If the text or passphrase changed since,
 * the result belongs to inputs no longer on screen and is dropped. Otherwise the
 * passphrase has done its work, whatever the outcome, and leaves the screen.
 */
export function settleRestoreCheck(
  state: RestoreScreenState,
  startedAt: number,
  prepared: PreparedRestore | null,
): RestoreScreenState {
  if (state.revision !== startedAt) return state;
  return { ...state, draft: { ...state.draft, passphrase: '', typed: '' }, prepared };
}

/** What a replace may submit: a stored check with the confirmation word typed. */
export function confirmedRestore(
  state: RestoreScreenState,
): { readonly checked: PreparedRestore; readonly typed: string } | null {
  if (!state.prepared || !isConfirmed(state.draft.typed)) return null;
  return { checked: state.prepared, typed: state.draft.typed.trim() };
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
