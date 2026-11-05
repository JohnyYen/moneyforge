import type { RestoreSummary } from '../application/backup-service';
import {
  canCheckRestore,
  canExport,
  emptyExportDraft,
  emptyRestoreDraft,
  isConfirmed,
  restoreLines,
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
