import type { AccountBalance, GroupOverview } from '../../application/overview-use-cases';
import type { Account } from '../../domain/account';
import type { AccountGroup } from '../../domain/account-group';
import type { Currency } from '../../domain/currency';
import { accountsListModel } from './accounts-list-model';

const usd: Currency = { code: 'USD', name: 'Dollar', decimals: 2, symbol: '$', kind: 'fiat' };
const eur: Currency = { code: 'EUR', name: 'Euro', decimals: 2, symbol: '€', kind: 'fiat' };
const currencies = { USD: usd, EUR: eur };

const balance = (
  id: string,
  name: string,
  code: 'USD' | 'EUR',
  minor: bigint,
  extra: Partial<Account> = {},
): AccountBalance => ({
  account: {
    id,
    name,
    type: 'Bank',
    currencyCode: code,
    openingBalance: 0n,
    archived: false,
    systemRole: null,
    groupId: null,
    ...extra,
  },
  currency: currencies[code],
  balance: minor,
});

const group = (id: string, extra: Partial<AccountGroup> = {}): AccountGroup => ({
  id,
  name: 'Bank X',
  type: 'Bank',
  archived: false,
  ...extra,
});

const overviewOf = (
  value: AccountGroup,
  accounts: AccountBalance[],
  total: bigint,
  missingRates: string[] = [],
): GroupOverview => ({ group: value, accounts, total, baseCurrency: 'USD', missingRates });

describe('accountsListModel', () => {
  it('shows an active group with its total and its active sub-accounts beneath', () => {
    const bank = group('g1');
    const model = accountsListModel(
      {
        baseCurrency: 'USD',
        groups: [
          overviewOf(
            bank,
            [
              balance('a1', 'USD', 'USD', 10000n, { groupId: 'g1' }),
              balance('a2', 'Euro savings', 'EUR', 5025n, { groupId: 'g1' }),
              balance('a3', 'Old', 'EUR', 1n, { groupId: 'g1', archived: true }),
            ],
            15000n,
          ),
        ],
        ungrouped: [balance('w', 'Wallet', 'USD', 500n)],
      },
      usd,
    );

    expect(model.active).toEqual([
      {
        kind: 'group',
        id: 'g1',
        title: 'Bank X',
        subtitle: 'Bank · USD, EUR',
        trailing: '$150.00',
        note: null,
        accounts: [
          { kind: 'account', id: 'a1', title: 'USD', subtitle: undefined, trailing: '$100.00' },
          { kind: 'account', id: 'a2', title: 'Euro savings', subtitle: 'EUR', trailing: '€50.25' },
        ],
      },
      { kind: 'account', id: 'w', title: 'Wallet', subtitle: 'Bank · USD', trailing: '$5.00' },
    ]);
    expect(model.archived).toEqual([]);
    expect(model.hasActiveAccounts).toBe(true);
  });

  it('notes the currencies the group total leaves out for lack of a rate', () => {
    const model = accountsListModel(
      {
        baseCurrency: 'USD',
        groups: [
          overviewOf(group('g1'), [balance('a2', 'EUR', 'EUR', 5025n, { groupId: 'g1' })], 0n, ['EUR']),
        ],
        ungrouped: [],
      },
      usd,
    );

    expect(model.active[0]).toMatchObject({ note: 'No rate for EUR, so it is not in the total.' });
  });

  it('lists archived groups and archived ungrouped accounts in the archived section', () => {
    const model = accountsListModel(
      {
        baseCurrency: 'USD',
        groups: [
          overviewOf(
            group('g1', { archived: true }),
            [balance('a1', 'USD', 'USD', 100n, { groupId: 'g1', archived: true })],
            0n,
          ),
        ],
        ungrouped: [balance('old', 'Old wallet', 'EUR', 0n, { archived: true })],
      },
      usd,
    );

    expect(model.active).toEqual([]);
    expect(model.archived).toEqual([
      { kind: 'group', id: 'g1', title: 'Bank X', subtitle: 'Bank · USD', trailing: null, note: null, accounts: [] },
      { kind: 'account', id: 'old', title: 'Old wallet', subtitle: 'Bank · EUR', trailing: '€0.00' },
    ]);
    expect(model.hasActiveAccounts).toBe(false);
  });

  it('has no active account when an active group holds only archived sub-accounts', () => {
    const model = accountsListModel(
      {
        baseCurrency: 'USD',
        groups: [overviewOf(group('g1'), [balance('a1', 'USD', 'USD', 1n, { groupId: 'g1', archived: true })], 0n)],
        ungrouped: [],
      },
      usd,
    );

    expect(model.active).toHaveLength(1);
    expect(model.hasActiveAccounts).toBe(false);
  });

  it('leaves the group total out without a base currency', () => {
    const model = accountsListModel(
      { baseCurrency: 'USD', groups: [overviewOf(group('g1'), [], 0n)], ungrouped: [] },
      null,
    );

    expect(model.active[0]).toMatchObject({ trailing: null });
  });
});
