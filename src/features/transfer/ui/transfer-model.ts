import type { NumberFormat } from '@/features/rules/domain/number-format';
import { err, ok, type Result } from '@/shared/result';

import type { CsvImportInput, CsvReport, RowFailure } from '../application/transfer-service';
import { parseCsv, type CsvSeparator } from '../domain/csv';
import type { DateFormat, RowKind } from '../domain/csv-import';

const FAILURES_SHOWN = 20;

export const SEPARATOR_OPTIONS: readonly { value: CsvSeparator; label: string }[] = [
  { value: ',', label: 'Comma' },
  { value: ';', label: 'Semicolon' },
  { value: '\t', label: 'Tab' },
];

export const DATE_OPTIONS: readonly { value: DateFormat; label: string }[] = [
  { value: 'ymd', label: 'Year first, 2026-03-31' },
  { value: 'dmy', label: 'Day first, 31/03/2026' },
  { value: 'mdy', label: 'Month first, 03/31/2026' },
];

const NUMBER_FORMATS = {
  'dot-comma': { decimal: '.', thousands: ',' },
  'comma-dot': { decimal: ',', thousands: '.' },
  'dot-none': { decimal: '.', thousands: '' },
  'comma-none': { decimal: ',', thousands: '' },
  'dot-space': { decimal: '.', thousands: ' ' },
  'comma-space': { decimal: ',', thousands: ' ' },
} as const satisfies Record<string, NumberFormat>;

export type NumberFormatKey = keyof typeof NUMBER_FORMATS;

export const NUMBER_OPTIONS: readonly { value: NumberFormatKey; label: string }[] = [
  { value: 'dot-comma', label: '1,234.56' },
  { value: 'comma-dot', label: '1.234,56' },
  { value: 'dot-none', label: '1234.56' },
  { value: 'comma-none', label: '1234,56' },
  { value: 'dot-space', label: '1 234.56' },
  { value: 'comma-space', label: '1 234,56' },
];

/** Columns are text, as chips hold them. Empty means not chosen, or none. */
export type CsvDraft = {
  readonly text: string;
  readonly separator: CsvSeparator;
  readonly hasHeader: boolean;
  readonly accountId: string;
  readonly dateColumn: string;
  readonly descriptionColumn: string;
  readonly categoryColumn: string;
  readonly amountMode: 'single' | 'split';
  readonly amountColumn: string;
  readonly debitColumn: string;
  readonly creditColumn: string;
  readonly positive: RowKind;
  readonly dateFormat: DateFormat;
  readonly numberFormat: NumberFormatKey;
  readonly unknown: 'fallback' | 'create';
  readonly fallbackIncome: string;
  readonly fallbackExpense: string;
};

export const emptyCsvDraft: CsvDraft = {
  text: '',
  separator: ',',
  hasHeader: true,
  accountId: '',
  dateColumn: '',
  descriptionColumn: '',
  categoryColumn: '',
  amountMode: 'single',
  amountColumn: '',
  debitColumn: '',
  creditColumn: '',
  positive: 'income',
  dateFormat: 'ymd',
  numberFormat: 'dot-comma',
  unknown: 'fallback',
  fallbackIncome: '',
  fallbackExpense: '',
};

export function columnChoices({ text, separator, hasHeader }: CsvDraft) {
  const parsed = parseCsv(text, separator);
  if (!parsed.ok || parsed.value.length === 0) return [];
  return parsed.value[0].cells.map((cell, index) => ({
    value: String(index),
    label: (hasHeader && cell.trim()) || `Column ${index + 1}`,
  }));
}

const column = (text: string) => (text === '' ? null : Number(text));

export function toCsvInput(draft: CsvDraft): Result<CsvImportInput, { message: string }> {
  const missing = (what: string) => err({ message: `Choose ${what}.` });
  if (!draft.accountId) return missing('an account');
  const date = column(draft.dateColumn);
  if (date === null) return missing('the date column');
  const single = draft.amountMode === 'single';
  const [first, second] = single
    ? [column(draft.amountColumn), 0]
    : [column(draft.debitColumn), column(draft.creditColumn)];
  if (first === null || second === null) {
    return missing(single ? 'the amount column' : 'the debit and credit columns');
  }
  return ok({
    text: draft.text,
    separator: draft.separator,
    hasHeader: draft.hasHeader,
    accountId: draft.accountId,
    mapping: {
      date,
      description: column(draft.descriptionColumn),
      category: column(draft.categoryColumn),
      amount: single
        ? { mode: 'single', column: first, positive: draft.positive }
        : { mode: 'split', debit: first, credit: second },
      dateFormat: draft.dateFormat,
      numberFormat: NUMBER_FORMATS[draft.numberFormat],
    },
    unknownCategories:
      draft.unknown === 'create'
        ? { action: 'create' }
        : {
            action: 'fallback',
            income: draft.fallbackIncome || null,
            expense: draft.fallbackExpense || null,
          },
  });
}

export function failureLines(failures: readonly RowFailure[]): string[] {
  const shown = failures
    .slice(0, FAILURES_SHOWN)
    .map(({ line, reason }) => `Line ${line}: ${reason}`);
  const hidden = failures.length - shown.length;
  return hidden > 0 ? [...shown, `And ${hidden} more.`] : shown;
}

export function reportLabel({ imported, duplicates, invalid }: CsvReport): string {
  const plural = duplicates === 1 ? '' : 's';
  return `Imported ${imported}. Skipped ${duplicates} duplicate${plural} and ${invalid.length} invalid.`;
}
