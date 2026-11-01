import type { ScheduleUnit } from '@/features/planning/domain/schedule';
import type { SqlExecutor } from '@/shared/persistence/sql-driver';

import type { AssetRepository } from '../application/ports';
import type {
  Asset,
  AssetStatus,
  AssetType,
  ExpectedStream,
  RuleLink,
  StreamKind,
  TransactionLink,
  Valuation,
} from '../domain/asset';

type TypeRow = { id: string; name: string; archived: number };

type AssetRow = {
  id: string;
  name: string;
  type_id: string;
  currency_code: string;
  account_id: string | null;
  status: AssetStatus;
  sold_on: string | null;
  notes: string;
};

type ValuationRow = { id: string; asset_id: string; valued_on: string; amount: string };

type StreamRow = {
  id: string;
  asset_id: string;
  name: string;
  kind: StreamKind;
  amount: string;
  unit: ScheduleUnit;
  every: number;
  day_of_month: number | null;
  start_on: string;
  end_on: string | null;
};

type LinkRow = {
  transaction_id: string;
  asset_id: string;
  stream_id: string | null;
  due_on: string | null;
};

type RuleLinkRow = { rule_id: string; asset_id: string; stream_id: string | null };

const toType = (row: TypeRow): AssetType => ({
  id: row.id,
  name: row.name,
  archived: row.archived === 1,
});

const toAsset = (row: AssetRow): Asset => ({
  id: row.id,
  name: row.name,
  typeId: row.type_id,
  currencyCode: row.currency_code,
  accountId: row.account_id,
  status: row.status,
  soldOn: row.sold_on,
  notes: row.notes,
});

const toValuation = (row: ValuationRow): Valuation => ({
  id: row.id,
  assetId: row.asset_id,
  valuedOn: row.valued_on,
  amount: BigInt(row.amount),
});

const toStream = (row: StreamRow): ExpectedStream => ({
  id: row.id,
  assetId: row.asset_id,
  name: row.name,
  kind: row.kind,
  amount: BigInt(row.amount),
  schedule: {
    unit: row.unit,
    every: row.every,
    startOn: row.start_on,
    endOn: row.end_on,
    dayOfMonth: row.day_of_month,
  },
});

/** A removed stream empties `stream_id` and leaves a date that no longer means anything. */
const toLink = (row: LinkRow): TransactionLink => ({
  transactionId: row.transaction_id,
  assetId: row.asset_id,
  streamId: row.stream_id,
  dueOn: row.stream_id ? row.due_on : null,
});

const toRuleLink = (row: RuleLinkRow): RuleLink => ({
  ruleId: row.rule_id,
  assetId: row.asset_id,
  streamId: row.stream_id,
});

export function createSqliteAssetRepository(sql: SqlExecutor): AssetRepository {
  return {
    listTypes: async () =>
      (await sql.all<TypeRow>('SELECT * FROM asset_types ORDER BY name, id')).map(toType),

    getType: async (id) => {
      const row = await sql.get<TypeRow>('SELECT * FROM asset_types WHERE id = ?', [id]);
      return row ? toType(row) : null;
    },

    saveType: ({ id, name, archived }) =>
      sql.run(
        `INSERT INTO asset_types (id, name, archived) VALUES (?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET name = excluded.name, archived = excluded.archived`,
        [id, name, archived ? 1 : 0],
      ),

    listAssets: async () =>
      (await sql.all<AssetRow>('SELECT * FROM assets ORDER BY name, id')).map(toAsset),

    getAsset: async (id) => {
      const row = await sql.get<AssetRow>('SELECT * FROM assets WHERE id = ?', [id]);
      return row ? toAsset(row) : null;
    },

    saveAsset: (asset) =>
      sql.run(
        `INSERT INTO assets
           (id, name, type_id, currency_code, account_id, status, sold_on, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           name = excluded.name, type_id = excluded.type_id,
           currency_code = excluded.currency_code, account_id = excluded.account_id,
           status = excluded.status, sold_on = excluded.sold_on, notes = excluded.notes`,
        [
          asset.id,
          asset.name,
          asset.typeId,
          asset.currencyCode,
          asset.accountId,
          asset.status,
          asset.soldOn,
          asset.notes,
        ],
      ),

    listValuations: async () =>
      (
        await sql.all<ValuationRow>('SELECT * FROM asset_valuations ORDER BY valued_on DESC, id')
      ).map(toValuation),

    saveValuation: ({ id, assetId, valuedOn, amount }) =>
      sql.run(
        `INSERT INTO asset_valuations (id, asset_id, valued_on, amount) VALUES (?, ?, ?, ?)
         ON CONFLICT (asset_id, valued_on) DO UPDATE SET
           id = excluded.id, amount = excluded.amount`,
        [id, assetId, valuedOn, amount.toString()],
      ),

    removeValuation: (id) => sql.run('DELETE FROM asset_valuations WHERE id = ?', [id]),

    listStreams: async () =>
      (await sql.all<StreamRow>('SELECT * FROM asset_streams ORDER BY name, id')).map(toStream),

    getStream: async (id) => {
      const row = await sql.get<StreamRow>('SELECT * FROM asset_streams WHERE id = ?', [id]);
      return row ? toStream(row) : null;
    },

    saveStream: (stream) =>
      sql.run(
        `INSERT INTO asset_streams
           (id, asset_id, name, kind, amount, unit, every, day_of_month, start_on, end_on)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           name = excluded.name, kind = excluded.kind, amount = excluded.amount,
           unit = excluded.unit, every = excluded.every, day_of_month = excluded.day_of_month,
           start_on = excluded.start_on, end_on = excluded.end_on`,
        [
          stream.id,
          stream.assetId,
          stream.name,
          stream.kind,
          stream.amount.toString(),
          stream.schedule.unit,
          stream.schedule.every,
          stream.schedule.dayOfMonth,
          stream.schedule.startOn,
          stream.schedule.endOn,
        ],
      ),

    removeStream: (id) => sql.run('DELETE FROM asset_streams WHERE id = ?', [id]),

    listLinks: async () =>
      (await sql.all<LinkRow>('SELECT * FROM asset_transaction_links')).map(toLink),

    getLink: async (transactionId) => {
      const row = await sql.get<LinkRow>(
        'SELECT * FROM asset_transaction_links WHERE transaction_id = ?',
        [transactionId],
      );
      return row ? toLink(row) : null;
    },

    saveLink: ({ transactionId, assetId, streamId, dueOn }) =>
      sql.run(
        `INSERT INTO asset_transaction_links (transaction_id, asset_id, stream_id, due_on)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (transaction_id) DO UPDATE SET
           asset_id = excluded.asset_id, stream_id = excluded.stream_id, due_on = excluded.due_on`,
        [transactionId, assetId, streamId, dueOn],
      ),

    removeLink: (transactionId) =>
      sql.run('DELETE FROM asset_transaction_links WHERE transaction_id = ?', [transactionId]),

    listRuleLinks: async () =>
      (await sql.all<RuleLinkRow>('SELECT * FROM asset_rule_links')).map(toRuleLink),

    getRuleLink: async (ruleId) => {
      const row = await sql.get<RuleLinkRow>('SELECT * FROM asset_rule_links WHERE rule_id = ?', [
        ruleId,
      ]);
      return row ? toRuleLink(row) : null;
    },

    saveRuleLink: ({ ruleId, assetId, streamId }) =>
      sql.run(
        `INSERT INTO asset_rule_links (rule_id, asset_id, stream_id) VALUES (?, ?, ?)
         ON CONFLICT (rule_id) DO UPDATE SET
           asset_id = excluded.asset_id, stream_id = excluded.stream_id`,
        [ruleId, assetId, streamId],
      ),

    removeRuleLink: (ruleId) => sql.run('DELETE FROM asset_rule_links WHERE rule_id = ?', [ruleId]),

    ruleExists: async (ruleId) =>
      (await sql.get('SELECT 1 FROM message_rules WHERE id = ?', [ruleId])) !== undefined,

    isCurrencyInUse: async (code) =>
      (await sql.get('SELECT 1 FROM assets WHERE currency_code = ? LIMIT 1', [code])) !== undefined,
  };
}
