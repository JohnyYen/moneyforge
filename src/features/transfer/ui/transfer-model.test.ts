import {
  columnChoices,
  emptyCsvDraft,
  failureLines,
  previewLines,
  reportLabel,
  toCsvInput,
  undoLines,
  type CsvDraft,
} from './transfer-model';

const draft = (change: Partial<CsvDraft> = {}): CsvDraft => ({
  ...emptyCsvDraft,
  text: 'Date,Amount\n2026-01-02,5',
  accountId: 'a',
  dateColumn: '0',
  amountColumn: '1',
  ...change,
});

describe('columnChoices', () => {
  it('names columns from the header', () => {
    expect(columnChoices(draft())).toEqual([
      { value: '0', label: 'Date' },
      { value: '1', label: 'Amount' },
    ]);
  });

  it('numbers them with no header, or a blank one', () => {
    expect(columnChoices(draft({ hasHeader: false, text: 'x,y' }))[1].label).toBe('Column 2');
    expect(columnChoices(draft({ text: 'a,\n1,2' }))[1].label).toBe('Column 2');
  });

  it('offers nothing for unreadable text', () => {
    expect(columnChoices(draft({ text: '"a' }))).toEqual([]);
  });
});

describe('toCsvInput', () => {
  it('builds a single amount mapping', () => {
    expect(toCsvInput(draft({ positive: 'expense', numberFormat: 'comma-dot' }))).toMatchObject({
      ok: true,
      value: {
        accountId: 'a',
        mapping: {
          date: 0,
          description: null,
          category: null,
          amount: { mode: 'single', column: 1, positive: 'expense' },
          numberFormat: { decimal: ',', thousands: '.' },
        },
        unknownCategories: { action: 'fallback', income: null, expense: null },
      },
    });
  });

  it('builds a debit and credit mapping', () => {
    const result = toCsvInput(
      draft({ amountMode: 'split', debitColumn: '1', creditColumn: '2', amountColumn: '' }),
    );
    expect(result).toMatchObject({
      value: { mapping: { amount: { mode: 'split', debit: 1, credit: 2 } } },
    });
  });

  it('turns the category choice into a policy', () => {
    expect(toCsvInput(draft({ unknown: 'create' }))).toMatchObject({
      value: { unknownCategories: { action: 'create' } },
    });
    expect(toCsvInput(draft({ fallbackExpense: 'c' }))).toMatchObject({
      value: { unknownCategories: { income: null, expense: 'c' } },
    });
  });

  it.each([
    ['an account', { accountId: '' }],
    ['a date column', { dateColumn: '' }],
    ['an amount column', { amountColumn: '' }],
    ['debit and credit', { amountMode: 'split', creditColumn: '1' }],
  ] as const)('asks for %s', (_, change) => {
    expect(toCsvInput(draft(change))).toMatchObject({ ok: false });
  });
});

describe('report text', () => {
  it('caps a long list of failures and says how many are left', () => {
    const failures = Array.from({ length: 23 }, (_, index) => ({ line: index, reason: 'Bad.' }));
    const lines = failureLines(failures);
    expect(lines).toHaveLength(21);
    expect(lines[0]).toBe('Line 0: Bad.');
    expect(lines[20]).toBe('And 3 more.');
  });

  it('says what an import did', () => {
    expect(reportLabel({ imported: 2, batchId: 'b', duplicates: 1, invalid: [{ line: 1, reason: 'x' }] })).toBe(
      'Imported 2. Skipped 1 duplicate and 1 invalid.',
    );
  });
});

describe('previewLines', () => {
  const preview = {
    valid: 2,
    duplicates: 0,
    invalid: [],
    newCategories: [],
    currencyCode: 'USD',
    firstRows: [
      { day: '2026-01-02', kind: 'income', amount: '1000.50', description: 'Salary' },
      { day: '2026-01-03', kind: 'expense', amount: '3.25', description: '' },
    ],
    range: { from: '2026-01-02', to: '2026-01-03' },
    moneyIn: '1000.50',
    moneyOut: '3.25',
  } as const;

  it('shows the dates, the totals, and the rows as they were read', () => {
    expect(previewLines(preview)).toEqual([
      'From 2026-01-02 to 2026-01-03. In 1000.50 USD, out 3.25 USD.',
      '2026-01-02  In 1000.50 USD  Salary',
      '2026-01-03  Out 3.25 USD  No description',
    ]);
  });

  it('shows nothing with no rows to import', () => {
    expect(previewLines({ ...preview, firstRows: [], range: null })).toEqual([]);
  });

  it('says when rows are left out of the list', () => {
    expect(previewLines({ ...preview, valid: 7 }).at(-1)).toBe('And 5 more.');
  });
});

describe('undoLines', () => {
  it('reports what went and what stayed, with why', () => {
    expect(undoLines({ removed: 3, kept: [] })).toEqual(['Removed 3 rows.']);
    expect(
      undoLines({ removed: 1, kept: [{ description: 'Salary', reason: 'It has a split.' }] }),
    ).toEqual(['Removed 1 row. 1 could not be removed.', 'Salary: It has a split.']);
  });
});
