import { createContext, useContext } from 'react';

import type { PlanningService } from '../application/planning-service';

export const PlanningContext = createContext<PlanningService | null>(null);

export function usePlanning(): PlanningService {
  const planning = useContext(PlanningContext);
  if (!planning) throw new Error('usePlanning needs a PlanningContext provider');
  return planning;
}
