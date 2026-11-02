import { parseAmount, parseDay, readRow, rowFingerprint, type CsvMapping } from './csv-import';

const DOT = { decimal: '.', thousands: ',' } as const;
const COMMA = { decimal: ',', thousands: '.' } as const;

describe('parseDay', () => {
  it.each([
    ['2026-03-04', 'ymd', '2026-03-04'],
    ['2026/3/4', 'ymd', '2026-03-04'],
    ['04/03/2026', 'dmy', '2026-03-04'],
    ['4.3.2026', 'dmy', '2026-03-04'],
    ['03/04/2026', 'mdy', '2026-03-04'],
    ['2024-02-29', 'ymd', '2024-02-29'],
    ['2026-03-04 14:30', 'ymd', '2026-03-04'],
    ['2026-03-04T14:30:05', 'ymd', '2026-03-04'],
  ] as const)('reads %s as %s', (text, format, day) => {
    expect(parseDay(text, format)).toBe(day);
  });

  it.each([
    ['13/13/2026', 'mdy'],
    ['31/04/2026', 'dmy'],
    ['2026-02-29', 'ymd'],
    ['13/01/2026', 'mdy'],
    ['01/02/26', 'dmy'],
    ['26-02-01', 'ymd'],
    ['2026-03/04', 'ymd'],
    ['March 4', 'ymd'],
    ['04/03/2026', 'ymd'],
    ['2026-03-04Z', 'ymd'],
    ['', 'ymd'],
    ['1899-12-31', 'ymd'],
    ['0050-01-01', 'ymd'],
    ['31/12/0099', 'dmy'],
  ] as const)('refuses %j as %s, never picking another reading', (text, format) => {
    expect(parseDay(text, format)).toBeNull();
  });
});

describe('parseAmount', () => {
  it.each([
    ['1,234.56', DOT, 2, 123456n],
    ['1.234,56', COMMA, 2, 123456n],
    ['-1,234.56', DOT, 2, -123456n],
    ['+5', DOT, 2, 500n],
    ['0.000000000000000001', DOT, 18, 1n],
    ['123456789012345678901234567890.123456789012345678', DOT, 18,
      123456789012345678901234567890123456789012345678n],
  ] as const)('reads %s exactly', (text, format, decimals, minor) => {
    expect(parseAmount(text, format, decimals)).toEqual({ ok: true, value: minor });
  });

  it.each([
    ['1.500', DOT, 2],
    ['1,50', DOT, 2],
    ['1.234,56', DOT, 2],
    ['1,234.56', COMMA, 2],
    ['(50.00)', DOT, 2],
    ['50-', DOT, 2],
    ['$50', DOT, 2],
    ['50 USD', DOT, 2],
    ['1e5', DOT, 2],
    ['--5', DOT, 2],
    ['.50', DOT, 2],
    ['abc', DOT, 2],
  ] as const)('refuses %s instead of guessing', (text, format, decimals) => {
    expect(parseAmount(text, format, decimals)).toMatchObject({ ok: false });
  });

  it('caps the length, whatever the digits', () => {
    expect(parseAmount('1'.repeat(64), DOT, 2)).toMatchObject({ ok: true });
    expect(parseAmount('1'.repeat(65), DOT, 2)).toEqual({
      ok: false,
      error: expect.stringMatching(/64 characters/),
    });
  });
});

describe('readRow', () => {
  const single: CsvMapping = {
    date: 0,
    description: 1,
    category: 3,
    amount: { mode: 'single', column: 2, positive: 'income' },
    currency: null,
    dateFormat: 'ymd',
    numberFormat: DOT,
  };
  const split: CsvMapping = {
    ...single,
    category: null,
    amount: { mode: 'split', debit: 2, credit: 3 },
  };
  const read = (mapping: CsvMapping, cells: string[], columns = 4) =>
    readRow({ line: 2, cells }, mapping, columns, { code: 'USD', decimals: 2 });

  it('takes income from a positive amount and expense from a negative one', () => {
    expect(read(single, ['2026-01-02', ' Pay\n day ', '10.50', ' Salary '])).toEqual({
      ok: true,
      value: {
        day: '2026-01-02',
        kind: 'income',
        minor: 1050n,
        description: 'Pay day',
        category: 'Salary',
      },
    });
    expect(read(single, ['2026-01-02', 'Tea', '-3.00', ''])).toMatchObject({
      value: { kind: 'expense', minor: 300n, category: null },
    });
  });

  it('follows a statement where positive means spent', () => {
    const card: CsvMapping = {
      ...single,
      amount: { mode: 'single', column: 2, positive: 'expense' },
    };
    expect(read(card, ['2026-01-02', 'Tea', '3.00', ''])).toMatchObject({
      value: { kind: 'expense', minor: 300n },
    });
  });

  it.each([
    [['2026-01-02', 'x', '5.00', ''], 'expense', 500n],
    [['2026-01-02', 'x', '', '5.00'], 'income', 500n],
    [['2026-01-02', 'x', '0.00', '5.00'], 'income', 500n],
    [['2026-01-02', 'x', '5.00', '0'], 'expense', 500n],
  ])('reads debit and credit columns from %j', (cells, kind, minor) => {
    expect(read(split, cells)).toMatchObject({ value: { kind, minor } });
  });

  it.each([
    ['both filled', split, ['2026-01-02', 'x', '5.00', '5.00']],
    ['neither filled', split, ['2026-01-02', 'x', '', '']],
    ['a negative debit', split, ['2026-01-02', 'x', '-5.00', '']],
    ['a zero amount', single, ['2026-01-02', 'x', '0.00', '']],
    ['an empty amount', single, ['2026-01-02', 'x', '', '']],
    ['a bad date', single, ['01/02/2026', 'x', '1.00', '']],
    ['too many columns', single, ['2026-01-02', 'x', '1.00', '', '']],
    ['too few columns', single, ['2026-01-02', 'x']],
    ['a long category', single, ['2026-01-02', 'x', '1.00', 'c'.repeat(65)]],
  ])('refuses %s', (_, mapping, cells) => {
    expect(read(mapping, cells)).toMatchObject({ ok: false });
  });
});

describe('rowFingerprint', () => {
  const row = { day: '2026-01-02', minor: 500n, kind: 'expense', description: 'Tea' } as const;

  it('ignores case and spacing but not the account, amount, day, or repeat count', () => {
    const base = rowFingerprint('a', row, 0, 'secret');
    expect(rowFingerprint('a', { ...row, description: ' TEA ' }, 0, 'secret')).toBe(base);
    expect(rowFingerprint('b', row, 0, 'secret')).not.toBe(base);
    expect(rowFingerprint('a', { ...row, minor: 501n }, 0, 'secret')).not.toBe(base);
    expect(rowFingerprint('a', { ...row, day: '2026-01-03' }, 0, 'secret')).not.toBe(base);
    expect(rowFingerprint('a', { ...row, kind: 'income' }, 0, 'secret')).not.toBe(base);
    expect(rowFingerprint('a', row, 1, 'secret')).not.toBe(base);
  });

  it('reveals nothing without the secret', () => {
    expect(rowFingerprint('a', row, 0, 'other')).not.toBe(rowFingerprint('a', row, 0, 'secret'));
    expect(rowFingerprint('a', row, 0, 'secret')).toMatch(/^[0-9a-f]{64}$/);
  });
});
