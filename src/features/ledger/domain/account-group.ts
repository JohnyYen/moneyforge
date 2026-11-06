import { err, ok, type Result } from '@/shared/result';

import { ledgerError, type LedgerError } from './ledger-error';

/**
 * Gathers accounts that live in one place, such as a bank holding several currencies. It has no
 * currency and no postings: each account in it stays an ordinary single-currency account.
 */
export type AccountGroup = {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly archived: boolean;
};

export function validateGroupFields(input: {
  readonly name: string;
  readonly type: string;
}): Result<{ name: string; type: string }, LedgerError> {
  const name = input.name.trim();
  const type = input.type.trim();
  if (!name) return err(ledgerError('invalid-group', 'Enter a group name.'));
  if (!type) return err(ledgerError('invalid-group', 'Enter a group type.'));
  return ok({ name, type });
}
