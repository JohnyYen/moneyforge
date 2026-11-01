import type { Migration } from '../migrator';

export const planningMigration: Migration = {
  version: 4,
  name: 'planning',
  sql: `
    CREATE TABLE budgets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      currency_code TEXT NOT NULL REFERENCES currencies (code),
      amount TEXT NOT NULL CHECK (typeof(amount) = 'text'),
      period_kind TEXT NOT NULL CHECK (period_kind IN ('weekly', 'monthly', 'yearly', 'custom')),
      start_day INTEGER,
      start_month INTEGER,
      custom_start_on TEXT,
      custom_length_days INTEGER,
      starts_on TEXT NOT NULL,
      rollover INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      CHECK ((period_kind = 'custom') = (custom_start_on IS NOT NULL)),
      CHECK ((period_kind = 'custom') = (custom_length_days IS NOT NULL))
    );

    CREATE TABLE budget_categories (
      budget_id TEXT NOT NULL REFERENCES budgets (id) ON DELETE CASCADE,
      category_id TEXT NOT NULL REFERENCES categories (id),
      PRIMARY KEY (budget_id, category_id)
    );

    CREATE TABLE recurring_items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('income', 'expense', 'transfer')),
      account_id TEXT NOT NULL REFERENCES accounts (id),
      to_account_id TEXT REFERENCES accounts (id),
      amount TEXT NOT NULL CHECK (typeof(amount) = 'text'),
      currency_code TEXT NOT NULL REFERENCES currencies (code),
      category_id TEXT REFERENCES categories (id),
      unit TEXT NOT NULL CHECK (unit IN ('day', 'week', 'month', 'year')),
      every INTEGER NOT NULL CHECK (every >= 1),
      day_of_month INTEGER,
      start_on TEXT NOT NULL,
      end_on TEXT,
      mode TEXT NOT NULL CHECK (mode IN ('ask', 'auto')),
      apply_split INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      materialized_through TEXT,
      CHECK ((kind = 'transfer') = (to_account_id IS NOT NULL))
    );

    CREATE TABLE recurring_occurrences (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL REFERENCES recurring_items (id),
      due_on TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'posted', 'skipped')),
      kind TEXT NOT NULL CHECK (kind IN ('income', 'expense', 'transfer')),
      account_id TEXT NOT NULL REFERENCES accounts (id),
      to_account_id TEXT REFERENCES accounts (id),
      amount TEXT NOT NULL CHECK (typeof(amount) = 'text'),
      currency_code TEXT NOT NULL REFERENCES currencies (code),
      category_id TEXT REFERENCES categories (id),
      description TEXT NOT NULL,
      apply_split INTEGER NOT NULL,
      transaction_id TEXT REFERENCES transactions (id) ON DELETE SET NULL,
      note TEXT,
      UNIQUE (item_id, due_on),
      CHECK (status = 'posted' OR transaction_id IS NULL)
    );
    CREATE INDEX recurring_occurrences_status ON recurring_occurrences (status, due_on);

    CREATE TABLE planned_items (
      id TEXT PRIMARY KEY,
      planned_on TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('income', 'expense')),
      account_id TEXT NOT NULL REFERENCES accounts (id),
      amount TEXT NOT NULL CHECK (typeof(amount) = 'text'),
      description TEXT NOT NULL
    );
  `,
};
