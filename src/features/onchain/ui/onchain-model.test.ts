import type { WatchedView } from '../application/watch-use-cases';
import {
  amountLabel,
  differenceLabel,
  reconcileTarget,
  refreshFailures,
  shortAddress,
  toChainInput,
  toTokenInput,
  toWatchedDraft,
  toWatchedInput,
  watchedSubtitle,
} from './onchain-model';

const view: WatchedView = {
  watched: {
    id: 'w1',
    chainId: 'c1',
    tokenId: 't1',
    address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    label: 'Main',
    accountId: 'a1',
    lastRead: { amount: 1_500_000n, decimals: 6, readAt: '2026-03-10T12:00:00.000Z' },
  },
  chain: {
    id: 'c1',
    name: 'Tron',
    family: 'tron',
    endpoint: 'https://api.trongrid.io',
    evmChainId: null,
  },
  token: { id: 't1', chainId: 'c1', symbol: 'USDT', contract: 'T', decimals: 6 },
  account: {
    id: 'a1',
    name: 'Wallet',
    type: 'Crypto',
    currencyCode: 'USDT',
    openingBalance: 0n,
    archived: false,
    systemRole: null,
  },
  currency: { code: 'USDT', name: 'Tether', decimals: 2, symbol: '$', kind: 'stablecoin' },
  stale: false,
  comparison: { status: 'differs', counted: 150n, difference: 50n },
};

const withComparison = (comparison: WatchedView['comparison']): WatchedView => ({
  ...view,
  comparison,
});

describe('labels', () => {
  it('shortens an address', () => {
    expect(shortAddress(view.watched.address)).toBe('TR7NHq...gjLj6t');
  });

  it('shows an amount exactly, at the decimals it was read with', () => {
    expect(
      amountLabel(
        { amount: 1234567890123456789012n, decimals: 18, readAt: '' },
        'USDT',
      ),
    ).toBe('USDT 1,234.567890123456789012');
    expect(amountLabel(null, 'USDT')).toBe('Not read yet');
  });

  it('marks a stale value in the list', () => {
    expect(watchedSubtitle(view)).toBe('USDT on Tron. USDT 1.50.');
    expect(watchedSubtitle({ ...view, stale: true })).toBe('USDT on Tron. USDT 1.50. Stale.');
  });
});

describe('differenceLabel', () => {
  it('says which side is higher, in the account currency', () => {
    expect(differenceLabel(view)).toBe('On-chain is $0.50 above Wallet in MoneyForge.');
    expect(differenceLabel(withComparison({ status: 'differs', counted: 0n, difference: -50n })))
      .toBe('On-chain is $0.50 below Wallet in MoneyForge.');
  });

  it('says when both agree, or agree as far as the account can record', () => {
    expect(differenceLabel(withComparison({ status: 'matches', counted: 1n, difference: 0n })))
      .toBe('Matches Wallet in MoneyForge.');
    expect(
      differenceLabel(withComparison({ status: 'within-precision', counted: 1n, difference: 0n })),
    ).toBe('Matches Wallet to the 2 decimals it keeps.');
  });

  it('is empty with nothing to compare', () => {
    expect(differenceLabel(withComparison(null))).toBeNull();
  });
});

describe('reconcileTarget', () => {
  it('fills the existing form with what the account can record', () => {
    expect(reconcileTarget(view)).toEqual({ id: 'a1', counted: '1.50' });
  });

  it('offers nothing when there is no difference to settle', () => {
    expect(reconcileTarget(withComparison(null))).toBeNull();
    expect(
      reconcileTarget(withComparison({ status: 'matches', counted: 150n, difference: 0n })),
    ).toBeNull();
    expect(
      reconcileTarget(
        withComparison({ status: 'within-precision', counted: 150n, difference: 0n }),
      ),
    ).toBeNull();
  });
});

describe('refreshFailures', () => {
  it('names each address that failed', () => {
    expect(
      refreshFailures([
        { id: 'a', label: 'A', error: null },
        { id: 'b', label: 'B', error: 'Too slow.' },
      ]),
    ).toEqual([{ id: 'b', message: 'B: Too slow.' }]);
  });

  it('keeps two addresses with the same label and failure apart', () => {
    const failures = refreshFailures([
      { id: 'a', label: 'Main', error: 'Too slow.' },
      { id: 'b', label: 'Main', error: 'Too slow.' },
    ]);
    expect(new Set(failures.map(({ id }) => id)).size).toBe(2);
  });
});

describe('forms', () => {
  it('round trips an address and maps an empty account to none', () => {
    const draft = toWatchedDraft(view);
    expect(toWatchedInput(draft, 'w1')).toEqual({
      id: 'w1',
      chainId: 'c1',
      tokenId: 't1',
      address: view.watched.address,
      label: 'Main',
      accountId: 'a1',
    });
    expect(toWatchedInput({ ...draft, accountId: '' }, null)).toMatchObject({
      id: null,
      accountId: null,
    });
  });

  it('reads token decimals and refuses blank ones later, in the domain', () => {
    const draft = { chainId: 'c1', symbol: 'USDT', contract: 'x', decimals: '6' };
    expect(toTokenInput(draft, null).decimals).toBe(6);
    expect(toTokenInput({ ...draft, decimals: ' ' }, null).decimals).toBeNaN();
    expect(toTokenInput({ ...draft, decimals: '1e1' }, null).decimals).toBeNaN();
  });

  it('sends a chain ID only for an EVM chain', () => {
    const draft = {
      name: 'X',
      family: 'evm' as const,
      endpoint: 'https://x.example.com',
      evmChainId: '1',
    };
    expect(toChainInput(draft, null).evmChainId).toBe('1');
    expect(toChainInput({ ...draft, family: 'tron' }, 'c1')).toMatchObject({
      id: 'c1',
      evmChainId: null,
    });
  });
});
