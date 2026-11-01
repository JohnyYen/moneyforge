import { err, ok, type Result } from '@/shared/result';

import { isValidDate } from '../domain/exchange-rate';
import { ledgerError, type LedgerError } from '../domain/ledger-error';

export function occurredAtFromDay(
  day: string,
  today: string,
): Result<string | undefined, LedgerError> {
  const text = day.trim();
  if (!isValidDate(text)) return err(ledgerError('invalid-date', 'Enter a date as YYYY-MM-DD.'));
  if (text === today) return ok(undefined);
  const [year, month, date] = text.split('-').map(Number);
  return ok(new Date(year, month - 1, date, 12).toISOString());
}
