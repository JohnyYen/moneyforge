import { powerOfTen } from '@/features/ledger/domain/rate';

import { addPercents, alignPercents, compareToHundred, readPercentOrZero } from './percentage';

/**
 * Splits `amount` by percentages totaling 100 with the largest-remainder method: each
 * line takes the floor of its share, then the leftover units go one each to the largest
 * fractional parts, and earlier lines win ties. The result sums exactly to `amount`.
 */
export function allocate(amount: bigint, percentages: readonly string[]): bigint[] {
  const percents = percentages.map(readPercentOrZero);
  if (compareToHundred(addPercents(percents)) !== 0) {
    throw new Error('Percentages must total 100 to allocate.');
  }
  const { units, scale } = alignPercents(percents);
  const divisor = 100n * powerOfTen(scale);

  const shares = units.map((percent, index) => {
    const product = amount * percent;
    return { index, floor: product / divisor, remainder: product % divisor };
  });
  const allocated = shares.reduce((total, share) => total + share.floor, 0n);
  const leftover = Number(amount - allocated);

  const byRemainder = [...shares].sort((left, right) => {
    if (left.remainder === right.remainder) return left.index - right.index;
    return left.remainder > right.remainder ? -1 : 1;
  });
  const extra = new Set(byRemainder.slice(0, leftover).map(({ index }) => index));
  return shares.map(({ index, floor }) => (extra.has(index) ? floor + 1n : floor));
}
