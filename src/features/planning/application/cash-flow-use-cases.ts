import { BASE_CURRENCY_KEY } from '@/features/ledger/application/setup-use-cases';
import type { Currency } from '@/features/ledger/domain/currency';
import { isValidDate } from '@/features/ledger/domain/exchange-rate';
import { parseDecimal } from '@/features/ledger/domain/money';
import { err, ok, type Result } from '@/shared/result';

import { reserveBudgets } from '../domain/budget-reservation';
import { addDays, type Day } from '../domain/calendar';
import {
  projectCashFlow,
  summarizeHistory,
  type CashFlowProjection,
  type HistoryRow,
  type Movement,
} from '../domain/cash-flow';
import { recentPeriods, type BudgetPeriod } from '../domain/period';
import { planningError, type PlanningError } from '../domain/planning-error';
import { flowOfPlanned, recurringFlows, type PlannedItem } from '../domain/recurring';
import type { createBudgetUseCases } from './budget-use-cases';
import type { PlanningDeps } from './ports';
import { queryStartOf, recordedAmount, todayOf } from './recorded-movements';

export const HISTORY_PERIODS = ['weekly', 'monthly', 'yearly'] as const;
export type HistoryPeriod = (typeof HISTORY_PERIODS)[number];

export type ProjectionOptions = {
  readonly horizonDays: number;
  /**
   * When set, what remains of each budget's current period leaves the total, less what expected
   * flows already take from it. See `reserveBudgets`.
   */
  readonly includeBudgets: boolean;
};

export type PlannedInput = Omit<PlannedItem, 'id' | 'amount'> & { readonly amount: string };

const MAX_HORIZON_DAYS = 3660;

const HISTORY_SHAPES: Record<HistoryPeriod, BudgetPeriod> = {
  weekly: { kind: 'weekly', startDay: null },
  monthly: { kind: 'monthly', startDay: null },
  yearly: { kind: 'yearly', startMonth: null, startDay: null },
};

type BudgetStatuses = ReturnType<typeof createBudgetUseCases>['budgetStatuses'];

export function createCashFlowUseCases(
  { store, clock, generateId, expectedSources = [] }: PlanningDeps,
  budgetStatuses: BudgetStatuses,
) {
  async function baseCurrency(): Promise<Result<Currency, PlanningError>> {
    const code = await store.settings.get(BASE_CURRENCY_KEY);
    const base = code ? await store.currencies.get(code) : null;
    return base ? ok(base) : err(planningError('setup-required', 'Choose a base currency first.'));
  }

  async function movementsSince(from: Day): Promise<Movement[]> {
    const [incomes, expenses] = await Promise.all(
      (['income', 'expense'] as const).map((kind) =>
        store.journal.list({ kind, from: queryStartOf(from) }),
      ),
    );
    const movements = (kind: Movement['kind'], transactions: typeof incomes) =>
      transactions.flatMap((transaction) => {
        const amount = recordedAmount(transaction);
        return amount ? [{ ...amount, kind }] : [];
      });
    return [...movements('income', incomes), ...movements('expense', expenses)];
  }

  return {
    async cashFlowHistory(
      period: HistoryPeriod,
      count: number,
    ): Promise<Result<HistoryRow[], PlanningError>> {
      const base = await baseCurrency();
      if (!base.ok) return base;
      const periods = recentPeriods(HISTORY_SHAPES[period], todayOf(clock), count);
      const [movements, rates, currencies] = await Promise.all([
        movementsSince(periods[0].startOn),
        store.exchangeRates.list(),
        store.currencies.list(),
      ]);
      return ok(summarizeHistory({ periods, movements, base: base.value, rates, currencies }));
    },

    async projectCashFlow({
      horizonDays,
      includeBudgets,
    }: ProjectionOptions): Promise<Result<CashFlowProjection, PlanningError>> {
      if (!Number.isInteger(horizonDays) || horizonDays < 1 || horizonDays > MAX_HORIZON_DAYS) {
        return err(
          planningError('invalid-date', `Choose a horizon from 1 to ${MAX_HORIZON_DAYS} days.`),
        );
      }
      const base = await baseCurrency();
      if (!base.ok) return base;
      const today = todayOf(clock);
      const until = addDays(today, horizonDays);

      const [
        accounts,
        balances,
        items,
        pending,
        planned,
        rates,
        currencies,
        external,
        statuses,
        categories,
      ] = await Promise.all([
        store.accounts.listUser(),
        store.journal.balances(),
        store.planning.listItems(),
        store.planning.listPendingOccurrences(),
        store.planning.listPlannedItems(),
        store.exchangeRates.list(),
        store.currencies.list(),
        Promise.all(expectedSources.map((source) => source.expectedFlows({ from: today, to: until }))),
        includeBudgets ? budgetStatuses() : [],
        store.categories.list(),
      ]);

      const projected = accounts.filter(({ archived }) => !archived);
      const accountCurrencies = new Map(projected.map(({ id, currencyCode }) => [id, currencyCode]));
      const flows = [
        ...recurringFlows(items, pending, {
          today,
          until,
          projected: new Set(accountCurrencies.keys()),
        }),
        ...planned.map(flowOfPlanned),
        ...external.flat(),
      ];
      const budgets = reserveBudgets({
        statuses,
        flows,
        accountCurrencies,
        parents: new Map(categories.map(({ id, parentId }) => [id, parentId])),
        base: base.value,
        today,
        until,
        rates,
        currencies,
      });
      const projection = projectCashFlow({
        today,
        horizonDays,
        base: base.value,
        rates,
        currencies,
        accounts: projected.map(({ id, currencyCode }) => ({
          accountId: id,
          currency: currencyCode,
          balance: balances[id] ?? 0n,
        })),
        flows,
        totalOutflows: budgets.outflows,
      });
      const missingRates = [...new Set([...projection.total.missingRates, ...budgets.missing])];
      return ok({ ...projection, total: { ...projection.total, missingRates: missingRates.sort() } });
    },

    listPlannedItems: () => store.planning.listPlannedItems(),

    addPlannedItem: (input: PlannedInput): Promise<Result<PlannedItem, PlanningError>> =>
      store.atomic(async ({ accounts, currencies, planning }) => {
        const invalid = (message: string) => err(planningError('invalid-planned-item', message));
        const description = input.description.trim();
        if (!description) return invalid('Enter a description.');
        if (!isValidDate(input.plannedOn)) return invalid('Enter a date as YYYY-MM-DD.');
        const account = await accounts.get(input.accountId);
        if (!account || account.systemRole !== null) return invalid('Choose an account.');
        const currency = await currencies.get(account.currencyCode);
        if (!currency) return invalid('Choose an account.');
        const amount = parseDecimal(input.amount, currency.decimals);
        if (!amount.ok) return amount;
        if (amount.value <= 0n) return invalid('The amount must be greater than zero.');
        const item = { ...input, id: generateId(), description, amount: amount.value };
        await planning.savePlannedItem(item);
        return ok(item);
      }),

    removePlannedItem: async (id: string): Promise<Result<void, PlanningError>> => {
      await store.planning.removePlannedItem(id);
      return ok(undefined);
    },
  };
}
