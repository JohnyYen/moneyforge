import { err, ok, type Result } from '@/shared/result';

import { ledgerError, type LedgerError } from './ledger-error';
import { isValidDecimals, MAX_DECIMALS } from './money';

export const CURRENCY_KINDS = ['fiat', 'stablecoin', 'other'] as const;
export type CurrencyKind = (typeof CURRENCY_KINDS)[number];

export type Currency = {
  readonly code: string;
  readonly name: string;
  readonly decimals: number;
  readonly symbol: string;
  readonly kind: CurrencyKind;
};

const CODE_PATTERN = /^[A-Z0-9]{2,10}$/;

export function validateCurrency(input: Currency): Result<Currency, LedgerError> {
  const code = input.code.trim().toUpperCase();
  const name = input.name.trim();
  if (!CODE_PATTERN.test(code)) {
    return err(ledgerError('invalid-currency', 'Code must be 2 to 10 letters or digits.'));
  }
  if (!name) return err(ledgerError('invalid-currency', 'Enter a currency name.'));
  if (!isValidDecimals(input.decimals)) {
    return err(ledgerError('invalid-currency', `Decimals must be 0 to ${MAX_DECIMALS}.`));
  }
  if (!CURRENCY_KINDS.includes(input.kind)) {
    return err(ledgerError('invalid-currency', 'Choose a currency kind.'));
  }
  return ok({ ...input, code, name, symbol: input.symbol.trim() || code });
}
