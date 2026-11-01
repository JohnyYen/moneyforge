import type { Clock, IdGenerator } from '@/features/ledger/application/ports';
import type { SplitRepositories } from '@/features/split/application/ports';

import type { Budget } from '../domain/budget';
import type { Day } from '../domain/calendar';
import type { ExpectedFlow } from '../domain/cash-flow';
import type { Occurrence, PlannedItem, RecurringItem } from '../domain/recurring';

export interface PlanningRepository {
  listBudgets(): Promise<Budget[]>;
  getBudget(id: string): Promise<Budget | null>;
  /** Inserts or replaces a budget and all of its categories. */
  saveBudget(budget: Budget): Promise<void>;

  listItems(): Promise<RecurringItem[]>;
  getItem(id: string): Promise<RecurringItem | null>;
  saveItem(item: RecurringItem): Promise<void>;
  markMaterialized(itemId: string, through: Day): Promise<void>;

  getOccurrence(id: string): Promise<Occurrence | null>;
  findOccurrence(itemId: string, dueOn: Day): Promise<Occurrence | null>;
  listPendingOccurrences(): Promise<Occurrence[]>;
  /** A second occurrence for one item and date fails on the database's unique key. */
  saveOccurrence(occurrence: Occurrence): Promise<void>;

  listPlannedItems(): Promise<PlannedItem[]>;
  savePlannedItem(item: PlannedItem): Promise<void>;
  removePlannedItem(id: string): Promise<void>;
}

export interface PlanningRepositories extends SplitRepositories {
  readonly planning: PlanningRepository;
}

export interface PlanningStore extends PlanningRepositories {
  atomic<T>(work: (repositories: PlanningRepositories) => Promise<T>): Promise<T>;
}

/**
 * Money some other feature expects in an account, which the projection adds to its own. Amounts
 * are in the account's currency. Flows outside `from` through `to`, or on an account that is not
 * projected, are ignored.
 */
export interface ExpectedCashFlowSource {
  expectedFlows(range: { readonly from: Day; readonly to: Day }): Promise<ExpectedFlow[]>;
}

export type PlanningDeps = {
  readonly store: PlanningStore;
  readonly clock: Clock;
  readonly generateId: IdGenerator;
  readonly expectedSources?: readonly ExpectedCashFlowSource[];
};
