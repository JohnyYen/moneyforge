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

/** The exact converted amount in target minor units, before any rounding. */
function expectedMinor(minor: bigint, rate: ExactRate, fromDecimals: number, toDecimals: number) {
  return {
    numerator: minor * rate.numerator * powerOfTen(toDecimals),
    denominator: rate.denominator * powerOfTen(fromDecimals),
  };
}

export function convertMinor(
  minor: bigint,
  rate: ExactRate,
  fromDecimals: number,
  toDecimals: number,
): bigint {
  const { numerator, denominator } = expectedMinor(minor, rate, fromDecimals, toDecimals);
  return divideRoundingHalfAwayFromZero(numerator, denominator);
}

/** 0.5%, as a divisor, so the comparison stays in exact integers. */
const SPREAD_DIVISOR = 200n;

/**
 * True when `target` is what `rate` yields for `source`, allowing rounding (half a
 * minor unit of the target) or a provider's spread (0.5% of the expected amount).
 * Only the value of the rate matters, not the digits it was written with.
 */
export function isConsistentConversion(
  source: bigint,
  target: bigint,
  rate: ExactRate,
  fromDecimals: number,
  toDecimals: number,
): boolean {
  const { numerator, denominator } = expectedMinor(source, rate, fromDecimals, toDecimals);
  const difference = magnitude(target * denominator - numerator);
  return 2n * difference <= denominator || SPREAD_DIVISOR * difference <= magnitude(numerator);
}

const DERIVED_RATE_DIGIT_STEP = 12;

/**
 * The rate two positive amounts imply, written as text. The quotient may repeat, so it
 * is rounded, with digits added until `isConsistentConversion` accepts it. More digits
 * bring the rate as close to the quotient as needed, so the search always ends.
 */
export function deriveRate(
  source: bigint,
  target: bigint,
  fromDecimals: number,
  toDecimals: number,
): string {
  if (source <= 0n || target <= 0n) return '0';
  const numerator = target * powerOfTen(fromDecimals);
  const denominator = source * powerOfTen(toDecimals);
  for (let digits = DERIVED_RATE_DIGIT_STEP; ; digits += DERIVED_RATE_DIGIT_STEP) {
    const rounded = divideRoundingHalfAwayFromZero(numerator * powerOfTen(digits), denominator);
    const rate = { numerator: rounded, denominator: powerOfTen(digits) };
    if (isConsistentConversion(source, target, rate, fromDecimals, toDecimals)) {
      const [whole, fraction = ''] = formatDecimal(rounded, digits).split('.');
      const significant = fraction.replace(/0+$/, '');
      return significant ? `${whole}.${significant}` : whole;
    }
  }
}

function magnitude(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function divideRoundingHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  const rounded = (2n * magnitude(numerator) + denominator) / (2n * denominator);
  return numerator < 0n ? -rounded : rounded;
}
