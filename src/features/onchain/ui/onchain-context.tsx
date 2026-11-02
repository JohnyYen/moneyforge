import { createContext, useContext } from 'react';

import type { OnChainService } from '../application/onchain-service';

export const OnChainContext = createContext<OnChainService | null>(null);

export function useOnChain(): OnChainService {
  const onchain = useContext(OnChainContext);
  if (!onchain) throw new Error('useOnChain needs an OnChainContext provider');
  return onchain;
}
