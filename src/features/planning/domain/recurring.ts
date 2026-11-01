import { err, ok, type Result } from '@/shared/result';

import { addDays, laterDay, type Day } from './calendar';
import type { ExpectedFlow } from './cash-flow';
import { planningError, type PlanningError } from './planning-error';
import { occurrencesBetween, validateSchedule, type Schedule } from './schedule';

export const RECURRING_KINDS = ['income', 'expense', 'transfer'] as const;
export type RecurringKind = (typeof RECURRING_KINDS)[number];

export const RECURRING_MODES = ['ask', 'auto'] as const;
export type RecurringMode = (typeof RECURRING_MODES)[number];

/** The most dates an `ask` item adds in one run, so a distant start cannot flood the list. */
export const MAX_ASK_DATES_PER_RUN = 60;

export type RecurringItem = {
  readonly id: string;
  readonly name: string;
  readonly kind: RecurringKind;
  readonly accountId: string;
  /** Transfers only. */
  readonly toAccountId: string | null;
  readonly amount: bigint;
  readonly currencyCode: string;
  readonly categoryId: string | null;
  readonly schedule: Schedule;
  readonly mode: RecurringMode;
  /** Income only: applies the split structure the ledger would propose for it. */
  readonly applySplit: boolean;
  readonly active: boolean;
  /** The last day already turned into occurrences. Never moves back. */
  readonly materializedThrough: Day | null;
};

export type OccurrenceStatus = 'pending' | 'posted' | 'skipped';

/** A copy of the item on its due date, so editing the item never changes it. */
export type Occurrence = {
  readonly id: string;
  readonly itemId: string;
  readonly dueOn: Day;
  readonly status: OccurrenceStatus;
  readonly kind: RecurringKind;
  readonly accountId: string;
  readonly toAccountId: string | null;
  readonly amount: bigint;
  readonly currencyCode: string;
  readonly categoryId: string | null;
  readonly description: string;
  readonly applySplit: boolean;
  /** Empty once the posted transaction is deleted: the date stays used. */
  readonly transactionId: string | null;
  readonly note: string | null;
};

export function validateRecurringFields<Item extends RecurringItem>(
  item: Item,
): Result<Item, PlanningError> {
  const invalid = (message: string) => err(planningError('invalid-recurring', message));
  const name = item.name.trim();
  if (!name) return invalid('Enter a name.');
  if (!RECURRING_KINDS.includes(item.kind)) return invalid('Choose income, expense, or transfer.');
  if (!RECURRING_MODES.includes(item.mode)) return invalid('Choose how it gets recorded.');
  if (item.amount <= 0n) return invalid('The amount must be greater than zero.');
  const transfer = item.kind === 'transfer';
  if (transfer && !item.toAccountId) return invalid('Choose the account that receives it.');
  if (transfer && item.toAccountId === item.accountId) {
    return invalid('Choose two different accounts.');
  }
  if (item.applySplit && item.kind !== 'income') return invalid('Only income can be split.');
  const schedule = validateSchedule(item.schedule);
  if (!schedule.ok) return schedule;
  return ok({
    ...item,
    name,
    schedule: schedule.value,
    toAccountId: transfer ? item.toAccountId : null,
    categoryId: transfer ? null : item.categoryId,
  });
}

export function occurrenceFrom(item: RecurringItem, dueOn: Day, id: string): Occurrence {
  return {
    id,
    itemId: item.id,
    dueOn,
    status: 'pending',
    kind: item.kind,
    accountId: item.accountId,
    toAccountId: item.toAccountId,
    amount: item.amount,
    currencyCode: item.currencyCode,
    categoryId: item.categoryId,
    description: item.name,
    applySplit: item.applySplit,
    transactionId: null,
    note: null,
  };
}

/**
 * A transfer with a side that is not projected has no flows at all: one side alone would read as
 * money appearing or leaving, when it only moves.
 */
export function flowsOfOccurrence(
  occurrence: Occurrence,
  day: Day,
  projected: ReadonlySet<string>,
): ExpectedFlow[] {
  const { kind, accountId, toAccountId, amount, categoryId, description: label } = occurrence;
  if (kind === 'income') return [{ day, accountId, minor: amount, label, categoryId }];
  if (kind === 'expense') return [{ day, accountId, minor: -amount, label, categoryId }];
  if (!toAccountId || !projected.has(accountId) || !projected.has(toAccountId)) return [];
  // No category: a transfer only moves money, so it never takes from a budget's reservation.
  return [
    { day, accountId, minor: -amount, label },
    { day, accountId: toAccountId, minor: amount, label },
  ];
}

/**
 * Dates through `today` the next run stores. An `ask` item keeps its latest when too many are due,
 * and those before them are gone for good. `capped` says some were dropped.
 */
export function datesDue(
  { materializedThrough, mode, schedule }: RecurringItem,
  today: Day,
): { readonly dates: readonly Day[]; readonly capped: boolean } {
  const from = materializedThrough ? addDays(materializedThrough, 1) : schedule.startOn;
  const due = occurrencesBetween(schedule, from, today);
  const dates = mode === 'ask' ? due.slice(-MAX_ASK_DATES_PER_RUN) : due;
  return { dates, capped: dates.length < due.length };
}

/** What recurring items will do through `until`. Anything overdue counts as due today. */
export function recurringFlows(
  items: readonly RecurringItem[],
  pending: readonly Occurrence[],
  {
    today,
    until,
    projected,
  }: { readonly today: Day; readonly until: Day; readonly projected: ReadonlySet<string> },
): ExpectedFlow[] {
  const flows = pending.flatMap((occurrence) =>
    flowsOfOccurrence(occurrence, laterDay(occurrence.dueOn, today), projected),
  );
  for (const item of items) {
    if (!item.active) continue;
    const { dates } = datesDue(item, today);
    const tomorrow = addDays(today, 1);
    const after = laterDay(tomorrow, addDays(item.materializedThrough ?? today, 1));
    for (const dueOn of [...dates, ...occurrencesBetween(item.schedule, after, until)]) {
      const occurrence = occurrenceFrom(item, dueOn, '');
      flows.push(...flowsOfOccurrence(occurrence, laterDay(dueOn, today), projected));
    }
  }
  return flows;
}

/** A one-off the user expects, which affects only the projection until it really happens. */
export type PlannedItem = {
  readonly id: string;
  readonly plannedOn: Day;
  readonly kind: 'income' | 'expense';
  readonly accountId: string;
  readonly amount: bigint;
  readonly description: string;
};

export function flowOfPlanned(item: PlannedItem): ExpectedFlow {
  const { plannedOn: day, accountId, amount, kind, description: label } = item;
  return { day, accountId, minor: kind === 'income' ? amount : -amount, label };
}
