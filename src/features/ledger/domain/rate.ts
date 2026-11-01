import { err, ok, type Result } from '@/shared/result';

import { ledgerError, type LedgerError } from './ledger-error';
import { formatDecimal, groupThousands } from './money';

export type ExactRate = { readonly numerator: bigint; readonly denominator: bigint };

const RATE_PATTERN = /^(\d*)(?:\.(\d*))?$/;

/** Built from text: Babel can compile `**` to `Math.pow`, which throws on bigint. */
export function powerOfTen(exponent: number): bigint {
  return BigInt(`1${'0'.repeat(exponent)}`);
}

export function parseRate(text: string): Result<ExactRate, LedgerError> {
  const invalid = err(ledgerError('invalid-rate', 'Enter a rate greater than zero.'));
  const match = RATE_PATTERN.exec(text.trim());
  const whole = match?.[1] ?? '';
  const fraction = match?.[2] ?? '';
  if (!match || (whole === '' && fraction === '')) return invalid;
  const numerator = BigInt(`${whole}${fraction}`);
  if (numerator === 0n) return invalid;
  return ok({ numerator, denominator: powerOfTen(fraction.length) });
}

/** For reading: an entered rate always has a power of ten as its denominator. */
export function formatRate(rate: ExactRate): string {
  const digits = rate.denominator.toString().length - 1;
  const [whole, fraction = ''] = formatDecimal(rate.numerator, digits).split('.');
  const significant = fraction.replace(/0+$/, '');
  return `${groupThousands(whole)}${significant ? `.${significant}` : ''}`;
}

export function invertRate(rate: ExactRate): ExactRate {
  return { numerator: rate.denominator, denominator: rate.numerator };
}

export function convertMinor(
  minor: bigint,
  rate: ExactRate,
  fromDecimals: number,
  toDecimals: number,
): bigint {
  const numerator = minor * rate.numerator * powerOfTen(toDecimals);
  const denominator = rate.denominator * powerOfTen(fromDecimals);
  return divideRoundingHalfAwayFromZero(numerator, denominator);
}

/**
 * True when `target` could result from `source` at a rate rounded to the digits it
 * was written with, so a rate of 0.92 accepts anything from 0.915 to 0.925.
 */
export function isConsistentConversion(
  source: bigint,
  target: bigint,
  rate: ExactRate,
  fromDecimals: number,
  toDecimals: number,
): boolean {
  const bound = (halfUnits: bigint) =>
    convertMinor(
      source,
      { numerator: 2n * rate.numerator + halfUnits, denominator: 2n * rate.denominator },
      fromDecimals,
      toDecimals,
    );
  return bound(-1n) <= target && target <= bound(1n);
}

const DERIVED_RATE_DIGIT_STEPS = [12, 24, 36, 48, 60];

/**
 * The rate two amounts imply, written as text. The quotient may repeat, so it is rounded,
 * and that stays within what `isConsistentConversion` accepts for the digits written.
 */
export function deriveRate(
  source: bigint,
  target: bigint,
  fromDecimals: number,
  toDecimals: number,
): string {
  const numerator = target * powerOfTen(fromDecimals);
  const denominator = source * powerOfTen(toDecimals);
  for (const digits of DERIVED_RATE_DIGIT_STEPS) {
    const rounded = divideRoundingHalfAwayFromZero(numerator * powerOfTen(digits), denominator);
    if (rounded > 0n) {
      const [whole, fraction = ''] = formatDecimal(rounded, digits).split('.');
      const significant = fraction.replace(/0+$/, '');
      return significant ? `${whole}.${significant}` : whole;
    }
  }
  return '0';
}

function divideRoundingHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  const rounded = (2n * magnitude + denominator) / (2n * denominator);
  return negative ? -rounded : rounded;
}
