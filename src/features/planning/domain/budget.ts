import type { Currency } from '@/features/ledger/domain/currency';
import type { ExchangeRate } from '@/features/ledger/domain/exchange-rate';
import { err, ok, type Result } from '@/shared/result';

import type { Day } from './calendar';
import { convertOn } from './conversion';
import {
  nextPeriod,
  periodContaining,
  validatePeriod,
  type BudgetPeriod,
  type PeriodRange,
} from './period';
import { planningError, type PlanningError } from './planning-error';

export type Budget = {
  readonly id: string;
  readonly name: string;
  readonly currencyCode: string;
  readonly amount: bigint;
  readonly categoryIds: readonly string[];
  readonly period: BudgetPeriod;
  /** Rollover starts with the period holding this day, which moves when the carry restarts. */
  readonly startsOn: Day;
  readonly rollover: boolean;
  readonly active: boolean;
};

/** A negative `minor` is a refund: income in one of the budget's categories. */
export type Expense = {
  readonly day: Day;
  readonly minor: bigint;
  readonly currency: string;
  readonly categoryId: string | null;
};

export type BudgetStatus = {
  readonly budget: Budget;
  readonly period: PeriodRange;
  readonly spent: bigint;
  /** Surplus or overspend from earlier periods, which is negative after an overspend. */
  readonly carried: bigint;
  readonly available: bigint;
  readonly remaining: bigint;
  /** While this has entries, `spent` leaves those currencies out. */
  readonly missingRates: readonly string[];
};

export function validateBudget(budget: Budget): Result<Budget, PlanningError> {
  const invalid = (message: string) => err(planningError('invalid-budget', message));
  const name = budget.name.trim();
  if (!name) return invalid('Enter a budget name.');
  if (budget.amount <= 0n) return invalid('The amount must be greater than zero.');
  if (budget.categoryIds.length === 0) return invalid('Choose at least one category.');
  const period = validatePeriod(budget.period);
  if (!period.ok) return period;
  return ok({ ...budget, name });
}

export function belongsTo(
  categoryId: string | null,
  chosen: ReadonlySet<string>,
  parents: ReadonlyMap<string, string | null>,
): boolean {
  const visited = new Set<string>();
  let current = categoryId;
  while (current && !visited.has(current)) {
    if (chosen.has(current)) return true;
    visited.add(current);
    current = parents.get(current) ?? null;
  }
  return false;
}

/** What a period means, so a blank start and the day it defaults to read as one. */
function periodKey(period: BudgetPeriod): string {
  switch (period.kind) {
    case 'weekly':
    case 'monthly':
      return `${period.kind}:${period.startDay ?? 1}`;
    case 'yearly':
      return `yearly:${period.startMonth ?? 1}:${period.startDay ?? 1}`;
    case 'custom':
      return `custom:${period.startOn}:${period.lengthDays}`;
  }
}

const categoriesKey = ({ categoryIds }: Budget) => [...new Set(categoryIds)].sort().join();

/**
 * True when what carried over no longer means what it did: past periods would be recomputed with
 * terms they never ran under, so the carry starts again from zero instead.
 */
export function rolloverRestarts(before: Budget, after: Budget): boolean {
  return (
    before.amount !== after.amount ||
    before.currencyCode !== after.currencyCode ||
    before.rollover !== after.rollover ||
    periodKey(before.period) !== periodKey(after.period) ||
    categoriesKey(before) !== categoriesKey(after)
  );
}

export function computeBudgetStatus(input: {
  readonly budget: Budget;
  /** Spending and refunds only: transfers and other kinds never reach this. */
  readonly expenses: readonly Expense[];
  readonly rates: readonly ExchangeRate[];
  readonly currencies: readonly Currency[];
  readonly asOf: Day;
  readonly parents: ReadonlyMap<string, string | null>;
}): BudgetStatus {
  const { budget, expenses, rates, currencies, asOf, parents } = input;
  const target = currencies.find(({ code }) => code === budget.currencyCode);
  const chosen = new Set(budget.categoryIds);
  const missing = new Set<string>();
  const counted = expenses
    .filter(({ categoryId }) => belongsTo(categoryId, chosen, parents))
    .sort((first, second) => first.day.localeCompare(second.day));
  let next = 0;

  function spentIn({ startOn, endOn }: PeriodRange): bigint {
    let total = 0n;
    for (; next < counted.length && counted[next].day <= endOn; next += 1) {
      const { day, minor, currency } = counted[next];
      if (day < startOn) continue;
      const converted = target ? convertOn(minor, currency, target, day, { rates, currencies }) : null;
      if (converted === null) missing.add(currency);
      else total += converted;
    }
    return total;
  }

  const current = periodContaining(budget.period, asOf);
  let carried = 0n;
  if (budget.rollover) {
    let period = periodContaining(budget.period, budget.startsOn);
    while (period.startOn < current.startOn) {
      carried += budget.amount - spentIn(period);
      period = nextPeriod(budget.period, period);
    }
  }
  const spent = spentIn(current);
  const available = budget.amount + carried;
  return {
    budget,
    period: current,
    spent,
    carried,
    available,
    remaining: available - spent,
    missingRates: [...missing].sort(),
  };
}
