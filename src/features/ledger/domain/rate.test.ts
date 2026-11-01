import { convertMinor, invertRate, parseRate } from './rate';

function rate(text: string) {
  const result = parseRate(text);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe('parseRate', () => {
  it('keeps the rate as an exact fraction', () => {
    expect(rate('4012.75')).toEqual({ numerator: 401275n, denominator: 100n });
  });

  it.each(['0', '0.00', '-1', 'abc', '', '1e3'])('rejects %p', (text) => {
    expect(parseRate(text)).toMatchObject({ ok: false, error: { code: 'invalid-rate' } });
  });
});

describe('convertMinor', () => {
  it('converts between currencies of different precision', () => {
    expect(convertMinor(10000n, rate('4000.5'), 2, 0)).toBe(400050n);
    expect(convertMinor(1000000n, rate('1'), 6, 18)).toBe(1000000000000000000n);
  });

  it('keeps 18-decimal precision with a long rate', () => {
    expect(convertMinor(1000000000000000000n, rate('0.123456789012345678'), 18, 18)).toBe(
      123456789012345678n,
    );
  });

  it('rounds half away from zero at the target precision', () => {
    expect(convertMinor(1n, rate('0.5'), 0, 0)).toBe(1n);
    expect(convertMinor(-1n, rate('0.5'), 0, 0)).toBe(-1n);
    expect(convertMinor(1n, rate('0.49'), 0, 0)).toBe(0n);
  });

  it('inverts a rate exactly', () => {
    const inverse = invertRate(rate('4'));

    expect(convertMinor(100n, inverse, 0, 2)).toBe(2500n);
  });
});
