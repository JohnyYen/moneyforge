import type { TransactionChangeGuard } from '@/features/ledger/application/ports';
import { isSystemAccountId } from '@/features/ledger/domain/account';
import type { Transaction } from '@/features/ledger/domain/journal';
import { ledgerError } from '@/features/ledger/domain/ledger-error';
import { err, ok } from '@/shared/result';

import { hasDoneMoves, type SplitRun } from '../domain/split-run';
import type { SplitRepository } from './ports';

/** True when the change touches what a run was computed from: amount, account, or kind. */
function changesSplitBasis(existing: Transaction, next: Transaction): boolean {
  if (existing.kind !== next.kind) return true;
  if (existing.postings.length !== next.postings.length) return true;
  return existing.postings.some((posting, index) => {
    const other = next.postings[index];
    return posting.accountId !== other.accountId || posting.amount !== other.amount;
  });
}

const movementShape = ({ kind, postings }: Transaction) =>
  [kind, ...postings.map(({ accountId }) => accountId).filter((id) => !isSystemAccountId(id))].join(
    ' ',
  );

export function createSplitChangeGuard(splits: SplitRepository): TransactionChangeGuard {
  /** Cancels a run with no completed moves, once the user has agreed to that. */
  async function cancelRun(run: SplitRun, confirmed: boolean | undefined, doing: string) {
    const moves = await splits.listMoves(run.id);
    if (hasDoneMoves(moves)) {
      return err(
        ledgerError(
          'transaction-locked',
          `This income has completed split moves. Undo them before ${doing} it.`,
        ),
      );
    }
    if (!confirmed) {
      return err(
        ledgerError(
          'confirmation-required',
          `This income has a split with no completed moves. ${
            doing === 'deleting' ? 'Deleting' : 'Changing'
          } it cancels the split.`,
        ),
      );
    }
    await splits.removeRun(run.id);
    return ok(undefined);
  }

  return {
    beforeUpdate: async (existing, next, { confirmed }) => {
      if (changesSplitBasis(existing, next)) {
        const run = await splits.getRunForTransaction(existing.id);
        if (run) return cancelRun(run, confirmed, 'changing');
      }
      const move = await splits.getMoveByLedgerTransaction(existing.id);
      if (move && movementShape(existing) !== movementShape(next)) {
        return err(
          ledgerError(
            'transaction-locked',
            'This movement completes a split move, so its accounts and type stay fixed. ' +
              'Delete it to make the move pending again.',
          ),
        );
      }
      return ok(undefined);
    },

    beforeDelete: async (existing, { confirmed }) => {
      const run = await splits.getRunForTransaction(existing.id);
      if (run) return cancelRun(run, confirmed, 'deleting');
      const move = await splits.getMoveByLedgerTransaction(existing.id);
      if (move) await splits.markMovePending(move.id);
      return ok(undefined);
    },
  };
}
