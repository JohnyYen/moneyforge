import type { Migration } from '../migrator';

/**
 * A group only gathers accounts under one name; it has no currency and no postings of its own.
 * Each account it holds keeps its single currency, and a group holds at most one per currency.
 */
export const accountGroupsMigration: Migration = {
  version: 8,
  name: 'account-groups',
  sql: `
    CREATE TABLE account_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0
    );
    ALTER TABLE accounts ADD COLUMN group_id TEXT REFERENCES account_groups (id);
    CREATE UNIQUE INDEX accounts_group_currency
      ON accounts (group_id, currency_code) WHERE group_id IS NOT NULL;
  `,
};
