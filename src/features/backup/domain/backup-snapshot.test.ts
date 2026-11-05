import {
  checkAgainstSchema,
  checkPassphrase,
  decodeSnapshot,
  encodeSnapshot,
  validateSnapshot,
  type BackupSnapshot,
  type TableSchema,
} from './backup-snapshot';

const snapshot = (postings: readonly (readonly (string | number | null)[])[]): BackupSnapshot => ({
  schemaVersion: 7,
  createdAt: '2026-03-10T12:00:00.000Z',
  tables: [
    {
      name: 'postings',
      columns: ['id', 'transaction_id', 'amount', 'currency_code'],
      rows: postings,
    },
    { name: 'settings', columns: ['key', 'value'], rows: [['a', 'b']] },
  ],
});

const balanced = snapshot([
  [1, 't1', '100', 'USD'],
  [2, 't1', '-100', 'USD'],
]);

const code = (value: unknown) => {
  const result = validateSnapshot(value, 7);
  return result.ok ? 'valid' : result.error.code;
};

describe('snapshot validation', () => {
  it('accepts a balanced snapshot', () => {
    expect(code(balanced)).toBe('valid');
  });

  it('checks balance in exact integers past what a number can hold', () => {
    const huge = '1000000000000000000000000000000000001';
    expect(
      code(
        snapshot([
          [1, 't1', huge, 'USDT'],
          [2, 't1', '-1000000000000000000000000000000000000', 'USDT'],
        ]),
      ),
    ).toBe('unbalanced');
    expect(
      code(
        snapshot([
          [1, 't1', huge, 'USDT'],
          [2, 't1', `-${huge}`, 'USDT'],
        ]),
      ),
    ).toBe('valid');
  });

  it('checks balance per currency and per transaction', () => {
    const acrossCurrencies = snapshot([
      [1, 't1', '100', 'USD'],
      [2, 't1', '-100', 'EUR'],
    ]);
    const acrossTransactions = snapshot([
      [1, 't1', '100', 'USD'],
      [2, 't2', '-100', 'USD'],
    ]);
    expect(code(acrossCurrencies)).toBe('unbalanced');
    expect(code(acrossTransactions)).toBe('unbalanced');
  });

  it.each([['1.5'], ['abc'], [''], ['1e3'], [12]])('refuses the posting amount %j', (amount) => {
    expect(code(snapshot([[1, 't1', amount, 'USD']]))).toBe('invalid-contents');
  });

  it.each<[string, unknown]>([
    ['null', null],
    ['an array', []],
    ['no tables', { ...balanced, tables: undefined }],
    ['another schema version than the header', { ...balanced, schemaVersion: 6 }],
    ['an unknown field', { ...balanced, extra: 1 }],
    ['no time', { ...balanced, createdAt: 5 }],
    ['no postings table', { ...balanced, tables: [balanced.tables[1]] }],
    ['a repeated table', { ...balanced, tables: [...balanced.tables, balanced.tables[1]] }],
    ['a row of another width', {
      ...balanced,
      tables: [balanced.tables[0], { ...balanced.tables[1], rows: [['a']] }],
    }],
    ['a repeated column', {
      ...balanced,
      tables: [balanced.tables[0], { name: 'settings', columns: ['key', 'key'], rows: [] }],
    }],
    ['an object cell', {
      ...balanced,
      tables: [balanced.tables[0], { ...balanced.tables[1], rows: [['a', {}]] }],
    }],
    ['a boolean cell', {
      ...balanced,
      tables: [balanced.tables[0], { ...balanced.tables[1], rows: [['a', true]] }],
    }],
    ['a row that is no array', {
      ...balanced,
      tables: [balanced.tables[0], { ...balanced.tables[1], rows: ['a'] }],
    }],
  ])('refuses %s', (_, value) => {
    expect(code(value)).toBe('invalid-contents');
  });

  it('refuses message text in a backup, which is never written there', () => {
    const inbox = { name: 'inbox_items', columns: ['id', 'body'], rows: [['i1', 'raw text']] };
    expect(code({ ...balanced, tables: [...balanced.tables, inbox] })).toBe('invalid-contents');
    const erased = { ...inbox, rows: [['i1', null]] };
    expect(code({ ...balanced, tables: [...balanced.tables, erased] })).toBe('valid');
  });

  it('round trips text outside ASCII through the encoded payload', () => {
    const accented = {
      ...balanced,
      tables: [
        balanced.tables[0],
        { name: 'settings', columns: ['key', 'value'], rows: [['ñandú', 'pagó 💸 "x"\n']] },
      ],
    };
    const bytes = encodeSnapshot(accented);
    expect(bytes.every((byte) => byte < 0x80)).toBe(true);
    expect(decodeSnapshot(bytes)).toEqual(accented);
  });

  it('reads bytes outside ASCII or broken JSON as nothing', () => {
    expect(decodeSnapshot(Uint8Array.of(0x7b, 0xff))).toBeUndefined();
    expect(decodeSnapshot(Uint8Array.of(0x7b))).toBeUndefined();
  });
});

describe('check against the schema', () => {
  const schema: TableSchema[] = [
    {
      name: 'postings',
      columns: [
        { name: 'id', type: 'INTEGER', required: true },
        { name: 'transaction_id', type: 'TEXT', required: true },
        { name: 'amount', type: 'TEXT', required: true },
        { name: 'currency_code', type: 'TEXT', required: true },
      ],
    },
    {
      name: 'settings',
      columns: [
        { name: 'key', type: 'TEXT', required: true },
        { name: 'value', type: 'TEXT', required: false },
      ],
    },
  ];
  const fits = (value: BackupSnapshot) => checkAgainstSchema(value, schema).ok;
  const withSettings = (columns: string[], rows: (string | number | null)[][]) => ({
    ...balanced,
    tables: [balanced.tables[0], { name: 'settings', columns, rows }],
  });

  it('accepts columns in any order, because rows name them', () => {
    expect(fits(balanced)).toBe(true);
    expect(fits(withSettings(['value', 'key'], [[null, 'a']]))).toBe(true);
  });

  it('refuses a table the schema does not have, or one left out', () => {
    expect(fits({ ...balanced, tables: [...balanced.tables, { name: 'x', columns: [], rows: [] }] })).toBe(false);
    expect(fits({ ...balanced, tables: [balanced.tables[0]] })).toBe(false);
  });

  it('refuses a column the schema does not have, or one left out', () => {
    expect(fits(withSettings(['key', 'value', 'x'], [['a', 'b', 'c']]))).toBe(false);
    expect(fits(withSettings(['key'], [['a']]))).toBe(false);
  });

  it('refuses an empty required cell and a cell of the wrong type', () => {
    expect(fits(withSettings(['key', 'value'], [[null, 'b']]))).toBe(false);
    expect(fits(withSettings(['key', 'value'], [[5, 'b']]))).toBe(false);
    const posting = { ...balanced.tables[0], rows: [['one', 't1', '0', 'USD']] };
    expect(fits({ ...balanced, tables: [posting, balanced.tables[1]] })).toBe(false);
  });
});

describe('passphrase', () => {
  it.each([
    ['too short', 'elevenchars', 'elevenchars', 'weak-passphrase'],
    ['only spaces', ' '.repeat(14), ' '.repeat(14), 'weak-passphrase'],
    ['surrogates counted as one', '💸'.repeat(11), '💸'.repeat(11), 'weak-passphrase'],
    ['a mismatch', 'twelve chars!', 'twelve chars?', 'passphrase-mismatch'],
  ])('refuses %s', (_, passphrase, confirmation, expected) => {
    expect(checkPassphrase(passphrase, confirmation)).toMatchObject({
      ok: false,
      error: { code: expected },
    });
  });

  it('accepts exactly 12 characters', () => {
    expect(checkPassphrase('twelve chars', 'twelve chars').ok).toBe(true);
  });

  it('never repeats the passphrase in its message', () => {
    const result = checkPassphrase('short-secret', 'short-Secret');
    expect(JSON.stringify(result)).not.toMatch(/short-secret/i);
  });
});
