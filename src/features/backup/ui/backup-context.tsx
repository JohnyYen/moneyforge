import { createContext, useContext } from 'react';

import type { BackupService } from '../application/backup-service';

export type BackupAccess = {
  readonly backup: BackupService;
  /** Opens every service again, so a restored ledger starts as a fresh launch would. */
  readonly reopen: () => void;
};

export const BackupContext = createContext<BackupAccess | null>(null);

export function useBackup(): BackupAccess {
  const access = useContext(BackupContext);
  if (!access) throw new Error('useBackup needs a BackupContext provider');
  return access;
}
