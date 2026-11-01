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
  type Transaction,
} from '../domain/journal';
import { ledgerError, type LedgerError } from '../domain/ledger-error';
import { parseDecimal, type Money } from '../domain/money';
import { convertMinor, parseRate } from '../domain/rate';
import type { LedgerDeps } from './ledger-deps';
import type { LedgerRepositories } from './ports';

type EntryInput = {
  readonly description?: string;
  readonly occurredAt?: string;
};

type CategorizedInput = EntryInput & {
  readonly accountId: string;
  readonly amount: string;
  readonly categoryId?: string | null;
};

type Funded = { readonly account: Account; readonly currency: Currency };
type TransactionResult = Result<Transaction, LedgerError>;

async function resolveActiveAccount(
  { accounts, currencies }: LedgerRepositories,
  id: string,
): Promise<Result<Funded, LedgerError>> {
  const account = await accounts.get(id);
  if (!account || account.systemRole !== null) {
    return err(ledgerError('not-found', 'Account not found.'));
  }
  if (account.archived) {
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
): Promise<Result<void, LedgerError>> {
  if (!categoryId) return ok(undefined);
  const category = await categories.get(categoryId);
  if (!category || category.archived || category.kind !== kind) {
    return err(ledgerError('category-mismatch', `Choose an active ${kind} category.`));
  }
  return ok(undefined);
}

export function createTransactionUseCases({ store, clock, generateId }: LedgerDeps) {
  const entryFields = (input: EntryInput) => ({
    id: generateId(),
    occurredAt: input.occurredAt ?? clock.now().toISOString(),
    description: input.description ?? '',
  });

  /** Runs and saves in one write, so what was checked is what gets stored. */
  const record = (
    build: (repositories: LedgerRepositories) => Promise<TransactionResult>,
  ): Promise<TransactionResult> =>
    store.atomic(async (repositories) => {
      const transaction = await build(repositories);
      if (transaction.ok) await repositories.journal.save(transaction.value);
      return transaction;
    });

  const recordCategorized =
    (kind: CategoryKind, factory: typeof createIncome) => (input: CategorizedInput) =>
      record(async (repositories) => {
        const resolved = await resolveActiveAccount(repositories, input.accountId);
        if (!resolved.ok) return resolved;
        const category = await checkCategory(repositories, input.categoryId, kind);
        if (!category.ok) return category;
        const amount = parseDecimal(input.amount, resolved.value.currency.decimals);
        if (!amount.ok) return amount;
        return factory({
          ...entryFields(input),
          categoryId: input.categoryId,
          account: resolved.value.account,
          amount: amount.value,
        });
      });

  return {
    recordIncome: recordCategorized('income', createIncome),
    recordExpense: recordCategorized('expense', createExpense),

    recordTransfer: (
      input: EntryInput & {
        fromAccountId: string;
        toAccountId: string;
        amount: string;
        fee?: string;
        categoryId?: string | null;
      },
    ) =>
      record(async (repositories) => {
        const from = await resolveActiveAccount(repositories, input.fromAccountId);
        if (!from.ok) return from;
        const to = await resolveActiveAccount(repositories, input.toAccountId);
        if (!to.ok) return to;
        const category = await checkCategory(repositories, input.categoryId, 'expense');
        if (!category.ok) return category;
        const { decimals } = from.value.currency;
        const amount = parseDecimal(input.amount, decimals);
        if (!amount.ok) return amount;
        const fee = parseDecimal(input.fee || '0', decimals);
        if (!fee.ok) return fee;
        return createTransfer({
          ...entryFields(input),
          categoryId: input.categoryId,
          from: from.value.account,
          to: to.value.account,
          amount: amount.value,
          fee: fee.value,
        });
      }),

    recordConversion: (
      input: EntryInput & {
        fromAccountId: string;
        toAccountId: string;
        sourceAmount: string;
        targetAmount?: string;
        rate: string;
        fee?: string;
        feeCurrency?: string;
        categoryId?: string | null;
      },
    ) =>
      record(async (repositories) => {
        const from = await resolveActiveAccount(repositories, input.fromAccountId);
        if (!from.ok) return from;
        const to = await resolveActiveAccount(repositories, input.toAccountId);
        if (!to.ok) return to;
        const category = await checkCategory(repositories, input.categoryId, 'expense');
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

        let fee: Money | undefined;
        if (input.fee) {
          const feeCurrency = input.feeCurrency === target.code ? target : source;
          if (input.feeCurrency && input.feeCurrency !== feeCurrency.code) {
            return err(
              ledgerError('currency-mismatch', 'The fee must be in one of the two currencies.'),
            );
          }
          const parsedFee = parseDecimal(input.fee, feeCurrency.decimals);
          if (!parsedFee.ok) return parsedFee;
          fee = { minor: parsedFee.value, currency: feeCurrency.code };
        }

        return createConversion({
          ...entryFields(input),
          categoryId: input.categoryId,
          from: from.value.account,
          to: to.value.account,
          sourceAmount: sourceAmount.value,
          targetAmount: targetAmount.value,
          rate: input.rate,
          fee,
        });
      }),

    /** Returns `null` when the counted balance already matches and nothing is recorded. */
    reconcile: (
      input: EntryInput & { accountId: string; countedBalance: string },
    ): Promise<Result<Transaction | null, LedgerError>> =>
      store.atomic(async (repositories) => {
        const resolved = await resolveActiveAccount(repositories, input.accountId);
        if (!resolved.ok) return resolved;
        const { account, currency } = resolved.value;
        const counted = parseDecimal(input.countedBalance, currency.decimals);
        if (!counted.ok) return counted;
        const balances = await repositories.journal.balances();
        const difference = counted.value - (balances[account.id] ?? 0n);
        if (difference === 0n) return ok(null);

        const adjustment = createAdjustment({
          ...entryFields({ ...input, description: input.description || 'Reconciliation' }),
          metadata: { countedBalance: input.countedBalance.trim() },
          account,
          difference,
        });
        if (adjustment.ok) await repositories.journal.save(adjustment.value);
        return adjustment;
      }),
  };
}
