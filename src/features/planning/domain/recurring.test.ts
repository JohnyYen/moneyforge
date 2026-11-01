import {
  flowsOfOccurrence,
  occurrenceFrom,
  recurringFlows,
  validateRecurringFields,
  type RecurringItem,
} from './recurring';

const item = (change: Partial<RecurringItem> = {}): RecurringItem => ({
  id: 'r1',
  name: 'Rent',
  kind: 'expense',
  accountId: 'a',
  toAccountId: null,
  amount: 10_00n,
  currencyCode: 'USD',
  categoryId: 'housing',
  schedule: { unit: 'day', every: 1, startOn: '2026-03-01', endOn: null, dayOfMonth: null },
  mode: 'ask',
  applySplit: false,
  active: true,
  materializedThrough: '2026-03-10',
  ...change,
});

describe('occurrenceFrom', () => {
  it('copies what posting needs, so a later edit cannot reach it', () => {
    expect(occurrenceFrom(item(), '2026-03-11', 'o1')).toEqual({
      id: 'o1',
      itemId: 'r1',
      dueOn: '2026-03-11',
      status: 'pending',
      kind: 'expense',
      accountId: 'a',
      toAccountId: null,
      amount: 10_00n,
      currencyCode: 'USD',
      categoryId: 'housing',
      description: 'Rent',
      applySplit: false,
      transactionId: null,
      note: null,
    });
  });
});

describe('flows', () => {
  const flow = (kind: RecurringItem['kind'], toAccountId: string | null = null) =>
    flowsOfOccurrence({ ...occurrenceFrom(item({ kind, toAccountId }), '2026-03-11', 'o1') }, '2026-03-11');

  it('signs income and expense', () => {
    expect(flow('income').map(({ minor }) => minor)).toEqual([10_00n]);
    expect(flow('expense').map(({ minor }) => minor)).toEqual([-10_00n]);
  });

  it('moves a transfer between its accounts and leaves the total alone', () => {
    expect(flow('transfer', 'b').map(({ accountId, minor }) => [accountId, minor])).toEqual([
      ['a', -10_00n],
      ['b', 10_00n],
    ]);
  });
});

describe('recurringFlows', () => {
  const window = { today: '2026-03-10', until: '2026-03-13' };

  it('starts after what is already materialized', () => {
    const flows = recurringFlows([item()], [], window);
    expect(flows.map(({ day }) => day)).toEqual(['2026-03-11', '2026-03-12', '2026-03-13']);
  });

  it('moves dates not yet materialized up to today', () => {
    const flows = recurringFlows([item({ materializedThrough: '2026-03-08' })], [], window);
    expect(flows.map(({ day }) => day)).toEqual([
      '2026-03-10',
      '2026-03-10',
      '2026-03-11',
      '2026-03-12',
      '2026-03-13',
    ]);
  });

  it('counts a pending occurrence as due today', () => {
    const pending = occurrenceFrom(item(), '2026-03-02', 'o1');
    const flows = recurringFlows([], [pending], window);
    expect(flows).toEqual([expect.objectContaining({ day: '2026-03-10', minor: -10_00n })]);
  });

  it('leaves out archived items', () => {
    expect(recurringFlows([item({ active: false })], [], window)).toEqual([]);
  });

  it('starts from the schedule start when nothing was materialized', () => {
    const flows = recurringFlows(
      [item({ materializedThrough: null, schedule: { ...item().schedule, startOn: '2026-03-12' } })],
      [],
      window,
    );
    expect(flows.map(({ day }) => day)).toEqual(['2026-03-12', '2026-03-13']);
  });
});

describe('validateRecurringFields', () => {
  it('accepts an item and trims its name', () => {
    expect(validateRecurringFields(item({ name: ' Rent ' }))).toEqual({
      ok: true,
      value: expect.objectContaining({ name: 'Rent' }),
    });
  });

  it.each([
    ['no name', { name: ' ' }],
    ['a zero amount', { amount: 0n }],
    ['a bad kind', { kind: 'gift' as RecurringItem['kind'] }],
    ['a bad mode', { mode: 'maybe' as RecurringItem['mode'] }],
    ['a transfer with no target', { kind: 'transfer' as const, toAccountId: null }],
    ['a transfer to itself', { kind: 'transfer' as const, toAccountId: 'a' }],
    ['a split on an expense', { kind: 'expense' as const, applySplit: true }],
  ])('refuses %s', (_, change) => {
    expect(validateRecurringFields(item(change)).ok).toBe(false);
  });

  it('drops a target and a category that do not apply', () => {
    const income = validateRecurringFields(item({ kind: 'income', toAccountId: 'b' }));
    expect(income).toEqual({ ok: true, value: expect.objectContaining({ toAccountId: null }) });
    const transfer = validateRecurringFields(item({ kind: 'transfer', toAccountId: 'b' }));
    expect(transfer).toEqual({ ok: true, value: expect.objectContaining({ categoryId: null }) });
  });
});
