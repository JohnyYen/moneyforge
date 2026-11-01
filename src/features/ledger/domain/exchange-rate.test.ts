import { findRate, type ExchangeRate } from './exchange-rate';

const rate = (fromCode: string, toCode: string, value: string, effectiveOn = '2026-01-10') => ({
  id: `${fromCode}-${toCode}-${effectiveOn}`,
  fromCode,
  toCode,
  rate: value,
  effectiveOn,
});

const asOf = '2026-01-10';

describe('findRate', () => {
  const direct: ExchangeRate = rate('USD', 'EUR', '0.9');
  const inverse: ExchangeRate = rate('EUR', 'USD', '2');

  it.each([
    ['after the inverse', [inverse, direct]],
    ['before the inverse', [direct, inverse]],
  ])('prefers the direct rate of the same day when it comes %s', (_order, rates) => {
    expect(findRate(rates, 'USD', 'EUR', asOf)).toEqual({ numerator: 9n, denominator: 10n });
  });

  it('prefers a newer inverse rate over an older direct one', () => {
    const older = rate('USD', 'EUR', '0.9', '2026-01-09');

    expect(findRate([older, inverse], 'USD', 'EUR', asOf)).toEqual({
      numerator: 1n,
      denominator: 2n,
    });
  });
});
