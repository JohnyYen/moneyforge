import { err, ok, type Result } from '@/shared/result';

import type { SubAccountInput } from '../../application/account-group-use-cases';
import type { GroupOverview } from '../../application/overview-use-cases';
import type { AccountGroup } from '../../domain/account-group';
import type { Currency } from '../../domain/currency';
import type { LedgerError, LedgerErrorCode } from '../../domain/ledger-error';
import { formatDisplay } from '../../domain/money';
import {
  missingRatesNote,
  subAccountRow,
  type AccountRowModel,
} from '../accounts/accounts-list-model';

export type GroupDetailModel = {
  readonly title: string;
  readonly subtitle: string;
  readonly total: string | null;
  readonly note: string | null;
  readonly archived: boolean;
  readonly accounts: readonly AccountRowModel[];
  readonly archivedAccounts: readonly AccountRowModel[];
  /** Currencies a new sub-account may use: none the group already holds, archived ones included. */
  readonly availableCurrencies: readonly Currency[];
};

export function groupDetailModel(
  { group, accounts, total, missingRates }: GroupOverview,
  base: Currency | null,
  currencies: readonly Currency[],
): GroupDetailModel {
  const held = new Set(accounts.map(({ account }) => account.currencyCode));
  return {
    title: group.name,
    subtitle: group.archived ? `${group.type} · Archived` : group.type,
    total: base ? formatDisplay(total, base) : null,
    note: missingRatesNote(missingRates),
    archived: group.archived,
    accounts: accounts.filter(({ account }) => !account.archived).map(subAccountRow),
    archivedAccounts: accounts.filter(({ account }) => account.archived).map(subAccountRow),
    availableCurrencies: group.archived ? [] : currencies.filter(({ code }) => !held.has(code)),
  };
}

/** One currency line of the create-group form. `key` keeps the row stable while editing. */
export type GroupCurrencyRow = {
  readonly key: string;
  readonly currencyCode: string | null;
  readonly openingBalance: string;
};

export type GroupFormValues = {
  readonly name: string;
  readonly type: string;
  readonly rows: readonly GroupCurrencyRow[];
};

/** Catches what the form can see before the use case runs; amounts are checked by the use case. */
export function validateGroupForm(
  values: GroupFormValues,
): Result<{ name: string; type: string; currencies: SubAccountInput[] }, string> {
  if (!values.name.trim()) return err('Enter a name.');
  if (!values.type.trim()) return err('Enter a type.');
  if (values.rows.length === 0) return err('Add at least one currency.');
  const currencies: SubAccountInput[] = [];
  for (const { currencyCode, openingBalance } of values.rows) {
    if (!currencyCode) return err('Choose a currency for every row.');
    if (currencies.some((chosen) => chosen.currencyCode === currencyCode)) {
      return err(`${currencyCode} appears more than once. Each currency can appear only once.`);
    }
    currencies.push({ currencyCode, openingBalance });
  }
  return ok({ name: values.name, type: values.type, currencies });
}

const GROUP_ERROR_COPY: Partial<Record<LedgerErrorCode, string>> = {
  'group-currency-taken': 'This group already has an account in this currency.',
  'group-not-found': 'This group no longer exists.',
  'group-empty': 'Add at least one currency.',
  'duplicate-currency': 'Each currency can appear only once.',
  'group-archived': 'This group is archived. Restore it or choose another group.',
  'invalid-group': 'Enter a name and a type for the group.',
};

export function groupErrorMessage(error: LedgerError): string {
  return GROUP_ERROR_COPY[error.code] ?? error.message;
}

/** Gives a refused result the group error copy, for `useSubmit` to show. */
export function withGroupErrorCopy<T>(result: Result<T, LedgerError>): Result<T, LedgerError> {
  return result.ok ? result : err({ ...result.error, message: groupErrorMessage(result.error) });
}

/** The picker value for "no group". Group ids are generated, so it never clashes with one. */
export const NO_GROUP = 'none';

export function pickerValueFor(groupId: string | null): string {
  return groupId ?? NO_GROUP;
}

export function groupIdFromPicker(value: string): string | null {
  return value === NO_GROUP ? null : value;
}

/** "None" and the active groups, plus the archived group the account is already in, if any. */
export function groupPickerOptions(
  groups: readonly AccountGroup[],
  currentGroupId: string | null,
): { value: string; label: string }[] {
  return [
    { value: NO_GROUP, label: 'None' },
    ...groups
      .filter(({ archived, id }) => !archived || id === currentGroupId)
      .map(({ id, name, archived }) => ({
        value: id,
        label: archived ? `${name} (archived)` : name,
      })),
  ];
}

/** A sub-account mirrors its group's type, so the form shows it locked. */
export function lockedGroupType(
  groupId: string | null,
  groups: readonly AccountGroup[],
): string | null {
  if (groupId === null) return null;
  return groups.find(({ id }) => id === groupId)?.type ?? null;
}
