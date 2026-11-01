import { parseDecimal } from '@/features/ledger/domain/money';
import { err, ok, type Result } from '@/shared/result';

import {
  computeBudgetStatus,
  validateBudget,
  type Budget,
  type BudgetStatus,
  type Expense,
} from '../domain/budget';
import type { Day } from '../domain/calendar';
import { periodContaining, type BudgetPeriod } from '../domain/period';
import { planningError, type PlanningError } from '../domain/planning-error';
import type { PlanningDeps, PlanningRepositories } from './ports';
import { queryStartOf, recordedAmount, todayOf } from './recorded-movements';

export type BudgetInput = {
  readonly name: string;
  readonly currencyCode: string;
  readonly amount: string;
  readonly categoryIds: readonly string[];
  readonly period: BudgetPeriod;
  readonly rollover: boolean;
};

type BudgetResult = Result<Budget, PlanningError>;

const notFound = () => err(planningError('not-found', 'Budget not found.'));

async function buildBudget(
  { categories, currencies }: PlanningRepositories,
  input: BudgetInput,
  base: Pick<Budget, 'id' | 'startsOn' | 'active'>,
): Promise<BudgetResult> {
  const currency = await currencies.get(input.currencyCode);
  if (!currency) return err(planningError('invalid-currency', 'Choose a currency.'));
  const amount = parseDecimal(input.amount, currency.decimals);
  if (!amount.ok) return amount;
  const budget = validateBudget({ ...input, ...base, amount: amount.value });
  if (!budget.ok) return budget;
  for (const id of budget.value.categoryIds) {
    const category = await categories.get(id);
    if (category?.kind !== 'expense') {
      return err(planningError('category-mismatch', 'Choose expense categories.'));
    }
  }
  return budget;
}

/** A custom budget has its own first day. Any other starts with the period it was made in. */
const startOf = ({ period }: BudgetInput, fallback: Day) =>
  period.kind === 'custom' ? period.startOn : fallback;

export function createBudgetUseCases({ store, clock, generateId }: PlanningDeps) {
  /** Fetches what the budget needing the longest history needs, once for all of them. */
  async function expensesSince(from: Day): Promise<Expense[]> {
    const recorded = await store.journal.list({ kind: 'expense', from: queryStartOf(from) });
    return recorded.flatMap((transaction) => {
      const amount = recordedAmount(transaction);
      return amount ? [{ ...amount, categoryId: transaction.categoryId }] : [];
    });
  }

  async function budgetStatuses(): Promise<BudgetStatus[]> {
    const budgets = (await store.planning.listBudgets()).filter(({ active }) => active);
    if (budgets.length === 0) return [];
    const asOf = todayOf(clock);
    const earliest = budgets
      .map(({ period, rollover, startsOn }) =>
        periodContaining(period, rollover && startsOn < asOf ? startsOn : asOf).startOn,
      )
      .reduce((first, second) => (first < second ? first : second));
    const [expenses, rates, currencies, categories] = await Promise.all([
      expensesSince(earliest),
      store.exchangeRates.list(),
      store.currencies.list(),
      store.categories.list(),
    ]);
    const parents = new Map(categories.map(({ id, parentId }) => [id, parentId]));
    return budgets.map((budget) =>
      computeBudgetStatus({ budget, expenses, rates, currencies, asOf, parents }),
    );
  }

  return {
    listBudgets: () => store.planning.listBudgets(),
    getBudget: (id: string) => store.planning.getBudget(id),
    budgetStatuses,

    createBudget: (input: BudgetInput): Promise<BudgetResult> =>
      store.atomic(async (repositories) => {
        const budget = await buildBudget(repositories, input, {
          id: generateId(),
          startsOn: startOf(input, todayOf(clock)),
          active: true,
        });
        if (budget.ok) await repositories.planning.saveBudget(budget.value);
        return budget;
      }),

    updateBudget: (id: string, input: BudgetInput): Promise<BudgetResult> =>
      store.atomic(async (repositories) => {
        const existing = await repositories.planning.getBudget(id);
        if (!existing) return notFound();
        const budget = await buildBudget(repositories, input, {
          id,
          startsOn: startOf(input, existing.startsOn),
          active: existing.active,
        });
        if (budget.ok) await repositories.planning.saveBudget(budget.value);
        return budget;
      }),

    setBudgetActive: (id: string, active: boolean): Promise<Result<void, PlanningError>> =>
      store.atomic(async ({ planning }) => {
        const existing = await planning.getBudget(id);
        if (!existing) return notFound();
        await planning.saveBudget({ ...existing, active });
        return ok(undefined);
      }),
  };
}
