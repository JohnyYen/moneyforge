import type { Account } from './account';
import type { AccountGroup } from './account-group';
import { accountLabel, groupNamesById, withGroupLabels } from './account-label';

const account = (id: string, name: string, groupId: string | null): Account => ({
  id,
  name,
  type: 'Bank',
  currencyCode: 'EUR',
  openingBalance: 0n,
  archived: false,
  systemRole: null,
  groupId,
});

const bankX: AccountGroup = { id: 'g1', name: 'Bank X', type: 'Bank', archived: false };
const bankY: AccountGroup = { id: 'g2', name: 'Bank Y', type: 'Bank', archived: true };

describe('accountLabel', () => {
  const names = groupNamesById([bankX, bankY]);

  it('names a grouped account after its group', () => {
    expect(accountLabel(account('a1', 'EUR', 'g1'), names)).toBe('Bank X · EUR');
  });

  it('keeps the name of an account moved into a group, after the group name', () => {
    expect(accountLabel(account('a2', 'Pesos', 'g2'), names)).toBe('Bank Y · Pesos');
  });

  it('keeps the plain name of an ungrouped account', () => {
    expect(accountLabel(account('a3', 'Wallet', null), names)).toBe('Wallet');
  });

  it('falls back to the plain name when the group is unknown', () => {
    expect(accountLabel(account('a4', 'EUR', 'gone'), names)).toBe('EUR');
  });
});

describe('withGroupLabels', () => {
  it('returns copies named by their label and leaves the originals untouched', () => {
    const accounts = [account('a1', 'EUR', 'g1'), account('a3', 'Wallet', null)];

    const labelled = withGroupLabels(accounts, [bankX]);

    expect(labelled.map(({ name }) => name)).toEqual(['Bank X · EUR', 'Wallet']);
    expect(labelled[0]).toEqual({ ...accounts[0], name: 'Bank X · EUR' });
    expect(accounts.map(({ name }) => name)).toEqual(['EUR', 'Wallet']);
  });

  it('follows a group rename', () => {
    const accounts = [account('a1', 'EUR', 'g1')];

    expect(withGroupLabels(accounts, [{ ...bankX, name: 'Bank Z' }])[0].name).toBe('Bank Z · EUR');
  });
});
