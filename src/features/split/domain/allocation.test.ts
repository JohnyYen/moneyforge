import { allocate } from './allocation';

const sum = (amounts: readonly bigint[]) => amounts.reduce((total, amount) => total + amount, 0n);

/** A small deterministic generator, so a failing case reproduces. */
function mulberry32(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** Whole hundredths of a percent that total exactly 100. */
function randomPercents(random: () => number, count: number): string[] {
  const units: number[] = [];
  let left = 10000;
  for (let index = 0; index < count - 1; index += 1) {
    const slots = count - index - 1;
    const share = 1 + Math.floor(random() * (left - slots));
    units.push(share);
    left -= share;
  }
  units.push(left);
  return units.map((value) => (value / 100).toFixed(2));
}

describe('allocate', () => {
  it('gives each line its exact share when it divides evenly', () => {
    expect(allocate(1000n, ['50', '30', '20'])).toEqual([500n, 300n, 200n]);
  });

  it('hands leftover units to the largest remainders', () => {
    // Exact shares are 33.4, 33.3, 33.3, so the one leftover unit goes to the first line.
    expect(allocate(100n, ['33.4', '33.3', '33.3'])).toEqual([34n, 33n, 33n]);
    expect(allocate(101n, ['50', '25', '25'])).toEqual([51n, 25n, 25n]);
  });

  it('breaks ties by line order', () => {
    expect(allocate(2n, ['25', '25', '25', '25'])).toEqual([1n, 1n, 0n, 0n]);
  });

  it('can allocate zero to a line when the income is tiny', () => {
    expect(allocate(1n, ['99', '1'])).toEqual([1n, 0n]);
  });

  it('handles amounts far past the safe integer range', () => {
    const huge = 123456789012345678901234567890123456n;
    const amounts = allocate(huge, ['33.333333333333333333', '33.333333333333333333', '33.333333333333333334']);
    expect(sum(amounts)).toBe(huge);
  });

  it('refuses percentages that do not total 100', () => {
    expect(() => allocate(100n, ['50', '49'])).toThrow('total 100');
  });

  it('sums exactly to the income across currencies from 0 to 18 decimals', () => {
    const random = mulberry32(20261101);
    for (let decimals = 0; decimals <= 18; decimals += 1) {
      for (let round = 0; round < 200; round += 1) {
        const count = 1 + Math.floor(random() * 8);
        const percents = randomPercents(random, count);
        const whole = BigInt(Math.floor(random() * 10_000_000));
        const fraction = BigInt(Math.floor(random() * 1_000_000_000));
        const amount = whole * BigInt(`1${'0'.repeat(decimals)}`) + fraction + 1n;

        const amounts = allocate(amount, percents);

        expect(sum(amounts)).toBe(amount);
        amounts.forEach((allocated, index) => {
          expect(allocated).toBeGreaterThanOrEqual(0n);
          const units = BigInt(percents[index].replace('.', ''));
          const exactTimes = allocated * 10000n - amount * units;
          // Largest remainder never strays a whole unit from the exact share.
          expect(exactTimes < 10000n && exactTimes > -10000n).toBe(true);
        });
      }
    }
  });
});
