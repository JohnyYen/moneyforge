import type { TableSchema } from './backup-snapshot';

/** A column as the migrator declares it, and the schema version that introduced it. */
type ColumnDefinition = {
  readonly name: string;
  readonly type: 'INTEGER' | 'TEXT';
  readonly required: boolean;
};

type TableDefinition = {
  readonly name: string;
  /** The schema version whose migration creates the table. */
  readonly since: number;
  readonly columns: readonly ColumnDefinition[];
};

/**
 * Every table a backup carries, as the migrations declare it. A file is checked against the
 * schema of its own version, so a table added later is not demanded of an older file and a
 * table it predates is refused.
 */
const TABLES: readonly TableDefinition[] = [
  {
    name: 'accounts',
    since: 1,
    columns: [
      { name: 'id', type: 'TEXT', required: false },
      { name: 'name', type: 'TEXT', required: true },
      { name: 'type', type: 'TEXT', required: true },
      { name: 'currency_code', type: 'TEXT', required: true },
      { name: 'opening_balance', type: 'TEXT', required: true },
      { name: 'archived', type: 'INTEGER', required: true },
      { name: 'system_role', type: 'TEXT', required: false },
    ],
  },
  {
    name: 'categories',
    since: 1,
    columns: [
      { name: 'id', type: 'TEXT', required: false },
      { name: 'name', type: 'TEXT', required: true },
      { name: 'kind', type: 'TEXT', required: true },
      { name: 'parent_id', type: 'TEXT', required: false },
      { name: 'archived', type: 'INTEGER', required: true },
    ],
  },
  {
    name: 'currencies',
    since: 1,
    columns: [
      { name: 'code', type: 'TEXT', required: false },
      { name: 'name', type: 'TEXT', required: true },
      { name: 'decimals', type: 'INTEGER', required: true },
      { name: 'symbol', type: 'TEXT', required: true },
      { name: 'kind', type: 'TEXT', required: true },
    ],
  },
  {
    name: 'exchange_rates',
    since: 1,
    columns: [
      { name: 'id', type: 'TEXT', required: false },
      { name: 'from_code', type: 'TEXT', required: true },
      { name: 'to_code', type: 'TEXT', required: true },
      { name: 'rate', type: 'TEXT', required: true },
      { name: 'effective_on', type: 'TEXT', required: true },
    ],
  },
  {
    name: 'postings',
    since: 1,
    columns: [
      { name: 'id', type: 'INTEGER', required: false },
      { name: 'transaction_id', type: 'TEXT', required: true },
      { name: 'position', type: 'INTEGER', required: true },
      { name: 'account_id', type: 'TEXT', required: true },
      { name: 'amount', type: 'TEXT', required: true },
      { name: 'currency_code', type: 'TEXT', required: true },
    ],
  },
  {
    name: 'settings',
    since: 1,
    columns: [
      { name: 'key', type: 'TEXT', required: false },
      { name: 'value', type: 'TEXT', required: true },
    ],
  },
  {
    name: 'transactions',
    since: 1,
    columns: [
      { name: 'id', type: 'TEXT', required: false },
      { name: 'occurred_at', type: 'TEXT', required: true },
      { name: 'kind', type: 'TEXT', required: true },
      { name: 'description', type: 'TEXT', required: true },
      { name: 'category_id', type: 'TEXT', required: false },
      { name: 'metadata', type: 'TEXT', required: false },
    ],
  },
  {
    name: 'pending_moves',
    since: 2,
    columns: [
      { name: 'id', type: 'TEXT', required: false },
      { name: 'run_id', type: 'TEXT', required: true },
      { name: 'position', type: 'INTEGER', required: true },
      { name: 'label', type: 'TEXT', required: true },
      { name: 'from_account_id', type: 'TEXT', required: true },
      { name: 'to_account_id', type: 'TEXT', required: true },
      { name: 'amount', type: 'TEXT', required: true },
      { name: 'currency_code', type: 'TEXT', required: true },
      { name: 'status', type: 'TEXT', required: true },
      { name: 'ledger_transaction_id', type: 'TEXT', required: false },
    ],
  },
  {
    name: 'split_defaults',
    since: 2,
    columns: [
      { name: 'scope', type: 'TEXT', required: true },
      { name: 'scope_id', type: 'TEXT', required: true },
      { name: 'structure_id', type: 'TEXT', required: true },
    ],
  },
  {
    name: 'split_run_lines',
    since: 2,
    columns: [
      { name: 'run_id', type: 'TEXT', required: true },
      { name: 'position', type: 'INTEGER', required: true },
      { name: 'label', type: 'TEXT', required: true },
      { name: 'target_account_id', type: 'TEXT', required: true },
      { name: 'percentage', type: 'TEXT', required: true },
      { name: 'is_remainder', type: 'INTEGER', required: true },
      { name: 'amount', type: 'TEXT', required: true },
    ],
  },
  {
    name: 'split_runs',
    since: 2,
    columns: [
      { name: 'id', type: 'TEXT', required: false },
      { name: 'transaction_id', type: 'TEXT', required: true },
      { name: 'structure_id', type: 'TEXT', required: true },
      { name: 'structure_name', type: 'TEXT', required: true },
      { name: 'source_account_id', type: 'TEXT', required: true },
      { name: 'currency_code', type: 'TEXT', required: true },
      { name: 'amount', type: 'TEXT', required: true },
      { name: 'created_at', type: 'TEXT', required: true },
    ],
  },
  {
    name: 'split_structure_lines',
    since: 2,
    columns: [
      { name: 'structure_id', type: 'TEXT', required: true },
      { name: 'position', type: 'INTEGER', required: true },
      { name: 'label', type: 'TEXT', required: true },
      { name: 'target_account_id', type: 'TEXT', required: true },
      { name: 'percentage', type: 'TEXT', required: false },
      { name: 'is_remainder', type: 'INTEGER', required: true },
    ],
  },
  {
    name: 'split_structures',
    since: 2,
    columns: [
      { name: 'id', type: 'TEXT', required: false },
      { name: 'name', type: 'TEXT', required: true },
      { name: 'active', type: 'INTEGER', required: true },
    ],
  },
  {
    name: 'inbox_items',
    since: 3,
    columns: [
      { name: 'id', type: 'TEXT', required: false },
      { name: 'source_id', type: 'TEXT', required: true },
      { name: 'rule_id', type: 'TEXT', required: false },
      { name: 'status', type: 'TEXT', required: true },
      { name: 'channel', type: 'TEXT', required: true },
      { name: 'received_at', type: 'TEXT', required: true },
      { name: 'body', type: 'TEXT', required: false },
      { name: 'body_hash', type: 'TEXT', required: true },
      { name: 'reference_key', type: 'TEXT', required: false },
      { name: 'note', type: 'TEXT', required: false },
      { name: 'kind', type: 'TEXT', required: false },
      { name: 'account_id', type: 'TEXT', required: false },
      { name: 'category_id', type: 'TEXT', required: false },
      { name: 'counterpart_account_id', type: 'TEXT', required: false },
      { name: 'amount_minor', type: 'TEXT', required: false },
      { name: 'currency_code', type: 'TEXT', required: false },
      { name: 'reference', type: 'TEXT', required: false },
      { name: 'counterparty', type: 'TEXT', required: false },
      { name: 'balance', type: 'TEXT', required: false },
      { name: 'description', type: 'TEXT', required: true },
      { name: 'auto_post', type: 'INTEGER', required: true },
      { name: 'split_mode', type: 'TEXT', required: true },
      { name: 'split_structure_id', type: 'TEXT', required: false },
      { name: 'split_requested', type: 'INTEGER', required: true },
      { name: 'pair_item_id', type: 'TEXT', required: false },
      { name: 'transaction_id', type: 'TEXT', required: false },
    ],
  },
  {
    name: 'message_rules',
    since: 3,
    columns: [
      { name: 'id', type: 'TEXT', required: false },
      { name: 'source_id', type: 'TEXT', required: true },
      { name: 'name', type: 'TEXT', required: true },
      { name: 'priority', type: 'INTEGER', required: true },
      { name: 'template', type: 'TEXT', required: true },
      { name: 'decimal_separator', type: 'TEXT', required: true },
      { name: 'thousands_separator', type: 'TEXT', required: true },
      { name: 'kind', type: 'TEXT', required: true },
      { name: 'account_id', type: 'TEXT', required: true },
      { name: 'category_id', type: 'TEXT', required: false },
      { name: 'counterpart_account_id', type: 'TEXT', required: false },
      { name: 'currency_code', type: 'TEXT', required: false },
      { name: 'auto_post', type: 'INTEGER', required: true },
      { name: 'split_mode', type: 'TEXT', required: true },
      { name: 'split_structure_id', type: 'TEXT', required: false },
      { name: 'samples', type: 'TEXT', required: true },
    ],
  },
  {
    name: 'message_sources',
    since: 3,
    columns: [
      { name: 'id', type: 'TEXT', required: false },
      { name: 'name', type: 'TEXT', required: true },
      { name: 'channel', type: 'TEXT', required: true },
      { name: 'sender', type: 'TEXT', required: true },
      { name: 'enabled', type: 'INTEGER', required: true },
    ],
  },
  {
    name: 'budget_categories',
    since: 4,
    columns: [
      { name: 'budget_id', type: 'TEXT', required: true },
      { name: 'category_id', type: 'TEXT', required: true },
    ],
  },
  {
    name: 'budgets',
    since: 4,
    columns: [
      { name: 'id', type: 'TEXT', required: false },
      { name: 'name', type: 'TEXT', required: true },
      { name: 'currency_code', type: 'TEXT', required: true },
      { name: 'amount', type: 'TEXT', required: true },
      { name: 'period_kind', type: 'TEXT', required: true },
      { name: 'start_day', type: 'INTEGER', required: false },
      { name: 'start_month', type: 'INTEGER', required: false },
      { name: 'custom_start_on', type: 'TEXT', required: false },
      { name: 'custom_length_days', type: 'INTEGER', required: false },
      { name: 'starts_on', type: 'TEXT', required: true },
      { name: 'rollover', type: 'INTEGER', required: true },
      { name: 'active', type: 'INTEGER', required: true },
    ],
  },
  {
    name: 'planned_items',
    since: 4,
    columns: [
      { name: 'id', type: 'TEXT', required: false },
      { name: 'planned_on', type: 'TEXT', required: true },
      { name: 'kind', type: 'TEXT', required: true },
      { name: 'account_id', type: 'TEXT', required: true },
      { name: 'amount', type: 'TEXT', required: true },
      { name: 'description', type: 'TEXT', required: true },
    ],
  },
  {
    name: 'recurring_items',
    since: 4,
    columns: [
      { name: 'id', type: 'TEXT', required: false },
      { name: 'name', type: 'TEXT', required: true },
      { name: 'kind', type: 'TEXT', required: true },
      { name: 'account_id', type: 'TEXT', required: true },
      { name: 'to_account_id', type: 'TEXT', required: false },
      { name: 'amount', type: 'TEXT', required: true },
      { name: 'currency_code', type: 'TEXT', required: true },
      { name: 'category_id', type: 'TEXT', required: false },
      { name: 'unit', type: 'TEXT', required: true },
      { name: 'every', type: 'INTEGER', required: true },
      { name: 'day_of_month', type: 'INTEGER', required: false },
      { name: 'start_on', type: 'TEXT', required: true },
      { name: 'end_on', type: 'TEXT', required: false },
      { name: 'mode', type: 'TEXT', required: true },
      { name: 'apply_split', type: 'INTEGER', required: true },
      { name: 'active', type: 'INTEGER', required: true },
      { name: 'materialized_through', type: 'TEXT', required: false },
    ],
  },
  {
    name: 'recurring_occurrences',
    since: 4,
    columns: [
      { name: 'id', type: 'TEXT', required: false },
      { name: 'item_id', type: 'TEXT', required: true },
      { name: 'due_on', type: 'TEXT', required: true },
      { name: 'status', type: 'TEXT', required: true },
      { name: 'kind', type: 'TEXT', required: true },
      { name: 'account_id', type: 'TEXT', required: true },
      { name: 'to_account_id', type: 'TEXT', required: false },
      { name: 'amount', type: 'TEXT', required: true },
      { name: 'currency_code', type: 'TEXT', required: true },
      { name: 'category_id', type: 'TEXT', required: false },
      { name: 'description', type: 'TEXT', required: true },
      { name: 'apply_split', type: 'INTEGER', required: true },
      { name: 'transaction_id', type: 'TEXT', required: false },
      { name: 'note', type: 'TEXT', required: false },
    ],
  },
  {
    name: 'asset_rule_links',
    since: 5,
    columns: [
      { name: 'rule_id', type: 'TEXT', required: false },
      { name: 'asset_id', type: 'TEXT', required: true },
      { name: 'stream_id', type: 'TEXT', required: false },
    ],
  },
  {
    name: 'asset_streams',
    since: 5,
    columns: [
      { name: 'id', type: 'TEXT', required: false },
      { name: 'asset_id', type: 'TEXT', required: true },
      { name: 'name', type: 'TEXT', required: true },
      { name: 'kind', type: 'TEXT', required: true },
      { name: 'amount', type: 'TEXT', required: true },
      { name: 'category_id', type: 'TEXT', required: false },
      { name: 'unit', type: 'TEXT', required: true },
      { name: 'every', type: 'INTEGER', required: true },
      { name: 'day_of_month', type: 'INTEGER', required: false },
      { name: 'start_on', type: 'TEXT', required: true },
      { name: 'end_on', type: 'TEXT', required: false },
    ],
  },
  {
    name: 'asset_transaction_links',
    since: 5,
    columns: [
      { name: 'transaction_id', type: 'TEXT', required: false },
      { name: 'asset_id', type: 'TEXT', required: true },
      { name: 'stream_id', type: 'TEXT', required: false },
      { name: 'due_on', type: 'TEXT', required: false },
    ],
  },
  {
    name: 'asset_types',
    since: 5,
    columns: [
      { name: 'id', type: 'TEXT', required: false },
      { name: 'name', type: 'TEXT', required: true },
      { name: 'archived', type: 'INTEGER', required: true },
    ],
  },
  {
    name: 'asset_valuations',
    since: 5,
    columns: [
      { name: 'id', type: 'TEXT', required: false },
      { name: 'asset_id', type: 'TEXT', required: true },
      { name: 'valued_on', type: 'TEXT', required: true },
      { name: 'amount', type: 'TEXT', required: true },
    ],
  },
  {
    name: 'assets',
    since: 5,
    columns: [
      { name: 'id', type: 'TEXT', required: false },
      { name: 'name', type: 'TEXT', required: true },
      { name: 'type_id', type: 'TEXT', required: true },
      { name: 'currency_code', type: 'TEXT', required: true },
      { name: 'account_id', type: 'TEXT', required: false },
      { name: 'status', type: 'TEXT', required: true },
      { name: 'sold_on', type: 'TEXT', required: false },
      { name: 'notes', type: 'TEXT', required: true },
    ],
  },
  {
    name: 'onchain_chains',
    since: 6,
    columns: [
      { name: 'id', type: 'TEXT', required: false },
      { name: 'name', type: 'TEXT', required: true },
      { name: 'family', type: 'TEXT', required: true },
      { name: 'endpoint', type: 'TEXT', required: true },
      { name: 'evm_chain_id', type: 'TEXT', required: false },
    ],
  },
  {
    name: 'onchain_tokens',
    since: 6,
    columns: [
      { name: 'id', type: 'TEXT', required: false },
      { name: 'chain_id', type: 'TEXT', required: true },
      { name: 'symbol', type: 'TEXT', required: true },
      { name: 'contract', type: 'TEXT', required: true },
      { name: 'decimals', type: 'INTEGER', required: true },
    ],
  },
  {
    name: 'onchain_watched_addresses',
    since: 6,
    columns: [
      { name: 'id', type: 'TEXT', required: false },
      { name: 'chain_id', type: 'TEXT', required: true },
      { name: 'token_id', type: 'TEXT', required: true },
      { name: 'address', type: 'TEXT', required: true },
      { name: 'label', type: 'TEXT', required: true },
      { name: 'account_id', type: 'TEXT', required: false },
      { name: 'last_amount', type: 'TEXT', required: false },
      { name: 'last_decimals', type: 'INTEGER', required: false },
      { name: 'last_read_at', type: 'TEXT', required: false },
    ],
  },
  {
    name: 'imported_rows',
    since: 7,
    columns: [
      { name: 'fingerprint', type: 'TEXT', required: false },
      { name: 'transaction_id', type: 'TEXT', required: true },
      { name: 'batch_id', type: 'TEXT', required: true },
    ],
  },
];

/**
 * Left out on purpose. Restoring a file never writes a version the migrator did not apply,
 * so the applied list is rebuilt from the schema the restore runs.
 */
export const EXCLUDED_TABLES: Readonly<Record<string, string>> = {
  schema_migrations: 'Rebuilt by the migrator, so a restore runs every migration the file predates.',
};

export const BACKUP_TABLES: readonly { readonly name: string }[] = TABLES.map(({ name }) => ({
  name,
}));

/** The schema a file of this version must fit, before anything is written. */
export function schemaAt(version: number): readonly TableSchema[] {
  return TABLES.filter((table) => table.since <= version).map((table) => ({
    name: table.name,
    columns: table.columns,
  }));
}
