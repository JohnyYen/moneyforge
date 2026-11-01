import type { SqlExecutor } from '@/shared/persistence/sql-driver';

import type { PlanningRepository } from '../application/ports';
import type { Budget } from '../domain/budget';
import type { BudgetPeriod, PeriodKind } from '../domain/period';
import type {
  Occurrence,
  OccurrenceStatus,
  PlannedItem,
  RecurringItem,
  RecurringKind,
  RecurringMode,
} from '../domain/recurring';
import type { ScheduleUnit } from '../domain/schedule';

type BudgetRow = {
  id: string;
  name: string;
  currency_code: string;
  amount: string;
  period_kind: PeriodKind;
  start_day: number | null;
  start_month: number | null;
  custom_start_on: string | null;
  custom_length_days: number | null;
  starts_on: string;
  rollover: number;
  active: number;
};

type ItemRow = {
  id: string;
  name: string;
  kind: RecurringKind;
  account_id: string;
  to_account_id: string | null;
  amount: string;
  currency_code: string;
  category_id: string | null;
  unit: ScheduleUnit;
  every: number;
  day_of_month: number | null;
  start_on: string;
  end_on: string | null;
  mode: RecurringMode;
  apply_split: number;
  active: number;
  materialized_through: string | null;
};

type OccurrenceRow = {
  id: string;
  item_id: string;
  due_on: string;
  status: OccurrenceStatus;
  kind: RecurringKind;
  account_id: string;
  to_account_id: string | null;
  amount: string;
  currency_code: string;
  category_id: string | null;
  description: string;
  apply_split: number;
  transaction_id: string | null;
  note: string | null;
};

type PlannedRow = {
  id: string;
  planned_on: string;
  kind: PlannedItem['kind'];
  account_id: string;
  amount: string;
  description: string;
};

function toPeriod(row: BudgetRow): BudgetPeriod {
  const { period_kind: kind, start_day: startDay, start_month: startMonth } = row;
  if (kind === 'yearly') return { kind, startMonth, startDay };
  if (kind === 'custom') {
    return {
      kind,
      startOn: row.custom_start_on ?? '',
      lengthDays: row.custom_length_days ?? 0,
    };
  }
  return { kind, startDay };
}

function periodColumns(period: BudgetPeriod) {
  const custom = period.kind === 'custom';
  return [
    period.kind,
    custom ? null : period.startDay,
    period.kind === 'yearly' ? period.startMonth : null,
    custom ? period.startOn : null,
    custom ? period.lengthDays : null,
  ];
}

const toItem = (row: ItemRow): RecurringItem => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  accountId: row.account_id,
  toAccountId: row.to_account_id,
  amount: BigInt(row.amount),
  currencyCode: row.currency_code,
  categoryId: row.category_id,
  schedule: {
    unit: row.unit,
    every: row.every,
    startOn: row.start_on,
    endOn: row.end_on,
    dayOfMonth: row.day_of_month,
  },
  mode: row.mode,
  applySplit: row.apply_split === 1,
  active: row.active === 1,
  materializedThrough: row.materialized_through,
});

const toOccurrence = (row: OccurrenceRow): Occurrence => ({
  id: row.id,
  itemId: row.item_id,
  dueOn: row.due_on,
  status: row.status,
  kind: row.kind,
  accountId: row.account_id,
  toAccountId: row.to_account_id,
  amount: BigInt(row.amount),
  currencyCode: row.currency_code,
  categoryId: row.category_id,
  description: row.description,
  applySplit: row.apply_split === 1,
  transactionId: row.transaction_id,
  note: row.note,
});

const toPlanned = (row: PlannedRow): PlannedItem => ({
  id: row.id,
  plannedOn: row.planned_on,
  kind: row.kind,
  accountId: row.account_id,
  amount: BigInt(row.amount),
  description: row.description,
});

export function createSqlitePlanningRepository(sql: SqlExecutor): PlanningRepository {
  async function withCategories(rows: BudgetRow[]): Promise<Budget[]> {
    const links = await sql.all<{ budget_id: string; category_id: string }>(
      'SELECT budget_id, category_id FROM budget_categories ORDER BY category_id',
    );
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      currencyCode: row.currency_code,
      amount: BigInt(row.amount),
      categoryIds: links
        .filter(({ budget_id: budgetId }) => budgetId === row.id)
        .map(({ category_id: categoryId }) => categoryId),
      period: toPeriod(row),
      startsOn: row.starts_on,
      rollover: row.rollover === 1,
      active: row.active === 1,
    }));
  }

  return {
    listBudgets: async () =>
      withCategories(await sql.all<BudgetRow>('SELECT * FROM budgets ORDER BY name, id')),

    getBudget: async (id) => {
      const row = await sql.get<BudgetRow>('SELECT * FROM budgets WHERE id = ?', [id]);
      if (!row) return null;
      const [budget] = await withCategories([row]);
      return budget;
    },

    saveBudget: (budget) =>
      sql.transaction(async (tx) => {
        await tx.run(
          `INSERT INTO budgets
             (id, name, currency_code, amount, period_kind, start_day, start_month,
              custom_start_on, custom_length_days, starts_on, rollover, active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET
             name = excluded.name, currency_code = excluded.currency_code,
             amount = excluded.amount, period_kind = excluded.period_kind,
             start_day = excluded.start_day, start_month = excluded.start_month,
             custom_start_on = excluded.custom_start_on,
             custom_length_days = excluded.custom_length_days,
             starts_on = excluded.starts_on, rollover = excluded.rollover,
             active = excluded.active`,
          [
            budget.id,
            budget.name,
            budget.currencyCode,
            budget.amount.toString(),
            ...periodColumns(budget.period),
            budget.startsOn,
            budget.rollover ? 1 : 0,
            budget.active ? 1 : 0,
          ],
        );
        await tx.run('DELETE FROM budget_categories WHERE budget_id = ?', [budget.id]);
        for (const categoryId of budget.categoryIds) {
          await tx.run('INSERT INTO budget_categories (budget_id, category_id) VALUES (?, ?)', [
            budget.id,
            categoryId,
          ]);
        }
      }),

    listItems: async () =>
      (await sql.all<ItemRow>('SELECT * FROM recurring_items ORDER BY name, id')).map(toItem),

    getItem: async (id) => {
      const row = await sql.get<ItemRow>('SELECT * FROM recurring_items WHERE id = ?', [id]);
      return row ? toItem(row) : null;
    },

    saveItem: (item) =>
      sql.run(
        `INSERT INTO recurring_items
           (id, name, kind, account_id, to_account_id, amount, currency_code, category_id, unit,
            every, day_of_month, start_on, end_on, mode, apply_split, active, materialized_through)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           name = excluded.name, kind = excluded.kind, account_id = excluded.account_id,
           to_account_id = excluded.to_account_id, amount = excluded.amount,
           currency_code = excluded.currency_code, category_id = excluded.category_id,
           unit = excluded.unit, every = excluded.every, day_of_month = excluded.day_of_month,
           start_on = excluded.start_on, end_on = excluded.end_on, mode = excluded.mode,
           apply_split = excluded.apply_split, active = excluded.active,
           materialized_through = excluded.materialized_through`,
        [
          item.id,
          item.name,
          item.kind,
          item.accountId,
          item.toAccountId,
          item.amount.toString(),
          item.currencyCode,
          item.categoryId,
          item.schedule.unit,
          item.schedule.every,
          item.schedule.dayOfMonth,
          item.schedule.startOn,
          item.schedule.endOn,
          item.mode,
          item.applySplit ? 1 : 0,
          item.active ? 1 : 0,
          item.materializedThrough,
        ],
      ),

    markMaterialized: (itemId, through) =>
      sql.run(
        `UPDATE recurring_items SET materialized_through = ?
         WHERE id = ? AND (materialized_through IS NULL OR materialized_through < ?)`,
        [through, itemId, through],
      ),

    getOccurrence: async (id) => {
      const row = await sql.get<OccurrenceRow>('SELECT * FROM recurring_occurrences WHERE id = ?', [
        id,
      ]);
      return row ? toOccurrence(row) : null;
    },

    findOccurrence: async (itemId, dueOn) => {
      const row = await sql.get<OccurrenceRow>(
        'SELECT * FROM recurring_occurrences WHERE item_id = ? AND due_on = ?',
        [itemId, dueOn],
      );
      return row ? toOccurrence(row) : null;
    },

    listPendingOccurrences: async () =>
      (
        await sql.all<OccurrenceRow>(
          `SELECT * FROM recurring_occurrences WHERE status = 'pending' ORDER BY due_on, id`,
        )
      ).map(toOccurrence),

    saveOccurrence: (occurrence) =>
      sql.run(
        `INSERT INTO recurring_occurrences
           (id, item_id, due_on, status, kind, account_id, to_account_id, amount, currency_code,
            category_id, description, apply_split, transaction_id, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           status = excluded.status, amount = excluded.amount,
           description = excluded.description, transaction_id = excluded.transaction_id,
           note = excluded.note`,
        [
          occurrence.id,
          occurrence.itemId,
          occurrence.dueOn,
          occurrence.status,
          occurrence.kind,
          occurrence.accountId,
          occurrence.toAccountId,
          occurrence.amount.toString(),
          occurrence.currencyCode,
          occurrence.categoryId,
          occurrence.description,
          occurrence.applySplit ? 1 : 0,
          occurrence.transactionId,
          occurrence.note,
        ],
      ),

    listPlannedItems: async () =>
      (await sql.all<PlannedRow>('SELECT * FROM planned_items ORDER BY planned_on, id')).map(
        toPlanned,
      ),

    savePlannedItem: (item) =>
      sql.run(
        `INSERT INTO planned_items (id, planned_on, kind, account_id, amount, description)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [item.id, item.plannedOn, item.kind, item.accountId, item.amount.toString(), item.description],
      ),

    removePlannedItem: (id) => sql.run('DELETE FROM planned_items WHERE id = ?', [id]),
  };
}
