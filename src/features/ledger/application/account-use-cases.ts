import { err, ok, type Result } from '@/shared/result';

import { validateAccountFields, type Account } from '../domain/account';
import { createAdjustment } from '../domain/journal';
import { ledgerError, type LedgerError } from '../domain/ledger-error';
import { parseDecimal } from '../domain/money';
import type { LedgerDeps } from './ledger-deps';
import type { JournalRepository, LedgerRepositories } from './ports';

const openingEntryId = (accountId: string) => `opening:${accountId}`;

/** Runs inside `atomic`: a failure must throw so the account write rolls back with it. */
async function writeOpeningEntry(
  journal: JournalRepository,
  account: Account,
  occurredAt: string,
): Promise<void> {
  const id = openingEntryId(account.id);
  if (account.openingBalance === 0n) {
    await journal.remove(id);
    return;
  }
  const entry = createAdjustment({
    id,
    occurredAt,
    description: 'Opening balance',
    metadata: { source: 'opening-balance' },
    account,
    difference: account.openingBalance,
  });
  if (!entry.ok) throw new Error(entry.error.message);
  await journal.save(entry.value);
}

/**
 * Checks that an account may sit in a group: the group exists, is not archived unless the account
 * is already in it, and holds no other account in the same currency. Writes nothing, so a refusal
 * leaves the transaction untouched.
 */
export async function checkGroupSlot(
  { accounts, accountGroups }: LedgerRepositories,
  groupId: string | null,
  currencyCode: string,
  current?: { readonly id: string; readonly groupId: string | null },
): Promise<Result<void, LedgerError>> {
  if (groupId === null) return ok(undefined);
  const group = await accountGroups.get(groupId);
  if (!group) return err(ledgerError('group-not-found', 'Account group not found.'));
  if (group.archived && current?.groupId !== groupId) {
    return err(ledgerError('group-archived', 'This group is archived.'));
  }
  const taken = (await accounts.listUser()).some(
    (other) =>
      other.groupId === groupId && other.currencyCode === currencyCode && other.id !== current?.id,
  );
  if (taken) {
    return err(
      ledgerError('group-currency-taken', `This group already has a ${currencyCode} account.`),
    );
  }
  return ok(undefined);
}

export type NewAccountInput = {
  readonly name: string;
  readonly type: string;
  readonly currencyCode: string;
  readonly openingBalance: string;
  readonly groupId?: string | null;
};

/** Validates a new account without writing anything, so several can be checked before a write. */
export async function prepareAccount(
  repositories: LedgerRepositories,
  input: NewAccountInput,
  id: string,
): Promise<Result<Account, LedgerError>> {
  const fields = validateAccountFields(input);
  if (!fields.ok) return fields;
  const currency = await repositories.currencies.get(input.currencyCode);
  if (!currency) {
    return err(ledgerError('not-found', `Unknown currency ${input.currencyCode}.`));
  }
  const openingBalance = parseDecimal(input.openingBalance || '0', currency.decimals);
  if (!openingBalance.ok) return openingBalance;
  const groupId = input.groupId ?? null;
  const slot = await checkGroupSlot(repositories, groupId, currency.code);
  if (!slot.ok) return slot;

  return ok({
    ...fields.value,
    id,
    currencyCode: currency.code,
    openingBalance: openingBalance.value,
    archived: false,
    systemRole: null,
    groupId,
  });
}

/** Writes a prepared account with its opening balance entry. Runs inside `atomic`. */
export async function insertAccount(
  { accounts, journal }: LedgerRepositories,
  account: Account,
  occurredAt: string,
): Promise<void> {
  await accounts.save(account);
  await writeOpeningEntry(journal, account, occurredAt);
}

export function createAccountUseCases({ store, clock, generateId }: LedgerDeps) {
  return {
    listAccounts: () => store.accounts.listUser(),

    async getAccount(id: string): Promise<Account | null> {
      const account = await store.accounts.get(id);
      return account && account.systemRole === null ? account : null;
    },

    createAccount: (input: NewAccountInput): Promise<Result<Account, LedgerError>> =>
      store.atomic(async (repositories) => {
        const account = await prepareAccount(repositories, input, generateId());
        if (!account.ok) return account;
        await insertAccount(repositories, account.value, clock.now().toISOString());
        return account;
      }),

    updateAccount: (input: {
      id: string;
      name: string;
      type: string;
      openingBalance: string;
      archived: boolean;
      /** Left out, the account keeps its group; `null` takes it out of one. */
      groupId?: string | null;
    }): Promise<Result<Account, LedgerError>> =>
      store.atomic(async (repositories) => {
        const { currencies, accounts, journal } = repositories;
        const fields = validateAccountFields(input);
        if (!fields.ok) return fields;
        const existing = await accounts.get(input.id);
        if (!existing || existing.systemRole !== null) {
          return err(ledgerError('not-found', 'Account not found.'));
        }
        const currency = await currencies.get(existing.currencyCode);
        if (!currency) {
          return err(ledgerError('not-found', `Unknown currency ${existing.currencyCode}.`));
        }
        const openingBalance = parseDecimal(input.openingBalance || '0', currency.decimals);
        if (!openingBalance.ok) return openingBalance;
        const groupId = input.groupId === undefined ? existing.groupId : input.groupId;
        const slot = await checkGroupSlot(repositories, groupId, existing.currencyCode, existing);
        if (!slot.ok) return slot;

        const account: Account = {
          ...existing,
          ...fields.value,
          openingBalance: openingBalance.value,
          archived: input.archived,
          groupId,
        };
        await accounts.save(account);
        if (account.openingBalance !== existing.openingBalance) {
          const previous = await journal.get(openingEntryId(account.id));
          const occurredAt = previous?.occurredAt ?? clock.now().toISOString();
          await writeOpeningEntry(journal, account, occurredAt);
        }
        return ok(account);
      }),
  };
}
