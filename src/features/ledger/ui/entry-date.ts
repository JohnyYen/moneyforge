import { err, ok, type Result } from '@/shared/result';

import { isValidDate } from '../domain/exchange-rate';
import { ledgerError, type LedgerError } from '../domain/ledger-error';

/** `undefined` for `currentDay`, which leaves the moment to the use case. */
export function occurredAtFromDay(
  day: string,
  currentDay: string,
): Result<string | undefined, LedgerError> {
  const text = day.trim();
  if (!isValidDate(text)) return err(ledgerError('invalid-date', 'Enter a date as YYYY-MM-DD.'));
  if (text === currentDay) return ok(undefined);
  const [year, month, date] = text.split('-').map(Number);
  return ok(new Date(year, month - 1, date, 12).toISOString());
}
