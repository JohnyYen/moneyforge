import type { AccountBalance, GroupOverview } from '../../application/overview-use-cases';
import type { Account } from '../../domain/account';
import type { AccountGroup } from '../../domain/account-group';
import type { Currency } from '../../domain/currency';
import { ledgerError, type LedgerErrorCode } from '../../domain/ledger-error';
import {
  groupDetailModel,
  groupErrorMessage,
  groupIdFromPicker,
  groupPickerOptions,
  lockedGroupType,
  NO_GROUP,
  pickerValueFor,
  validateGroupForm,
  withGroupErrorCopy,
} from './group-model';

const usd: Currency = { code: 'USD', name: 'Dollar', decimals: 2, symbol: '$', kind: 'fiat' };
const eur: Currency = { code: 'EUR', name: 'Euro', decimals: 2, symbol: '€', kind: 'fiat' };
const cop: Currency = { code: 'COP', name: 'Peso', decimals: 2, symbol: 'COL$', kind: 'fiat' };

const bank: AccountGroup = { id: 'g1', name: 'Bank X', type: 'Bank', archived: false };
const savings: AccountGroup = { id: 'g2', name: 'Savings', type: 'Savings', archived: false };
const closed: AccountGroup = { id: 'g3', name: 'Closed', type: 'Bank', archived: true };

const sub = (id: string, currency: Currency, minor: bigint, archived = false): AccountBalance => {
  const account: Account = {
    id,
    name: currency.code,
    type: 'Bank',
    currencyCode: currency.code,
    openingBalance: 0n,
    archived,
    systemRole: null,
    groupId: 'g1',
  };
  return { account, currency, balance: minor };
};

describe('groupDetailModel', () => {
  const overview = (group: AccountGroup, missingRates: string[] = []): GroupOverview => ({
    group,
    accounts: [sub('a1', usd, 10000n), sub('a2', eur, 500n, true)],
    total: 10000n,
    baseCurrency: 'USD',
    missingRates,
  });

  it('shows the total, splits active and archived sub-accounts, and offers only new currencies', () => {
    const model = groupDetailModel(overview(bank, ['COP']), usd, [usd, eur, cop]);

    expect(model).toMatchObject({
      title: 'Bank X',
      subtitle: 'Bank',
      total: '$100.00',
      note: 'No rate for COP, so it is not in the total.',
      archived: false,
    });
    expect(model.accounts.map(({ id }) => id)).toEqual(['a1']);
    expect(model.archivedAccounts.map(({ id }) => id)).toEqual(['a2']);
    // EUR is held by an archived sub-account, which still takes the slot.
    expect(model.availableCurrencies).toEqual([cop]);
  });

  it('offers no currency for an archived group and marks it archived', () => {
    const model = groupDetailModel(overview(closed), usd, [usd, eur, cop]);

    expect(model).toMatchObject({ subtitle: 'Bank · Archived', archived: true });
    expect(model.availableCurrencies).toEqual([]);
  });
});

describe('validateGroupForm', () => {
  const row = (currencyCode: string | null, openingBalance = '') => ({
    key: currencyCode ?? 'blank',
    currencyCode,
    openingBalance,
  });

  it('builds the use case input from the rows', () => {
    expect(
      validateGroupForm({ name: ' Bank X ', type: 'Bank', rows: [row('USD', '100'), row('EUR')] }),
    ).toEqual({
      ok: true,
      value: {
        name: ' Bank X ',
        type: 'Bank',
        currencies: [
          { currencyCode: 'USD', openingBalance: '100' },
          { currencyCode: 'EUR', openingBalance: '' },
        ],
      },
    });
  });

  it.each([
    [{ name: ' ', type: 'Bank', rows: [row('USD')] }, 'Enter a name.'],
    [{ name: 'Bank X', type: '', rows: [row('USD')] }, 'Enter a type.'],
    [{ name: 'Bank X', type: 'Bank', rows: [] }, 'Add at least one currency.'],
    [{ name: 'Bank X', type: 'Bank', rows: [row('USD'), row(null)] }, 'Choose a currency for every row.'],
    [
      { name: 'Bank X', type: 'Bank', rows: [row('USD'), row('EUR'), row('USD', '2')] },
      'USD appears more than once. Each currency can appear only once.',
    ],
  ])('rejects %o', (values, message) => {
    expect(validateGroupForm(values)).toEqual({ ok: false, error: message });
  });
});

describe('group errors', () => {
  it.each<[LedgerErrorCode, string]>([
    ['group-currency-taken', 'This group already has an account in this currency.'],
    ['group-not-found', 'This group no longer exists.'],
    ['group-empty', 'Add at least one currency.'],
    ['duplicate-currency', 'Each currency can appear only once.'],
    ['group-archived', 'This group is archived. Restore it or choose another group.'],
    ['invalid-group', 'Enter a name and a type for the group.'],
  ])('gives %s its own copy', (code, message) => {
    expect(groupErrorMessage(ledgerError(code, 'raw'))).toBe(message);
  });

  it('keeps the message of any other error', () => {
    expect(groupErrorMessage(ledgerError('too-precise', 'Too many decimals.'))).toBe(
      'Too many decimals.',
    );
  });

  it('rewrites only a refused result', () => {
    expect(withGroupErrorCopy({ ok: true, value: 1 })).toEqual({ ok: true, value: 1 });
    expect(withGroupErrorCopy({ ok: false, error: ledgerError('group-empty', 'raw') })).toEqual({
      ok: false,
      error: { code: 'group-empty', message: 'Add at least one currency.' },
    });
  });
});

describe('group picker', () => {
  it('offers None and the active groups', () => {
    expect(groupPickerOptions([bank, savings, closed], null)).toEqual([
      { value: NO_GROUP, label: 'None' },
      { value: 'g1', label: 'Bank X' },
      { value: 'g2', label: 'Savings' },
    ]);
  });

  it('keeps the archived group the account is already in', () => {
    expect(groupPickerOptions([bank, closed], 'g3')).toEqual([
      { value: NO_GROUP, label: 'None' },
      { value: 'g1', label: 'Bank X' },
      { value: 'g3', label: 'Closed (archived)' },
    ]);
  });

  it('maps between a group id and a picker value', () => {
    expect(pickerValueFor(null)).toBe(NO_GROUP);
    expect(pickerValueFor('g1')).toBe('g1');
    expect(groupIdFromPicker(NO_GROUP)).toBeNull();
    expect(groupIdFromPicker('g1')).toBe('g1');
  });

  it('locks the type to the selected group', () => {
    expect(lockedGroupType('g2', [bank, savings])).toBe('Savings');
    expect(lockedGroupType(null, [bank, savings])).toBeNull();
    expect(lockedGroupType('missing', [bank])).toBeNull();
  });
});
