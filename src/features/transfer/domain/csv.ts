import { err, ok, type Result } from '@/shared/result';

import { transferError, type TransferError } from './transfer-error';

export const CSV_SEPARATORS = [',', ';', '\t'] as const;
export type CsvSeparator = (typeof CSV_SEPARATORS)[number];

/** These bound the work on any text, and what a paste or a share can carry anyway. */
export const MAX_CSV_CHARS = 1_000_000;
export const MAX_CSV_ROWS = 5000;
export const MAX_CSV_COLUMNS = 64;
export const MAX_CSV_CELL = 2000;

const BYTE_ORDER_MARK = 0xfeff;

export type CsvRow = { readonly line: number; readonly cells: readonly string[] };

const tooLarge = (message: string) => err(transferError('too-large', message));
const malformed = (message: string) => err(transferError('invalid-csv', message));

/**
 * Reads RFC 4180 text, with the separator the person chose. A quote only opens a field at its
 * start, so `5" screen` stays text. `line` counts lines of the file, for messages, so a row after
 * a quoted newline still names the line an editor shows.
 */
export function parseCsv(
  input: string,
  separator: CsvSeparator,
): Result<CsvRow[], TransferError> {
  if (input.length > MAX_CSV_CHARS) {
    return tooLarge(`Paste up to ${MAX_CSV_CHARS.toLocaleString('en')} characters.`);
  }
  const text = input.charCodeAt(0) === BYTE_ORDER_MARK ? input.slice(1) : input;
  const rows: CsvRow[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let closed = false;
  let line = 1;
  let rowLine = 1;
  let quoteLine = 1;

  const endCell = () => {
    cells.push(cell);
    cell = '';
    closed = false;
  };
  const endRow = () => {
    const blank = cells.length === 0 && !closed && cell.trim() === '';
    endCell();
    if (!blank) rows.push({ line: rowLine, cells });
    cells = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (character === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
        closed = true;
      } else {
        cell += character;
        if (character === '\n' || (character === '\r' && next !== '\n')) line += 1;
      }
    } else if (character === separator) {
      endCell();
      if (cells.length > MAX_CSV_COLUMNS) {
        return tooLarge(`A row can have up to ${MAX_CSV_COLUMNS} columns.`);
      }
    } else if (character === '\n' || character === '\r') {
      endRow();
      if (rows.length > MAX_CSV_ROWS) return tooLarge(`A file can have up to ${MAX_CSV_ROWS} rows.`);
      if (character === '\r' && next === '\n') index += 1;
      line += 1;
      rowLine = line;
    } else if (closed) {
      return malformed(`Line ${line}: there is text after a closing quote.`);
    } else if (character === '"' && cell === '') {
      quoted = true;
      quoteLine = line;
    } else {
      cell += character;
    }
    if (cell.length > MAX_CSV_CELL) {
      return tooLarge(`Line ${line}: a cell can have up to ${MAX_CSV_CELL} characters.`);
    }
  }
  if (quoted) return malformed(`Line ${quoteLine}: a quote is never closed.`);
  endRow();
  if (rows.length > MAX_CSV_ROWS) return tooLarge(`A file can have up to ${MAX_CSV_ROWS} rows.`);
  return ok(rows);
}

const needsQuotes = /[",\r\n]/;

/** Numbers are written by the caller: only `neutralizeFormula` makes text safe to open. */
export function writeCsv(rows: readonly (readonly string[])[]): string {
  const cell = (text: string) =>
    needsQuotes.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  return rows.map((row) => `${row.map(cell).join(',')}\r\n`).join('');
}

const FORMULA_START = /^[=+\-@\uFF1D\uFF0B\uFF0D\uFF20]/;

/**
 * A spreadsheet runs a cell that starts with one of these, and some drop leading space first.
 * The apostrophe makes it text. Full-width forms are included, since some apps fold them.
 */
export function neutralizeFormula(text: string): string {
  const risky = /^[\t\r]/.test(text) || FORMULA_START.test(text.trimStart());
  return risky ? `'${text}` : text;
}
