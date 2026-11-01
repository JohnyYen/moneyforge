import { createContext, useContext } from 'react';

import type { RulesService } from '../application/rules-service';

export const RulesContext = createContext<RulesService | null>(null);

export function useRules(): RulesService {
  const rules = useContext(RulesContext);
  if (!rules) throw new Error('useRules needs a RulesContext provider');
  return rules;
}
