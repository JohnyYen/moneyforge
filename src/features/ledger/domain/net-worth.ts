import type { Currency } from './currency';
import { findRate, type ExchangeRate } from './exchange-rate';
import type { Money } from './money';
import { convertMinor } from './rate';

export type NetWorth = { readonly total: Money; readonly missingRates: readonly string[] };

export function computeNetWorth(input: {
  readonly base: Currency;
  readonly currencies: readonly Currency[];
  readonly rates: readonly ExchangeRate[];
  readonly balances: readonly Money[];
  readonly asOf: string;
}): NetWorth {
  const { base, currencies, rates, balances, asOf } = input;
  const totals = new Map<string, bigint>();
  for (const { currency, minor } of balances) {
    totals.set(currency, (totals.get(currency) ?? 0n) + minor);
  }

  let total = 0n;
  const missingRates: string[] = [];
  for (const [code, minor] of totals) {
    if (minor === 0n) continue;
    if (code === base.code) {
      total += minor;
      continue;
    }
    const currency = currencies.find((candidate) => candidate.code === code);
    const rate = findRate(rates, code, base.code, asOf);
    if (!currency || !rate) {
      missingRates.push(code);
      continue;
    }
    total += convertMinor(minor, rate, currency.decimals, base.decimals);
  }
  return { total: { minor: total, currency: base.code }, missingRates };
}
