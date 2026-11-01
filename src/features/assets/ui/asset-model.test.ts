import type { Currency } from '@/features/ledger/domain/currency';

import type { Asset, ExpectedStream, Valuation } from '../domain/asset';
import {
  assetRow,
  emptyStreamDraft,
  linkInputFor,
  NO_SELECTION,
  percentLabel,
  rangeLabel,
  reportRange,
  toAssetDraft,
  toAssetInput,
  toStreamDraft,
  toStreamInput,
} from './asset-model';

const usd: Currency = { code: 'USD', name: 'Dollar', decimals: 2, symbol: '$', kind: 'fiat' };
const currencies = new Map([['USD', usd]]);

const asset: Asset = {
  id: 'a1',
  name: 'Flat',
  typeId: 't1',
  currencyCode: 'USD',
  accountId: null,
  status: 'active',
  soldOn: null,
  notes: '',
};

const valuation: Valuation = { id: 'v1', assetId: 'a1', valuedOn: '2026-01-01', amount: 5_00n };

const stream: ExpectedStream = {
  id: 's1',
  assetId: 'a1',
  name: 'Rent',
  kind: 'income',
  amount: 12_50n,
  schedule: { unit: 'month', every: 2, startOn: '2026-01-01', endOn: null, dayOfMonth: 15 },
};

describe('percentLabel', () => {
  it('reads an exact ratio as a percentage', () => {
    expect(percentLabel({ numerator: 3n, denominator: 100n })).toBe('3.00%');
    expect(percentLabel({ numerator: -1n, denominator: 3n })).toBe('-33.33%');
    expect(percentLabel({ numerator: 2n, denominator: 3n })).toBe('66.67%');
  });

  it('has nothing to read with no ratio', () => {
    expect(percentLabel(null)).toBeNull();
  });
});

describe('reportRange', () => {
  it('covers the calendar month and year holding today', () => {
    expect(reportRange('month', '2026-03-10')).toEqual({ from: '2026-03-01', to: '2026-03-31' });
    expect(reportRange('year', '2026-03-10')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });

  it('ends a trailing year today', () => {
    expect(reportRange('twelve-months', '2026-03-10')).toEqual({
      from: '2025-03-11',
      to: '2026-03-10',
    });
  });
});

describe('assetRow', () => {
  const types = [{ id: 't1', name: 'Home', archived: false }];

  it('shows the type and the latest value', () => {
    expect(assetRow({ asset, latest: valuation }, types, currencies)).toMatchObject({
      subtitle: 'Home',
      trailing: '$5.00',
    });
  });

  it('never shows a missing value as zero, and says when it was sold', () => {
    const sold = { ...asset, status: 'sold', soldOn: '2026-02-01' } as const;
    expect(assetRow({ asset: sold, latest: null }, types, currencies)).toMatchObject({
      subtitle: 'Home. Sold on 2026-02-01',
      trailing: 'No value yet',
    });
  });
});

describe('drafts', () => {
  it('round trips an asset, with an empty account as null', () => {
    expect(toAssetInput(toAssetDraft(asset))).toMatchObject({ accountId: null, name: 'Flat' });
  });

  it('round trips a stream through planning schedule drafts', () => {
    expect(toStreamInput(toStreamDraft(stream, usd))).toEqual({
      name: 'Rent',
      kind: 'income',
      amount: '12.50',
      schedule: stream.schedule,
    });
  });

  it('starts a stream monthly from today', () => {
    expect(toStreamInput(emptyStreamDraft('2026-03-10')).schedule).toEqual({
      unit: 'month',
      every: 1,
      startOn: '2026-03-10',
      endOn: null,
      dayOfMonth: null,
    });
  });
});

describe('linkInputFor', () => {
  const selection = { assetId: 'a1', stream };

  it('links income to its stream', () => {
    expect(linkInputFor({ id: 't1', kind: 'income' }, selection)).toEqual({
      transactionId: 't1',
      assetId: 'a1',
      streamId: 's1',
    });
  });

  it('falls back to the asset alone for a stream of the other kind', () => {
    expect(linkInputFor({ id: 't1', kind: 'expense' }, selection)?.streamId).toBeNull();
  });

  it('links nothing for a transfer or with no choice', () => {
    expect(linkInputFor({ id: 't1', kind: 'transfer' }, selection)).toBeNull();
    expect(linkInputFor({ id: 't1', kind: 'income' }, NO_SELECTION)).toBeNull();
  });
});

describe('rangeLabel', () => {
  it('names both ends', () => {
    expect(rangeLabel('2026-03-01', '2026-03-31')).toBe('Mar 1, 2026 to Mar 31, 2026');
  });
});
