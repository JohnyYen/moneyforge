import { convertMinor, formatRate, invertRate, isConsistentConversion, parseRate } from './rate';

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
  const consistent = (source: bigint, target: bigint, text: string) =>
    isConsistentConversion(source, target, rate(text), 2, 2);

  it('accepts the exact conversion', () => {
    expect(consistent(1000n, 920n, '0.92')).toBe(true);
  });

  it('accepts any amount the rate could produce once rounded to its written digits', () => {
    expect(consistent(1000n, 915n, '0.92')).toBe(true);
    expect(consistent(1000n, 925n, '0.92')).toBe(true);
  });

  it('rejects an amount outside that range', () => {
    expect(consistent(1000n, 914n, '0.92')).toBe(false);
    expect(consistent(1000n, 926n, '0.92')).toBe(false);
  });

  it('tightens with the precision of the rate', () => {
    expect(consistent(1000n, 918n, '0.9180')).toBe(true);
    expect(consistent(1000n, 919n, '0.9180')).toBe(false);
  });

  it('compares across currencies of different precision', () => {
    const received = 9180000000000000000n;

    expect(isConsistentConversion(1000n, received, rate('0.918'), 2, 18)).toBe(true);
    expect(isConsistentConversion(1000n, received * 2n, rate('0.918'), 2, 18)).toBe(false);
  });
});
