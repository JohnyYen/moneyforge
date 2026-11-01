import type { Migration } from '../migrator';

export const splitMigration: Migration = {
  version: 2,
  name: 'split',
  sql: `
    CREATE TABLE split_structures (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE split_structure_lines (
      structure_id TEXT NOT NULL REFERENCES split_structures (id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      label TEXT NOT NULL,
      target_account_id TEXT NOT NULL REFERENCES accounts (id),
      percentage TEXT CHECK (percentage IS NULL OR typeof(percentage) = 'text'),
      is_remainder INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (structure_id, position),
      CHECK ((is_remainder = 1) = (percentage IS NULL))
    );
    CREATE UNIQUE INDEX split_structure_lines_remainder
      ON split_structure_lines (structure_id) WHERE is_remainder = 1;

    CREATE TABLE split_defaults (
      scope TEXT NOT NULL CHECK (scope IN ('category', 'account')),
      scope_id TEXT NOT NULL,
      structure_id TEXT NOT NULL REFERENCES split_structures (id),
      PRIMARY KEY (scope, scope_id)
    );

    CREATE TABLE split_runs (
      id TEXT PRIMARY KEY,
      transaction_id TEXT NOT NULL UNIQUE REFERENCES transactions (id),
      structure_id TEXT NOT NULL REFERENCES split_structures (id),
      structure_name TEXT NOT NULL,
      source_account_id TEXT NOT NULL REFERENCES accounts (id),
      currency_code TEXT NOT NULL REFERENCES currencies (code),
      amount TEXT NOT NULL CHECK (typeof(amount) = 'text'),
      created_at TEXT NOT NULL
    );

    CREATE TABLE split_run_lines (
      run_id TEXT NOT NULL REFERENCES split_runs (id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      label TEXT NOT NULL,
      target_account_id TEXT NOT NULL REFERENCES accounts (id),
      percentage TEXT NOT NULL CHECK (typeof(percentage) = 'text'),
      is_remainder INTEGER NOT NULL,
      amount TEXT NOT NULL CHECK (typeof(amount) = 'text'),
      PRIMARY KEY (run_id, position)
    );

    CREATE TABLE pending_moves (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES split_runs (id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      label TEXT NOT NULL,
      from_account_id TEXT NOT NULL REFERENCES accounts (id),
      to_account_id TEXT NOT NULL REFERENCES accounts (id),
      amount TEXT NOT NULL CHECK (typeof(amount) = 'text'),
      currency_code TEXT NOT NULL REFERENCES currencies (code),
      status TEXT NOT NULL CHECK (status IN ('pending', 'done', 'skipped')),
      ledger_transaction_id TEXT UNIQUE REFERENCES transactions (id),
      UNIQUE (run_id, position),
      CHECK ((status = 'done') = (ledger_transaction_id IS NOT NULL))
    );
    CREATE INDEX pending_moves_status ON pending_moves (status);
  `,
};
