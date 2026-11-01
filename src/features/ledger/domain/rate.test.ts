import { convertMinor, deriveRate, formatRate, invertRate, isConsistentConversion, parseRate } from './rate';

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

describe('formatRate', () => {
  it('groups thousands and drops zeros that carry no value', () => {
    expect(formatRate(rate('1500'))).toBe('1,500');
    expect(formatRate(rate('1.500'))).toBe('1.5');
    expect(formatRate(rate('0.000001'))).toBe('0.000001');
  });
});

describe('isConsistentConversion', () => {
  const consistent = (source: bigint, target: bigint, text: string, from = 2, to = 2) =>
    isConsistentConversion(source, target, rate(text), from, to);

  it('accepts the exact conversion', () => {
    expect(consistent(1000n, 920n, '0.92')).toBe(true);
  });

  it('allows small spreads and rejects typos at a rate of 1', () => {
    expect(consistent(10000n, 10001n, '1')).toBe(true);
    expect(consistent(10000n, 14000n, '1')).toBe(false);
    expect(consistent(10000n, 14999n, '1')).toBe(false);
  });

  it.each([
    ['1', 10000n, 9950n, 10050n],
    ['2', 10000n, 19900n, 20100n],
    ['0.92', 1000n, 916n, 924n],
  ])('stops half a percent from the expected amount at a rate of %s', (text, source, low, high) => {
    expect(consistent(source, low, text)).toBe(true);
    expect(consistent(source, high, text)).toBe(true);
    expect(consistent(source, low - 1n, text)).toBe(false);
    expect(consistent(source, high + 1n, text)).toBe(false);
  });

  it('gives the same answer however the rate is written', () => {
    for (const target of [915n, 916n, 924n, 925n]) {
      expect(consistent(1000n, target, '0.9200')).toBe(consistent(1000n, target, '0.92'));
    }
    expect(consistent(10000n, 20500n, '2.00')).toBe(false);
  });

  it('allows half a minor unit where the percentage is smaller than that', () => {
    expect(consistent(150n, 1n, '0.01')).toBe(true);
    expect(consistent(150n, 2n, '0.01')).toBe(true);
    expect(consistent(150n, 3n, '0.01')).toBe(false);
  });

  it('holds for a currency with no decimals', () => {
    expect(consistent(100000n, 100500n, '1', 0, 0)).toBe(true);
    expect(consistent(100000n, 100501n, '1', 0, 0)).toBe(false);
    expect(consistent(3n, 2n, '0.5', 0, 0)).toBe(true);
    expect(consistent(3n, 1n, '0.5', 0, 0)).toBe(true);
    expect(consistent(3n, 3n, '0.5', 0, 0)).toBe(false);
  });

  it('holds exactly at 18 decimals', () => {
    const one = 1000000000000000000n;
    const band = 5000000000000000n;

    expect(consistent(one, one + band, '1', 18, 18)).toBe(true);
    expect(consistent(one, one - band, '1', 18, 18)).toBe(true);
    expect(consistent(one, one + band + 1n, '1', 18, 18)).toBe(false);
    expect(consistent(one, one - band - 1n, '1', 18, 18)).toBe(false);
  });

  it('always accepts what the rate itself produces', () => {
    for (const [source, text, from, to] of [
      [1n, '0.5', 0, 0],
      [149n, '0.01', 2, 2],
      [12345n, '0.000000000001', 2, 18],
      [987654321n, '1234.5678', 6, 0],
    ] as const) {
      const target = convertMinor(source, rate(text), from, to);
      expect(isConsistentConversion(source, target, rate(text), from, to)).toBe(true);
    }
  });

  it('compares across currencies of different precision', () => {
    const received = 9180000000000000000n;

    expect(isConsistentConversion(1000n, received, rate('0.918'), 2, 18)).toBe(true);
    expect(isConsistentConversion(1000n, received * 2n, rate('0.918'), 2, 18)).toBe(false);
  });
});

describe('deriveRate', () => {
  const check = (source: bigint, target: bigint, fromDecimals: number, toDecimals: number) => {
    const text = deriveRate(source, target, fromDecimals, toDecimals);
    const rate = parseRate(text);
    if (!rate.ok) throw new Error(`${text} is not a rate`);
    return { text, consistent: isConsistentConversion(source, target, rate.value, fromDecimals, toDecimals) };
  };

  it('states an exact rate plainly', () => {
    expect(check(10000n, 9200n, 2, 2)).toEqual({ text: '0.92', consistent: true });
  });

  it('crosses decimals', () => {
    expect(check(100n, 1000000n, 2, 6)).toEqual({ text: '1', consistent: true });
  });

  it('rounds a repeating quotient and stays consistent', () => {
    expect(check(300n, 100n, 2, 2)).toEqual({ text: '0.333333333333', consistent: true });
  });

  it('keeps digits for a tiny rate', () => {
    expect(check(BigInt(`1${'0'.repeat(30)}`), 1n, 18, 2).consistent).toBe(true);
  });

  it('adds digits until the rate agrees with the amounts', () => {
    expect(check(10000000000000n, 6n, 0, 0)).toEqual({
      text: '0.0000000000006',
      consistent: true,
    });
  });

  it('agrees with the amounts across precisions and sizes', () => {
    const amounts = [1n, 3n, 7n, 999n, 123456789n, 10n ** 20n, 10n ** 31n + 7n];
    for (const source of amounts) {
      for (const target of amounts) {
        for (const [from, to] of [[0, 0], [2, 2], [0, 18], [18, 0], [18, 18]]) {
          expect(check(source, target, from, to).consistent).toBe(true);
        }
      }
    }
  });
});
