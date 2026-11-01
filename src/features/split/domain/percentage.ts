import { formatDecimal } from '@/features/ledger/domain/money';
import { powerOfTen } from '@/features/ledger/domain/rate';
import { err, ok, type Result } from '@/shared/result';

import { splitError, type SplitError } from './split-error';

/** Exact value: `units / 10^scale`. */
export type Percent = { readonly units: bigint; readonly scale: number };

const PERCENT_PATTERN = /^(\d*)(?:\.(\d*))?$/;
const ZERO: Percent = { units: 0n, scale: 0 };

function readPercent(text: string): Percent | null {
  const match = PERCENT_PATTERN.exec(text.trim());
  const whole = match?.[1] ?? '';
  const fraction = match?.[2] ?? '';
  if (!match || (whole === '' && fraction === '')) return null;
  return { units: BigInt(`${whole}${fraction}`), scale: fraction.length };
}

/** Puts percents on one scale, so their `units` compare and add directly. */
export function alignPercents(percents: readonly Percent[]) {
  const scale = percents.reduce((widest, percent) => Math.max(widest, percent.scale), 0);
  return {
    scale,
    units: percents.map((percent) => percent.units * powerOfTen(scale - percent.scale)),
  };
}

export function parsePercent(text: string): Result<Percent, SplitError> {
  const percent = readPercent(text);
  if (!percent || percent.units === 0n || compareToHundred(percent) > 0) {
    return err(splitError('invalid-percentage', 'Enter a percentage from 0 to 100.'));
  }
  return ok(percent);
}

/** For a total shown while typing, where unfinished text must not fail. */
export function readPercentOrZero(text: string): Percent {
  return readPercent(text) ?? ZERO;
}

export function addPercents(percents: readonly Percent[]): Percent {
  const { scale, units } = alignPercents(percents);
  return { scale, units: units.reduce((total, value) => total + value, 0n) };
}

export function hundredMinus(percent: Percent): Percent {
  return { scale: percent.scale, units: 100n * powerOfTen(percent.scale) - percent.units };
}

export function compareToHundred(percent: Percent): number {
  const hundred = 100n * powerOfTen(percent.scale);
  if (percent.units === hundred) return 0;
  return percent.units < hundred ? -1 : 1;
}

export function formatPercent({ units, scale }: Percent): string {
  const [whole, fraction = ''] = formatDecimal(units, scale).split('.');
  const significant = fraction.replace(/0+$/, '');
  return significant ? `${whole}.${significant}` : whole;
}
