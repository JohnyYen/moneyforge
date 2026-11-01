import type { Migration } from '../migrator';

export const rulesMigration: Migration = {
  version: 3,
  name: 'rules',
  sql: `
    CREATE TABLE message_sources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      channel TEXT NOT NULL CHECK (channel IN ('sms', 'paste')),
      sender TEXT NOT NULL UNIQUE,
      enabled INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE message_rules (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES message_sources (id),
      name TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0,
      template TEXT NOT NULL,
      decimal_separator TEXT NOT NULL,
      thousands_separator TEXT NOT NULL,
      kind TEXT NOT NULL
        CHECK (kind IN ('income', 'expense', 'transfer_out', 'transfer_in')),
      account_id TEXT NOT NULL REFERENCES accounts (id),
      category_id TEXT REFERENCES categories (id),
      counterpart_account_id TEXT REFERENCES accounts (id),
      currency_code TEXT REFERENCES currencies (code),
      auto_post INTEGER NOT NULL DEFAULT 0,
      split_mode TEXT NOT NULL DEFAULT 'none' CHECK (split_mode IN ('none', 'ask', 'auto')),
      split_structure_id TEXT REFERENCES split_structures (id),
      samples TEXT NOT NULL DEFAULT '[]',
      CHECK ((kind IN ('transfer_out', 'transfer_in')) = (counterpart_account_id IS NOT NULL)),
      CHECK (split_mode <> 'auto' OR split_structure_id IS NOT NULL)
    );
    CREATE INDEX message_rules_source ON message_rules (source_id);

    CREATE TABLE inbox_items (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES message_sources (id),
      rule_id TEXT REFERENCES message_rules (id) ON DELETE SET NULL,
      status TEXT NOT NULL
        CHECK (status IN ('unmatched', 'proposed', 'waiting_pair', 'posted', 'rejected')),
      channel TEXT NOT NULL CHECK (channel IN ('sms', 'paste')),
      received_at TEXT NOT NULL,
      body TEXT,
      body_hash TEXT NOT NULL,
      reference_key TEXT,
      note TEXT,
      kind TEXT CHECK (kind IN ('income', 'expense', 'transfer_out', 'transfer_in')),
      account_id TEXT REFERENCES accounts (id),
      category_id TEXT REFERENCES categories (id),
      counterpart_account_id TEXT REFERENCES accounts (id),
      amount_minor TEXT CHECK (amount_minor IS NULL OR typeof(amount_minor) = 'text'),
      currency_code TEXT REFERENCES currencies (code),
      reference TEXT,
      counterparty TEXT,
      balance TEXT,
      description TEXT NOT NULL DEFAULT '',
      auto_post INTEGER NOT NULL DEFAULT 0,
      split_mode TEXT NOT NULL DEFAULT 'none' CHECK (split_mode IN ('none', 'ask', 'auto')),
      split_structure_id TEXT REFERENCES split_structures (id),
      split_requested INTEGER NOT NULL DEFAULT 0,
      pair_item_id TEXT REFERENCES inbox_items (id) ON DELETE SET NULL,
      transaction_id TEXT REFERENCES transactions (id) ON DELETE SET NULL,
      CHECK (status NOT IN ('posted', 'rejected') OR body IS NULL)
    );
    CREATE UNIQUE INDEX inbox_items_reference
      ON inbox_items (source_id, reference_key) WHERE reference_key IS NOT NULL;
    CREATE INDEX inbox_items_body_hash ON inbox_items (source_id, body_hash);
    CREATE INDEX inbox_items_status ON inbox_items (status, received_at);
    CREATE INDEX inbox_items_pair ON inbox_items (pair_item_id);
    CREATE INDEX inbox_items_transaction ON inbox_items (transaction_id);
  `,
};
