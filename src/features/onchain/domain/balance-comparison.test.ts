import { compareBalance, isStale } from './balance-comparison';

describe('compareBalance', () => {
  it('matches across different decimals', () => {
    expect(
      compareBalance({
        amount: 1_500_000n,
        tokenDecimals: 6,
        ledger: 150n,
        accountDecimals: 2,
      }),
    ).toEqual({ status: 'matches', counted: 150n, difference: 0n });
  });

  it('reports a difference exactly, in the account currency', () => {
    expect(
      compareBalance({
        amount: 1_000_000_000_000_000_001n,
        tokenDecimals: 18,
        ledger: 999_999_999_999_999_999n,
        accountDecimals: 18,
      }),
    ).toEqual({ status: 'differs', counted: 1_000_000_000_000_000_001n, difference: 2n });
  });

  it('scales up when the account holds more decimals than the token', () => {
    expect(
      compareBalance({ amount: 150n, tokenDecimals: 2, ledger: 1_000_000n, accountDecimals: 6 }),
    ).toEqual({ status: 'differs', counted: 1_500_000n, difference: 500_000n });
  });

  it('calls an amount finer than the account can record close, not different', () => {
    expect(
      compareBalance({ amount: 1_500_999n, tokenDecimals: 6, ledger: 150n, accountDecimals: 2 }),
    ).toEqual({ status: 'within-precision', counted: 150n, difference: 0n });
  });

  it('rounds down what would be offered to reconcile', () => {
    expect(
      compareBalance({ amount: 2_509_999n, tokenDecimals: 6, ledger: 150n, accountDecimals: 2 }),
    ).toEqual({ status: 'differs', counted: 250n, difference: 100n });
  });

  it('handles an overdrawn ledger', () => {
    expect(
      compareBalance({ amount: 0n, tokenDecimals: 6, ledger: -500n, accountDecimals: 2 }),
    ).toEqual({ status: 'differs', counted: 0n, difference: 500n });
  });
});

describe('isStale', () => {
  const now = new Date('2026-03-10T12:00:00.000Z');

  it('keeps a recent read fresh, up to the hour', () => {
    expect(isStale('2026-03-10T11:00:00.000Z', now)).toBe(false);
  });

  it('marks an older read', () => {
    expect(isStale('2026-03-10T10:59:59.999Z', now)).toBe(true);
  });

  it('marks a time it cannot read', () => {
    expect(isStale('yesterday', now)).toBe(true);
  });
});
