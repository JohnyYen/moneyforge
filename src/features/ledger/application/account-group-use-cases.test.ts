import { runMigrations } from '@/shared/persistence/migrator';
import { migrations } from '@/shared/persistence/migrations';
import { createNodeSqliteDriver } from '@/shared/persistence/node-sqlite-driver';
import type { SqlDriver } from '@/shared/persistence/sql-driver';
import type { Result } from '@/shared/result';

import { systemAccountId } from '../domain/account';
import type { LedgerError } from '../domain/ledger-error';
import { createSqliteLedgerStore } from '../infrastructure/sqlite-ledger-store';
import { createLedgerService, type LedgerService } from './ledger-service';

function unwrap<T>(result: Result<T, LedgerError>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

describe('account groups', () => {
  let driver: SqlDriver;
  let ledger: LedgerService;
  let sequence: number;

  beforeEach(async () => {
    driver = createNodeSqliteDriver();
    await runMigrations(driver, migrations);
    sequence = 0;
    ledger = createLedgerService({
      store: createSqliteLedgerStore(driver),
      clock: { now: () => new Date('2026-03-10T12:00:00.000Z') },
      generateId: () => `id-${++sequence}`,
    });
    await ledger.initialize();
  });

  afterEach(() => driver.close());

  const balanceOf = async (id: string) =>
    (await ledger.accountBalances()).find((item) => item.account.id === id)?.balance;

  const bankX = async () =>
    unwrap(
      await ledger.createAccountGroup({
        name: 'Bank X',
        type: 'Bank',
        currencies: [
          { currencyCode: 'USD', openingBalance: '100' },
          { currencyCode: 'EUR', openingBalance: '50.25', name: 'Euro savings' },
        ],
      }),
    );

  const failure = (code: string) => ({ ok: false, error: { code } });

  const countRows = async (table: string) =>
    (await driver.get<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`))?.count;

  describe('creating', () => {
    it('creates the group with one sub-account per currency and their opening balances', async () => {
      const { group, accounts } = await bankX();

      expect(group).toEqual({ id: group.id, name: 'Bank X', type: 'Bank', archived: false });
      expect(accounts).toEqual([
        expect.objectContaining({ name: 'USD', type: 'Bank', currencyCode: 'USD', groupId: group.id }),
        expect.objectContaining({ name: 'Euro savings', currencyCode: 'EUR', groupId: group.id }),
      ]);
      await expect(balanceOf(accounts[0].id)).resolves.toBe(10000n);
      await expect(balanceOf(accounts[1].id)).resolves.toBe(5025n);
      await expect(ledger.listAccountGroups()).resolves.toEqual([group]);
      await expect(ledger.getAccount(accounts[0].id)).resolves.toMatchObject({ groupId: group.id });
    });

    it('rejects an empty currency list, a repeated currency, and a blank name, and writes nothing', async () => {
      const input = { name: 'Bank X', type: 'Bank' };
      const usd = { currencyCode: 'USD', openingBalance: '1' };

      await expect(ledger.createAccountGroup({ ...input, currencies: [] })).resolves.toMatchObject(
        failure('group-empty'),
      );
      await expect(
        ledger.createAccountGroup({ ...input, currencies: [usd, { ...usd, openingBalance: '2' }] }),
      ).resolves.toMatchObject(failure('duplicate-currency'));
      await expect(
        ledger.createAccountGroup({ ...input, name: ' ', currencies: [usd] }),
      ).resolves.toMatchObject(failure('invalid-group'));

      await expect(ledger.listAccountGroups()).resolves.toEqual([]);
      await expect(ledger.listAccounts()).resolves.toEqual([]);
    });

    it('writes nothing when a later sub-account is invalid', async () => {
      await expect(
        ledger.createAccountGroup({
          name: 'Bank X',
          type: 'Bank',
          currencies: [
            { currencyCode: 'USD', openingBalance: '1' },
            { currencyCode: 'EUR', openingBalance: '1.234' },
          ],
        }),
      ).resolves.toMatchObject(failure('too-precise'));
      await expect(
        ledger.createAccountGroup({
          name: 'Bank X',
          type: 'Bank',
          currencies: [
            { currencyCode: 'USD', openingBalance: '1' },
            { currencyCode: 'XXX', openingBalance: '1' },
          ],
        }),
      ).resolves.toMatchObject(failure('not-found'));

      await expect(countRows('account_groups')).resolves.toBe(0);
      await expect(ledger.listAccounts()).resolves.toEqual([]);
      await expect(countRows('transactions')).resolves.toBe(0);
    });
  });

  describe('editing', () => {
    it('renames and retypes the group', async () => {
      const { group } = await bankX();

      const updated = unwrap(await ledger.updateAccountGroup(group.id, { name: 'Bank Y', type: 'Cash' }));

      expect(updated).toEqual({ ...group, name: 'Bank Y', type: 'Cash' });
      await expect(ledger.getAccountGroup(group.id)).resolves.toEqual(updated);
      await expect(
        ledger.updateAccountGroup('missing', { name: 'A', type: 'B' }),
      ).resolves.toMatchObject(failure('group-not-found'));
      await expect(
        ledger.updateAccountGroup(group.id, { name: '', type: 'B' }),
      ).resolves.toMatchObject(failure('invalid-group'));
    });

    it('adds a sub-account in a new currency and refuses one already held', async () => {
      const { group } = await bankX();

      const dai = unwrap(await ledger.addSubAccount(group.id, { currencyCode: 'DAI', openingBalance: '3' }));

      expect(dai).toMatchObject({ name: 'DAI', type: 'Bank', currencyCode: 'DAI', groupId: group.id });
      await expect(balanceOf(dai.id)).resolves.toBe(3n * 10n ** 18n);
      await expect(
        ledger.addSubAccount(group.id, { currencyCode: 'USD', openingBalance: '0' }),
      ).resolves.toMatchObject(failure('group-currency-taken'));
      await expect(
        ledger.addSubAccount('missing', { currencyCode: 'USD', openingBalance: '0' }),
      ).resolves.toMatchObject(failure('group-not-found'));
    });

    it('archives and unarchives every sub-account with the group', async () => {
      const { group, accounts } = await bankX();

      const archived = unwrap(await ledger.setAccountGroupArchived(group.id, true));

      expect(archived.archived).toBe(true);
      for (const { id } of accounts) {
        await expect(ledger.getAccount(id)).resolves.toMatchObject({ archived: true });
      }

      unwrap(await ledger.setAccountGroupArchived(group.id, false));

      for (const { id } of accounts) {
        await expect(ledger.getAccount(id)).resolves.toMatchObject({ archived: false });
      }
      await expect(ledger.setAccountGroupArchived('missing', true)).resolves.toMatchObject(
        failure('group-not-found'),
      );
    });
    it('carries a new group type to every sub-account, which mirror it', async () => {
      const { group, accounts } = await bankX();

      unwrap(await ledger.updateAccountGroup(group.id, { name: 'Bank X', type: 'Savings' }));

      for (const { id } of accounts) {
        await expect(ledger.getAccount(id)).resolves.toMatchObject({ type: 'Savings' });
      }
      const later = unwrap(
        await ledger.addSubAccount(group.id, { currencyCode: 'DAI', openingBalance: '0' }),
      );
      expect(later.type).toBe('Savings');
    });

    it('unarchives every sub-account with the group, one archived on its own before included', async () => {
      const { group, accounts } = await bankX();
      const [usd, eur] = accounts;
      const edit = { name: usd.name, type: 'Bank', openingBalance: '100', archived: true };
      unwrap(await ledger.updateAccount({ ...edit, id: usd.id }));

      unwrap(await ledger.setAccountGroupArchived(group.id, true));
      unwrap(await ledger.setAccountGroupArchived(group.id, false));

      await expect(ledger.getAccount(usd.id)).resolves.toMatchObject({ archived: false });
      await expect(ledger.getAccount(eur.id)).resolves.toMatchObject({ archived: false });
    });

    it('refuses to add a sub-account to an archived group', async () => {
      const { group } = await bankX();
      unwrap(await ledger.setAccountGroupArchived(group.id, true));

      await expect(
        ledger.addSubAccount(group.id, { currencyCode: 'DAI', openingBalance: '0' }),
      ).resolves.toMatchObject(failure('group-archived'));
    });
  });

  describe('moving accounts', () => {
    const create = async (name: string, currencyCode: string, groupId?: string | null) =>
      ledger.createAccount({ name, type: 'Bank', currencyCode, openingBalance: '0', groupId });

    it('moves an account into a group and back out', async () => {
      const { group } = await bankX();
      const wallet = unwrap(await create('Wallet', 'DAI'));
      expect(wallet.groupId).toBeNull();

      const moved = unwrap(await ledger.moveAccountToGroup(wallet.id, group.id));

      expect(moved.groupId).toBe(group.id);
      await expect(ledger.getAccount(wallet.id)).resolves.toMatchObject({ groupId: group.id });

      unwrap(await ledger.moveAccountToGroup(wallet.id, null));

      await expect(ledger.getAccount(wallet.id)).resolves.toMatchObject({ groupId: null });
    });

    it('refuses a currency the group already holds, an unknown group, and a system account', async () => {
      const { group, accounts } = await bankX();
      const other = unwrap(await create('Other', 'USD'));

      await expect(ledger.moveAccountToGroup(other.id, group.id)).resolves.toMatchObject(
        failure('group-currency-taken'),
      );
      await expect(ledger.moveAccountToGroup(other.id, 'missing')).resolves.toMatchObject(
        failure('group-not-found'),
      );
      await expect(
        ledger.moveAccountToGroup(systemAccountId('USD', 'equity'), group.id),
      ).resolves.toMatchObject(failure('not-found'));
      // Staying in its own group is not a clash with itself.
      unwrap(await ledger.moveAccountToGroup(accounts[0].id, group.id));
    });

    it('applies the same rule when creating or editing an account', async () => {
      const { group, accounts } = await bankX();

      await expect(create('Second USD', 'USD', group.id)).resolves.toMatchObject(
        failure('group-currency-taken'),
      );
      await expect(create('Lost', 'DAI', 'missing')).resolves.toMatchObject(failure('group-not-found'));
      const dai = unwrap(await create('Crypto', 'DAI', group.id));
      expect(dai.groupId).toBe(group.id);

      const loose = unwrap(await create('Loose', 'EUR'));
      const edit = { id: loose.id, name: 'Loose', type: 'Bank', openingBalance: '0', archived: false };
      await expect(ledger.updateAccount({ ...edit, groupId: group.id })).resolves.toMatchObject(
        failure('group-currency-taken'),
      );

      // Leaving out the group keeps the one the account already has.
      const renamed = unwrap(
        await ledger.updateAccount({ ...edit, id: accounts[0].id, name: 'Dollars' }),
      );
      expect(renamed).toMatchObject({ name: 'Dollars', groupId: group.id });

      const out = unwrap(await ledger.updateAccount({ ...edit, id: accounts[0].id, groupId: null }));
      expect(out.groupId).toBeNull();
    });

    it('refuses an archived group as the target of a move, a new account, or an edit', async () => {
      const { group, accounts } = await bankX();
      const wallet = unwrap(await create('Wallet', 'DAI'));
      unwrap(await ledger.setAccountGroupArchived(group.id, true));

      await expect(ledger.moveAccountToGroup(wallet.id, group.id)).resolves.toMatchObject(
        failure('group-archived'),
      );
      await expect(create('Crypto', 'COP', group.id)).resolves.toMatchObject(
        failure('group-archived'),
      );
      const edit = { id: wallet.id, name: 'Wallet', type: 'Bank', openingBalance: '0', archived: false };
      await expect(ledger.updateAccount({ ...edit, groupId: group.id })).resolves.toMatchObject(
        failure('group-archived'),
      );
      await expect(ledger.getAccount(wallet.id)).resolves.toMatchObject({ groupId: null });

      // A sub-account already in the archived group can still be edited or taken out.
      const renamed = unwrap(
        await ledger.updateAccount({ ...edit, id: accounts[0].id, name: 'Dollars', archived: true }),
      );
      expect(renamed).toMatchObject({ name: 'Dollars', groupId: group.id });
      unwrap(await ledger.moveAccountToGroup(accounts[1].id, null));
    });
  });
});
