import { err, ok, type Result } from '@/shared/result';

import type { Account } from '../domain/account';
import type { CategoryKind } from '../domain/category';
import type { Currency } from '../domain/currency';
import {
  createAdjustment,
  createConversion,
  createExpense,
  createIncome,
  createTransfer,
  isDeletable,
  isEditable,
  type Transaction,
} from '../domain/journal';
import { ledgerError, type LedgerError } from '../domain/ledger-error';
import { parseDecimal, type Money } from '../domain/money';
import { convertMinor, isConsistentConversion, parseRate } from '../domain/rate';
import type { LedgerDeps } from './ledger-deps';
import type { LedgerRepositories, TransactionChangeOptions } from './ports';

type EntryFields = {
  readonly description?: string;
  readonly occurredAt?: string;
};

type CategorizedInput = EntryFields & {
  readonly accountId: string;
  readonly amount: string;
  readonly categoryId?: string | null;
};

type TransferInput = EntryFields & {
  readonly fromAccountId: string;
  readonly toAccountId: string;
  readonly amount: string;
  readonly fee?: string;
  readonly categoryId?: string | null;
};

type ConversionInput = EntryFields & {
  readonly fromAccountId: string;
  readonly toAccountId: string;
  readonly sourceAmount: string;
  readonly targetAmount?: string;
  readonly rate: string;
  readonly fee?: string;
  readonly feeCurrency?: string;
  readonly categoryId?: string | null;
};

export type TransactionEntry =
  | ({ readonly kind: 'income' | 'expense' } & CategorizedInput)
  | ({ readonly kind: 'transfer' } & TransferInput)
  | ({ readonly kind: 'conversion' } & ConversionInput);

/** What a new entry is built on. `existing` is the transaction an edit replaces. */
export type EntryBasis = {
  readonly id: string;
  readonly occurredAt: string;
  readonly existing: Transaction | null;
};

type Funded = { readonly account: Account; readonly currency: Currency };
type TransactionResult = Result<Transaction, LedgerError>;

const entryFields = (input: EntryFields, basis: EntryBasis) => ({
  id: basis.id,
  occurredAt: input.occurredAt ?? basis.occurredAt,
  description: input.description ?? '',
});

/** An edit may keep an account archived since, so old entries stay correctable. */
async function resolveAccount(
  { accounts, currencies }: LedgerRepositories,
  id: string,
  existing: Transaction | null,
): Promise<Result<Funded, LedgerError>> {
  const account = await accounts.get(id);
  if (!account || account.systemRole !== null) {
    return err(ledgerError('not-found', 'Account not found.'));
  }
  const alreadyUsed = existing?.postings.some((posting) => posting.accountId === id) ?? false;
  if (account.archived && !alreadyUsed) {
    return err(ledgerError('account-archived', `${account.name} is archived.`));
  }
  const currency = await currencies.get(account.currencyCode);
  if (!currency) {
    return err(ledgerError('not-found', `Unknown currency ${account.currencyCode}.`));
  }
  return ok({ account, currency });
}

async function checkCategory(
  { categories }: LedgerRepositories,
  categoryId: string | null | undefined,
  kind: CategoryKind,
  existing: Transaction | null,
): Promise<Result<void, LedgerError>> {
  if (!categoryId) return ok(undefined);
  const category = await categories.get(categoryId);
  const retired = category?.archived && category.id !== existing?.categoryId;
  if (!category || retired || category.kind !== kind) {
    return err(ledgerError('category-mismatch', `Choose an active ${kind} category.`));
  }
  return ok(undefined);
}

async function buildCategorized(
  repositories: LedgerRepositories,
  kind: CategoryKind,
  input: CategorizedInput,
  basis: EntryBasis,
): Promise<TransactionResult> {
  const resolved = await resolveAccount(repositories, input.accountId, basis.existing);
  if (!resolved.ok) return resolved;
  const category = await checkCategory(repositories, input.categoryId, kind, basis.existing);
  if (!category.ok) return category;
  const amount = parseDecimal(input.amount, resolved.value.currency.decimals);
  if (!amount.ok) return amount;
  const factory = kind === 'income' ? createIncome : createExpense;
  return factory({
    ...entryFields(input, basis),
    categoryId: input.categoryId,
    account: resolved.value.account,
    amount: amount.value,
  });
}

async function buildTransfer(
  repositories: LedgerRepositories,
  input: TransferInput,
  basis: EntryBasis,
): Promise<TransactionResult> {
  const from = await resolveAccount(repositories, input.fromAccountId, basis.existing);
  if (!from.ok) return from;
  const to = await resolveAccount(repositories, input.toAccountId, basis.existing);
  if (!to.ok) return to;
  const category = await checkCategory(repositories, input.categoryId, 'expense', basis.existing);
  if (!category.ok) return category;
  const { decimals } = from.value.currency;
  const amount = parseDecimal(input.amount, decimals);
  if (!amount.ok) return amount;
  const fee = parseDecimal(input.fee || '0', decimals);
  if (!fee.ok) return fee;
  return createTransfer({
    ...entryFields(input, basis),
    categoryId: input.categoryId,
    from: from.value.account,
    to: to.value.account,
    amount: amount.value,
    fee: fee.value,
  });
}

async function buildConversion(
  repositories: LedgerRepositories,
  input: ConversionInput,
  basis: EntryBasis,
): Promise<TransactionResult> {
  const from = await resolveAccount(repositories, input.fromAccountId, basis.existing);
  if (!from.ok) return from;
  const to = await resolveAccount(repositories, input.toAccountId, basis.existing);
  if (!to.ok) return to;
  const category = await checkCategory(repositories, input.categoryId, 'expense', basis.existing);
  if (!category.ok) return category;
  const source = from.value.currency;
  const target = to.value.currency;

  const sourceAmount = parseDecimal(input.sourceAmount, source.decimals);
  if (!sourceAmount.ok) return sourceAmount;
  const rate = parseRate(input.rate);
  if (!rate.ok) return rate;
  const targetAmount = input.targetAmount
    ? parseDecimal(input.targetAmount, target.decimals)
    : ok(convertMinor(sourceAmount.value, rate.value, source.decimals, target.decimals));
  if (!targetAmount.ok) return targetAmount;
  // Rejected rather than derived: a quotient of two amounts can be a repeating decimal,
  // which an exact rate string cannot hold, and a typo in either field should surface.
  if (
    !isConsistentConversion(
      sourceAmount.value,
      targetAmount.value,
      rate.value,
      source.decimals,
      target.decimals,
    )
  ) {
    return err(
      ledgerError(
        'inconsistent-conversion',
        'The amount received does not match the rate. Correct one, or leave it empty.',
      ),
    );
  }

  let fee: Money | undefined;
  if (input.fee) {
    const feeCurrency = input.feeCurrency === target.code ? target : source;
    if (input.feeCurrency && input.feeCurrency !== feeCurrency.code) {
      return err(ledgerError('currency-mismatch', 'The fee must be in one of the two currencies.'));
    }
    const parsedFee = parseDecimal(input.fee, feeCurrency.decimals);
    if (!parsedFee.ok) return parsedFee;
    fee = { minor: parsedFee.value, currency: feeCurrency.code };
  }

  return createConversion({
    ...entryFields(input, basis),
    categoryId: input.categoryId,
    from: from.value.account,
    to: to.value.account,
    sourceAmount: sourceAmount.value,
    targetAmount: targetAmount.value,
    rate: input.rate,
    fee,
  });
}

export function buildEntry(
  repositories: LedgerRepositories,
  entry: TransactionEntry,
  basis: EntryBasis,
): Promise<TransactionResult> {
  switch (entry.kind) {
    case 'transfer':
      return buildTransfer(repositories, entry, basis);
    case 'conversion':
      return buildConversion(repositories, entry, basis);
    default:
      return buildCategorized(repositories, entry.kind, entry, basis);
  }
}

const transactionNotFound = () => err(ledgerError('not-found', 'Transaction not found.'));

export function createTransactionUseCases({ store, clock, generateId }: LedgerDeps) {
  const newBasis = (): EntryBasis => ({
    id: generateId(),
    occurredAt: clock.now().toISOString(),
    existing: null,
  });

  /** Runs and saves in one write, so what was checked is what gets stored. */
  const recordEntry = (entry: TransactionEntry): Promise<TransactionResult> =>
    store.atomic(async (repositories) => {
      const transaction = await buildEntry(repositories, entry, newBasis());
      if (transaction.ok) await repositories.journal.save(transaction.value);
      return transaction;
    });

  return {
    recordEntry,
    recordIncome: (input: CategorizedInput) => recordEntry({ ...input, kind: 'income' }),
    recordExpense: (input: CategorizedInput) => recordEntry({ ...input, kind: 'expense' }),
    recordTransfer: (input: TransferInput) => recordEntry({ ...input, kind: 'transfer' }),
    recordConversion: (input: ConversionInput) => recordEntry({ ...input, kind: 'conversion' }),

    getTransaction: (id: string) => store.journal.get(id),

    /** Builds through the factories again, then replaces the postings in one write. */
    updateTransaction: (
      id: string,
      entry: TransactionEntry,
      options: TransactionChangeOptions = {},
    ): Promise<TransactionResult> =>
      store.atomic(async (repositories) => {
        const existing = await repositories.journal.get(id);
        if (!existing) return transactionNotFound();
        if (!isEditable(existing)) {
          return err(
            ledgerError(
              'transaction-locked',
              'Opening balances and reconciliations cannot be edited.',
            ),
          );
        }
        const basis = { id, occurredAt: existing.occurredAt, existing };
        const transaction = await buildEntry(repositories, entry, basis);
        if (!transaction.ok) return transaction;
        const allowed = await repositories.changeGuard.beforeUpdate(
          existing,
          transaction.value,
          options,
        );
        if (!allowed.ok) return allowed;
        await repositories.journal.save(transaction.value);
        return transaction;
      }),

    deleteTransaction: (
      id: string,
      options: TransactionChangeOptions = {},
    ): Promise<Result<void, LedgerError>> =>
      store.atomic(async ({ journal, changeGuard }) => {
        const existing = await journal.get(id);
        if (!existing) return transactionNotFound();
        if (!isDeletable(existing)) {
          return err(
            ledgerError('transaction-locked', 'Change an opening balance by editing the account.'),
          );
        }
        const allowed = await changeGuard.beforeDelete(existing, options);
        if (!allowed.ok) return allowed;
        await journal.remove(id);
        return ok(undefined);
      }),

    /** Returns `null` when the counted balance already matches and nothing is recorded. */
    reconcile: (
      input: EntryFields & { accountId: string; countedBalance: string },
    ): Promise<Result<Transaction | null, LedgerError>> =>
      store.atomic(async (repositories) => {
        const resolved = await resolveAccount(repositories, input.accountId, null);
        if (!resolved.ok) return resolved;
        const { account, currency } = resolved.value;
        const counted = parseDecimal(input.countedBalance, currency.decimals);
        if (!counted.ok) return counted;
        const balances = await repositories.journal.balances();
        const difference = counted.value - (balances[account.id] ?? 0n);
        if (difference === 0n) return ok(null);

        const adjustment = createAdjustment({
          ...entryFields(
            { ...input, description: input.description || 'Reconciliation' },
            newBasis(),
          ),
          metadata: { countedBalance: input.countedBalance.trim() },
          account,
          difference,
        });
        if (adjustment.ok) await repositories.journal.save(adjustment.value);
        return adjustment;
      }),
  };
}
