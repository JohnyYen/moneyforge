import { err, ok, type Result } from '@/shared/result';

import type { Account } from '../domain/account';
import { validateGroupFields, type AccountGroup } from '../domain/account-group';
import { withGroupLabels } from '../domain/account-label';
import { ledgerError, type LedgerError } from '../domain/ledger-error';
import { checkGroupSlot, insertAccount, prepareAccount } from './account-use-cases';
import type { LedgerDeps } from './ledger-deps';

/** One sub-account of a group. Its name defaults to its currency code. */
export type SubAccountInput = {
  readonly currencyCode: string;
  readonly openingBalance: string;
  readonly name?: string;
};

const groupNotFound = () => err(ledgerError('group-not-found', 'Account group not found.'));

const subAccount = (group: AccountGroup, input: SubAccountInput) => ({
  name: input.name?.trim() || input.currencyCode,
  type: group.type,
  currencyCode: input.currencyCode,
  openingBalance: input.openingBalance,
  groupId: group.id,
});

export function createAccountGroupUseCases({ store, clock, generateId }: LedgerDeps) {
  return {
    listAccountGroups: () => store.accountGroups.list(),

    /**
     * The user accounts as shown outside their group: a grouped one reads "Bank X · EUR". For
     * display and pickers only; never save one of these back.
     */
    listAccountsForDisplay: async (): Promise<Account[]> => {
      const [accounts, groups] = await Promise.all([
        store.accounts.listUser(),
        store.accountGroups.list(),
      ]);
      return withGroupLabels(accounts, groups);
    },

    getAccountGroup: (id: string) => store.accountGroups.get(id),

    /**
     * Every sub-account is validated before anything is written, because a returned error
     * commits like any other result.
     */
    createAccountGroup: (input: {
      name: string;
      type: string;
      currencies: readonly SubAccountInput[];
    }): Promise<Result<{ group: AccountGroup; accounts: Account[] }, LedgerError>> =>
      store.atomic(async (repositories) => {
        const fields = validateGroupFields(input);
        if (!fields.ok) return fields;
        if (input.currencies.length === 0) {
          return err(ledgerError('group-empty', 'Add at least one currency.'));
        }
        const codes = input.currencies.map(({ currencyCode }) => currencyCode);
        if (new Set(codes).size !== codes.length) {
          return err(ledgerError('duplicate-currency', 'Each currency can appear only once.'));
        }

        const group: AccountGroup = { ...fields.value, id: generateId(), archived: false };
        // The group is not saved yet, so each sub-account is checked without a group, which
        // the distinct currencies above already make safe.
        const accounts: Account[] = [];
        for (const currency of input.currencies) {
          const { groupId, ...unsaved } = subAccount(group, currency);
          const account = await prepareAccount(repositories, unsaved, generateId());
          if (!account.ok) return account;
          accounts.push({ ...account.value, groupId });
        }

        await repositories.accountGroups.save(group);
        const occurredAt = clock.now().toISOString();
        for (const account of accounts) await insertAccount(repositories, account, occurredAt);
        return ok({ group, accounts });
      }),

    updateAccountGroup: (
      id: string,
      input: { name: string; type: string },
    ): Promise<Result<AccountGroup, LedgerError>> =>
      store.atomic(async ({ accountGroups, accounts }) => {
        const fields = validateGroupFields(input);
        if (!fields.ok) return fields;
        const existing = await accountGroups.get(id);
        if (!existing) return groupNotFound();
        const group = { ...existing, ...fields.value };
        await accountGroups.save(group);
        // Sub-accounts mirror their group's type.
        for (const account of await accounts.listUser()) {
          if (account.groupId === id && account.type !== group.type) {
            await accounts.save({ ...account, type: group.type });
          }
        }
        return ok(group);
      }),

    addSubAccount: (
      groupId: string,
      input: SubAccountInput,
    ): Promise<Result<Account, LedgerError>> =>
      store.atomic(async (repositories) => {
        const group = await repositories.accountGroups.get(groupId);
        if (!group) return groupNotFound();
        const account = await prepareAccount(repositories, subAccount(group, input), generateId());
        if (!account.ok) return account;
        await insertAccount(repositories, account.value, clock.now().toISOString());
        return account;
      }),

    /** `null` takes the account out of its group. */
    moveAccountToGroup: (
      accountId: string,
      groupId: string | null,
    ): Promise<Result<Account, LedgerError>> =>
      store.atomic(async (repositories) => {
        const existing = await repositories.accounts.get(accountId);
        if (!existing || existing.systemRole !== null) {
          return err(ledgerError('not-found', 'Account not found.'));
        }
        const slot = await checkGroupSlot(repositories, groupId, existing.currencyCode, existing);
        if (!slot.ok) return slot;
        // Moving into a group takes its type; moving out keeps the current one.
        const account = { ...existing, groupId, type: slot.value?.type ?? existing.type };
        await repositories.accounts.save(account);
        return ok(account);
      }),

    /**
     * Archiving a group archives every account in it, and unarchiving restores them all, including
     * any archived on its own before the group was.
     */
    setAccountGroupArchived: (
      id: string,
      archived: boolean,
    ): Promise<Result<AccountGroup, LedgerError>> =>
      store.atomic(async ({ accountGroups, accounts }) => {
        const existing = await accountGroups.get(id);
        if (!existing) return groupNotFound();
        const group = { ...existing, archived };
        await accountGroups.save(group);
        for (const account of await accounts.listUser()) {
          if (account.groupId === id) await accounts.save({ ...account, archived });
        }
        return ok(group);
      }),
  };
}
