import type { Account } from '../domain/account';
import type { Category } from '../domain/category';
import type { Currency } from '../domain/currency';
import type { ExchangeRate } from '../domain/exchange-rate';
import type { Transaction, TransactionKind } from '../domain/journal';

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

export interface LedgerRepositories {
  readonly currencies: CurrencyRepository;
  readonly accounts: AccountRepository;
  readonly categories: CategoryRepository;
  readonly journal: JournalRepository;
  readonly exchangeRates: ExchangeRateRepository;
  readonly settings: SettingsRepository;
}

export interface LedgerStore extends LedgerRepositories {
  atomic<T>(work: (repositories: LedgerRepositories) => Promise<T>): Promise<T>;
}

export interface Clock {
  now(): Date;
}

export type IdGenerator = () => string;
