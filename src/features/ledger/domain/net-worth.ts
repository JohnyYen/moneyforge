import type { Currency } from './currency';
import { findRate, type ExchangeRate } from './exchange-rate';
import type { Money } from './money';
import { convertMinor } from './rate';

export type NetWorth = { readonly total: Money; readonly missingRates: readonly string[] };

/**
 * A balance in the base currency, with the latest rate on or before `asOf`, direct or inverse.
 * `null` when the currency or its rate is unknown, so a caller never values it at zero.
 */
export function toBaseMinor(
  minor: bigint,
  code: string,
  context: {
    readonly base: Currency;
    readonly currencies: readonly Currency[];
    readonly rates: readonly ExchangeRate[];
    readonly asOf: string;
  },
): bigint | null {
  const { base, currencies, rates, asOf } = context;
  if (code === base.code) return minor;
  const currency = currencies.find((candidate) => candidate.code === code);
  const rate = findRate(rates, code, base.code, asOf);
  if (!currency || !rate) return null;
  return convertMinor(minor, rate, currency.decimals, base.decimals);
}

export function computeNetWorth(input: {
  readonly base: Currency;
  readonly currencies: readonly Currency[];
  readonly rates: readonly ExchangeRate[];
  readonly balances: readonly Money[];
  readonly asOf: string;
}): NetWorth {
  const { base, balances } = input;
  const totals = new Map<string, bigint>();
  for (const { currency, minor } of balances) {
    totals.set(currency, (totals.get(currency) ?? 0n) + minor);
  }

  let total = 0n;
  const missingRates: string[] = [];
  for (const [code, minor] of totals) {
    if (minor === 0n) continue;
    const converted = toBaseMinor(minor, code, input);
    if (converted === null) missingRates.push(code);
    else total += converted;
  }
  return { total: { minor: total, currency: base.code }, missingRates };
}
