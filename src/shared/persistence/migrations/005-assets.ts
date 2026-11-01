import type { Migration } from '../migrator';

export const assetsMigration: Migration = {
  version: 5,
  name: 'assets',
  sql: `
    CREATE TABLE asset_types (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO asset_types (id, name) VALUES
      ('default-real-estate', 'Real estate'),
      ('default-vehicle', 'Vehicle'),
      ('default-business', 'Business'),
      ('default-investment', 'Investment'),
      ('default-other', 'Other');

    CREATE TABLE assets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type_id TEXT NOT NULL REFERENCES asset_types (id),
      currency_code TEXT NOT NULL REFERENCES currencies (code),
      account_id TEXT REFERENCES accounts (id),
      status TEXT NOT NULL CHECK (status IN ('active', 'sold')),
      sold_on TEXT,
      notes TEXT NOT NULL DEFAULT '',
      CHECK ((status = 'sold') = (sold_on IS NOT NULL))
    );

    CREATE TABLE asset_valuations (
      id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL REFERENCES assets (id),
      valued_on TEXT NOT NULL,
      amount TEXT NOT NULL CHECK (typeof(amount) = 'text'),
      UNIQUE (asset_id, valued_on)
    );

    CREATE TABLE asset_streams (
      id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL REFERENCES assets (id),
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('income', 'expense')),
      amount TEXT NOT NULL CHECK (typeof(amount) = 'text'),
      category_id TEXT REFERENCES categories (id),
      unit TEXT NOT NULL CHECK (unit IN ('day', 'week', 'month', 'year')),
      every INTEGER NOT NULL CHECK (every >= 1),
      day_of_month INTEGER,
      start_on TEXT NOT NULL,
      end_on TEXT
    );
    CREATE INDEX asset_streams_asset ON asset_streams (asset_id);

    CREATE TABLE asset_transaction_links (
      transaction_id TEXT PRIMARY KEY REFERENCES transactions (id) ON DELETE CASCADE,
      asset_id TEXT NOT NULL REFERENCES assets (id),
      stream_id TEXT REFERENCES asset_streams (id) ON DELETE SET NULL,
      due_on TEXT
    );
    CREATE INDEX asset_transaction_links_asset ON asset_transaction_links (asset_id);
    CREATE INDEX asset_transaction_links_stream ON asset_transaction_links (stream_id);

    CREATE TABLE asset_rule_links (
      rule_id TEXT PRIMARY KEY REFERENCES message_rules (id) ON DELETE CASCADE,
      asset_id TEXT NOT NULL REFERENCES assets (id),
      stream_id TEXT REFERENCES asset_streams (id) ON DELETE SET NULL
    );
    CREATE INDEX asset_rule_links_asset ON asset_rule_links (asset_id);
    CREATE INDEX asset_rule_links_stream ON asset_rule_links (stream_id);
  `,
};
