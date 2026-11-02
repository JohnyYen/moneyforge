import { isValidDate } from '@/features/ledger/domain/exchange-rate';
import { parseDecimal } from '@/features/ledger/domain/money';
import { foldCase, normalizeBody } from '@/features/rules/domain/message';
import { parseAmountText, type NumberFormat } from '@/features/rules/domain/number-format';
import { MAX_FIELD_LENGTH } from '@/features/rules/domain/template';
import { keyedHash } from '@/shared/keyed-hash';
import { err, ok, type Result } from '@/shared/result';

import { foldNeutralized, type CsvRow } from './csv';

export const DATE_FORMATS = ['ymd', 'dmy', 'mdy'] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export type RowKind = 'income' | 'expense';

export const MAX_CATEGORY_NAME = 64;
/** An older date is a typing or column mistake, and no ledger here reaches back that far. */
const MIN_YEAR = 1900;

export type AmountMapping =
  | { readonly mode: 'single'; readonly column: number; readonly positive: RowKind }
  | { readonly mode: 'split'; readonly debit: number; readonly credit: number };

/** Chosen by a person for each file. Nothing here is detected, since `03/04` can mean either. */
export type CsvMapping = {
  readonly date: number;
  readonly description: number | null;
  readonly amount: AmountMapping;
  readonly category: number | null;
  /** When chosen, a row in another currency is invalid instead of read as the account's. */
  readonly currency: number | null;
  readonly dateFormat: DateFormat;
  readonly numberFormat: NumberFormat;
};

export type ImportRow = {
  readonly day: string;
  readonly kind: RowKind;
  /** Always positive: the kind holds the direction. */
  readonly minor: bigint;
  readonly description: string;
  readonly category: string | null;
};

const DAY_PATTERN = /^(\d{1,4})([-/.])(\d{1,2})\2(\d{1,4})(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/;

/** Reads only the chosen order, and a two-digit year has no one reading. A time is dropped. */
export function parseDay(text: string, format: DateFormat): string | null {
  const match = DAY_PATTERN.exec(text.trim());
  if (!match) return null;
  const [, first, , second, third] = match;
  const [year, month, day] =
    format === 'ymd'
      ? [first, second, third]
      : format === 'dmy'
        ? [third, second, first]
        : [third, first, second];
  if (year.length !== 4 || month.length > 2 || day.length > 2) return null;
  if (Number(year) < MIN_YEAR) return null;
  const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  return isValidDate(iso) ? iso : null;
}

/** Keeps its sign. Brackets, currency marks, and exponents are refused, not interpreted. */
export function parseAmount(
  text: string,
  format: NumberFormat,
  decimals: number,
): Result<bigint, string> {
  const trimmed = text.trim();
  if (trimmed.length > MAX_FIELD_LENGTH) {
    return err(`The amount is over ${MAX_FIELD_LENGTH} characters.`);
  }
  const negative = trimmed.startsWith('-');
  const digits = /^[+-]/.test(trimmed) ? trimmed.slice(1) : trimmed;
  const plain = parseAmountText(digits, format);
  if (plain === null) return err(`Cannot read the amount "${trimmed}" with this number format.`);
  const minor = parseDecimal(plain, decimals);
  if (!minor.ok) return err(`Cannot read the amount "${trimmed}": ${minor.error.message}`);
  return ok(negative ? -minor.value : minor.value);
}

type Signed = { readonly kind: RowKind; readonly minor: bigint };

function readSigned(
  cells: readonly string[],
  { amount, numberFormat }: CsvMapping,
  decimals: number,
): Result<Signed, string> {
  const read = (column: number) => parseAmount(cells[column], numberFormat, decimals);
  if (amount.mode === 'single') {
    const value = read(amount.column);
    if (!value.ok) return value;
    if (value.value === 0n) return err('The amount is zero.');
    const opposite = amount.positive === 'income' ? 'expense' : 'income';
    return value.value > 0n
      ? ok({ kind: amount.positive, minor: value.value })
      : ok({ kind: opposite, minor: -value.value });
  }
  const side = (column: number): Result<bigint, string> =>
    cells[column].trim() === '' ? ok(0n) : read(column);
  const debit = side(amount.debit);
  if (!debit.ok) return debit;
  const credit = side(amount.credit);
  if (!credit.ok) return credit;
  if (debit.value < 0n || credit.value < 0n) {
    return err('A debit or credit column cannot hold a negative amount.');
  }
  if (debit.value > 0n && credit.value > 0n) return err('Both debit and credit are filled.');
  if (debit.value === 0n && credit.value === 0n) return err('Neither debit nor credit is filled.');
  return debit.value > 0n
    ? ok({ kind: 'expense', minor: debit.value })
    : ok({ kind: 'income', minor: credit.value });
}

export function readRow(
  { cells }: CsvRow,
  mapping: CsvMapping,
  columns: number,
  currency: { readonly code: string; readonly decimals: number },
): Result<ImportRow, string> {
  if (cells.length !== columns) {
    return err(`Expected ${columns} columns, found ${cells.length}.`);
  }
  const day = parseDay(cells[mapping.date], mapping.dateFormat);
  if (!day) return err(`Cannot read the date "${cells[mapping.date].trim()}" in this format.`);
  if (mapping.currency !== null) {
    const code = foldNeutralized(cells[mapping.currency]).trim();
    if (foldCase(code) !== foldCase(currency.code)) {
      return err(`The currency "${code}" is not this account's ${currency.code}.`);
    }
  }
  const signed = readSigned(cells, mapping, currency.decimals);
  if (!signed.ok) return signed;
  const text = (column: number | null) => (column === null ? '' : normalizeBody(cells[column]));
  const category = text(mapping.category);
  if (category.length > MAX_CATEGORY_NAME) {
    return err(`A category name can have up to ${MAX_CATEGORY_NAME} characters.`);
  }
  return ok({
    ...signed.value,
    day,
    description: text(mapping.description),
    category: category || null,
  });
}

/**
 * Built from what a row means, not its text, so the same statement in another format still
 * matches. `repeat` tells two identical rows in a file apart: both are real, and a re-import
 * finds each one. Keyed, so stored fingerprints reveal nothing about amounts or descriptions.
 * An exported description matches its original, or importing an export would double every row
 * that looks like a formula.
 */
export function rowFingerprint(
  accountId: string,
  row: Pick<ImportRow, 'day' | 'kind' | 'minor' | 'description'>,
  repeat: number,
  secret: string,
): string {
  return keyedHash('csv-row', `${rowIdentity(accountId, row)}\0${repeat}`, secret);
}

export const rowIdentity = (
  accountId: string,
  { day, kind, minor, description }: Pick<ImportRow, 'day' | 'kind' | 'minor' | 'description'>,
) =>
  [accountId, day, kind, minor, foldCase(normalizeBody(foldNeutralized(description)))].join('\0');
