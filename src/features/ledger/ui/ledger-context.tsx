import { createContext, useContext } from 'react';

import type { LedgerService } from '../application/ledger-service';

export const LedgerContext = createContext<LedgerService | null>(null);

export function useLedger(): LedgerService {
  const ledger = useContext(LedgerContext);
  if (!ledger) throw new Error('useLedger needs a LedgerContext provider');
  return ledger;
}
