import { err, ok, type Result } from '@/shared/result';

import { ledgerError, type LedgerError } from './ledger-error';

export const SYSTEM_ROLES = ['income', 'expense', 'equity', 'conversion'] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];

export type Account = {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly currencyCode: string;
  readonly openingBalance: bigint;
  readonly archived: boolean;
  readonly systemRole: SystemRole | null;
};

export type AccountRef = Pick<Account, 'id' | 'currencyCode'>;

const SYSTEM_PREFIX = 'system:';

export function systemAccountId(currencyCode: string, role: SystemRole): string {
  return `${SYSTEM_PREFIX}${currencyCode}:${role}`;
}

export function isSystemAccountId(id: string): boolean {
  return id.startsWith(SYSTEM_PREFIX);
}

export function buildSystemAccounts(currencyCode: string): Account[] {
  return SYSTEM_ROLES.map((role) => ({
    id: systemAccountId(currencyCode, role),
    name: `${currencyCode} ${role}`,
    type: 'system',
    currencyCode,
    openingBalance: 0n,
    archived: false,
    systemRole: role,
  }));
}

export function validateAccountFields(input: {
  readonly name: string;
  readonly type: string;
}): Result<{ name: string; type: string }, LedgerError> {
  const name = input.name.trim();
  const type = input.type.trim();
  if (!name) return err(ledgerError('invalid-account', 'Enter an account name.'));
  if (!type) return err(ledgerError('invalid-account', 'Enter an account type.'));
  return ok({ name, type });
}
