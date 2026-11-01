import {
  latestValuation,
  sellAsset,
  validateAsset,
  validateStream,
  validateValuation,
  type Asset,
  type ExpectedStream,
  type Valuation,
} from './asset';

const TODAY = '2026-03-10';

const asset = (change: Partial<Asset> = {}): Asset => ({
  id: 'a1',
  name: ' Flat ',
  typeId: 't1',
  currencyCode: 'USD',
  accountId: null,
  status: 'active',
  soldOn: null,
  notes: ' ',
  ...change,
});

const valuation = (change: Partial<Valuation> = {}): Valuation => ({
  id: 'v1',
  assetId: 'a1',
  valuedOn: TODAY,
  amount: 100_00n,
  ...change,
});

const stream = (change: Partial<ExpectedStream> = {}): ExpectedStream => ({
  id: 's1',
  assetId: 'a1',
  name: ' Rent ',
  kind: 'income',
  categoryId: null,
  amount: 10_00n,
  schedule: { unit: 'month', every: 1, startOn: TODAY, endOn: null, dayOfMonth: null },
  ...change,
});

describe('validateAsset', () => {
  it('trims what the user typed', () => {
    expect(validateAsset(asset())).toEqual({
      ok: true,
      value: expect.objectContaining({ name: 'Flat', notes: '' }),
    });
  });

  it.each<[string, Partial<Asset>]>([
    ['no name', { name: ' ' }],
    ['no type', { typeId: '' }],
    ['no currency', { currencyCode: '' }],
    ['a sold date on an active asset', { soldOn: TODAY }],
    ['a sold asset with no date', { status: 'sold' }],
  ])('refuses %s', (_, change) => {
    expect(validateAsset(asset(change))).toMatchObject({ ok: false, error: { code: 'invalid-asset' } });
  });
});

describe('sellAsset', () => {
  it('stops the asset on that date', () => {
    expect(sellAsset(asset(), '2026-03-01', TODAY)).toEqual({
      ok: true,
      value: expect.objectContaining({ status: 'sold', soldOn: '2026-03-01' }),
    });
  });

  it.each([
    ['a future date', '2026-03-11'],
    ['a date that does not exist', '2026-02-30'],
  ])('refuses %s', (_, soldOn) => {
    expect(sellAsset(asset(), soldOn, TODAY).ok).toBe(false);
  });
});

describe('validateValuation', () => {
  it('takes zero, since an asset can lose all its value', () => {
    expect(validateValuation(valuation({ amount: 0n }), TODAY).ok).toBe(true);
  });

  it.each<[string, Partial<Valuation>]>([
    ['a negative value', { amount: -1n }],
    ['a future date', { valuedOn: '2026-03-11' }],
    ['a broken date', { valuedOn: 'soon' }],
  ])('refuses %s', (_, change) => {
    expect(validateValuation(valuation(change), TODAY)).toMatchObject({
      ok: false,
      error: { code: 'invalid-valuation' },
    });
  });
});

describe('latestValuation', () => {
  it('goes by the date of the value, not the order it was entered in', () => {
    const newest = valuation({ id: 'v2', valuedOn: '2026-03-09' });
    const older = valuation({ id: 'v3', valuedOn: '2025-01-01' });
    expect(latestValuation([older, newest, valuation({ id: 'v4', valuedOn: '2026-01-01' })])).toBe(
      newest,
    );
  });

  it('is empty with no history', () => {
    expect(latestValuation([])).toBeNull();
  });
});

describe('validateStream', () => {
  it('trims the name and normalizes the schedule through planning', () => {
    const weekly = stream({
      schedule: { unit: 'week', every: 1, startOn: TODAY, endOn: null, dayOfMonth: 4 },
    });
    expect(validateStream(weekly)).toEqual({
      ok: true,
      value: expect.objectContaining({
        name: 'Rent',
        schedule: expect.objectContaining({ dayOfMonth: null }),
      }),
    });
  });

  it.each<[string, Partial<ExpectedStream>]>([
    ['no name', { name: '' }],
    ['a zero amount', { amount: 0n }],
    ['a transfer', { kind: 'transfer' as ExpectedStream['kind'] }],
  ])('refuses %s', (_, change) => {
    expect(validateStream(stream(change))).toMatchObject({
      ok: false,
      error: { code: 'invalid-stream' },
    });
  });

  it('refuses a schedule planning refuses', () => {
    const schedule = { ...stream().schedule, endOn: '2020-01-01' };
    expect(validateStream(stream({ schedule }))).toMatchObject({
      ok: false,
      error: { code: 'invalid-schedule' },
    });
  });
});
