import type { Clock, IdGenerator, LedgerRepositories } from '@/features/ledger/application/ports';

import type { PendingMove, SplitRun } from '../domain/split-run';
import type { SplitStructure } from '../domain/split-structure';

export const SPLIT_DEFAULT_SCOPES = ['category', 'account'] as const;
export type SplitDefaultScope = (typeof SPLIT_DEFAULT_SCOPES)[number];

export type SplitDefault = {
  readonly scope: SplitDefaultScope;
  readonly scopeId: string;
  readonly structureId: string;
};

export interface SplitRepository {
  listStructures(): Promise<SplitStructure[]>;
  getStructure(id: string): Promise<SplitStructure | null>;
  /** Inserts or replaces a structure and all of its lines. */
  saveStructure(structure: SplitStructure): Promise<void>;

  listDefaults(): Promise<SplitDefault[]>;
  getDefault(scope: SplitDefaultScope, scopeId: string): Promise<string | null>;
  setDefault(entry: SplitDefault): Promise<void>;
  clearDefault(scope: SplitDefaultScope, scopeId: string): Promise<void>;

  saveRun(run: SplitRun, moves: readonly PendingMove[]): Promise<void>;
  /** Removes a run together with its lines and moves. */
  removeRun(id: string): Promise<void>;
  getRunForTransaction(transactionId: string): Promise<SplitRun | null>;

  listMoves(runId: string): Promise<PendingMove[]>;
  listPendingMoves(): Promise<PendingMove[]>;
  countPendingMoves(): Promise<number>;
  getMove(id: string): Promise<PendingMove | null>;
  getMoveByLedgerTransaction(transactionId: string): Promise<PendingMove | null>;
  markMoveDone(id: string, ledgerTransactionId: string): Promise<void>;
  markMoveSkipped(id: string): Promise<void>;
  /** Also drops the ledger link, so call it before removing the linked transaction. */
  markMovePending(id: string): Promise<void>;
}

export interface SplitRepositories extends LedgerRepositories {
  readonly splits: SplitRepository;
}

export interface SplitStore extends SplitRepositories {
  atomic<T>(work: (repositories: SplitRepositories) => Promise<T>): Promise<T>;
}

export type SplitDeps = {
  readonly store: SplitStore;
  readonly clock: Clock;
  readonly generateId: IdGenerator;
};
