import type { SqlExecutor } from '@/shared/persistence/sql-driver';

import type { OnChainRepository } from '../application/ports';
import type { Chain, ChainFamily, Token, WatchedAddress } from '../domain/onchain';

type ChainRow = {
  id: string;
  name: string;
  family: ChainFamily;
  endpoint: string;
  evm_chain_id: string | null;
};

type TokenRow = {
  id: string;
  chain_id: string;
  symbol: string;
  contract: string;
  decimals: number;
};

type WatchedRow = {
  id: string;
  chain_id: string;
  token_id: string;
  address: string;
  label: string;
  account_id: string | null;
  last_amount: string | null;
  last_decimals: number | null;
  last_read_at: string | null;
};

const toChain = (row: ChainRow): Chain => ({
  id: row.id,
  name: row.name,
  family: row.family,
  endpoint: row.endpoint,
  evmChainId: row.evm_chain_id,
});

const toToken = (row: TokenRow): Token => ({
  id: row.id,
  chainId: row.chain_id,
  symbol: row.symbol,
  contract: row.contract,
  decimals: row.decimals,
});

const toWatched = (row: WatchedRow): WatchedAddress => ({
  id: row.id,
  chainId: row.chain_id,
  tokenId: row.token_id,
  address: row.address,
  label: row.label,
  accountId: row.account_id,
  lastRead:
    row.last_amount !== null && row.last_decimals !== null && row.last_read_at !== null
      ? {
          amount: BigInt(row.last_amount),
          decimals: row.last_decimals,
          readAt: row.last_read_at,
        }
      : null,
});

export function createSqliteOnChainRepository(sql: SqlExecutor): OnChainRepository {
  return {
    listChains: async () =>
      (await sql.all<ChainRow>('SELECT * FROM onchain_chains ORDER BY name')).map(toChain),

    getChain: async (id) => {
      const row = await sql.get<ChainRow>('SELECT * FROM onchain_chains WHERE id = ?', [id]);
      return row ? toChain(row) : null;
    },

    saveChain: ({ id, name, family, endpoint, evmChainId }) =>
      sql.run(
        `INSERT INTO onchain_chains (id, name, family, endpoint, evm_chain_id)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           name = excluded.name, endpoint = excluded.endpoint,
           evm_chain_id = excluded.evm_chain_id`,
        [id, name, family, endpoint, evmChainId],
      ),

    listTokens: async () =>
      (await sql.all<TokenRow>('SELECT * FROM onchain_tokens ORDER BY symbol, id')).map(toToken),

    getToken: async (id) => {
      const row = await sql.get<TokenRow>('SELECT * FROM onchain_tokens WHERE id = ?', [id]);
      return row ? toToken(row) : null;
    },

    saveToken: ({ id, chainId, symbol, contract, decimals }) =>
      sql.run(
        `INSERT INTO onchain_tokens (id, chain_id, symbol, contract, decimals)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           symbol = excluded.symbol, contract = excluded.contract, decimals = excluded.decimals`,
        [id, chainId, symbol, contract, decimals],
      ),

    listWatched: async () =>
      (
        await sql.all<WatchedRow>('SELECT * FROM onchain_watched_addresses ORDER BY label, id')
      ).map(toWatched),

    getWatched: async (id) => {
      const row = await sql.get<WatchedRow>(
        'SELECT * FROM onchain_watched_addresses WHERE id = ?',
        [id],
      );
      return row ? toWatched(row) : null;
    },

    saveWatched: ({ id, chainId, tokenId, address, label, accountId, lastRead }) =>
      sql.run(
        `INSERT INTO onchain_watched_addresses
           (id, chain_id, token_id, address, label, account_id,
            last_amount, last_decimals, last_read_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           chain_id = excluded.chain_id, token_id = excluded.token_id,
           address = excluded.address, label = excluded.label, account_id = excluded.account_id,
           last_amount = excluded.last_amount, last_decimals = excluded.last_decimals,
           last_read_at = excluded.last_read_at`,
        [
          id,
          chainId,
          tokenId,
          address,
          label,
          accountId,
          lastRead?.amount.toString() ?? null,
          lastRead?.decimals ?? null,
          lastRead?.readAt ?? null,
        ],
      ),

    removeWatched: (id) => sql.run('DELETE FROM onchain_watched_addresses WHERE id = ?', [id]),

    saveRead: ({ id, tokenId, address }, contract, { amount, decimals, readAt }) =>
      sql.run(
        `UPDATE onchain_watched_addresses
         SET last_amount = ?, last_decimals = ?, last_read_at = ?
         WHERE id = ? AND token_id = ? AND address = ?
           AND (last_read_at IS NULL OR last_read_at <= ?)
           AND EXISTS (SELECT 1 FROM onchain_tokens WHERE id = ? AND contract = ?)`,
        [amount.toString(), decimals, readAt, id, tokenId, address, readAt, tokenId, contract],
      ),

    clearReads: (tokenId) =>
      sql.run(
        `UPDATE onchain_watched_addresses
         SET last_amount = NULL, last_decimals = NULL, last_read_at = NULL
         WHERE token_id = ?`,
        [tokenId],
      ),
  };
}
