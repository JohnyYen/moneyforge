import { createBudgetUseCases } from './budget-use-cases';
import { createCashFlowUseCases } from './cash-flow-use-cases';
import type { PlanningDeps } from './ports';
import { createRecurringUseCases } from './recurring-use-cases';

export function createPlanningService(deps: PlanningDeps) {
  const budgets = createBudgetUseCases(deps);
  return {
    ...budgets,
    ...createRecurringUseCases(deps),
    ...createCashFlowUseCases(deps, budgets.budgetStatuses),
  };
}

export type PlanningService = ReturnType<typeof createPlanningService>;
