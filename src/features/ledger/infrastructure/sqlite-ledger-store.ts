import type { SqlExecutor, SqlValue } from '@/shared/persistence/sql-driver';

import type { LedgerRepositories, LedgerStore, TransactionFilter } from '../application/ports';
import type { Account, SystemRole } from '../domain/account';
import type { Category, CategoryKind } from '../domain/category';
import type { Currency } from '../domain/currency';
import { isBalanced, type Transaction, type TransactionKind } from '../domain/journal';

type AccountRow = {
  id: string;
  name: string;
  type: string;
  currency_code: string;
  opening_balance: string;
  archived: number;
  system_role: SystemRole | null;
};

type CategoryRow = {
  id: string;
  name: string;
  kind: CategoryKind;
  parent_id: string | null;
  archived: number;
};

type TransactionRow = {
  id: string;
  occurred_at: string;
  kind: TransactionKind;
  description: string;
  category_id: string | null;
  metadata: string | null;
};

type PostingRow = {
  transaction_id: string;
  account_id: string;
  amount: string;
  currency_code: string;
};

type ExchangeRateRow = {
  id: string;
  from_code: string;
  to_code: string;
  rate: string;
  effective_on: string;
};

const toAccount = (row: AccountRow): Account => ({
  id: row.id,
  name: row.name,
  type: row.type,
  currencyCode: row.currency_code,
  openingBalance: BigInt(row.opening_balance),
  archived: row.archived === 1,
  systemRole: row.system_role,
});

const toCategory = (row: CategoryRow): Category => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  parentId: row.parent_id,
  archived: row.archived === 1,
});

/** Below the 999 bound parameters some SQLite builds allow in one statement. */
const POSTING_CHUNK_SIZE = 500;

function buildListQuery(filter: TransactionFilter) {
  const conditions: string[] = [];
  const params: SqlValue[] = [];
  const add = (condition: string, value: SqlValue | undefined) => {
    if (value === undefined) return;
    conditions.push(condition);
    params.push(value);
  };

  add(
    'EXISTS (SELECT 1 FROM postings p WHERE p.transaction_id = t.id AND p.account_id = ?)',
    filter.accountId,
  );
  add('t.category_id = ?', filter.categoryId);
  add('t.kind = ?', filter.kind);
  add('t.occurred_at >= ?', filter.from);
  add('t.occurred_at <= ?', filter.to);

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const page = filter.limit === undefined ? '' : 'LIMIT ? OFFSET ?';
  if (filter.limit !== undefined) params.push(filter.limit, filter.offset ?? 0);
  return {
    sql: `SELECT t.* FROM transactions t ${where} ORDER BY t.occurred_at DESC, t.id DESC ${page}`,
    params,
  };
}

function createRepositories(sql: SqlExecutor): LedgerRepositories {
  async function loadTransactions(rows: TransactionRow[]): Promise<Transaction[]> {
    if (rows.length === 0) return [];
    const byTransaction = new Map<string, PostingRow[]>();
    for (let start = 0; start < rows.length; start += POSTING_CHUNK_SIZE) {
      const ids = rows.slice(start, start + POSTING_CHUNK_SIZE).map((row) => row.id);
      const marks = ids.map(() => '?').join(', ');
      const postings = await sql.all<PostingRow>(
        `SELECT transaction_id, account_id, amount, currency_code FROM postings
         WHERE transaction_id IN (${marks}) ORDER BY transaction_id, position`,
        ids,
      );
      for (const posting of postings) {
        const group = byTransaction.get(posting.transaction_id);
        if (group) group.push(posting);
        else byTransaction.set(posting.transaction_id, [posting]);
      }
    }
    return rows.map((row) => ({
      id: row.id,
      occurredAt: row.occurred_at,
      kind: row.kind,
      description: row.description,
      categoryId: row.category_id,
      metadata: row.metadata === null ? null : JSON.parse(row.metadata),
      postings: (byTransaction.get(row.id) ?? []).map((posting) => ({
        accountId: posting.account_id,
        amount: BigInt(posting.amount),
        currency: posting.currency_code,
      })),
    }));
  }

  return {
    currencies: {
      list: () => sql.all<Currency>('SELECT * FROM currencies ORDER BY code'),
      get: async (code) =>
        (await sql.get<Currency>('SELECT * FROM currencies WHERE code = ?', [code])) ?? null,
      save: (currency) =>
        sql.run(
          `INSERT INTO currencies (code, name, decimals, symbol, kind) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (code) DO UPDATE SET
             name = excluded.name, decimals = excluded.decimals,
             symbol = excluded.symbol, kind = excluded.kind`,
          [currency.code, currency.name, currency.decimals, currency.symbol, currency.kind],
        ),
    },

    accounts: {
      listUser: async () =>
        (
          await sql.all<AccountRow>(
            'SELECT * FROM accounts WHERE system_role IS NULL ORDER BY name, id',
          )
        ).map(toAccount),
      get: async (id) => {
        const row = await sql.get<AccountRow>('SELECT * FROM accounts WHERE id = ?', [id]);
        return row ? toAccount(row) : null;
      },
      save: (account) =>
        sql.run(
          `INSERT INTO accounts
             (id, name, type, currency_code, opening_balance, archived, system_role)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET
             name = excluded.name, type = excluded.type,
             opening_balance = excluded.opening_balance, archived = excluded.archived`,
          [
            account.id,
            account.name,
            account.type,
            account.currencyCode,
            account.openingBalance.toString(),
            account.archived ? 1 : 0,
            account.systemRole,
          ],
        ),
    },

    categories: {
      list: async () =>
        (await sql.all<CategoryRow>('SELECT * FROM categories ORDER BY kind, name')).map(
          toCategory,
        ),
      get: async (id) => {
        const row = await sql.get<CategoryRow>('SELECT * FROM categories WHERE id = ?', [id]);
        return row ? toCategory(row) : null;
      },
      save: (category) =>
        sql.run(
          `INSERT INTO categories (id, name, kind, parent_id, archived) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET
             name = excluded.name, kind = excluded.kind,
             parent_id = excluded.parent_id, archived = excluded.archived`,
          [
            category.id,
            category.name,
            category.kind,
            category.parentId,
            category.archived ? 1 : 0,
          ],
        ),
    },

    journal: {
      save: async (transaction) => {
        if (!isBalanced(transaction.postings)) {
          throw new Error(`Transaction ${transaction.id} does not balance`);
        }
        await sql.transaction(async (tx) => {
          await tx.run('DELETE FROM postings WHERE transaction_id = ?', [transaction.id]);
          await tx.run(
            `INSERT INTO transactions (id, occurred_at, kind, description, category_id, metadata)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT (id) DO UPDATE SET
               occurred_at = excluded.occurred_at, kind = excluded.kind,
               description = excluded.description, category_id = excluded.category_id,
               metadata = excluded.metadata`,
            [
              transaction.id,
              transaction.occurredAt,
              transaction.kind,
              transaction.description,
              transaction.categoryId,
              transaction.metadata === null ? null : JSON.stringify(transaction.metadata),
            ],
          );
          let position = 0;
          for (const posting of transaction.postings) {
            await tx.run(
              `INSERT INTO postings (transaction_id, position, account_id, amount, currency_code)
               VALUES (?, ?, ?, ?, ?)`,
              [
                transaction.id,
                position,
                posting.accountId,
                posting.amount.toString(),
                posting.currency,
              ],
            );
            position += 1;
          }
        });
      },
      remove: (id) => sql.run('DELETE FROM transactions WHERE id = ?', [id]),
      get: async (id) => {
        const row = await sql.get<TransactionRow>('SELECT * FROM transactions WHERE id = ?', [id]);
        if (!row) return null;
        const [transaction] = await loadTransactions([row]);
        return transaction;
      },
      list: async (filter) => {
        const query = buildListQuery(filter);
        return loadTransactions(await sql.all<TransactionRow>(query.sql, query.params));
      },
      balances: async () => {
        // Summed here, not with SQL SUM: amounts exceed SQLite's integer range.
        const rows = await sql.all<{ account_id: string; amount: string }>(
          'SELECT account_id, amount FROM postings',
        );
        const balances: Record<string, bigint> = {};
        for (const { account_id: accountId, amount } of rows) {
          balances[accountId] = (balances[accountId] ?? 0n) + BigInt(amount);
        }
        return balances;
      },
      currencyHasPostings: async (code) =>
        (await sql.get('SELECT 1 AS found FROM postings WHERE currency_code = ? LIMIT 1', [code])) !==
        undefined,
    },

    exchangeRates: {
      list: async () =>
        (
          await sql.all<ExchangeRateRow>(
            'SELECT * FROM exchange_rates ORDER BY effective_on DESC, from_code, to_code',
          )
        ).map((row) => ({
          id: row.id,
          fromCode: row.from_code,
          toCode: row.to_code,
          rate: row.rate,
          effectiveOn: row.effective_on,
        })),
      save: (rate) =>
        sql.run(
          `INSERT INTO exchange_rates (id, from_code, to_code, rate, effective_on)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (from_code, to_code, effective_on) DO UPDATE SET rate = excluded.rate`,
          [rate.id, rate.fromCode, rate.toCode, rate.rate, rate.effectiveOn],
        ),
    },

    settings: {
      get: async (key) =>
        (await sql.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]))
          ?.value ?? null,
      set: (key, value) =>
        sql.run(
          `INSERT INTO settings (key, value) VALUES (?, ?)
           ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
          [key, value],
        ),
    },
  };
}

export function createSqliteLedgerStore(driver: SqlExecutor): LedgerStore {
  return {
    ...createRepositories(driver),
    atomic: (work) => driver.transaction((tx) => work(createRepositories(tx))),
  };
}
