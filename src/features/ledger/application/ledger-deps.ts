import type { Clock, IdGenerator, LedgerStore } from './ports';

export type LedgerDeps = {
  readonly store: LedgerStore;
  readonly clock: Clock;
  readonly generateId: IdGenerator;
};
