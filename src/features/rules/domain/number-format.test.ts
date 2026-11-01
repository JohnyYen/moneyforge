import { isValidNumberFormat, parseAmountText } from './number-format';

const DOT_DECIMAL = { decimal: '.', thousands: ',' } as const;
const COMMA_DECIMAL = { decimal: ',', thousands: '.' } as const;

describe('parseAmountText', () => {
  it.each([
    ['1,500.25', DOT_DECIMAL, '1500.25'],
    ['1.500,25', COMMA_DECIMAL, '1500.25'],
    ['1,500', DOT_DECIMAL, '1500'],
    ['1.500', COMMA_DECIMAL, '1500'],
    ['1.500', DOT_DECIMAL, '1.500'],
    ['1,234,567.89', DOT_DECIMAL, '1234567.89'],
    ['1500', DOT_DECIMAL, '1500'],
    ['0.05', DOT_DECIMAL, '0.05'],
    ['1 500,25', { decimal: ',', thousands: ' ' }, '1500.25'],
    ["1'500.25", { decimal: '.', thousands: "'" }, '1500.25'],
    ['1500.25', { decimal: '.', thousands: '' }, '1500.25'],
    ['123456789012345678901234567890.123456789012345678', DOT_DECIMAL, '123456789012345678901234567890.123456789012345678'],
  ] as const)('reads %s', (text, format, expected) => {
    expect(parseAmountText(text, format)).toBe(expected);
  });

  it.each([
    ['1.500,25', DOT_DECIMAL],
    ['1,500.25', COMMA_DECIMAL],
    ['1,50', DOT_DECIMAL],
    ['1,5000', DOT_DECIMAL],
    ['1,00,000', DOT_DECIMAL],
    ['1.2.3', { decimal: '.', thousands: '' }],
    ['1,500', { decimal: '.', thousands: '' }],
    ['.50', DOT_DECIMAL],
    ['1.', DOT_DECIMAL],
    [',500', DOT_DECIMAL],
    ['', DOT_DECIMAL],
    ['abc', DOT_DECIMAL],
    ['1.5.0', DOT_DECIMAL],
    ['1.500,000', DOT_DECIMAL],
    ['٣٠٠', DOT_DECIMAL],
  ] as const)('never guesses at %s', (text, format) => {
    expect(parseAmountText(text, format)).toBeNull();
  });
});

describe('isValidNumberFormat', () => {
  it('needs two different, known separators', () => {
    expect(isValidNumberFormat({ decimal: '.', thousands: ',' })).toBe(true);
    expect(isValidNumberFormat({ decimal: ',', thousands: '' })).toBe(true);
    expect(isValidNumberFormat({ decimal: '.', thousands: '.' })).toBe(false);
    expect(isValidNumberFormat({ decimal: ' ', thousands: ',' })).toBe(false);
    expect(isValidNumberFormat({ decimal: '.', thousands: '-' })).toBe(false);
  });
});

describe('parseAmountText, leading zeros', () => {
  const format = { decimal: '.', thousands: ',' } as const;

  it.each(['0,500', '01,500', '0,500.25'])('refuses %j', (text) => {
    expect(parseAmountText(text, format)).toBeNull();
  });

  it('keeps a plain zero whole part', () => {
    expect(parseAmountText('0.50', format)).toBe('0.50');
  });
});
