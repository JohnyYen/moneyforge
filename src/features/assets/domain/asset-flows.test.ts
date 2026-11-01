import { expectedAssetFlows, expectedMovements, nearestDue, streamDates } from './asset-flows';
import type { Asset, ExpectedStream, TransactionLink } from './asset';

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
  schedule: monthly,
  ...change,
});

const link = (change: Partial<TransactionLink> = {}): TransactionLink => ({
  transactionId: 't1',
  assetId: 'a1',
  streamId: 's1',
  dueOn: '2026-03-15',
  ...change,
});

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
    links?: readonly TransactionLink[];
  }) =>
    expectedAssetFlows({
      assets: input.assets ?? [asset()],
      streams: input.streams ?? [stream()],
      links: input.links ?? [],
      ...range,
    });

  it('signs income and expense on the linked account', () => {
    const paid = flows({ streams: [stream(), stream({ id: 's2', kind: 'expense', amount: 3_00n })] });
    expect(paid.filter(({ day }) => day === '2026-03-15')).toEqual([
      { day: '2026-03-15', accountId: 'bank', minor: 10_00n, label: 'Flat: Rent' },
      { day: '2026-03-15', accountId: 'bank', minor: -3_00n, label: 'Flat: Rent' },
    ]);
  });

  it('skips a date a transaction of that stream already covers', () => {
    expect(flows({ links: [link()] }).map(({ day }) => day)).toEqual(['2026-04-15', '2026-05-15']);
  });

  it.each<[string, Partial<TransactionLink>]>([
    ['another stream', { streamId: 's2' }],
    ['another date', { dueOn: '2026-02-15' }],
    ['no stream', { streamId: null, dueOn: null }],
  ])('keeps a date covered only by %s', (_, change) => {
    expect(flows({ links: [link(change)] })).toHaveLength(3);
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
});
