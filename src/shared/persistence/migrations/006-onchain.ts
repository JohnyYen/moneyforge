import type { Migration } from '../migrator';

export const onchainMigration: Migration = {
  version: 6,
  name: 'onchain',
  sql: `
    CREATE TABLE onchain_chains (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      family TEXT NOT NULL CHECK (family IN ('tron', 'evm')),
      endpoint TEXT NOT NULL,
      evm_chain_id TEXT,
      CHECK ((family = 'evm') = (evm_chain_id IS NOT NULL))
    );
    INSERT INTO onchain_chains (id, name, family, endpoint, evm_chain_id) VALUES
      ('default-tron', 'Tron', 'tron', 'https://api.trongrid.io', NULL),
      ('default-ethereum', 'Ethereum', 'evm', 'https://ethereum-rpc.publicnode.com', '1');

    CREATE TABLE onchain_tokens (
      id TEXT PRIMARY KEY,
      chain_id TEXT NOT NULL REFERENCES onchain_chains (id),
      symbol TEXT NOT NULL,
      contract TEXT NOT NULL,
      decimals INTEGER NOT NULL CHECK (decimals BETWEEN 0 AND 18),
      UNIQUE (chain_id, contract),
      UNIQUE (id, chain_id)
    );
    INSERT INTO onchain_tokens (id, chain_id, symbol, contract, decimals) VALUES
      ('default-usdt-tron', 'default-tron', 'USDT', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', 6),
      ('default-usdt-ethereum', 'default-ethereum', 'USDT',
        '0xdAC17F958D2ee523a2206206994597C13D831ec7', 6),
      ('default-usdc-ethereum', 'default-ethereum', 'USDC',
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 6);

    CREATE TABLE onchain_watched_addresses (
      id TEXT PRIMARY KEY,
      chain_id TEXT NOT NULL,
      token_id TEXT NOT NULL,
      address TEXT NOT NULL,
      label TEXT NOT NULL,
      account_id TEXT REFERENCES accounts (id),
      last_amount TEXT CHECK (last_amount IS NULL OR typeof(last_amount) = 'text'),
      last_decimals INTEGER,
      last_read_at TEXT,
      FOREIGN KEY (token_id, chain_id) REFERENCES onchain_tokens (id, chain_id),
      UNIQUE (token_id, address),
      CHECK ((last_amount IS NULL) = (last_decimals IS NULL)),
      CHECK ((last_amount IS NULL) = (last_read_at IS NULL))
    );
  `,
};
