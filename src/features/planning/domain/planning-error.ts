import type { SplitErrorCode } from '@/features/split/domain/split-error';

export type PlanningErrorCode =
  | SplitErrorCode
  | 'invalid-budget'
  | 'invalid-period'
  | 'invalid-schedule'
  | 'invalid-recurring'
  | 'invalid-planned-item'
  | 'occurrence-not-pending';

export type PlanningError = { readonly code: PlanningErrorCode; readonly message: string };

export function planningError(code: PlanningErrorCode, message: string): PlanningError {
  return { code, message };
}
