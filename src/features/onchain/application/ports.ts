import type { Clock, IdGenerator, LedgerRepositories } from '@/features/ledger/application/ports';
import type { Result } from '@/shared/result';

import type { Chain, ChainFamily, LastRead, Token, WatchedAddress } from '../domain/onchain';
import type { OnChainError } from '../domain/onchain-error';

export type BalanceQuery = {
  readonly family: ChainFamily;
  readonly endpoint: string;
  readonly evmChainId: string | null;
  readonly contract: string;
  readonly address: string;
};

export type BalanceRead = { readonly balance: bigint; readonly decimals: number };

/** Reads, and nothing else: no method here signs or sends. Failures are results, never throws. */
export interface OnChainClient {
  readBalance(query: BalanceQuery): Promise<Result<BalanceRead, OnChainError>>;
}

/** For a binary or a test with no network. */
export const absentOnChainClient: OnChainClient = {
  readBalance: async () => ({
    ok: false,
    error: { code: 'network-failed', message: 'No network client is available.' },
  }),
};

export interface OnChainRepository {
  listChains(): Promise<Chain[]>;
  getChain(id: string): Promise<Chain | null>;
  saveChain(chain: Chain): Promise<void>;

  listTokens(): Promise<Token[]>;
  getToken(id: string): Promise<Token | null>;
  saveToken(token: Token): Promise<void>;

  listWatched(): Promise<WatchedAddress[]>;
  getWatched(id: string): Promise<WatchedAddress | null>;
  saveWatched(watched: WatchedAddress): Promise<void>;
  removeWatched(id: string): Promise<void>;

  /**
   * Keeps a read only if the row still watches what was read, on the same contract, and holds
   * nothing newer, because the network ran outside any write and the person may have edited it.
   */
  saveRead(watched: WatchedAddress, contract: string, read: LastRead): Promise<void>;
  /** A contract edit makes the amounts read from the old one meaningless. */
  clearReads(tokenId: string): Promise<void>;
}

export interface OnChainRepositories extends LedgerRepositories {
  readonly onchain: OnChainRepository;
}

export interface OnChainStore extends OnChainRepositories {
  atomic<T>(work: (repositories: OnChainRepositories) => Promise<T>): Promise<T>;
}

export type OnChainDeps = {
  readonly store: OnChainStore;
  readonly clock: Clock;
  readonly generateId: IdGenerator;
  readonly client: OnChainClient;
};
