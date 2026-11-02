import type {
  Clock,
  IdGenerator,
  LedgerRepositories,
} from '@/features/ledger/application/ports';

export interface ImportedRowRepository {
  /** Which of these fingerprints are already held by a transaction. */
  findKnown(fingerprints: readonly string[]): Promise<Set<string>>;
  save(fingerprint: string, transactionId: string, batchId: string): Promise<void>;
  /** The transactions one import created that still exist. */
  listBatch(batchId: string): Promise<string[]>;
}

export interface TransferRepositories extends LedgerRepositories {
  readonly importedRows: ImportedRowRepository;
}

export interface TransferStore extends TransferRepositories {
  atomic<T>(work: (repositories: TransferRepositories) => Promise<T>): Promise<T>;
}

export type TransferDeps = {
  readonly store: TransferStore;
  readonly clock: Clock;
  readonly generateId: IdGenerator;
  /** The install's dedup secret. Called outside any write, so it may take its time. */
  readonly loadSecret: () => Promise<string>;
};
