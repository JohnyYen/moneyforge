import {
  columnChoices,
  emptyCsvDraft,
  failureLines,
  reportLabel,
  toCsvInput,
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
    expect(reportLabel({ imported: 2, duplicates: 1, invalid: [{ line: 1, reason: 'x' }] })).toBe(
      'Imported 2. Skipped 1 duplicate and 1 invalid.',
    );
  });
});
