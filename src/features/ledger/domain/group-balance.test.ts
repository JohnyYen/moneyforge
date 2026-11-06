import type { Currency } from './currency';
import type { ExchangeRate } from './exchange-rate';
import { computeGroupBalance } from './group-balance';

const usd: Currency = { code: 'USD', name: 'US Dollar', decimals: 2, symbol: '$', kind: 'fiat' };
const cop: Currency = { code: 'COP', name: 'Peso', decimals: 2, symbol: '$', kind: 'fiat' };
const dai: Currency = { code: 'DAI', name: 'Dai', decimals: 18, symbol: 'DAI', kind: 'stablecoin' };

const rate = (
  fromCode: string,
  toCode: string,
  value: string,
  effectiveOn: string,
): ExchangeRate => ({ id: `${fromCode}-${toCode}-${effectiveOn}`, fromCode, toCode, rate: value, effectiveOn });

const currencies = [usd, cop, dai];

const subAccount = (accountId: string, currencyCode: string, balance: bigint, archived = false) => ({
  accountId,
  currencyCode,
  balance,
  archived,
});

describe('computeGroupBalance', () => {
  it('totals sub-accounts in the base currency and keeps each balance in its own', () => {
    const result = computeGroupBalance({
      base: usd,
      currencies,
      asOf: '2026-02-01',
      rates: [
        rate('DAI', 'USD', '1.1', '2026-01-20'),
        rate('DAI', 'USD', '5', '2026-03-01'),
        rate('USD', 'COP', '4000', '2026-01-01'),
      ],
      accounts: [
        subAccount('a-usd', 'USD', 1000n),
        subAccount('a-dai', 'DAI', 2000000000000000000n),
        subAccount('a-cop', 'COP', 800000n),
      ],
    });

    expect(result).toEqual({
      total: 1000n + 220n + 200n,
      baseCurrency: 'USD',
      balances: [
        { accountId: 'a-usd', currencyCode: 'USD', balance: 1000n },
        { accountId: 'a-dai', currencyCode: 'DAI', balance: 2000000000000000000n },
        { accountId: 'a-cop', currencyCode: 'COP', balance: 800000n },
      ],
      missingRates: [],
    });
  });

  it('rounds each conversion like net worth does', () => {
    const result = computeGroupBalance({
      base: usd,
      currencies,
      asOf: '2026-02-01',
      rates: [rate('USD', 'COP', '3', '2026-01-01')],
      accounts: [subAccount('a-cop', 'COP', 100n), subAccount('a-usd', 'USD', -5n)],
    });

    // 1.00 COP / 3 = 0.333 USD, rounded half away from zero to 33 cents.
    expect(result.total).toBe(33n - 5n);
  });

  it('reports a currency with no rate and leaves it out of the total, never as zero', () => {
    const result = computeGroupBalance({
      base: usd,
      currencies,
      asOf: '2026-02-01',
      rates: [rate('USD', 'COP', '4000', '2026-03-01')],
      accounts: [subAccount('a-usd', 'USD', 100n), subAccount('a-cop', 'COP', 500n)],
    });

    expect(result.total).toBe(100n);
    expect(result.missingRates).toEqual(['COP']);
    expect(result.balances).toContainEqual({ accountId: 'a-cop', currencyCode: 'COP', balance: 500n });
  });

  it('needs no rate for a zero balance', () => {
    const result = computeGroupBalance({
      base: usd,
      currencies,
      asOf: '2026-02-01',
      rates: [],
      accounts: [subAccount('a-cop', 'COP', 0n)],
    });

    expect(result).toMatchObject({ total: 0n, missingRates: [] });
  });

  it('lists an archived sub-account but leaves it out of the total and its missing rates', () => {
    const result = computeGroupBalance({
      base: usd,
      currencies,
      asOf: '2026-02-01',
      rates: [],
      accounts: [
        subAccount('a-usd', 'USD', 100n),
        subAccount('old-usd', 'USD', 900n, true),
        subAccount('old-cop', 'COP', 500n, true),
      ],
    });

    expect(result.total).toBe(100n);
    expect(result.missingRates).toEqual([]);
    expect(result.balances.map(({ accountId }) => accountId)).toEqual(['a-usd', 'old-usd', 'old-cop']);
  });

  it('totals an empty group as zero', () => {
    expect(
      computeGroupBalance({ base: usd, currencies, asOf: '2026-02-01', rates: [], accounts: [] }),
    ).toEqual({ total: 0n, baseCurrency: 'USD', balances: [], missingRates: [] });
  });
});
