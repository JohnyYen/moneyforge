import { err, ok, type Result } from '@/shared/result';

import { ledgerError, type LedgerError } from './ledger-error';

export type Money = { readonly minor: bigint; readonly currency: string };

export const MAX_DECIMALS = 18;

const DECIMAL_PATTERN = /^([+-]?)(\d*)(?:\.(\d*))?$/;

export function isValidDecimals(decimals: number): boolean {
  return Number.isInteger(decimals) && decimals >= 0 && decimals <= MAX_DECIMALS;
}

export function parseDecimal(text: string, decimals: number): Result<bigint, LedgerError> {
  if (!isValidDecimals(decimals)) {
    return err(ledgerError('invalid-decimals', `Decimals must be 0 to ${MAX_DECIMALS}.`));
  }
  const match = DECIMAL_PATTERN.exec(text.trim());
  const whole = match?.[2] ?? '';
  const fraction = match?.[3] ?? '';
  if (!match || (whole === '' && fraction === '')) {
    return err(ledgerError('invalid-amount', 'Enter a valid amount.'));
  }
  // Even trailing zeros are refused: `1,500` reaches here as `1.500`, a likely thousands separator.
  if (fraction.length > decimals) {
    return err(
      ledgerError(
        'too-precise',
        `This currency allows ${decimals} decimals. Do not use thousands separators.`,
      ),
    );
  }
  const magnitude = BigInt(`${whole}${fraction.padEnd(decimals, '0')}` || '0');
  return ok(match[1] === '-' ? -magnitude : magnitude);
}

export function formatDecimal(minor: bigint, decimals: number): string {
  const negative = minor < 0n;
  const digits = (negative ? -minor : minor).toString().padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals);
  return `${negative ? '-' : ''}${whole}${decimals > 0 ? `.${fraction}` : ''}`;
}

export function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

const DISPLAY_MIN_DECIMALS = 2;

export function formatDisplay(
  minor: bigint,
  currency: { readonly code: string; readonly symbol: string; readonly decimals: number },
): string {
  const text = formatDecimal(minor < 0n ? -minor : minor, currency.decimals);
  const [whole, fraction = ''] = text.split('.');
  const grouped = groupThousands(whole);
  const significant = fraction.replace(/0+$/, '');
  const shown =
    significant.length >= DISPLAY_MIN_DECIMALS
      ? significant
      : fraction.slice(0, DISPLAY_MIN_DECIMALS);
  const amount = shown ? `${grouped}.${shown}` : grouped;
  const prefix = currency.symbol.length > 1 ? `${currency.symbol} ` : currency.symbol;
  return `${minor < 0n ? '-' : ''}${prefix}${amount}`;
}
