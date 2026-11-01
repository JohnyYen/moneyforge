import { formatDecimal, formatDisplay, parseDecimal } from './money';

function parsed(text: string, decimals: number) {
  const result = parseDecimal(text, decimals);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe('parseDecimal', () => {
  it('parses into minor units by currency decimals', () => {
    expect(parsed('12.34', 2)).toBe(1234n);
    expect(parsed('12', 2)).toBe(1200n);
    expect(parsed('.5', 2)).toBe(50n);
    expect(parsed('7', 0)).toBe(7n);
  });

  it('parses negative amounts', () => {
    expect(parsed('-0.05', 2)).toBe(-5n);
  });

  it('accepts trailing zeros beyond the currency precision', () => {
    expect(parsed('1.2300', 2)).toBe(123n);
  });

  it('rejects precision the currency cannot hold instead of rounding', () => {
    const result = parseDecimal('1.234', 2);

    expect(result).toMatchObject({ ok: false, error: { code: 'too-precise' } });
  });

  it.each(['', ' ', 'abc', '1,5', '1e3', '1.2.3', '--1', '.'])('rejects %p', (text) => {
    expect(parseDecimal(text, 2)).toMatchObject({ ok: false, error: { code: 'invalid-amount' } });
  });

  it.each([-1, 19, 1.5])('rejects %p decimals', (decimals) => {
    expect(parseDecimal('1', decimals)).toMatchObject({
      ok: false,
      error: { code: 'invalid-decimals' },
    });
  });
});

describe('formatDecimal', () => {
  it('formats minor units with all currency decimals', () => {
    expect(formatDecimal(1234n, 2)).toBe('12.34');
    expect(formatDecimal(5n, 2)).toBe('0.05');
    expect(formatDecimal(-5n, 2)).toBe('-0.05');
    expect(formatDecimal(7n, 0)).toBe('7');
  });

  it('round trips 18-decimal amounts beyond the float range exactly', () => {
    const text = '123456789012345678901234.123456789012345678';

    const minor = parsed(text, 18);

    expect(minor).toBe(123456789012345678901234123456789012345678n);
    expect(formatDecimal(minor, 18)).toBe(text);
  });

  it('round trips the smallest 18-decimal unit', () => {
    expect(formatDecimal(parsed('0.000000000000000001', 18), 18)).toBe('0.000000000000000001');
  });
});

describe('formatDisplay', () => {
  const usd = { code: 'USD', symbol: '$', decimals: 2 };
  const dai = { code: 'DAI', symbol: 'DAI', decimals: 18 };

  it('groups thousands and keeps fiat cents', () => {
    expect(formatDisplay(123456700n, usd)).toBe('$1,234,567.00');
    expect(formatDisplay(-150n, usd)).toBe('-$1.50');
  });

  it('trims insignificant zeros on high precision currencies', () => {
    expect(formatDisplay(1500000000000000000n, dai)).toBe('DAI 1.50');
    expect(formatDisplay(1n, dai)).toBe('DAI 0.000000000000000001');
  });
});
