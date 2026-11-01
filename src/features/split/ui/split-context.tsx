import { createContext, useContext } from 'react';

import type { SplitService } from '../application/split-service';

export const SplitContext = createContext<SplitService | null>(null);

export function useSplit(): SplitService {
  const split = useContext(SplitContext);
  if (!split) throw new Error('useSplit needs a SplitContext provider');
  return split;
}
