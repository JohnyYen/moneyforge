import { MAX_CSV_CELL, MAX_CSV_CHARS, MAX_CSV_ROWS, neutralizeFormula, parseCsv, writeCsv } from './csv';

const cells = (text: string, separator: ',' | ';' | '\t' = ',') => {
  const parsed = parseCsv(text, separator);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value.map((row) => row.cells);
};

describe('parseCsv', () => {
  it.each([
    ['plain rows', 'a,b\nc,d', [['a', 'b'], ['c', 'd']]],
    ['a trailing newline', 'a,b\n', [['a', 'b']]],
    ['Windows line ends', 'a,b\r\nc,d\r\n', [['a', 'b'], ['c', 'd']]],
    ['old Mac line ends', 'a\rb', [['a'], ['b']]],
    ['a separator inside quotes', '"a,b",c', [['a,b', 'c']]],
    ['an escaped quote', '"say ""hi""",x', [['say "hi"', 'x']]],
    ['a newline inside quotes', '"one\ntwo",x\ny,z', [['one\ntwo', 'x'], ['y', 'z']]],
    ['Windows newline inside quotes', '"one\r\ntwo",x', [['one\r\ntwo', 'x']]],
    ['an empty quoted cell', '"",x', [['', 'x']]],
    ['empty cells', 'a,,c,', [['a', '', 'c', '']]],
    ['a quote inside an unquoted cell', 'a"b,c', [['a"b', 'c']]],
    ['a byte order mark', '\uFEFFa,b', [['a', 'b']]],
    ['a byte order mark before a quote', '\uFEFF"a,b",c', [['a,b', 'c']]],
    ['blank lines', 'a\n\n   \nb', [['a'], ['b']]],
  ])('reads %s', (_, text, expected) => {
    expect(cells(text)).toEqual(expected);
  });

  it.each([
    [';', 'a;"b;c";d'],
    ['\t', 'a\t"b\tc"\td'],
  ] as const)('splits on %j', (separator, text) => {
    expect(cells(text, separator)).toEqual([['a', `b${separator}c`, 'd']]);
  });

  it('leaves other separators alone', () => {
    expect(cells('a,b;c', ';')).toEqual([['a,b', 'c']]);
  });

  it('counts lines through quoted newlines', () => {
    const parsed = parseCsv('"one\ntwo",x\r\n\r\nnext,y', ',');
    expect(parsed.ok && parsed.value.map(({ line }) => line)).toEqual([1, 4]);
  });

  it.each([
    ['an unterminated quote', 'a\n"b,c\nd', /line 2/i],
    ['text after a closing quote', '"a"b,c', /line 1/i],
  ])('refuses %s', (_, text, message) => {
    const parsed = parseCsv(text, ',');
    expect(parsed).toMatchObject({ ok: false, error: { code: 'invalid-csv' } });
    expect(parsed.ok ? '' : parsed.error.message).toMatch(message);
  });

  it('refuses what is over the caps', () => {
    const refused = { ok: false, error: { code: 'too-large' } };
    expect(parseCsv('a'.repeat(MAX_CSV_CHARS + 1), ',')).toMatchObject(refused);
    expect(parseCsv('a\n'.repeat(MAX_CSV_ROWS + 1), ',')).toMatchObject(refused);
    expect(parseCsv(`"${'a'.repeat(MAX_CSV_CELL + 1)}"`, ',')).toMatchObject(refused);
    expect(parseCsv(','.repeat(100), ',')).toMatchObject(refused);
  });
});

describe('writeCsv', () => {
  it('quotes only what needs it and survives its own parser', () => {
    const rows = [['plain', 'a,b', 'say "hi"', 'one\ntwo', '']];
    const text = writeCsv(rows);
    expect(text).toBe('plain,"a,b","say ""hi""","one\ntwo",\r\n');
    expect(cells(text)).toEqual(rows);
  });
});

describe('neutralizeFormula', () => {
  it.each([
    '=HYPERLINK("http://example.com","x")',
    '+1+1',
    '-2+3',
    '@SUM(A1)',
    '\t=1+1',
    '\r=1+1',
    '   =1+1',
    '\uFF1D1+1',
  ])('makes %j plain text', (text) => {
    expect(neutralizeFormula(text)).toBe(`'${text}`);
  });

  it.each(['Coffee', 'A = B', '12.50', "'quoted", ''])('leaves %j alone', (text) => {
    expect(neutralizeFormula(text)).toBe(text);
  });
});
