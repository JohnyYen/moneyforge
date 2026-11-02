import { createContext, useContext } from 'react';

import type { TransferService } from '../application/transfer-service';

export const TransferContext = createContext<TransferService | null>(null);

export function useTransfer(): TransferService {
  const transfer = useContext(TransferContext);
  if (!transfer) throw new Error('useTransfer needs a TransferContext provider');
  return transfer;
}
