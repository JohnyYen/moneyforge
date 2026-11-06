import type { Result } from '@/shared/result';

import type { Account } from '../domain/account';
import type { AccountGroup } from '../domain/account-group';
import type { Category } from '../domain/category';
import type { Currency } from '../domain/currency';
import type { ExchangeRate } from '../domain/exchange-rate';
import type { Transaction, TransactionKind } from '../domain/journal';
import type { LedgerError } from '../domain/ledger-error';

export type TransactionFilter = {
  readonly accountId?: string;
  readonly categoryId?: string;
  readonly kind?: TransactionKind;
  readonly from?: string;
  readonly to?: string;
  readonly limit?: number;
  readonly offset?: number;
};

export interface CurrencyRepository {
  list(): Promise<Currency[]>;
  get(code: string): Promise<Currency | null>;
  save(currency: Currency): Promise<void>;
}

export interface AccountRepository {
  listUser(): Promise<Account[]>;
  get(id: string): Promise<Account | null>;
  save(account: Account): Promise<void>;
}

export interface AccountGroupRepository {
  list(): Promise<AccountGroup[]>;
  get(id: string): Promise<AccountGroup | null>;
  save(group: AccountGroup): Promise<void>;
}

export interface CategoryRepository {
  list(): Promise<Category[]>;
  get(id: string): Promise<Category | null>;
  save(category: Category): Promise<void>;
}

export interface JournalRepository {
  /** Inserts or replaces a transaction and its postings atomically. */
  save(transaction: Transaction): Promise<void>;
  remove(id: string): Promise<void>;
  get(id: string): Promise<Transaction | null>;
  list(filter: TransactionFilter): Promise<Transaction[]>;
  balances(): Promise<Record<string, bigint>>;
  currencyHasPostings(code: string): Promise<boolean>;
}

export interface ExchangeRateRepository {
  list(): Promise<ExchangeRate[]>;
  /** Keeps one rate per currency pair and day; a later save replaces it. */
  save(rate: ExchangeRate): Promise<void>;
}

export interface SettingsRepository {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export type TransactionChangeOptions = {
  /** The user accepted the side effects a guard asked about with `confirmation-required`. */
  readonly confirmed?: boolean;
};

/**
 * Lets another feature that depends on a recorded transaction refuse a change to it, or
 * adapt to it, in the same write. A refusal must happen before anything is written,
 * because a returned error commits like any other result. Runs inside the transaction, so
 * it must only await database work.
 */
export interface TransactionChangeGuard {
  beforeUpdate(
    existing: Transaction,
    next: Transaction,
    options: TransactionChangeOptions,
  ): Promise<Result<void, LedgerError>>;
  beforeDelete(
    existing: Transaction,
    options: TransactionChangeOptions,
  ): Promise<Result<void, LedgerError>>;
}

/**
 * Lets another feature that stores amounts in a currency's minor units keep its decimals fixed,
 * since changing them would rewrite what those amounts mean. Runs inside the transaction, so it
 * must only await database work.
 */
export interface CurrencyUsageGuard {
  isInUse(code: string): Promise<boolean>;
}

export interface LedgerRepositories {
  readonly currencies: CurrencyRepository;
  readonly accounts: AccountRepository;
  readonly accountGroups: AccountGroupRepository;
  readonly categories: CategoryRepository;
  readonly journal: JournalRepository;
  readonly exchangeRates: ExchangeRateRepository;
  readonly settings: SettingsRepository;
  readonly changeGuard: TransactionChangeGuard;
  readonly currencyUsage: CurrencyUsageGuard;
}

export interface LedgerStore extends LedgerRepositories {
  atomic<T>(work: (repositories: LedgerRepositories) => Promise<T>): Promise<T>;
}

export interface Clock {
  now(): Date;
}

export type IdGenerator = () => string;
