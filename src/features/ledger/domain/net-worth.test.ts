import { computeNetWorth } from './net-worth';
import type { Currency } from './currency';
import type { ExchangeRate } from './exchange-rate';

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

describe('computeNetWorth', () => {
  it('sums balances already in the base currency', () => {
    const result = computeNetWorth({
      base: usd,
      currencies,
      rates: [],
      asOf: '2026-02-01',
      balances: [
        { minor: 1000n, currency: 'USD' },
        { minor: -300n, currency: 'USD' },
      ],
    });

    expect(result).toEqual({ total: { minor: 700n, currency: 'USD' }, missingRates: [] });
  });

  it('uses the latest rate on or before the date', () => {
    const result = computeNetWorth({
      base: usd,
      currencies,
      asOf: '2026-02-01',
      rates: [
        rate('DAI', 'USD', '0.9', '2026-01-01'),
        rate('DAI', 'USD', '1.1', '2026-01-20'),
        rate('DAI', 'USD', '5', '2026-03-01'),
      ],
      balances: [{ minor: 2000000000000000000n, currency: 'DAI' }],
    });

    expect(result.total.minor).toBe(220n);
  });

  it('falls back to the inverse of a stored rate', () => {
    const result = computeNetWorth({
      base: usd,
      currencies,
      asOf: '2026-02-01',
      rates: [rate('USD', 'COP', '4000', '2026-01-01')],
      balances: [{ minor: 800000n, currency: 'COP' }],
    });

    expect(result.total.minor).toBe(200n);
  });

  it('reports currencies with no rate instead of valuing them at zero silently', () => {
    const result = computeNetWorth({
      base: usd,
      currencies,
      asOf: '2026-02-01',
      rates: [rate('USD', 'COP', '4000', '2026-03-01')],
      balances: [
        { minor: 100n, currency: 'USD' },
        { minor: 500n, currency: 'COP' },
      ],
    });

    expect(result).toEqual({ total: { minor: 100n, currency: 'USD' }, missingRates: ['COP'] });
  });

  it('needs no rate for a zero balance', () => {
    const result = computeNetWorth({
      base: usd,
      currencies,
      asOf: '2026-02-01',
      rates: [],
      balances: [{ minor: 0n, currency: 'COP' }],
    });

    expect(result.missingRates).toEqual([]);
  });
});
