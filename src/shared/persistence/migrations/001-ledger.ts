import type { Migration } from '../migrator';

export const ledgerMigration: Migration = {
  version: 1,
  name: 'ledger',
  sql: `
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE currencies (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      decimals INTEGER NOT NULL CHECK (decimals BETWEEN 0 AND 18),
      symbol TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('fiat', 'stablecoin', 'other'))
    );

    CREATE TABLE accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      currency_code TEXT NOT NULL REFERENCES currencies (code),
      opening_balance TEXT NOT NULL DEFAULT '0',
      archived INTEGER NOT NULL DEFAULT 0,
      system_role TEXT CHECK (system_role IN ('income', 'expense', 'equity', 'conversion'))
    );
    CREATE UNIQUE INDEX accounts_system_role
      ON accounts (currency_code, system_role) WHERE system_role IS NOT NULL;

    CREATE TABLE categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('income', 'expense')),
      parent_id TEXT REFERENCES categories (id),
      archived INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE transactions (
      id TEXT PRIMARY KEY,
      occurred_at TEXT NOT NULL,
      kind TEXT NOT NULL
        CHECK (kind IN ('income', 'expense', 'transfer', 'conversion', 'adjustment')),
      description TEXT NOT NULL,
      category_id TEXT REFERENCES categories (id),
      metadata TEXT
    );
    CREATE INDEX transactions_occurred_at ON transactions (occurred_at);

    CREATE TABLE postings (
      id INTEGER PRIMARY KEY,
      transaction_id TEXT NOT NULL REFERENCES transactions (id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      account_id TEXT NOT NULL REFERENCES accounts (id),
      amount TEXT NOT NULL CHECK (typeof(amount) = 'text'),
      currency_code TEXT NOT NULL REFERENCES currencies (code),
      UNIQUE (transaction_id, position)
    );
    CREATE INDEX postings_account ON postings (account_id);

    CREATE TABLE exchange_rates (
      id TEXT PRIMARY KEY,
      from_code TEXT NOT NULL REFERENCES currencies (code),
      to_code TEXT NOT NULL REFERENCES currencies (code),
      rate TEXT NOT NULL CHECK (typeof(rate) = 'text'),
      effective_on TEXT NOT NULL,
      UNIQUE (from_code, to_code, effective_on)
    );
  `,
};
