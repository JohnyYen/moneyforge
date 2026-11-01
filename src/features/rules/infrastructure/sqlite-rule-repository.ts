import type { SqlExecutor, SqlValue } from '@/shared/persistence/sql-driver';

import type { RuleRepository } from '../application/ports';
import type { InboxItem, ItemStatus } from '../domain/inbox-item';
import type { MessageChannel } from '../domain/message';
import type { NumberFormat } from '../domain/number-format';
import type { Rule, RuleKind, SplitMode } from '../domain/rule';
import type { MessageSource } from '../domain/source';

type SourceRow = {
  id: string;
  name: string;
  channel: MessageChannel;
  sender: string;
  enabled: number;
};

type RuleRow = {
  id: string;
  source_id: string;
  name: string;
  priority: number;
  template: string;
  decimal_separator: NumberFormat['decimal'];
  thousands_separator: NumberFormat['thousands'];
  kind: RuleKind;
  account_id: string;
  category_id: string | null;
  counterpart_account_id: string | null;
  currency_code: string | null;
  auto_post: number;
  split_mode: SplitMode;
  split_structure_id: string | null;
  samples: string;
};

type ItemRow = {
  id: string;
  source_id: string;
  rule_id: string | null;
  status: ItemStatus;
  channel: MessageChannel;
  received_at: string;
  body: string | null;
  body_hash: string;
  reference_key: string | null;
  note: string | null;
  kind: RuleKind | null;
  account_id: string | null;
  category_id: string | null;
  counterpart_account_id: string | null;
  amount_minor: string | null;
  currency_code: string | null;
  reference: string | null;
  counterparty: string | null;
  balance: string | null;
  description: string;
  auto_post: number;
  split_mode: SplitMode;
  split_structure_id: string | null;
  split_requested: number;
  pair_item_id: string | null;
  transaction_id: string | null;
};

const toSource = (row: SourceRow): MessageSource => ({
  id: row.id,
  name: row.name,
  channel: row.channel,
  sender: row.sender,
  enabled: row.enabled === 1,
});

const toRule = (row: RuleRow): Rule => ({
  id: row.id,
  sourceId: row.source_id,
  name: row.name,
  priority: row.priority,
  template: row.template,
  format: { decimal: row.decimal_separator, thousands: row.thousands_separator },
  kind: row.kind,
  accountId: row.account_id,
  categoryId: row.category_id,
  counterpartAccountId: row.counterpart_account_id,
  currencyCode: row.currency_code,
  autoPost: row.auto_post === 1,
  splitMode: row.split_mode,
  splitStructureId: row.split_structure_id,
  samples: JSON.parse(row.samples) as string[],
});

const toItem = (row: ItemRow): InboxItem => ({
  id: row.id,
  sourceId: row.source_id,
  ruleId: row.rule_id,
  status: row.status,
  channel: row.channel,
  receivedAt: row.received_at,
  body: row.body,
  bodyHash: row.body_hash,
  referenceKey: row.reference_key,
  note: row.note,
  kind: row.kind,
  accountId: row.account_id,
  categoryId: row.category_id,
  counterpartAccountId: row.counterpart_account_id,
  amountMinor: row.amount_minor === null ? null : BigInt(row.amount_minor),
  currencyCode: row.currency_code,
  reference: row.reference,
  counterparty: row.counterparty,
  balance: row.balance,
  description: row.description,
  autoPost: row.auto_post === 1,
  splitMode: row.split_mode,
  splitStructureId: row.split_structure_id,
  splitRequested: row.split_requested === 1,
  pairItemId: row.pair_item_id,
  transactionId: row.transaction_id,
});

const ITEM_COLUMNS = [
  'id',
  'source_id',
  'rule_id',
  'status',
  'channel',
  'received_at',
  'body',
  'body_hash',
  'reference_key',
  'note',
  'kind',
  'account_id',
  'category_id',
  'counterpart_account_id',
  'amount_minor',
  'currency_code',
  'reference',
  'counterparty',
  'balance',
  'description',
  'auto_post',
  'split_mode',
  'split_structure_id',
  'split_requested',
  'pair_item_id',
  'transaction_id',
] as const;

const itemValues = (item: InboxItem): readonly SqlValue[] => [
  item.id,
  item.sourceId,
  item.ruleId,
  item.status,
  item.channel,
  item.receivedAt,
  item.body,
  item.bodyHash,
  item.referenceKey,
  item.note,
  item.kind,
  item.accountId,
  item.categoryId,
  item.counterpartAccountId,
  item.amountMinor === null ? null : item.amountMinor.toString(),
  item.currencyCode,
  item.reference,
  item.counterparty,
  item.balance,
  item.description,
  item.autoPost ? 1 : 0,
  item.splitMode,
  item.splitStructureId,
  item.splitRequested ? 1 : 0,
  item.pairItemId,
  item.transactionId,
];

const SAVE_ITEM = `
  INSERT INTO inbox_items (${ITEM_COLUMNS.join(', ')})
  VALUES (${ITEM_COLUMNS.map(() => '?').join(', ')})
  ON CONFLICT (id) DO UPDATE SET ${ITEM_COLUMNS.filter((column) => column !== 'id')
    .map((column) => `${column} = excluded.${column}`)
    .join(', ')}`;

const UNRESOLVED = `status IN ('unmatched', 'proposed', 'waiting_pair')`;

export function createSqliteRuleRepository(sql: SqlExecutor): RuleRepository {
  const oneItem = async (query: string, params: readonly SqlValue[]) => {
    const row = await sql.get<ItemRow>(query, params);
    return row ? toItem(row) : null;
  };
  const manyItems = async (query: string, params: readonly SqlValue[] = []) =>
    (await sql.all<ItemRow>(query, params)).map(toItem);
  const countUnresolvedBefore = async (cutoff: string) =>
    (
      await sql.get<{ total: number }>(
        `SELECT COUNT(*) AS total FROM inbox_items WHERE ${UNRESOLVED} AND received_at < ?`,
        [cutoff],
      )
    )?.total ?? 0;

  return {
    listSources: async () =>
      (await sql.all<SourceRow>('SELECT * FROM message_sources ORDER BY name, id')).map(toSource),

    getSource: async (id) => {
      const row = await sql.get<SourceRow>('SELECT * FROM message_sources WHERE id = ?', [id]);
      return row ? toSource(row) : null;
    },

    findSourceBySender: async (sender) => {
      const row = await sql.get<SourceRow>('SELECT * FROM message_sources WHERE sender = ?', [
        sender,
      ]);
      return row ? toSource(row) : null;
    },

    saveSource: (source) =>
      sql.run(
        `INSERT INTO message_sources (id, name, channel, sender, enabled) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET name = excluded.name, channel = excluded.channel,
           sender = excluded.sender, enabled = excluded.enabled`,
        [source.id, source.name, source.channel, source.sender, source.enabled ? 1 : 0],
      ),

    listRules: async (sourceId) =>
      (
        await sql.all<RuleRow>(
          'SELECT * FROM message_rules WHERE source_id = ? ORDER BY priority DESC, id',
          [sourceId],
        )
      ).map(toRule),

    getRule: async (id) => {
      const row = await sql.get<RuleRow>('SELECT * FROM message_rules WHERE id = ?', [id]);
      return row ? toRule(row) : null;
    },

    saveRule: (rule) =>
      sql.run(
        `INSERT INTO message_rules (id, source_id, name, priority, template, decimal_separator,
           thousands_separator, kind, account_id, category_id, counterpart_account_id,
           currency_code, auto_post, split_mode, split_structure_id, samples)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET source_id = excluded.source_id, name = excluded.name,
           priority = excluded.priority, template = excluded.template,
           decimal_separator = excluded.decimal_separator,
           thousands_separator = excluded.thousands_separator, kind = excluded.kind,
           account_id = excluded.account_id, category_id = excluded.category_id,
           counterpart_account_id = excluded.counterpart_account_id,
           currency_code = excluded.currency_code, auto_post = excluded.auto_post,
           split_mode = excluded.split_mode, split_structure_id = excluded.split_structure_id,
           samples = excluded.samples`,
        [
          rule.id,
          rule.sourceId,
          rule.name,
          rule.priority,
          rule.template,
          rule.format.decimal,
          rule.format.thousands,
          rule.kind,
          rule.accountId,
          rule.categoryId,
          rule.counterpartAccountId,
          rule.currencyCode,
          rule.autoPost ? 1 : 0,
          rule.splitMode,
          rule.splitStructureId,
          JSON.stringify(rule.samples),
        ],
      ),

    removeRule: (id) => sql.run('DELETE FROM message_rules WHERE id = ?', [id]),

    getItem: (id) => oneItem('SELECT * FROM inbox_items WHERE id = ?', [id]),

    saveItem: (item) => sql.run(SAVE_ITEM, itemValues(item)),

    listOpenItems: () =>
      manyItems(
        `SELECT i.* FROM inbox_items i
         WHERE i.${UNRESOLVED}
            OR (i.status = 'posted' AND i.split_requested = 1
                AND i.transaction_id IS NOT NULL
                AND NOT EXISTS (
                  SELECT 1 FROM split_runs r WHERE r.transaction_id = i.transaction_id
                ))
         ORDER BY i.received_at DESC, i.id`,
      ),

    findItemByReference: (sourceId, referenceKey) =>
      oneItem('SELECT * FROM inbox_items WHERE source_id = ? AND reference_key = ?', [
        sourceId,
        referenceKey,
      ]),

    listItemsByBodyHash: (sourceId, bodyHash) =>
      manyItems('SELECT * FROM inbox_items WHERE source_id = ? AND body_hash = ?', [
        sourceId,
        bodyHash,
      ]),

    listPairCandidates: (kind, from, to) =>
      manyItems(
        `SELECT * FROM inbox_items
         WHERE kind = ? AND received_at >= ? AND received_at <= ? AND pair_item_id IS NULL
           AND (status = 'waiting_pair' OR (status = 'posted' AND transaction_id IS NOT NULL))`,
        [kind, from, to],
      ),

    purgeUnresolvedBefore: async (cutoff) => {
      const total = await countUnresolvedBefore(cutoff);
      if (total === 0) return 0;
      await sql.run(
        `UPDATE inbox_items SET status = 'waiting_pair', pair_item_id = NULL
         WHERE ${UNRESOLVED} AND received_at >= ? AND pair_item_id IN (
           SELECT id FROM inbox_items WHERE ${UNRESOLVED} AND received_at < ?
         )`,
        [cutoff, cutoff],
      );
      await sql.run(`DELETE FROM inbox_items WHERE ${UNRESOLVED} AND received_at < ?`, [cutoff]);
      return total;
    },
  };
}
