import { migrations } from '@/shared/persistence/migrations';
import { runMigrations } from '@/shared/persistence/migrator';
import { createNodeSqliteDriver } from '@/shared/persistence/node-sqlite-driver';
import type { SqlDriver } from '@/shared/persistence/sql-driver';

import type { Budget } from '../domain/budget';
import { occurrenceFrom, type RecurringItem } from '../domain/recurring';
import { createSqlitePlanningRepository } from './sqlite-planning-repository';

const HUGE = 123_456_789_012_345_678_901_234_567_890n;

describe('sqlite planning repository', () => {
  let driver: SqlDriver;
  const repository = () => createSqlitePlanningRepository(driver);

  beforeEach(async () => {
    driver = createNodeSqliteDriver();
    await runMigrations(driver, migrations);
    await driver.run(
      `INSERT INTO currencies (code, name, decimals, symbol, kind)
       VALUES ('USD', 'Dollar', 2, '$', 'fiat')`,
    );
    await driver.run(
      `INSERT INTO accounts (id, name, type, currency_code, opening_balance, archived)
       VALUES ('a', 'Bank', 'Bank', 'USD', '0', 0), ('b', 'Other', 'Bank', 'USD', '0', 0)`,
    );
    await driver.run(
      `INSERT INTO categories (id, name, kind, archived)
       VALUES ('c1', 'Food', 'expense', 0), ('c2', 'Fun', 'expense', 0)`,
    );
  });

  afterEach(() => driver.close());

  const budget = (change: Partial<Budget> = {}): Budget => ({
    id: 'b1',
    name: 'Food',
    currencyCode: 'USD',
    amount: HUGE,
    categoryIds: ['c1', 'c2'],
    period: { kind: 'monthly', startDay: 25 },
    startsOn: '2026-01-01',
    rollover: true,
    active: true,
    ...change,
  });

  const item = (change: Partial<RecurringItem> = {}): RecurringItem => ({
    id: 'r1',
    name: 'Rent',
    kind: 'transfer',
    accountId: 'a',
    toAccountId: 'b',
    amount: HUGE,
    currencyCode: 'USD',
    categoryId: null,
    schedule: { unit: 'month', every: 2, startOn: '2026-01-31', endOn: '2027-01-01', dayOfMonth: 15 },
    mode: 'auto',
    applySplit: false,
    active: true,
    materializedThrough: '2026-02-01',
    ...change,
  });

  it.each([
    [{ kind: 'weekly', startDay: 7 }],
    [{ kind: 'monthly', startDay: null }],
    [{ kind: 'yearly', startMonth: 4, startDay: 6 }],
    [{ kind: 'custom', startOn: '2026-01-05', lengthDays: 10 }],
  ] as const)('round-trips a budget with period %j', async (period) => {
    await repository().saveBudget(budget({ period }));
    expect(await repository().getBudget('b1')).toEqual(budget({ period }));
  });

  it('replaces the categories of a saved budget', async () => {
    await repository().saveBudget(budget());
    await repository().saveBudget(budget({ categoryIds: ['c2'] }));
    expect((await repository().listBudgets())[0].categoryIds).toEqual(['c2']);
  });

  it('lets one category sit in two budgets', async () => {
    await repository().saveBudget(budget());
    await repository().saveBudget(budget({ id: 'b2' }));
    expect(await repository().listBudgets()).toHaveLength(2);
  });

  it('round-trips an item and an occurrence', async () => {
    await repository().saveItem(item());
    expect(await repository().getItem('r1')).toEqual(item());

    const occurrence = occurrenceFrom(item(), '2026-03-15', 'o1');
    await repository().saveOccurrence(occurrence);
    expect(await repository().getOccurrence('o1')).toEqual(occurrence);
    expect(await repository().findOccurrence('r1', '2026-03-15')).toEqual(occurrence);
    expect(await repository().findOccurrence('r1', '2026-03-16')).toBeNull();
  });

  it('refuses a second occurrence for one item and date', async () => {
    await repository().saveItem(item());
    await repository().saveOccurrence(occurrenceFrom(item(), '2026-03-15', 'o1'));
    await expect(
      repository().saveOccurrence(occurrenceFrom(item(), '2026-03-15', 'o2')),
    ).rejects.toThrow(/UNIQUE/);
  });

  it('never moves the materialized day back', async () => {
    await repository().saveItem(item());
    await repository().markMaterialized('r1', '2026-01-01');
    expect((await repository().getItem('r1'))?.materializedThrough).toBe('2026-02-01');
    await repository().markMaterialized('r1', '2026-03-01');
    expect((await repository().getItem('r1'))?.materializedThrough).toBe('2026-03-01');
  });

  it('round-trips a planned item', async () => {
    const planned = {
      id: 'p1',
      plannedOn: '2026-04-01',
      kind: 'expense',
      accountId: 'a',
      amount: HUGE,
      description: 'Laptop',
    } as const;
    await repository().savePlannedItem(planned);
    expect(await repository().listPlannedItems()).toEqual([planned]);
    await repository().removePlannedItem('p1');
    expect(await repository().listPlannedItems()).toEqual([]);
  });
});
