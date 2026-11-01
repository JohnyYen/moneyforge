import { err, ok, type Result } from '@/shared/result';

import { ledgerError, type LedgerError } from './ledger-error';

export type ExactRate = { readonly numerator: bigint; readonly denominator: bigint };

const RATE_PATTERN = /^(\d*)(?:\.(\d*))?$/;

/** Built from text: Babel can compile `**` to `Math.pow`, which throws on bigint. */
function powerOfTen(exponent: number): bigint {
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

function divideRoundingHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  const rounded = (2n * magnitude + denominator) / (2n * denominator);
  return negative ? -rounded : rounded;
}
