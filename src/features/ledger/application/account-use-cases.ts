import { err, ok, type Result } from '@/shared/result';

import { validateAccountFields, type Account } from '../domain/account';
import { createAdjustment } from '../domain/journal';
import { ledgerError, type LedgerError } from '../domain/ledger-error';
import { parseDecimal } from '../domain/money';
import type { LedgerDeps } from './ledger-deps';
import type { JournalRepository } from './ports';

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

export function createAccountUseCases({ store, clock, generateId }: LedgerDeps) {
  return {
    listAccounts: () => store.accounts.listUser(),

    async getAccount(id: string): Promise<Account | null> {
      const account = await store.accounts.get(id);
      return account && account.systemRole === null ? account : null;
    },

    createAccount: (input: {
      name: string;
      type: string;
      currencyCode: string;
      openingBalance: string;
    }): Promise<Result<Account, LedgerError>> =>
      store.atomic(async ({ currencies, accounts, journal }) => {
        const fields = validateAccountFields(input);
        if (!fields.ok) return fields;
        const currency = await currencies.get(input.currencyCode);
        if (!currency) {
          return err(ledgerError('not-found', `Unknown currency ${input.currencyCode}.`));
        }
        const openingBalance = parseDecimal(input.openingBalance || '0', currency.decimals);
        if (!openingBalance.ok) return openingBalance;

        const account: Account = {
          ...fields.value,
          id: generateId(),
          currencyCode: currency.code,
          openingBalance: openingBalance.value,
          archived: false,
          systemRole: null,
        };
        await accounts.save(account);
        await writeOpeningEntry(journal, account, clock.now().toISOString());
        return ok(account);
      }),

    updateAccount: (input: {
      id: string;
      name: string;
      type: string;
      openingBalance: string;
      archived: boolean;
    }): Promise<Result<Account, LedgerError>> =>
      store.atomic(async ({ currencies, accounts, journal }) => {
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

        const account: Account = {
          ...existing,
          ...fields.value,
          openingBalance: openingBalance.value,
          archived: input.archived,
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
