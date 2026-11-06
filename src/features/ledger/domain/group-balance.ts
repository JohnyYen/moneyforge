import type { Currency } from './currency';
import type { ExchangeRate } from './exchange-rate';
import { toBaseMinor } from './net-worth';

export type SubAccountBalance = {
  readonly accountId: string;
  readonly currencyCode: string;
  readonly balance: bigint;
};

export type GroupBalance = {
  /** In minor units of the base currency. */
  readonly total: bigint;
  readonly baseCurrency: string;
  readonly balances: readonly SubAccountBalance[];
  readonly missingRates: readonly string[];
};

/**
 * Each sub-account keeps its own balance; the total converts them to the base currency like net
 * worth does. Archived sub-accounts are listed but left out of the total, and a currency with no
 * rate is reported in `missingRates` instead of being counted as zero.
 */
export function computeGroupBalance(input: {
  readonly base: Currency;
  readonly currencies: readonly Currency[];
  readonly rates: readonly ExchangeRate[];
  readonly asOf: string;
  readonly accounts: readonly (SubAccountBalance & { readonly archived: boolean })[];
}): GroupBalance {
  let total = 0n;
  const missingRates: string[] = [];
  for (const { currencyCode, balance, archived } of input.accounts) {
    if (archived || balance === 0n) continue;
    const converted = toBaseMinor(balance, currencyCode, input);
    if (converted !== null) total += converted;
    else if (!missingRates.includes(currencyCode)) missingRates.push(currencyCode);
  }
  return {
    total,
    baseCurrency: input.base.code,
    balances: input.accounts.map(({ accountId, currencyCode, balance }) => ({
      accountId,
      currencyCode,
      balance,
    })),
    missingRates,
  };
}
