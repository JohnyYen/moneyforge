import type { Account } from '@/features/ledger/domain/account';
import type { Currency } from '@/features/ledger/domain/currency';
import type { RecurringItem } from '@/features/planning/domain/recurring';
import { err, ok } from '@/shared/result';

import type { Asset, ExpectedStream, Valuation } from '../domain/asset';
import {
  assetRow,
  droppedSelectionNotice,
  emptyStreamDraft,
  linkAfterSave,
  linkInputFor,
  NO_SELECTION,
  overdueStartNotice,
  percentLabel,
  projectionNotices,
  shownNotices,
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
  categoryId: null,
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
      categoryId: null,
      schedule: stream.schedule,
    });
    expect(toStreamInput(toStreamDraft({ ...stream, categoryId: 'food' }, usd)).categoryId).toBe('food');
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

describe('droppedSelectionNotice', () => {
  const selection = { assetId: 'a1', stream };

  it('says so when a transfer cannot link', () => {
    expect(droppedSelectionNotice({ kind: 'transfer' }, selection)).toMatch(/not linked/);
  });

  it('says so when the stream is of the other kind', () => {
    expect(droppedSelectionNotice({ kind: 'expense' }, selection)).toMatch(/Rent is income/);
  });

  it('stays quiet when nothing was dropped', () => {
    expect(droppedSelectionNotice({ kind: 'income' }, selection)).toBeNull();
    expect(droppedSelectionNotice({ kind: 'transfer' }, NO_SELECTION)).toBeNull();
  });
});

describe('linkAfterSave', () => {
  const selection = { assetId: 'a1', stream };
  const income = { id: 't1', kind: 'income' } as const;

  it('links quietly', async () => {
    const link = jest.fn(async () => ok(undefined));
    await expect(linkAfterSave(income, selection, link)).resolves.toBeNull();
    expect(link).toHaveBeenCalledWith({ transactionId: 't1', assetId: 'a1', streamId: 's1' });
  });

  it('turns a refused link into a notice instead of failing the saved entry', async () => {
    const link = async () => err({ message: 'Asset not found.' });
    await expect(linkAfterSave(income, selection, link)).resolves.toBe(
      'Saved, not linked. Asset not found.',
    );
  });

  it('turns a thrown failure into a notice too', async () => {
    const link = async () => {
      throw new Error('disk full');
    };
    await expect(linkAfterSave(income, selection, link)).resolves.toBe(
      'Saved, not linked. Link it from the transaction.',
    );
  });

  it('reports a dropped selection without calling for a link', async () => {
    const link = jest.fn(async () => ok(undefined));
    const notice = await linkAfterSave({ id: 't1', kind: 'transfer' }, selection, link);
    expect(notice).toMatch(/not linked/);
    expect(link).not.toHaveBeenCalled();
  });
});

describe('overdueStartNotice', () => {
  const today = '2026-03-10';

  it('says recent dates of an expense with a past start count as owed', () => {
    expect(overdueStartNotice({ kind: 'expense', startOn: '2024-01-01' }, today)).toMatch(
      /last 90 days .* count as owed today/,
    );
  });

  it('stays quiet for income, from today on, and on text that is not yet a date', () => {
    expect(overdueStartNotice({ kind: 'income', startOn: '2024-01-01' }, today)).toBeNull();
    expect(overdueStartNotice({ kind: 'expense', startOn: today }, today)).toBeNull();
    expect(overdueStartNotice({ kind: 'expense', startOn: '20' }, today)).toBeNull();
  });
});

describe('shownNotices', () => {
  const notice = (assetId: string, message: string) => ({ assetId, message });

  it('keeps every asset with none named, and one asset when named', () => {
    const notices = [notice('a1', 'One'), notice('a2', 'Two')];
    expect(shownNotices(notices)).toEqual(['One', 'Two']);
    expect(shownNotices(notices, 'a2')).toEqual(['Two']);
  });

  it('says a repeated message once, since it also keys the row', () => {
    expect(shownNotices([notice('a1', 'One'), notice('a2', 'One')])).toEqual(['One']);
  });
});

describe('projectionNotices', () => {
  const bank: Account = {
    id: 'bank',
    name: 'Bank',
    type: 'Bank',
    currencyCode: 'USD',
    openingBalance: 0n,
    archived: false,
    systemRole: null,
    groupId: null,
  };
  const item: RecurringItem = {
    id: 'r1',
    name: 'Tenant',
    kind: 'income',
    accountId: 'bank',
    toAccountId: null,
    amount: 12_50n,
    currencyCode: 'USD',
    categoryId: null,
    schedule: { ...stream.schedule, dayOfMonth: null },
    mode: 'ask',
    applySplit: false,
    active: true,
    materializedThrough: null,
  };
  const notices = (change: Partial<Parameters<typeof projectionNotices>[0]>) =>
    projectionNotices({
      assets: [asset],
      streams: [stream],
      accounts: [bank],
      items: [],
      today: '2026-03-10',
      ...change,
    }).map(({ message }) => message);

  it('names an archived linked account', () => {
    const linked = { ...asset, accountId: 'bank' };
    expect(notices({ assets: [linked], accounts: [{ ...bank, archived: true }] })).toEqual([
      'Flat: Bank is archived, so the projection leaves out Rent.',
    ]);
  });

  it('asks for a link when an account in the currency exists', () => {
    expect(notices({})).toEqual(['Flat: link an account to see Rent in the projection.']);
  });

  it('says when no open account is in the currency of the asset', () => {
    const expected = ['Flat: no account in USD, so the projection leaves out Rent.'];
    expect(notices({ accounts: [] })).toEqual(expected);
    expect(notices({ accounts: [{ ...bank, archived: true }] })).toEqual(expected);
  });

  it('warns about a recurring item that looks like the same money', () => {
    const linked = { ...asset, accountId: 'bank' };
    expect(notices({ assets: [linked], items: [item] })).toEqual([
      'Flat: Rent looks like the recurring item Tenant on the same account. Both count in the projection.',
    ]);
  });

  it('says nothing about a projected stream, a sold asset, or a stream that ended', () => {
    expect(notices({ assets: [{ ...asset, accountId: 'bank' }] })).toEqual([]);
    expect(notices({ assets: [{ ...asset, status: 'sold', soldOn: '2026-01-01' }] })).toEqual([]);
    const ended = { ...stream, schedule: { ...stream.schedule, endOn: '2026-02-01' } };
    expect(notices({ streams: [ended] })).toEqual([]);
  });
});

describe('rangeLabel', () => {
  it('names both ends', () => {
    expect(rangeLabel('2026-03-01', '2026-03-31')).toBe('Mar 1, 2026 to Mar 31, 2026');
  });
});
