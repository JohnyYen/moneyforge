import {
  addPercents,
  formatPercent,
  hundredMinus,
  parsePercent,
  readPercentOrZero,
} from './percentage';

const parsed = (text: string) => {
  const result = parsePercent(text);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

describe('percentage', () => {
  it.each([
    ['50', '50'],
    ['12.50', '12.5'],
    ['.5', '0.5'],
    [' 007 ', '7'],
    ['33.333333333333333333333', '33.333333333333333333333'],
  ])('keeps %s exactly as %s', (text, expected) => {
    expect(formatPercent(parsed(text))).toBe(expected);
  });

  it.each(['', '.', 'abc', '-5', '1.2.3', '1e2', '100.01'])('rejects %s', (text) => {
    expect(parsePercent(text).ok).toBe(false);
  });

  it('rejects zero', () => {
    expect(parsePercent('0.00').ok).toBe(false);
  });

  it('adds without floating point error', () => {
    expect(formatPercent(addPercents([parsed('0.1'), parsed('0.2')]))).toBe('0.3');
    expect(formatPercent(addPercents([]))).toBe('0');
  });

  it('reads anything being typed without failing', () => {
    expect(formatPercent(readPercentOrZero('150'))).toBe('150');
    expect(formatPercent(readPercentOrZero('abc'))).toBe('0');
    expect(formatPercent(readPercentOrZero(''))).toBe('0');
  });

  it('computes what is left of one hundred', () => {
    expect(formatPercent(hundredMinus(parsed('33.3')))).toBe('66.7');
  });
});
