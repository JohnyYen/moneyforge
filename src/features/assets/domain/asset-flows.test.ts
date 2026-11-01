import type { ExchangeRate } from '@/features/ledger/domain/exchange-rate';
import type { Currency } from '@/features/ledger/domain/currency';
import type { RecurringItem } from '@/features/planning/domain/recurring';

import {
  assignDueDates,
  expectedAssetFlows,
  expectedMovements,
  nearestDue,
  overlapsRecurring,
  paymentMeasure,
  streamDates,
} from './asset-flows';
import type { Asset, ExpectedStream, StreamPayment } from './asset';

const asset = (change: Partial<Asset> = {}): Asset => ({
  id: 'a1',
  name: 'Flat',
  typeId: 't1',
  currencyCode: 'USD',
  accountId: 'bank',
  status: 'active',
  soldOn: null,
  notes: '',
  ...change,
});

const monthly = { unit: 'month', every: 1, startOn: '2026-01-15', endOn: null, dayOfMonth: null } as const;

const stream = (change: Partial<ExpectedStream> = {}): ExpectedStream => ({
  id: 's1',
  assetId: 'a1',
  name: 'Rent',
  kind: 'income',
  amount: 10_00n,
  categoryId: null,
  schedule: monthly,
  ...change,
});

const payment = (change: Partial<StreamPayment> = {}): StreamPayment => ({
  transactionId: 't1',
  assetId: 'a1',
  streamId: 's1',
  dueOn: '2026-03-15',
  kind: 'income',
  day: '2026-03-15',
  minor: 10_00n,
  currency: 'USD',
  ...change,
});

const sameCurrency = paymentMeasure('USD', { rates: [], currencies: [] });

const range = { from: '2026-03-01', to: '2026-05-31' };

describe('streamDates', () => {
  it('uses the schedule, month-end clamp included', () => {
    const schedule = { ...monthly, startOn: '2026-01-31' };
    expect(streamDates(stream({ schedule }), asset(), '2026-02-01', '2026-03-31')).toEqual([
      '2026-02-28',
      '2026-03-31',
    ]);
  });

  it('honors the end of the schedule', () => {
    const schedule = { ...monthly, endOn: '2026-04-14' };
    expect(streamDates(stream({ schedule }), asset(), range.from, range.to)).toEqual(['2026-03-15']);
  });

  it('stops from the day of the sale, that day included', () => {
    const sold = asset({ status: 'sold', soldOn: '2026-04-15' });
    expect(streamDates(stream(), sold, range.from, range.to)).toEqual(['2026-03-15']);
  });
});

describe('expectedAssetFlows', () => {
  const flows = (input: {
    assets?: readonly Asset[];
    streams?: readonly ExpectedStream[];
    payments?: readonly StreamPayment[];
    from?: string;
  }) =>
    expectedAssetFlows({
      assets: input.assets ?? [asset()],
      streams: input.streams ?? [stream()],
      payments: input.payments ?? [],
      rates: [],
      currencies: [],
      ...range,
      from: input.from ?? range.from,
    });

  it('signs income and expense on the linked account', () => {
    const paid = flows({ streams: [stream(), stream({ id: 's2', kind: 'expense', amount: 3_00n })] });
    expect(paid.filter(({ day }) => day === '2026-03-15')).toEqual([
      { day: '2026-03-15', accountId: 'bank', minor: 10_00n, label: 'Flat: Rent', categoryId: null },
      { day: '2026-03-15', accountId: 'bank', minor: -3_00n, label: 'Flat: Rent', categoryId: null },
    ]);
  });

  it('skips a date a transaction of that stream already covers', () => {
    expect(flows({ payments: [payment()] }).map(({ day }) => day)).toEqual([
      '2026-04-15',
      '2026-05-15',
    ]);
  });

  it.each<[string, Partial<StreamPayment>]>([
    ['another stream', { streamId: 's2' }],
    ['another date', { dueOn: '2026-02-15' }],
    ['no stream', { streamId: null, dueOn: null }],
    ['too little money', { minor: 1_00n }],
    ['a payment that became an expense', { kind: 'expense' }],
    ['a payment that became a transfer', { kind: 'transfer' }],
  ])('keeps a date covered only by %s', (_, change) => {
    expect(flows({ payments: [payment(change)] })).toHaveLength(3);
  });

  it('covers a date once its payments reach the amount together', () => {
    const half = { minor: 5_00n };
    const payments = [payment({ ...half }), payment({ ...half, transactionId: 't2' })];
    expect(flows({ payments }).map(({ day }) => day)).toEqual(['2026-04-15', '2026-05-15']);
  });

  it('passes the category on, so a budget can recognize the flow', () => {
    const [flow] = flows({ streams: [stream({ kind: 'expense', categoryId: 'food' })] });
    expect(flow).toMatchObject({ categoryId: 'food', minor: -10_00n });
  });

  describe('overdue expenses', () => {
    const today = '2026-03-20';
    const rent = stream({ kind: 'expense' });
    const days = (input: Parameters<typeof flows>[0]) =>
      flows({ streams: [rent], from: today, ...input }).map(({ day }) => day);

    it('carries unpaid past dates to today', () => {
      expect(days({})).toEqual([today, today, today, '2026-04-15', '2026-05-15']);
    });

    it('leaves out a past date that was paid', () => {
      const payments = [payment({ kind: 'expense', dueOn: '2026-02-15', day: '2026-02-15' })];
      expect(days({ payments })).toEqual([today, today, '2026-04-15', '2026-05-15']);
    });

    it('looks back 90 days at most', () => {
      const schedule = { ...monthly, startOn: '2025-01-15' };
      expect(days({ streams: [stream({ kind: 'expense', schedule })] })).toEqual([
        today,
        today,
        today,
        '2026-04-15',
        '2026-05-15',
      ]);
      const weekly = { ...monthly, unit: 'week', startOn: '2025-12-13' } as const;
      const carried = days({ streams: [stream({ kind: 'expense', schedule: weekly })] });
      expect(carried.filter((day) => day === today)).toHaveLength(13);
    });

    it('starts no earlier than the stream', () => {
      const schedule = { ...monthly, startOn: '2026-03-15' };
      expect(days({ streams: [stream({ kind: 'expense', schedule })] })).toEqual([
        today,
        '2026-04-15',
        '2026-05-15',
      ]);
    });

    it('stops at a sale', () => {
      const sold = asset({ status: 'sold', soldOn: '2026-02-20' });
      expect(days({ assets: [sold] })).toEqual([today, today]);
    });

    it('does not carry income', () => {
      expect(days({ streams: [stream()] })).toEqual(['2026-04-15', '2026-05-15']);
    });
  });

  it('expects nothing in an account from an asset with none', () => {
    expect(flows({ assets: [asset({ accountId: null })] })).toEqual([]);
  });

  it('stops a sold asset', () => {
    const sold = asset({ status: 'sold', soldOn: '2026-04-01' });
    expect(flows({ assets: [sold] }).map(({ day }) => day)).toEqual(['2026-03-15']);
  });
});

describe('expectedMovements', () => {
  it('counts streams with no account too, in the currency of the asset', () => {
    expect(expectedMovements(asset({ accountId: null }), [stream()], range.from, '2026-03-31')).toEqual([
      { day: '2026-03-15', kind: 'income', minor: 10_00n, currency: 'USD' },
    ]);
  });
});

describe('nearestDue', () => {
  it('takes the closer date on either side', () => {
    expect(nearestDue(monthly, '2026-03-14', new Set())).toBe('2026-03-15');
    expect(nearestDue(monthly, '2026-03-20', new Set())).toBe('2026-03-15');
    expect(nearestDue(monthly, '2026-04-01', new Set())).toBe('2026-04-15');
  });

  it('skips a date already taken', () => {
    const taken = new Set(['2026-02-15', '2026-03-15']);
    expect(nearestDue(monthly, '2026-03-14', taken)).toBe('2026-04-15');
  });

  it('is empty long after a schedule ended', () => {
    const ended = { ...monthly, endOn: '2026-01-20' };
    expect(nearestDue(ended, '2026-09-01', new Set())).toBeNull();
  });

  it('prefers an open past date within half a step over a closer future one', () => {
    expect(nearestDue(monthly, '2026-03-02', new Set())).toBe('2026-02-15');
  });

  it('takes the next date when the past one is further than half a step', () => {
    expect(nearestDue(monthly, '2026-03-05', new Set())).toBe('2026-03-15');
  });

  it('passes over a past date already taken', () => {
    expect(nearestDue(monthly, '2026-03-02', new Set(['2026-02-15']))).toBe('2026-03-15');
  });
});

describe('assignDueDates', () => {
  const rent = stream({ schedule: { ...monthly, startOn: '2026-03-15' } });
  const assigned = (payments: readonly StreamPayment[]) =>
    Object.fromEntries(assignDueDates(rent, payments, sameCurrency));

  it('keeps payments on a date until they reach the amount, then opens the next', () => {
    const half = { day: '2026-03-15', minor: 5_00n, dueOn: null };
    const payments = [
      payment({ ...half, transactionId: 't1' }),
      payment({ ...half, transactionId: 't2' }),
      payment({ ...half, transactionId: 't3' }),
    ];
    expect(assigned(payments)).toEqual({
      t1: '2026-03-15',
      t2: '2026-03-15',
      t3: '2026-04-15',
    });
  });

  it('lets a stray amount share the date with the real payment', () => {
    const payments = [
      payment({ transactionId: 't1', day: '2026-03-14', minor: 1_00n }),
      payment({ transactionId: 't2', minor: 10_00n }),
    ];
    expect(assigned(payments)).toEqual({ t1: '2026-03-15', t2: '2026-03-15' });
  });

  it('fills dates oldest payment first, whatever order they arrive in', () => {
    const payments = [
      payment({ transactionId: 'later', day: '2026-03-16' }),
      payment({ transactionId: 'earlier', day: '2026-03-14' }),
    ];
    expect(assigned(payments)).toEqual({ earlier: '2026-03-15', later: '2026-04-15' });
  });

  it('leaves out other streams and other kinds', () => {
    const payments = [payment({ streamId: 's2' }), payment({ transactionId: 't2', kind: 'transfer' })];
    expect(assigned(payments)).toEqual({});
  });

  it('measures another currency at the rate of its day, and an unknown rate as nothing', () => {
    const usd: Currency = { code: 'USD', name: 'Dollar', decimals: 2, symbol: '$', kind: 'fiat' };
    const eur: Currency = { ...usd, code: 'EUR', name: 'Euro' };
    const rates: ExchangeRate[] = [
      { id: 'r', fromCode: 'EUR', toCode: 'USD', rate: '2', effectiveOn: '2026-01-01' },
    ];
    const measure = paymentMeasure('USD', { rates, currencies: [usd, eur] });
    expect(measure(payment({ currency: 'EUR', minor: 5_00n }))).toBe(10_00n);
    expect(measure(payment({ currency: 'COP', minor: 5_00n }))).toBe(0n);
  });
});

describe('overlapsRecurring', () => {
  const item = (change: Partial<RecurringItem> = {}): RecurringItem => ({
    id: 'r1',
    name: 'Rent',
    kind: 'income',
    accountId: 'bank',
    toAccountId: null,
    amount: 10_00n,
    currencyCode: 'USD',
    categoryId: null,
    schedule: { ...monthly, startOn: '2026-02-01' },
    mode: 'ask',
    applySplit: false,
    active: true,
    materializedThrough: null,
    ...change,
  });

  it('matches the same money on the same account and cadence, in overlapping ranges', () => {
    expect(overlapsRecurring(stream(), 'bank', item())).toBe(true);
  });

  it.each<[string, Partial<RecurringItem>]>([
    ['another account', { accountId: 'other' }],
    ['another amount', { amount: 11_00n }],
    ['another kind', { kind: 'expense' }],
    ['an item that stopped', { active: false }],
    ['another cadence', { schedule: { ...monthly, unit: 'week' } }],
    ['a range that ended first', { schedule: { ...monthly, startOn: '2025-01-01', endOn: '2025-12-01' } }],
  ])('ignores %s', (_, change) => {
    expect(overlapsRecurring(stream(), 'bank', item(change))).toBe(false);
  });
});
