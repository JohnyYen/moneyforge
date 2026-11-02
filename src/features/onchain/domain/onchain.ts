import { isValidDecimals, MAX_DECIMALS } from '@/features/ledger/domain/money';
import { err, ok, type Result } from '@/shared/result';

import { normalizeAddress } from './address';
import { onChainError, type OnChainError } from './onchain-error';

export const CHAIN_FAMILIES = ['tron', 'evm'] as const;
export type ChainFamily = (typeof CHAIN_FAMILIES)[number];

/** User data. The defaults are seeded once by the migration and stay editable. */
export type Chain = {
  readonly id: string;
  readonly name: string;
  /** Decides how addresses read and how balances are asked for. Fixed once created. */
  readonly family: ChainFamily;
  readonly endpoint: string;
  /** What an EVM endpoint must report, so a pasted URL of another network cannot answer. */
  readonly evmChainId: string | null;
};

export type Token = {
  readonly id: string;
  /** Fixed once created, because the contract only means something on its chain. */
  readonly chainId: string;
  /** Matches the currency code of the accounts it may link to. */
  readonly symbol: string;
  readonly contract: string;
  /** Stored, and checked against the contract on every read. */
  readonly decimals: number;
};

/** Holds its own decimals, so a later edit of the token cannot reinterpret an old amount. */
export type LastRead = {
  readonly amount: bigint;
  readonly decimals: number;
  readonly readAt: string;
};

export type WatchedAddress = {
  readonly id: string;
  readonly chainId: string;
  readonly tokenId: string;
  readonly address: string;
  readonly label: string;
  readonly accountId: string | null;
  readonly lastRead: LastRead | null;
};

const MAX_NAME_LENGTH = 64;
const MAX_ENDPOINT_LENGTH = 512;
/** No `URL` class: React Native's has no hostname. Letting `@` in would allow credentials. */
const ENDPOINT_PATTERN = /^https:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?(?:[/?]\S*)?$/;
const EVM_CHAIN_ID_PATTERN = /^[1-9]\d{0,18}$/;

/** For messages, because a path may hold an API key. */
export function hostOf(endpoint: string): string {
  return /^https:\/\/([^/?#]+)/.exec(endpoint)?.[1] ?? 'the endpoint';
}

export function validateChain(chain: Chain): Result<Chain, OnChainError> {
  const invalid = (message: string) => err(onChainError('invalid-chain', message));
  const name = chain.name.trim();
  if (!name || name.length > MAX_NAME_LENGTH) return invalid('Enter a name of 64 characters at most.');
  const endpoint = chain.endpoint.trim().replace(/\/+$/, '');
  if (endpoint.length > MAX_ENDPOINT_LENGTH || !ENDPOINT_PATTERN.test(endpoint)) {
    return invalid('Enter an https:// endpoint with no username or password.');
  }
  if (chain.family === 'tron') return ok({ ...chain, name, endpoint, evmChainId: null });
  const evmChainId = chain.evmChainId?.trim() ?? '';
  if (!EVM_CHAIN_ID_PATTERN.test(evmChainId)) return invalid('Enter the chain ID, such as 1.');
  return ok({ ...chain, name, endpoint, evmChainId });
}

export function validateToken(token: Token, family: ChainFamily): Result<Token, OnChainError> {
  const invalid = (message: string) => err(onChainError('invalid-token', message));
  const symbol = token.symbol.trim();
  if (!symbol || symbol.length > MAX_NAME_LENGTH) return invalid('Enter a symbol.');
  if (!isValidDecimals(token.decimals)) return invalid(`Decimals must be 0 to ${MAX_DECIMALS}.`);
  const contract = normalizeAddress(family, token.contract);
  return contract.ok ? ok({ ...token, symbol, contract: contract.value }) : contract;
}

export function validateLabel(text: string): Result<string, OnChainError> {
  const label = text.trim();
  if (!label || label.length > MAX_NAME_LENGTH) {
    return err(onChainError('invalid-watched', 'Enter a label of 64 characters at most.'));
  }
  return ok(label);
}
