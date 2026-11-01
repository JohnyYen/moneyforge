import { createAppServices, type AppServices } from '@/app-services/create-app-services';
import { isBalanced } from '@/features/ledger/domain/journal';
import { toLocalDay } from '@/features/ledger/application/overview-use-cases';
import { migrations } from '@/shared/persistence/migrations';
import { runMigrations } from '@/shared/persistence/migrator';
import { createNodeSqliteDriver } from '@/shared/persistence/node-sqlite-driver';
import type { SqlDriver, SqlExecutor } from '@/shared/persistence/sql-driver';
import type { Result } from '@/shared/result';

import { addDays } from '../domain/calendar';
import type { Schedule } from '../domain/schedule';
import type { BudgetInput } from './budget-use-cases';
import type { ExpectedCashFlowSource } from './ports';
import type { RecurringInput } from './recurring-use-cases';
import { toBudgetDraft, toBudgetInput } from '../ui/plan-model';

function unwrap<T>(result: Result<T, { code: string; message: string }>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

function failingOn(driver: SqlDriver, pattern: RegExp): SqlExecutor {
  const wrap = (sql: SqlExecutor): SqlExecutor => ({
    exec: (text) => sql.exec(text),
    all: (text, params) => sql.all(text, params),
    get: (text, params) => sql.get(text, params),
    run: async (text, params) => {
      if (pattern.test(text)) throw new Error('disk failure');
      await sql.run(text, params);
    },
    transaction: (work) => sql.transaction((tx) => work(wrap(tx))),
  });
  return wrap(driver);
}

/** Lets `allowed` matching statements through, then fails the rest. */
function failingAfter(driver: SqlDriver, pattern: RegExp, allowed: number): SqlExecutor {
  let seen = 0;
  const wrap = (sql: SqlExecutor): SqlExecutor => ({
    exec: (text) => sql.exec(text),
    all: (text, params) => sql.all(text, params),
    get: (text, params) => sql.get(text, params),
    run: async (text, params) => {
      if (pattern.test(text) && (seen += 1) > allowed) throw new Error('disk failure');
      await sql.run(text, params);
    },
    transaction: (work) => sql.transaction((tx) => work(wrap(tx))),
  });
  return wrap(driver);
}

describe('planning', () => {
  let driver: SqlDriver;
  let services: AppServices;
  let sequence: number;
  let now: Date;

  const localNoon = (day: string) => {
    const [year, month, date] = day.split('-').map(Number);
    return new Date(year, month - 1, date, 12);
  };
  const servicesOn = (sql: SqlExecutor, expectedSources?: readonly ExpectedCashFlowSource[]) =>
    createAppServices({
      driver: sql,
      clock: { now: () => now },
      generateId: () => `id-${++sequence}`,
      generateSecret: () => 'test-secret',
      expectedSources,
    });

  const TODAY = '2026-03-10';

  beforeEach(async () => {
    driver = createNodeSqliteDriver();
    await runMigrations(driver, migrations);
    sequence = 0;
    now = localNoon(TODAY);
    services = servicesOn(driver);
    await services.ledger.initialize();
    unwrap(await services.ledger.setBaseCurrency('USD'));
  });

  afterEach(() => driver.close());

  const account = async (name: string, currencyCode = 'USD', openingBalance = '0') =>
    unwrap(
      await services.ledger.createAccount({ name, type: 'Bank', currencyCode, openingBalance }),
    ).id;

  const archive = async (id: string) =>
    unwrap(
      await services.ledger.updateAccount({
        id,
        name: 'Archived',
        type: 'Bank',
        openingBalance: '100',
        archived: true,
      }),
    );

  const category = async (kind: 'income' | 'expense', name = 'Planning test') =>
    unwrap(await services.ledger.createCategory({ name, kind, parentId: null })).id;

  const expense = async (accountId: string, amount: string, day: string, categoryId: string) =>
    unwrap(
      await services.ledger.recordExpense({
        accountId,
        amount,
        categoryId,
        occurredAt: localNoon(day).toISOString(),
      }),
    );

  const budgetInput = (categoryId: string, change: Partial<BudgetInput> = {}): BudgetInput => ({
    name: 'Food',
    currencyCode: 'USD',
    amount: '100',
    categoryIds: [categoryId],
    period: { kind: 'monthly', startDay: null },
    rollover: false,
    ...change,
  });

  const daily = (change: Partial<Schedule> = {}): Schedule => ({
    unit: 'day',
    every: 1,
    startOn: TODAY,
    endOn: null,
    dayOfMonth: null,
    ...change,
  });

  const recurringInput = (
    accountId: string,
    change: Partial<RecurringInput> = {},
  ): RecurringInput => ({
    name: 'Rent',
    kind: 'expense',
    accountId,
    toAccountId: null,
    amount: '10',
    categoryId: null,
    schedule: daily(),
    mode: 'ask',
    applySplit: false,
    ...change,
  });

  const allRows = (table: string) => driver.all<Record<string, unknown>>(`SELECT * FROM ${table}`);
  const balanceOf = async (id: string) => (await services.ledger.accountBalances())
    .find(({ account: { id: accountId } }) => accountId === id)?.balance;
  const statusOf = async (id: string) =>
    (await services.planning.budgetStatuses()).find(({ budget }) => budget.id === id);

  describe('budgets', () => {
    it('computes spent from ledger expenses in the period', async () => {
      const bank = await account('Bank', 'USD', '1000');
      const food = await category('expense');
      const budget = unwrap(await services.planning.createBudget(budgetInput(food)));
      await expense(bank, '12.34', '2026-03-02', food);
      await expense(bank, '0.66', TODAY, food);
      await expense(bank, '500', '2026-02-28', food);

      const status = await statusOf(budget.id);
      expect(status?.spent).toBe(13_00n);
      expect(status?.remaining).toBe(87_00n);
    });

    it('leaves out transfers, conversions, income, and adjustments', async () => {
      const bank = await account('Bank', 'USD', '1000');
      const other = await account('Other');
      const food = await category('expense');
      const budget = unwrap(await services.planning.createBudget(budgetInput(food)));
      unwrap(
        await services.ledger.recordTransfer({
          fromAccountId: bank,
          toAccountId: other,
          amount: '50',
          fee: '1',
          categoryId: food,
        }),
      );
      unwrap(
        await services.ledger.recordIncome({
          accountId: bank,
          amount: '5',
          categoryId: await category('income'),
        }),
      );
      unwrap(await services.ledger.reconcile({ accountId: bank, countedBalance: '1' }));

      expect((await statusOf(budget.id))?.spent).toBe(0n);
    });

    it('stops counting an expense once it is deleted', async () => {
      const bank = await account('Bank', 'USD', '1000');
      const food = await category('expense');
      const budget = unwrap(await services.planning.createBudget(budgetInput(food)));
      const recorded = await expense(bank, '20', TODAY, food);
      unwrap(await services.ledger.deleteTransaction(recorded.id));

      expect((await statusOf(budget.id))?.spent).toBe(0n);
    });

    it('converts with stored rates and reports a missing one', async () => {
      const dollars = await account('Dollars', 'USD', '100');
      const pesos = await account('Pesos', 'EUR', '100');
      const food = await category('expense');
      const budget = unwrap(await services.planning.createBudget(budgetInput(food)));
      await expense(pesos, '10', TODAY, food);
      await expense(dollars, '1', TODAY, food);

      const missing = await statusOf(budget.id);
      expect(missing?.spent).toBe(1_00n);
      expect(missing?.missingRates).toEqual(['EUR']);

      unwrap(
        await services.ledger.saveRate({
          fromCode: 'EUR',
          toCode: 'USD',
          rate: '1.5',
          effectiveOn: '2026-01-01',
        }),
      );
      const found = await statusOf(budget.id);
      expect(found?.spent).toBe(16_00n);
      expect(found?.missingRates).toEqual([]);
    });

    it('lets one category sit in several budgets', async () => {
      const bank = await account('Bank', 'USD', '1000');
      const food = await category('expense');
      const first = unwrap(await services.planning.createBudget(budgetInput(food)));
      const second = unwrap(
        await services.planning.createBudget(budgetInput(food, { name: 'All' })),
      );
      await expense(bank, '7', TODAY, food);

      expect((await statusOf(first.id))?.spent).toBe(7_00n);
      expect((await statusOf(second.id))?.spent).toBe(7_00n);
    });

    it('starts rollover at creation, and a custom budget at its own start', async () => {
      const food = await category('expense');
      const plain = unwrap(await services.planning.createBudget(budgetInput(food)));
      const custom = unwrap(
        await services.planning.createBudget(
          budgetInput(food, { period: { kind: 'custom', startOn: '2026-01-05', lengthDays: 7 } }),
        ),
      );
      expect(plain.startsOn).toBe(TODAY);
      expect(custom.startsOn).toBe('2026-01-05');
    });

    it('carries rollover through the service', async () => {
      const bank = await account('Bank', 'USD', '1000');
      const food = await category('expense');
      now = localNoon('2026-01-10');
      const budget = unwrap(
        await services.planning.createBudget(budgetInput(food, { rollover: true })),
      );
      await expense(bank, '30', '2026-01-20', food);
      now = localNoon('2026-02-10');

      const status = await statusOf(budget.id);
      expect(status?.carried).toBe(70_00n);
      expect(status?.available).toBe(170_00n);
    });

    it('renames a budget and keeps its start', async () => {
      const food = await category('expense', 'A');
      const budget = unwrap(await services.planning.createBudget(budgetInput(food)));
      now = localNoon('2026-04-01');
      const updated = unwrap(
        await services.planning.updateBudget(budget.id, budgetInput(food, { name: 'Renamed' })),
      );

      expect(updated.startsOn).toBe(TODAY);
      expect(await services.planning.getBudget(budget.id)).toMatchObject({ name: 'Renamed' });
    });

    it('keeps what carried over through a save with nothing changed', async () => {
      const bank = await account('Bank', 'USD', '1000');
      const food = await category('expense');
      const usd = await services.ledger.getBaseCurrency();
      now = localNoon('2026-01-10');
      const budget = unwrap(
        await services.planning.createBudget(budgetInput(food, { rollover: true })),
      );
      await expense(bank, '30', '2026-01-20', food);
      now = localNoon('2026-03-10');
      const stored = await services.planning.getBudget(budget.id);
      if (!stored || !usd) throw new Error('Missing test data');

      const input = toBudgetInput(toBudgetDraft(stored, usd));
      const saved = unwrap(await services.planning.updateBudget(budget.id, input));

      expect(saved.startsOn).toBe('2026-01-10');
      expect((await statusOf(budget.id))?.carried).toBe(170_00n);
    });

    it('replaces the categories and restarts what carried over', async () => {
      const food = await category('expense', 'A');
      const fun = await category('expense', 'B');
      const budget = unwrap(await services.planning.createBudget(budgetInput(food)));
      now = localNoon('2026-04-01');
      const updated = unwrap(await services.planning.updateBudget(budget.id, budgetInput(fun)));

      expect(updated.startsOn).toBe('2026-04-01');
      expect(await services.planning.getBudget(budget.id)).toMatchObject({ categoryIds: [fun] });
    });

    it.each<[string, Partial<BudgetInput>]>([
      ['amount', { amount: '200' }],
      ['period', { period: { kind: 'monthly', startDay: 15 } }],
      ['rollover', { rollover: false }],
      ['currency', { currencyCode: 'EUR' }],
    ])('restarts what carried over when the %s changes', async (_, change) => {
      const bank = await account('Bank', 'USD', '1000');
      const food = await category('expense');
      now = localNoon('2026-01-10');
      const budget = unwrap(
        await services.planning.createBudget(budgetInput(food, { rollover: true })),
      );
      await expense(bank, '30', '2026-01-20', food);
      now = localNoon('2026-03-10');
      expect((await statusOf(budget.id))?.carried).toBe(170_00n);

      const updated = unwrap(
        await services.planning.updateBudget(
          budget.id,
          budgetInput(food, { rollover: true, ...change }),
        ),
      );

      expect(updated.startsOn).toBe('2026-03-10');
      expect((await statusOf(budget.id))?.carried).toBe(0n);
    });

    it('keeps what carried over when a saved budget is unchanged', async () => {
      const food = await category('expense');
      now = localNoon('2026-01-10');
      const input = budgetInput(food, {
        rollover: true,
        period: { kind: 'yearly', startMonth: 1, startDay: 1 },
      });
      const budget = unwrap(await services.planning.createBudget(input));
      now = localNoon('2026-03-10');

      const updated = unwrap(await services.planning.updateBudget(budget.id, input));

      expect(updated.startsOn).toBe('2026-01-10');
    });

    it('keeps a custom budget from starting before its own first day', async () => {
      const food = await category('expense');
      const period = { kind: 'custom', startOn: '2026-05-01', lengthDays: 7 } as const;
      const budget = unwrap(await services.planning.createBudget(budgetInput(food, { period })));

      const updated = unwrap(
        await services.planning.updateBudget(budget.id, budgetInput(food, { period, amount: '5' })),
      );

      expect(updated.startsOn).toBe('2026-05-01');
    });

    it('counts income in a budget category as negative spending', async () => {
      const bank = await account('Bank', 'USD', '1000');
      const food = await category('expense', 'Food');
      const refunds = await category('income', 'Food refunds');
      const salary = await category('income', 'Salary');
      const budget = unwrap(
        await services.planning.createBudget(budgetInput(food, { categoryIds: [food, refunds] })),
      );
      await expense(bank, '30', TODAY, food);
      const income = async (categoryId: string, amount: string) =>
        unwrap(await services.ledger.recordIncome({ accountId: bank, amount, categoryId }));
      await income(refunds, '10');
      await income(salary, '500');

      const status = await statusOf(budget.id);
      expect(status?.spent).toBe(20_00n);
      expect(status?.remaining).toBe(80_00n);
    });

    it('refuses a bad input and writes nothing', async () => {
      const food = await category('expense');
      const planning = services.planning;
      const refused = [
        await planning.createBudget(budgetInput(food, { name: ' ' })),
        await planning.createBudget(budgetInput(food, { amount: '0' })),
        await planning.createBudget(budgetInput(food, { amount: 'abc' })),
        await planning.createBudget(budgetInput(food, { amount: '1.234' })),
        await planning.createBudget(budgetInput(food, { currencyCode: 'XXX' })),
        await planning.createBudget(budgetInput('missing')),
        await planning.createBudget(budgetInput(food, { categoryIds: [] })),
      ];

      expect(refused.every((result) => !result.ok)).toBe(true);
      expect(await allRows('budgets')).toEqual([]);
    });

    it('hides an archived budget from the statuses and keeps it listed', async () => {
      const food = await category('expense');
      const budget = unwrap(await services.planning.createBudget(budgetInput(food)));
      unwrap(await services.planning.setBudgetActive(budget.id, false));

      expect(await services.planning.budgetStatuses()).toEqual([]);
      expect(await services.planning.listBudgets()).toHaveLength(1);
    });
  });

  describe('recurring items', () => {
    it('materializes each occurrence once across restarts', async () => {
      const bank = await account('Bank', 'USD', '100');
      unwrap(
        await services.planning.createItem(
          recurringInput(bank, { schedule: daily({ startOn: '2026-03-08' }) }),
        ),
      );

      await services.planning.materializeDue();
      await services.planning.materializeDue();
      await servicesOn(driver).planning.materializeDue();

      const occurrences = await allRows('recurring_occurrences');
      expect(occurrences.map(({ due_on: dueOn }) => dueOn).sort()).toEqual([
        '2026-03-08',
        '2026-03-09',
        '2026-03-10',
      ]);
    });

    it('does not double when two runs overlap', async () => {
      const bank = await account('Bank', 'USD', '100');
      unwrap(await services.planning.createItem(recurringInput(bank, { mode: 'auto' })));

      await Promise.all([
        services.planning.materializeDue(),
        services.planning.materializeDue(),
        servicesOn(driver).planning.materializeDue(),
      ]);

      expect(await allRows('recurring_occurrences')).toHaveLength(1);
      expect(await balanceOf(bank)).toBe(90_00n);
    });

    it('does not repeat a date when a restart follows a marker that was never written', async () => {
      const bank = await account('Bank', 'USD', '100');
      unwrap(await services.planning.createItem(recurringInput(bank, { mode: 'auto' })));
      unwrap(await services.planning.createItem(recurringInput(bank, { name: 'Later' })));
      const failing = servicesOn(failingOn(driver, /UPDATE recurring_items/));

      const interrupted = await failing.planning.materializeDue();
      expect(interrupted).toMatchObject({ failed: 2, posted: 1, pending: 1 });

      const restarted = await services.planning.materializeDue();
      expect(restarted).toEqual({ pending: 0, posted: 0, failed: 0 });
      expect(await allRows('recurring_occurrences')).toHaveLength(2);
      expect(await balanceOf(bank)).toBe(90_00n);
    });

    it('materializes newly due days, and not future ones', async () => {
      const bank = await account('Bank', 'USD', '100');
      unwrap(await services.planning.createItem(recurringInput(bank)));
      await services.planning.materializeDue();
      expect(await allRows('recurring_occurrences')).toHaveLength(1);

      now = localNoon('2026-03-12');
      await services.planning.materializeDue();
      expect(await allRows('recurring_occurrences')).toHaveLength(3);
    });

    it('does not bring back a skipped or a confirmed date', async () => {
      const bank = await account('Bank', 'USD', '100');
      unwrap(
        await services.planning.createItem(
          recurringInput(bank, { schedule: daily({ startOn: '2026-03-09' }) }),
        ),
      );
      await services.planning.materializeDue();
      const [first, second] = await services.planning.listPendingOccurrences();
      unwrap(await services.planning.skipOccurrence(first.id));
      unwrap(await services.planning.confirmOccurrence(second.id));

      await services.planning.materializeDue();

      expect(await services.planning.listPendingOccurrences()).toEqual([]);
      expect(await allRows('recurring_occurrences')).toHaveLength(2);
    });

    it('does not bring back a date whose transaction was deleted', async () => {
      const bank = await account('Bank', 'USD', '100');
      unwrap(await services.planning.createItem(recurringInput(bank, { mode: 'auto' })));
      await services.planning.materializeDue();
      const [row] = await allRows('recurring_occurrences');
      unwrap(await services.ledger.deleteTransaction(String(row.transaction_id)));

      await services.planning.materializeDue();

      const rows = await allRows('recurring_occurrences');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: 'posted', transaction_id: null });
      expect(await balanceOf(bank)).toBe(100_00n);
    });

    it('clamps a monthly item through the service, on the due date', async () => {
      const bank = await account('Bank', 'USD', '100');
      now = localNoon('2026-01-31');
      unwrap(
        await services.planning.createItem(
          recurringInput(bank, {
            mode: 'auto',
            schedule: daily({ unit: 'month', startOn: '2026-01-31' }),
          }),
        ),
      );
      now = localNoon('2026-04-30');
      await services.planning.materializeDue();

      const transactions = await services.ledger.listTransactions({ kind: 'expense' });
      const days = transactions.map(({ occurredAt }) => toLocalDay(new Date(occurredAt))).sort();
      expect(days).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    });

    it('asks first in ask mode, moving no money', async () => {
      const bank = await account('Bank', 'USD', '100');
      unwrap(await services.planning.createItem(recurringInput(bank)));
      await services.planning.materializeDue();

      expect(await balanceOf(bank)).toBe(100_00n);
      expect(await services.planning.listPendingOccurrences()).toEqual([
        expect.objectContaining({ dueOn: TODAY, status: 'pending', amount: 10_00n }),
      ]);
    });

    it('posts balanced entries in auto mode for each kind', async () => {
      const bank = await account('Bank', 'USD', '100');
      const savings = await account('Savings');
      for (const change of [
        { kind: 'income' as const },
        { kind: 'expense' as const },
        { kind: 'transfer' as const, toAccountId: savings },
      ]) {
        unwrap(await services.planning.createItem(recurringInput(bank, { ...change, mode: 'auto' })));
      }
      await services.planning.materializeDue();

      const transactions = await services.ledger.listTransactions({});
      const posted = transactions.filter(({ description }) => description === 'Rent');
      expect(posted.map(({ kind }) => kind).sort()).toEqual(['expense', 'income', 'transfer']);
      expect(posted.every(({ postings }) => isBalanced(postings))).toBe(true);
      expect(await balanceOf(bank)).toBe(90_00n);
      expect(await balanceOf(savings)).toBe(10_00n);
      const rows = await allRows('recurring_occurrences');
      expect(rows.every(({ status, transaction_id: id }) => status === 'posted' && id)).toBe(true);
    });

    it('dates a posted occurrence on its due day, not on today', async () => {
      const bank = await account('Bank', 'USD', '100');
      now = localNoon('2026-03-02');
      unwrap(
        await services.planning.createItem(
          recurringInput(bank, {
            mode: 'auto',
            schedule: daily({ startOn: '2026-03-02', endOn: '2026-03-02' }),
          }),
        ),
      );
      now = localNoon(TODAY);
      await services.planning.materializeDue();

      const [transaction] = await services.ledger.listTransactions({ kind: 'expense' });
      expect(toLocalDay(new Date(transaction.occurredAt))).toBe('2026-03-02');
    });

    it('keeps an auto occurrence pending with a note when posting is refused', async () => {
      const bank = await account('Bank', 'USD', '100');
      unwrap(await services.planning.createItem(recurringInput(bank, { mode: 'auto' })));
      await archive(bank);
      await services.planning.materializeDue();

      const [pending] = await services.planning.listPendingOccurrences();
      expect(pending.note).toMatch(/could not post/i);
      expect(pending.note).toContain('archived');
      expect(await services.ledger.listTransactions({ kind: 'expense' })).toEqual([]);
    });

    it('keeps an auto occurrence pending when the write itself fails', async () => {
      const bank = await account('Bank', 'USD', '100');
      unwrap(await services.planning.createItem(recurringInput(bank, { mode: 'auto' })));
      const failing = servicesOn(failingOn(driver, /INSERT INTO postings/));

      await failing.planning.materializeDue();

      const [pending] = await services.planning.listPendingOccurrences();
      expect(pending.note).toMatch(/could not post/i);
      expect(await allRows('transactions')).toEqual(
        expect.not.arrayContaining([expect.objectContaining({ description: 'Rent' })]),
      );
    });

    it('retries later when even the pending row cannot be stored', async () => {
      const bank = await account('Bank', 'USD', '100');
      unwrap(await services.planning.createItem(recurringInput(bank)));
      const failing = servicesOn(failingOn(driver, /INSERT INTO recurring_occurrences/));

      const summary = await failing.planning.materializeDue();
      expect(summary.failed).toBe(1);
      expect(await allRows('recurring_occurrences')).toEqual([]);

      await services.planning.materializeDue();
      expect(await allRows('recurring_occurrences')).toHaveLength(1);
    });

    it('confirms with edits and leaves the item alone', async () => {
      const bank = await account('Bank', 'USD', '100');
      const item = unwrap(await services.planning.createItem(recurringInput(bank)));
      await services.planning.materializeDue();
      const [pending] = await services.planning.listPendingOccurrences();

      const confirmed = unwrap(
        await services.planning.confirmOccurrence(pending.id, {
          amount: '12.50',
          description: 'Rent, March',
          occurredOn: '2026-03-08',
        }),
      );

      expect(confirmed).toMatchObject({ status: 'posted', amount: 12_50n });
      expect(await balanceOf(bank)).toBe(87_50n);
      const [transaction] = await services.ledger.listTransactions({ kind: 'expense' });
      expect(transaction.description).toBe('Rent, March');
      expect(toLocalDay(new Date(transaction.occurredAt))).toBe('2026-03-08');
      expect((await services.planning.getItem(item.id))?.amount).toBe(10_00n);
    });

    it('refuses a bad confirmation and leaves it pending', async () => {
      const bank = await account('Bank', 'USD', '100');
      unwrap(await services.planning.createItem(recurringInput(bank)));
      await services.planning.materializeDue();
      const [pending] = await services.planning.listPendingOccurrences();

      expect((await services.planning.confirmOccurrence(pending.id, { amount: '0' })).ok).toBe(false);
      expect((await services.planning.confirmOccurrence(pending.id, { amount: 'x' })).ok).toBe(false);
      expect(
        (await services.planning.confirmOccurrence(pending.id, { occurredOn: '2026-13-01' })).ok,
      ).toBe(false);

      expect(await services.planning.listPendingOccurrences()).toHaveLength(1);
      expect(await services.ledger.listTransactions({ kind: 'expense' })).toEqual([]);
    });

    it('confirms and skips only pending occurrences, so a double tap posts once', async () => {
      const bank = await account('Bank', 'USD', '100');
      unwrap(await services.planning.createItem(recurringInput(bank)));
      await services.planning.materializeDue();
      const [pending] = await services.planning.listPendingOccurrences();

      const [first, second] = await Promise.all([
        services.planning.confirmOccurrence(pending.id),
        services.planning.confirmOccurrence(pending.id),
      ]);

      expect([first.ok, second.ok].sort()).toEqual([false, true]);
      expect(await balanceOf(bank)).toBe(90_00n);
      expect(await services.planning.skipOccurrence(pending.id)).toMatchObject({
        ok: false,
        error: { code: 'occurrence-not-pending' },
      });
    });

    it('never changes a past or pending occurrence when the item is edited', async () => {
      const bank = await account('Bank', 'USD', '100');
      const item = unwrap(await services.planning.createItem(recurringInput(bank)));
      await services.planning.materializeDue();

      unwrap(
        await services.planning.updateItem(
          item.id,
          recurringInput(bank, { name: 'New rent', amount: '99' }),
        ),
      );
      now = localNoon('2026-03-11');
      await services.planning.materializeDue();

      const occurrences = await services.planning.listPendingOccurrences();
      expect(occurrences.map(({ description, amount }) => [description, amount])).toEqual([
        ['Rent', 10_00n],
        ['New rent', 99_00n],
      ]);
    });

    it('applies an edited schedule only to days not yet materialized', async () => {
      const bank = await account('Bank', 'USD', '100');
      const item = unwrap(
        await services.planning.createItem(
          recurringInput(bank, { schedule: daily({ unit: 'week', startOn: '2026-03-02' }) }),
        ),
      );
      await services.planning.materializeDue();
      unwrap(
        await services.planning.updateItem(
          item.id,
          recurringInput(bank, { schedule: daily({ startOn: '2026-03-02' }) }),
        ),
      );

      await services.planning.materializeDue();

      const rows = await allRows('recurring_occurrences');
      expect(rows.map(({ due_on: dueOn }) => dueOn).sort()).toEqual(['2026-03-02', '2026-03-09']);
    });

    it('stops while archived and does not catch up on restore', async () => {
      const bank = await account('Bank', 'USD', '100');
      const item = unwrap(await services.planning.createItem(recurringInput(bank)));
      await services.planning.materializeDue();
      unwrap(await services.planning.setItemActive(item.id, false));

      now = localNoon('2026-03-20');
      await services.planning.materializeDue();
      expect(await allRows('recurring_occurrences')).toHaveLength(1);

      unwrap(await services.planning.setItemActive(item.id, true));
      await services.planning.materializeDue();
      const rows = await allRows('recurring_occurrences');
      expect(rows.map(({ due_on: dueOn }) => dueOn).sort()).toEqual([TODAY, '2026-03-20']);
    });

    it('keeps today when an item is restored on a due date, and does not repeat it', async () => {
      const bank = await account('Bank', 'USD', '100');
      const item = unwrap(await services.planning.createItem(recurringInput(bank)));
      await services.planning.materializeDue();
      unwrap(await services.planning.setItemActive(item.id, false));
      unwrap(await services.planning.setItemActive(item.id, true));

      await services.planning.materializeDue();

      expect(await allRows('recurring_occurrences')).toHaveLength(1);
      expect((await services.planning.getItem(item.id))?.materializedThrough).toBe(TODAY);
    });

    it('never posts the past dates of a new auto item', async () => {
      const bank = await account('Bank', 'USD', '100');
      const item = unwrap(
        await services.planning.createItem(
          recurringInput(bank, { mode: 'auto', schedule: daily({ startOn: '2016-03-10' }) }),
        ),
      );
      expect(item.materializedThrough).toBe('2026-03-09');

      expect(await services.planning.materializeDue()).toEqual({ pending: 0, posted: 1, failed: 0 });

      expect(await allRows('recurring_occurrences')).toHaveLength(1);
      expect(await balanceOf(bank)).toBe(90_00n);
    });

    it('leaves a new auto item starting today or later to run as usual', async () => {
      const bank = await account('Bank', 'USD', '100');
      const dates = [TODAY, '2026-04-01'];
      for (const startOn of dates) {
        const item = unwrap(
          await services.planning.createItem(
            recurringInput(bank, { mode: 'auto', schedule: daily({ startOn }) }),
          ),
        );
        expect(item.materializedThrough).toBeNull();
      }
    });

    it('catches up an existing auto item after days away', async () => {
      const bank = await account('Bank', 'USD', '100');
      unwrap(await services.planning.createItem(recurringInput(bank, { mode: 'auto' })));
      await services.planning.materializeDue();
      now = localNoon('2026-03-13');

      expect((await services.planning.materializeDue()).posted).toBe(3);
    });

    it('does not post a backlog when an ask item becomes an auto item', async () => {
      const bank = await account('Bank', 'USD', '100');
      const schedule = daily({ startOn: '2026-01-01' });
      const item = unwrap(
        await services.planning.createItem(recurringInput(bank, { schedule })),
      );

      unwrap(
        await services.planning.updateItem(item.id, recurringInput(bank, { schedule, mode: 'auto' })),
      );

      expect((await services.planning.materializeDue()).posted).toBe(1);
      expect(await balanceOf(bank)).toBe(90_00n);
    });

    it('keeps only the latest 60 past dates of an ask item, and says so', async () => {
      const bank = await account('Bank', 'USD', '100');
      unwrap(
        await services.planning.createItem(
          recurringInput(bank, { schedule: daily({ startOn: '2016-03-10' }) }),
        ),
      );

      await services.planning.materializeDue();
      await services.planning.materializeDue();

      const pending = await services.planning.listPendingOccurrences();
      expect(pending).toHaveLength(60);
      expect(pending[0].dueOn).toBe(addDays(TODAY, -59));
      expect(pending.at(-1)?.dueOn).toBe(TODAY);
      expect(pending[0].note).toMatch(/latest 60/);
      expect(pending.slice(1).every(({ note }) => note === null)).toBe(true);
    });

    it('adds no notice when 60 dates or fewer are due', async () => {
      const bank = await account('Bank', 'USD', '100');
      unwrap(
        await services.planning.createItem(
          recurringInput(bank, { schedule: daily({ startOn: addDays(TODAY, -59) }) }),
        ),
      );

      await services.planning.materializeDue();

      const pending = await services.planning.listPendingOccurrences();
      expect(pending).toHaveLength(60);
      expect(pending.every(({ note }) => note === null)).toBe(true);
    });

    it('moves the marker after each date, so a stopped run counts none twice', async () => {
      const bank = await account('Bank', 'USD', '100');
      const item = unwrap(
        await services.planning.createItem(
          recurringInput(bank, { schedule: daily({ startOn: '2026-03-08' }) }),
        ),
      );
      const failing = servicesOn(failingAfter(driver, /INSERT INTO recurring_occurrences/, 1));

      expect((await failing.planning.materializeDue()).failed).toBe(1);

      expect((await services.planning.getItem(item.id))?.materializedThrough).toBe('2026-03-08');
      const projection = unwrap(
        await services.planning.projectCashFlow({ horizonDays: 1, includeBudgets: false }),
      );
      expect(projection.accounts[0].balances).toEqual([70_00n, 60_00n]);
    });

    it('lists posted occurrences that have a note until they are dismissed', async () => {
      const bank = await account('Bank', 'USD', '0');
      unwrap(
        await services.planning.createItem(
          recurringInput(bank, { kind: 'income', amount: '100', mode: 'auto', applySplit: true }),
        ),
      );
      unwrap(await services.planning.createItem(recurringInput(bank, { mode: 'auto' })));
      await services.planning.materializeDue();

      const notes = await services.planning.listPostedNotes();
      expect(notes).toEqual([expect.objectContaining({ status: 'posted', dueOn: TODAY })]);
      expect(notes[0].note).toMatch(/no default split/i);

      unwrap(await services.planning.dismissPostedNote(notes[0].id));

      expect(await services.planning.listPostedNotes()).toEqual([]);
      expect(await allRows('recurring_occurrences')).toEqual(
        expect.arrayContaining([expect.objectContaining({ status: 'posted', note: null })]),
      );
    });

    it('dismisses only the note of a posted occurrence', async () => {
      const bank = await account('Bank', 'USD', '100');
      unwrap(await services.planning.createItem(recurringInput(bank, { mode: 'auto' })));
      await archive(bank);
      await services.planning.materializeDue();
      const [pending] = await services.planning.listPendingOccurrences();

      expect(await services.planning.dismissPostedNote(pending.id)).toMatchObject({ ok: false });
      expect(await services.planning.dismissPostedNote('missing')).toMatchObject({ ok: false });

      const [kept] = await services.planning.listPendingOccurrences();
      expect(kept.note).toMatch(/could not post/i);
    });

    it('stops at the end date', async () => {
      const bank = await account('Bank', 'USD', '100');
      unwrap(
        await services.planning.createItem(
          recurringInput(bank, {
            schedule: daily({ startOn: '2026-03-09', endOn: '2026-03-09' }),
          }),
        ),
      );
      await services.planning.materializeDue();
      expect(await allRows('recurring_occurrences')).toHaveLength(1);
    });

    it('refuses a bad item and writes nothing', async () => {
      const bank = await account('Bank', 'USD', '100');
      const euros = await account('Euros', 'EUR');
      const archived = await account('Old', 'USD', '100');
      await archive(archived);
      const income = await category('income');
      const planning = services.planning;
      const refused = [
        await planning.createItem(recurringInput('missing')),
        await planning.createItem(recurringInput(archived)),
        await planning.createItem(recurringInput(bank, { amount: '0' })),
        await planning.createItem(recurringInput(bank, { amount: '1.234' })),
        await planning.createItem(recurringInput(bank, { categoryId: income })),
        await planning.createItem(recurringInput(bank, { kind: 'transfer' })),
        await planning.createItem(recurringInput(bank, { kind: 'transfer', toAccountId: euros })),
        await planning.createItem(recurringInput(bank, { kind: 'transfer', toAccountId: bank })),
        await planning.createItem(recurringInput(bank, { schedule: daily({ every: 0 }) })),
        await planning.createItem(recurringInput(bank, { applySplit: true })),
      ];

      expect(refused.every((result) => !result.ok)).toBe(true);
      expect(await allRows('recurring_items')).toEqual([]);
    });

    describe('income split', () => {
      const structureFor = async (bank: string, target: string) => {
        const structure = unwrap(
          await services.split.createStructure({
            name: 'Plan',
            lines: [
              { label: 'Save', targetAccountId: target, percentage: '25', isRemainder: false },
              { label: 'Rest', targetAccountId: bank, percentage: null, isRemainder: true },
            ],
          }),
        );
        unwrap(
          await services.split.setSplitDefault({
            scope: 'account',
            scopeId: bank,
            structureId: structure.id,
          }),
        );
      };

      it('applies the proposed structure in the write that posts', async () => {
        const bank = await account('Bank', 'USD', '0');
        const savings = await account('Savings');
        await structureFor(bank, savings);
        unwrap(
          await services.planning.createItem(
            recurringInput(bank, { kind: 'income', amount: '100', mode: 'auto', applySplit: true }),
          ),
        );
        await services.planning.materializeDue();

        const moves = await services.split.listPendingMoves();
        expect(moves).toEqual([expect.objectContaining({ toAccountId: savings, amount: 25_00n })]);
      });

      it('splits a confirmed occurrence too', async () => {
        const bank = await account('Bank', 'USD', '0');
        const savings = await account('Savings');
        await structureFor(bank, savings);
        unwrap(
          await services.planning.createItem(
            recurringInput(bank, { kind: 'income', amount: '100', applySplit: true }),
          ),
        );
        await services.planning.materializeDue();
        const [pending] = await services.planning.listPendingOccurrences();
        unwrap(await services.planning.confirmOccurrence(pending.id));

        expect(await services.split.countPendingMoves()).toBe(1);
      });

      it('posts and notes it when no structure is proposed', async () => {
        const bank = await account('Bank', 'USD', '0');
        unwrap(
          await services.planning.createItem(
            recurringInput(bank, { kind: 'income', amount: '100', mode: 'auto', applySplit: true }),
          ),
        );
        await services.planning.materializeDue();

        const [row] = await allRows('recurring_occurrences');
        expect(row.status).toBe('posted');
        expect(row.note).toMatch(/no default split/i);
        expect(await balanceOf(bank)).toBe(100_00n);
      });

      it('leaves income unsplit when the item does not ask for it', async () => {
        const bank = await account('Bank', 'USD', '0');
        const savings = await account('Savings');
        await structureFor(bank, savings);
        unwrap(
          await services.planning.createItem(
            recurringInput(bank, { kind: 'income', amount: '100', mode: 'auto' }),
          ),
        );
        await services.planning.materializeDue();

        expect(await services.split.countPendingMoves()).toBe(0);
      });
    });
  });

  describe('currency decimals', () => {
    const euro = { code: 'EUR', name: 'Euro', decimals: 3, symbol: 'E', kind: 'fiat' as const };
    const refused = { ok: false, error: { code: 'currency-in-use' } };

    it('stay editable with nothing in the currency', async () => {
      expect(await services.ledger.updateCurrency(euro)).toMatchObject({ ok: true });
    });

    it('are locked by a budget', async () => {
      const food = await category('expense');
      unwrap(await services.planning.createBudget(budgetInput(food, { currencyCode: 'EUR' })));
      expect(await services.ledger.updateCurrency(euro)).toMatchObject(refused);
    });

    it('are locked by a recurring item', async () => {
      unwrap(await services.planning.createItem(recurringInput(await account('E', 'EUR'))));
      expect(await services.ledger.updateCurrency(euro)).toMatchObject(refused);
    });

    it('are locked by an occurrence that outlives its item currency', async () => {
      const item = unwrap(
        await services.planning.createItem(recurringInput(await account('E', 'EUR'))),
      );
      await services.planning.materializeDue();
      unwrap(
        await services.planning.updateItem(item.id, recurringInput(await account('Bank'))),
      );
      expect(await services.ledger.updateCurrency(euro)).toMatchObject(refused);
    });

    it('are locked by a planned item', async () => {
      unwrap(
        await services.planning.addPlannedItem({
          plannedOn: TODAY,
          kind: 'expense',
          accountId: await account('E', 'EUR'),
          amount: '5',
          description: 'Trip',
        }),
      );
      expect(await services.ledger.updateCurrency(euro)).toMatchObject(refused);
    });

    it('leave a rename free while the currency is in use', async () => {
      const food = await category('expense');
      unwrap(await services.planning.createBudget(budgetInput(food, { currencyCode: 'EUR' })));
      expect(await services.ledger.updateCurrency({ ...euro, decimals: 2, name: 'Euros' })).toMatchObject({
        ok: true,
      });
    });
  });

  describe('cash flow history', () => {
    it('totals income and expense per period and currency, with base totals', async () => {
      const dollars = await account('Dollars', 'USD', '1000');
      const euros = await account('Euros', 'EUR', '1000');
      const other = await account('Other', 'USD');
      const food = await category('expense');
      await expense(dollars, '10', '2026-02-27', food);
      await expense(euros, '20', '2026-03-02', food);
      unwrap(
        await services.ledger.recordIncome({
          accountId: dollars,
          amount: '50',
          occurredAt: localNoon('2026-03-03').toISOString(),
        }),
      );
      unwrap(
        await services.ledger.recordTransfer({
          fromAccountId: dollars,
          toAccountId: other,
          amount: '7',
        }),
      );

      const missing = unwrap(await services.planning.cashFlowHistory('monthly', 2));
      expect(missing).toHaveLength(2);
      expect(missing[0].byCurrency).toEqual([
        { currency: 'USD', income: 0n, expense: 10_00n, net: -10_00n },
      ]);
      expect(missing[1].byCurrency).toEqual([
        { currency: 'EUR', income: 0n, expense: 20_00n, net: -20_00n },
        { currency: 'USD', income: 50_00n, expense: 0n, net: 50_00n },
      ]);
      expect(missing[1].missingRates).toEqual(['EUR']);
      expect(missing[1].base).toEqual({ income: 50_00n, expense: 0n, net: 50_00n });

      unwrap(
        await services.ledger.saveRate({
          fromCode: 'EUR',
          toCode: 'USD',
          rate: '2',
          effectiveOn: '2026-01-01',
        }),
      );
      const converted = unwrap(await services.planning.cashFlowHistory('monthly', 2));
      expect(converted[1].base).toEqual({ income: 50_00n, expense: 40_00n, net: 10_00n });
    });

    it('needs a base currency', async () => {
      await driver.run(`DELETE FROM settings WHERE key = 'base_currency'`);
      expect(await services.planning.cashFlowHistory('monthly', 1)).toMatchObject({
        ok: false,
        error: { code: 'setup-required' },
      });
    });
  });

  describe('cash flow projection', () => {
    const horizon = { horizonDays: 5, includeBudgets: false };
    const accountRow = (projection: { accounts: readonly { accountId: string }[] }, id: string) =>
      projection.accounts.find(({ accountId }) => accountId === id);

    it('starts from current balances and adds future occurrences', async () => {
      const bank = await account('Bank', 'USD', '100');
      unwrap(await services.planning.createItem(recurringInput(bank, { amount: '30' })));
      await services.planning.materializeDue();

      const projection = unwrap(await services.planning.projectCashFlow(horizon));
      expect(projection.days).toHaveLength(6);
      expect(projection.accounts[0].balances).toEqual([
        70_00n,
        40_00n,
        10_00n,
        -20_00n,
        -50_00n,
        -80_00n,
      ]);
      expect(projection.accounts[0].firstNegativeOn).toBe(addDays(TODAY, 3));
      expect(projection.total.firstNegativeOn).toBe(addDays(TODAY, 3));
    });

    it('leaves out dates the cap will drop, before they are ever materialized', async () => {
      const bank = await account('Bank', 'USD', '1000');
      unwrap(
        await services.planning.createItem(
          recurringInput(bank, { amount: '1', schedule: daily({ startOn: '2016-03-10' }) }),
        ),
      );

      const projection = unwrap(await services.planning.projectCashFlow(horizon));
      expect(projection.accounts[0].balances[0]).toBe(940_00n);
      expect(projection.accounts[0].balances[5]).toBe(935_00n);
    });

    it('leaves out capped dates while the first kept date cannot be stored', async () => {
      const bank = await account('Bank', 'USD', '1000');
      unwrap(
        await services.planning.createItem(
          recurringInput(bank, { amount: '1', schedule: daily({ startOn: '2016-03-10' }) }),
        ),
      );
      const failing = servicesOn(failingOn(driver, /INSERT INTO recurring_occurrences/));
      expect((await failing.planning.materializeDue()).failed).toBe(1);

      const projection = unwrap(await services.planning.projectCashFlow(horizon));
      expect(projection.accounts[0].balances[0]).toBe(940_00n);
    });

    it('does not count an already posted occurrence twice', async () => {
      const bank = await account('Bank', 'USD', '100');
      unwrap(
        await services.planning.createItem(
          recurringInput(bank, { mode: 'auto', schedule: daily({ endOn: TODAY }) }),
        ),
      );
      await services.planning.materializeDue();

      const projection = unwrap(await services.planning.projectCashFlow(horizon));
      expect(projection.accounts[0].balances).toEqual(Array(6).fill(90_00n));
    });

    it('moves a transfer between accounts and leaves the total flat', async () => {
      const bank = await account('Bank', 'USD', '100');
      const savings = await account('Savings');
      unwrap(
        await services.planning.createItem(
          recurringInput(bank, { kind: 'transfer', toAccountId: savings }),
        ),
      );

      const projection = unwrap(await services.planning.projectCashFlow(horizon));
      expect(accountRow(projection, bank)).toMatchObject({ firstNegativeOn: null });
      expect(projection.total.balances).toEqual(Array(6).fill(100_00n));
    });

    it('adds planned items and forgets past ones', async () => {
      const bank = await account('Bank', 'USD', '100');
      unwrap(
        await services.planning.addPlannedItem({
          plannedOn: addDays(TODAY, 2),
          kind: 'expense',
          accountId: bank,
          amount: '150',
          description: 'Laptop',
        }),
      );
      unwrap(
        await services.planning.addPlannedItem({
          plannedOn: addDays(TODAY, -2),
          kind: 'expense',
          accountId: bank,
          amount: '1',
          description: 'Old',
        }),
      );

      const projection = unwrap(await services.planning.projectCashFlow(horizon));
      expect(projection.accounts[0].balances.slice(0, 3)).toEqual([100_00n, 100_00n, -50_00n]);
    });

    it('removes a planned item', async () => {
      const bank = await account('Bank', 'USD', '100');
      const planned = unwrap(
        await services.planning.addPlannedItem({
          plannedOn: TODAY,
          kind: 'income',
          accountId: bank,
          amount: '5',
          description: 'Gift',
        }),
      );
      unwrap(await services.planning.removePlannedItem(planned.id));
      expect(await services.planning.listPlannedItems()).toEqual([]);
    });

    it('refuses a bad planned item', async () => {
      const bank = await account('Bank', 'USD', '100');
      const input = {
        plannedOn: TODAY,
        kind: 'income' as const,
        accountId: bank,
        amount: '5',
        description: 'Gift',
      };
      const planning = services.planning;
      const refused = [
        await planning.addPlannedItem({ ...input, plannedOn: 'soon' }),
        await planning.addPlannedItem({ ...input, amount: '0' }),
        await planning.addPlannedItem({ ...input, accountId: 'missing' }),
        await planning.addPlannedItem({ ...input, description: ' ' }),
      ];
      expect(refused.every((result) => !result.ok)).toBe(true);
      expect(await planning.listPlannedItems()).toEqual([]);
    });

    it('leaves budgets out unless asked, then takes what remains from the total', async () => {
      const bank = await account('Bank', 'USD', '100');
      const food = await category('expense');
      unwrap(await services.planning.createBudget(budgetInput(food, { amount: '120' })));
      await expense(bank, '20', TODAY, food);

      const without = unwrap(await services.planning.projectCashFlow(horizon));
      expect(without.total.balances.at(-1)).toBe(80_00n);

      const withBudgets = unwrap(
        await services.planning.projectCashFlow({ horizonDays: 30, includeBudgets: true }),
      );
      expect(withBudgets.accounts[0].balances.at(-1)).toBe(80_00n);
      expect(withBudgets.total.balances.at(-1)).toBe(-20_00n);
      expect(withBudgets.total.firstNegativeOn).toBe('2026-03-31');
    });

    it('takes an unfinished budget period at the end of the horizon', async () => {
      const bank = await account('Bank', 'USD', '100');
      const food = await category('expense');
      unwrap(await services.planning.createBudget(budgetInput(food, { amount: '150' })));

      const projection = unwrap(
        await services.planning.projectCashFlow({ ...horizon, includeBudgets: true }),
      );
      expect(projection.total.balances.at(-2)).toBe(100_00n);
      expect(projection.total.balances.at(-1)).toBe(-50_00n);
      expect(bank).toBeTruthy();
    });

    it('reserves nothing for an overspent budget', async () => {
      const bank = await account('Bank', 'USD', '100');
      const food = await category('expense');
      unwrap(await services.planning.createBudget(budgetInput(food, { amount: '10' })));
      await expense(bank, '20', TODAY, food);

      const projection = unwrap(
        await services.planning.projectCashFlow({ horizonDays: 30, includeBudgets: true }),
      );
      expect(projection.total.balances.at(-1)).toBe(80_00n);
    });

    it('reports a budget currency with no rate instead of reserving zero', async () => {
      await account('Bank', 'USD', '100');
      const food = await category('expense');
      unwrap(
        await services.planning.createBudget(budgetInput(food, { currencyCode: 'EUR' })),
      );

      const projection = unwrap(
        await services.planning.projectCashFlow({ horizonDays: 30, includeBudgets: true }),
      );
      expect(projection.total.missingRates).toEqual(['EUR']);
      expect(projection.total.balances.at(-1)).toBe(100_00n);
    });

    describe('budgets and expected flows', () => {
      const month = { horizonDays: 30, includeBudgets: true };

      const planRent = async (bank: string, categoryId: string, startOn = '2026-03-15') =>
        unwrap(
          await services.planning.createItem(
            recurringInput(bank, {
              amount: '40',
              categoryId,
              schedule: daily({ startOn, endOn: startOn }),
            }),
          ),
        );

      it('does not reserve what a recurring expense in the budget already takes', async () => {
        const bank = await account('Bank', 'USD', '1000');
        const food = await category('expense');
        unwrap(await services.planning.createBudget(budgetInput(food)));
        await planRent(bank, food);

        const projection = unwrap(await services.planning.projectCashFlow(month));
        expect(projection.total.balances.at(-1)).toBe(900_00n);
      });

      it('counts a pending occurrence in its budget', async () => {
        const bank = await account('Bank', 'USD', '1000');
        const food = await category('expense');
        unwrap(await services.planning.createBudget(budgetInput(food)));
        await planRent(bank, food, TODAY);
        await services.planning.materializeDue();

        const projection = unwrap(await services.planning.projectCashFlow(month));
        expect(projection.total.balances.at(-1)).toBe(900_00n);
      });

      it('reserves a category once across overlapping budgets', async () => {
        const bank = await account('Bank', 'USD', '1000');
        const food = await category('expense');
        unwrap(await services.planning.createBudget(budgetInput(food, { name: 'A' })));
        unwrap(await services.planning.createBudget(budgetInput(food, { name: 'B' })));
        await planRent(bank, food);

        const projection = unwrap(await services.planning.projectCashFlow(month));
        expect(projection.total.balances.at(-1)).toBe(900_00n);
      });

      it('reports a rate a budget left out of its spending', async () => {
        const dollars = await account('Bank', 'USD', '100');
        const euros = await account('Euros', 'EUR', '5');
        const food = await category('expense');
        unwrap(await services.planning.createBudget(budgetInput(food, { amount: '10' })));
        await expense(euros, '5', TODAY, food);
        await expense(dollars, '20', TODAY, food);

        const projection = unwrap(await services.planning.projectCashFlow(month));
        expect(projection.total.missingRates).toEqual(['EUR']);
      });

      it('reserves nothing for a budget that has not started', async () => {
        await account('Bank', 'USD', '100');
        const food = await category('expense');
        const period = { kind: 'custom', startOn: '2026-03-20', lengthDays: 7 } as const;
        unwrap(await services.planning.createBudget(budgetInput(food, { period })));

        const projection = unwrap(await services.planning.projectCashFlow(month));
        expect(projection.total.balances.at(-1)).toBe(100_00n);
      });

      it('drops a transfer whose other side is not projected', async () => {
        const bank = await account('Bank', 'USD', '100');
        const old = await account('Old');
        unwrap(
          await services.planning.createItem(
            recurringInput(bank, { kind: 'transfer', toAccountId: old }),
          ),
        );
        await archive(old);

        const projection = unwrap(await services.planning.projectCashFlow(horizon));
        expect(projection.total.balances).toEqual(Array(6).fill(100_00n));
      });
    });

    it('leaves out archived accounts', async () => {
      const bank = await account('Bank', 'USD', '100');
      const old = await account('Old', 'USD', '100');
      await archive(old);

      const projection = unwrap(await services.planning.projectCashFlow(horizon));
      expect(projection.accounts.map(({ accountId }) => accountId)).toEqual([bank]);
    });

    it('adds flows from an expected cash flow source', async () => {
      const bank = await account('Bank', 'USD', '100');
      const expectedFlows = jest.fn(async () => [
        { day: addDays(TODAY, 1), accountId: bank, minor: 25_00n, label: 'Rent received' },
      ]);
      const withSource = servicesOn(driver, [{ expectedFlows }]);

      const projection = unwrap(await withSource.planning.projectCashFlow(horizon));

      expect(expectedFlows).toHaveBeenCalledWith({ from: TODAY, to: addDays(TODAY, 5) });
      expect(projection.accounts[0].balances.slice(0, 2)).toEqual([100_00n, 125_00n]);
    });

    it.each([0, -1, 1.5, 10000])('refuses a horizon of %d days', async (horizonDays) => {
      expect(
        (await services.planning.projectCashFlow({ horizonDays, includeBudgets: false })).ok,
      ).toBe(false);
    });
  });
});
