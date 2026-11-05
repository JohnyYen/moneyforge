import type { PreparedRestore, RestoreSummary } from '../application/backup-service';
import {
  canCheckRestore,
  canExport,
  confirmedRestore,
  editRestoreInputs,
  emptyExportDraft,
  emptyRestoreDraft,
  exportDraftAfterAttempt,
  initialRestoreState,
  isConfirmed,
  restoreLines,
  settleRestoreCheck,
  typeRestoreConfirmation,
  type RestoreScreenState,
} from './backup-model';

const summary = (change: Partial<RestoreSummary> = {}): RestoreSummary => ({
  createdAt: '2026-03-31T14:05:09.000Z',
  schemaVersion: 7,
  upgrades: false,
  accounts: 3,
  transactions: 120,
  ...change,
});

describe('canExport', () => {
  it('waits for both passphrase fields', () => {
    expect(canExport(emptyExportDraft)).toBe(false);
    expect(canExport({ passphrase: 'a', confirmation: '' })).toBe(false);
    expect(canExport({ passphrase: 'a', confirmation: 'b' })).toBe(true);
  });
});

describe('exportDraftAfterAttempt', () => {
  it('drops both passphrase fields, whatever the outcome', () => {
    expect(exportDraftAfterAttempt()).toEqual(emptyExportDraft);
  });
});

describe('canCheckRestore', () => {
  it('needs the backup text and a passphrase', () => {
    expect(canCheckRestore(emptyRestoreDraft)).toBe(false);
    expect(canCheckRestore({ ...emptyRestoreDraft, text: '  \n', passphrase: 'p' })).toBe(false);
    expect(canCheckRestore({ ...emptyRestoreDraft, text: 'x', passphrase: '' })).toBe(false);
    expect(canCheckRestore({ ...emptyRestoreDraft, text: 'x', passphrase: 'p' })).toBe(true);
  });
});

describe('isConfirmed', () => {
  it('accepts only the confirmation word, ignoring surrounding spaces', () => {
    expect(isConfirmed('REPLACE')).toBe(true);
    expect(isConfirmed(' REPLACE ')).toBe(true);
    expect(isConfirmed('replace')).toBe(false);
    expect(isConfirmed('')).toBe(false);
  });
});

describe('restoreLines', () => {
  it('says when the backup was made and what it holds', () => {
    expect(restoreLines(summary())).toEqual([
      'Made on 2026-03-31 14:05 UTC.',
      '3 accounts and 120 transactions.',
      'Everything on this device will be replaced by this backup.',
    ]);
  });

  it('uses singular words for one of each', () => {
    expect(restoreLines(summary({ accounts: 1, transactions: 1 }))[1]).toBe(
      '1 account and 1 transaction.',
    );
  });

  it('warns when an older backup will be upgraded', () => {
    expect(restoreLines(summary({ upgrades: true, schemaVersion: 4 }))).toContain(
      'It comes from an older version of the app and will be upgraded as it is restored.',
    );
  });

  it('shows an unreadable date as written', () => {
    expect(restoreLines(summary({ createdAt: 'yesterday' }))[0]).toBe('Made on yesterday.');
  });
});

const prepared = (change: Partial<RestoreSummary> = {}): PreparedRestore =>
  ({ snapshot: {}, summary: summary(change) }) as PreparedRestore;

const filled = (): RestoreScreenState =>
  editRestoreInputs(initialRestoreState, { text: 'backup', passphrase: 'secret' });

describe('restore screen state', () => {
  it('stores a check whose inputs did not change, and drops the passphrase', () => {
    const state = filled();
    const opened = prepared();

    const settled = settleRestoreCheck(state, state.revision, opened);

    expect(settled.prepared).toBe(opened);
    expect(settled.draft).toEqual({ text: 'backup', passphrase: '', typed: '' });
  });

  it('drops the passphrase after a failed check too', () => {
    const state = filled();

    const settled = settleRestoreCheck(state, state.revision, null);

    expect(settled.prepared).toBeNull();
    expect(settled.draft.passphrase).toBe('');
    expect(settled.draft.text).toBe('backup');
  });

  it('discards a check whose text changed while it ran', () => {
    const started = filled();
    const edited = editRestoreInputs(started, { text: 'another backup' });

    const settled = settleRestoreCheck(edited, started.revision, prepared());

    expect(settled).toBe(edited);
    expect(settled.prepared).toBeNull();
  });

  it('discards a check whose passphrase changed while it ran, keeping what was typed', () => {
    const started = filled();
    const edited = editRestoreInputs(started, { passphrase: 'other' });

    const settled = settleRestoreCheck(edited, started.revision, prepared());

    expect(settled.prepared).toBeNull();
    expect(settled.draft.passphrase).toBe('other');
  });

  it('discards a check even when an edit puts the same inputs back', () => {
    const started = filled();
    const edited = editRestoreInputs(editRestoreInputs(started, { text: 'x' }), { text: 'backup' });

    expect(settleRestoreCheck(edited, started.revision, prepared()).prepared).toBeNull();
  });

  it('leaves a shown check behind on any edit of the text or passphrase', () => {
    const state = filled();
    const checked = typeRestoreConfirmation(
      settleRestoreCheck(state, state.revision, prepared()),
      'REPLACE',
    );

    const edited = editRestoreInputs(checked, { passphrase: 'p' });

    expect(edited.prepared).toBeNull();
    expect(edited.draft.typed).toBe('');
    expect(confirmedRestore(edited)).toBeNull();
  });

  it('typing the confirmation keeps the check and does not count as an edit', () => {
    const state = filled();
    const checked = settleRestoreCheck(state, state.revision, prepared());

    const typed = typeRestoreConfirmation(checked, 'REPLACE');

    expect(typed.prepared).toBe(checked.prepared);
    expect(typed.revision).toBe(checked.revision);
    expect(typed.draft).toEqual({ ...checked.draft, typed: 'REPLACE' });
  });

  it('typing the confirmation while a check runs does not let a stale result through', () => {
    const started = filled();
    const edited = typeRestoreConfirmation(editRestoreInputs(started, { text: 'y' }), 'REPLACE');

    expect(settleRestoreCheck(edited, started.revision, prepared()).prepared).toBeNull();
  });

  it('offers a restore only for a stored check with the word typed', () => {
    const state = filled();
    expect(confirmedRestore(typeRestoreConfirmation(state, 'REPLACE'))).toBeNull();

    const checked = settleRestoreCheck(state, state.revision, prepared());
    expect(confirmedRestore(checked)).toBeNull();
    expect(confirmedRestore(typeRestoreConfirmation(checked, 'replace'))).toBeNull();

    const confirmed = typeRestoreConfirmation(checked, ' REPLACE ');
    expect(confirmedRestore(confirmed)).toEqual({ checked: checked.prepared, typed: 'REPLACE' });
  });
});
