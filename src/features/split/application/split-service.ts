import {
  buildEntry,
  type TransactionEntry,
} from '@/features/ledger/application/transaction-use-cases';
import { isSystemAccountId } from '@/features/ledger/domain/account';
import type { Transaction } from '@/features/ledger/domain/journal';
import { formatDecimal, parseDecimal } from '@/features/ledger/domain/money';
import { deriveRate } from '@/features/ledger/domain/rate';
import { err, ok, type Result } from '@/shared/result';

import { splitError, type SplitError } from '../domain/split-error';
import { createSplitRun, type PendingMove, type SplitRun } from '../domain/split-run';
import {
  createSplitStructure,
  type SplitLine,
  type SplitStructure,
} from '../domain/split-structure';
import type { SplitDefaultScope, SplitDeps, SplitRepositories } from './ports';

type StructureInput = { readonly name: string; readonly lines: readonly SplitLine[] };

export type CompleteMoveInput = {
  readonly moveId: string;
  /** Sent from the source account. Empty means the planned amount. */
  readonly amount?: string;
  /** Received in a conversion's target currency. */
  readonly targetAmount?: string;
  /** Optional for a conversion: derived from the two amounts when empty. */
  readonly rate?: string;
  readonly fee?: string;
  readonly feeCurrency?: string;
  readonly occurredAt?: string;
};

export type SplitDetails = {
  readonly run: SplitRun;
  readonly moves: readonly PendingMove[];
};

export type SplitProposal = {
  readonly transactionId: string;
  readonly sourceAccountId: string;
  readonly amount: bigint;
  readonly currencyCode: string;
  readonly structures: readonly SplitStructure[];
  readonly proposedStructureId: string | null;
};

type SplitResult<T> = Result<T, SplitError>;

const notFound = (what: string) => err(splitError('not-found', `${what} not found.`));
const archived = () => err(splitError('structure-archived', 'This split structure is archived.'));

function incomePosting(transaction: Transaction) {
  return transaction.postings.find(({ accountId }) => !isSystemAccountId(accountId)) ?? null;
}

/** Runs before a line can reach a run, so every move starts completable. */
async function checkTargets(
  { accounts }: SplitRepositories,
  lines: readonly SplitLine[],
): Promise<SplitResult<void>> {
  for (const line of lines) {
    const account = await accounts.get(line.targetAccountId);
    if (!account || account.systemRole !== null) return notFound(`Account for ${line.label}`);
    if (account.archived) {
      return err(splitError('account-archived', `${account.name} is archived.`));
    }
  }
  return ok(undefined);
}

async function moveEntry(
  { accounts, currencies }: SplitRepositories,
  move: PendingMove,
  input: CompleteMoveInput,
): Promise<SplitResult<TransactionEntry>> {
  const from = await accounts.get(move.fromAccountId);
  const to = await accounts.get(move.toAccountId);
  const source = await currencies.get(move.currencyCode);
  if (!from || !to || !source) return notFound('Account');

  const amount = input.amount?.trim() || formatDecimal(move.amount, source.decimals);
  const movement = {
    fromAccountId: from.id,
    toAccountId: to.id,
    description: `Split: ${move.label}`,
    occurredAt: input.occurredAt,
    fee: input.fee?.trim() || undefined,
  };
  if (from.currencyCode === to.currencyCode) {
    return ok({ ...movement, kind: 'transfer', amount });
  }

  const target = await currencies.get(to.currencyCode);
  if (!target) return notFound('Currency');
  const targetText = input.targetAmount?.trim();
  if (!targetText) {
    return err(splitError('invalid-amount', `Enter the amount received in ${target.code}.`));
  }
  const sent = parseDecimal(amount, source.decimals);
  if (!sent.ok) return sent;
  const received = parseDecimal(targetText, target.decimals);
  if (!received.ok) return received;
  if (sent.value <= 0n || received.value <= 0n) {
    return err(splitError('non-positive-amount', 'The amount must be greater than zero.'));
  }
  const rate =
    input.rate?.trim() || deriveRate(sent.value, received.value, source.decimals, target.decimals);
  return ok({
    ...movement,
    kind: 'conversion',
    sourceAmount: amount,
    targetAmount: targetText,
    rate,
    feeCurrency: input.feeCurrency,
  });
}

async function writeStructure(
  repositories: SplitRepositories,
  input: StructureInput & { readonly id: string; readonly active: boolean },
): Promise<SplitResult<SplitStructure>> {
  const structure = createSplitStructure(input);
  if (!structure.ok) return structure;
  const targets = await checkTargets(repositories, structure.value.lines);
  if (!targets.ok) return targets;
  await repositories.splits.saveStructure(structure.value);
  return structure;
}

export function createSplitService({ store, clock, generateId }: SplitDeps) {
  const details = async (transactionId: string): Promise<SplitDetails | null> => {
    const run = await store.splits.getRunForTransaction(transactionId);
    return run && { run, moves: await store.splits.listMoves(run.id) };
  };

  return {
    listStructures: () => store.splits.listStructures(),
    getStructure: (id: string) => store.splits.getStructure(id),
    createStructure: (input: StructureInput): Promise<SplitResult<SplitStructure>> =>
      store.atomic((repositories) =>
        writeStructure(repositories, { ...input, id: generateId(), active: true }),
      ),

    updateStructure: (
      input: StructureInput & { readonly id: string },
    ): Promise<SplitResult<SplitStructure>> =>
      store.atomic(async (repositories) => {
        const existing = await repositories.splits.getStructure(input.id);
        if (!existing) return notFound('Structure');
        return writeStructure(repositories, { ...input, active: existing.active });
      }),

    setStructureActive: (id: string, active: boolean): Promise<SplitResult<void>> =>
      store.atomic(async ({ splits }) => {
        const existing = await splits.getStructure(id);
        if (!existing) return notFound('Structure');
        await splits.saveStructure({ ...existing, active });
        return ok(undefined);
      }),

    listSplitDefaults: () => store.splits.listDefaults(),

    /** A null structure clears the default for that category or account. */
    setSplitDefault: (input: {
      readonly scope: SplitDefaultScope;
      readonly scopeId: string;
      readonly structureId: string | null;
    }): Promise<SplitResult<void>> =>
      store.atomic(async ({ splits }) => {
        const { scope, scopeId, structureId } = input;
        if (structureId === null) {
          await splits.clearDefault(scope, scopeId);
          return ok(undefined);
        }
        const structure = await splits.getStructure(structureId);
        if (!structure) return notFound('Structure');
        if (!structure.active) return archived();
        await splits.setDefault({ scope, scopeId, structureId });
        return ok(undefined);
      }),

    /** What to offer after income is recorded, or `null` when there is nothing to offer. */
    splitProposal: async (transactionId: string): Promise<SplitProposal | null> => {
      const { journal, splits } = store;
      const transaction = await journal.get(transactionId);
      if (transaction?.kind !== 'income') return null;
      const posting = incomePosting(transaction);
      if (!posting || (await splits.getRunForTransaction(transactionId))) return null;
      const structures = (await splits.listStructures()).filter(({ active }) => active);
      if (structures.length === 0) return null;

      const candidates = [
        transaction.categoryId && (await splits.getDefault('category', transaction.categoryId)),
        await splits.getDefault('account', posting.accountId),
      ];
      const proposed = candidates.find((id) => structures.some((item) => item.id === id));
      return {
        transactionId,
        sourceAccountId: posting.accountId,
        amount: posting.amount,
        currencyCode: posting.currency,
        structures,
        proposedStructureId: proposed ?? null,
      };
    },

    /** Records the plan and moves no money. */
    applyStructure: (input: {
      readonly transactionId: string;
      readonly structureId: string;
    }): Promise<SplitResult<SplitDetails>> =>
      store.atomic(async (repositories) => {
        const { journal, splits } = repositories;
        const transaction = await journal.get(input.transactionId);
        if (!transaction) return notFound('Transaction');
        const posting = incomePosting(transaction);
        if (transaction.kind !== 'income' || !posting) {
          return err(splitError('not-income', 'Only income can be split.'));
        }
        if (await splits.getRunForTransaction(transaction.id)) {
          return err(splitError('already-split', 'This income is already split.'));
        }
        const structure = await splits.getStructure(input.structureId);
        if (!structure) return notFound('Structure');
        if (!structure.active) return archived();
        const targets = await checkTargets(repositories, structure.lines);
        if (!targets.ok) return targets;

        const { run, moves } = createSplitRun({
          id: generateId(),
          transactionId: transaction.id,
          structure,
          sourceAccountId: posting.accountId,
          currencyCode: posting.currency,
          amount: posting.amount,
          createdAt: clock.now().toISOString(),
          generateId,
        });
        await splits.saveRun(run, moves);
        return ok({ run, moves });
      }),

    splitDetails: details,
    listPendingMoves: () => store.splits.listPendingMoves(),
    countPendingMoves: () => store.splits.countPendingMoves(),
    getMove: (id: string) => store.splits.getMove(id),
    moveCompletedBy: (transactionId: string) =>
      store.splits.getMoveByLedgerTransaction(transactionId),

    /** Records the real movement and links it to the move in one write. */
    completeMove: (
      input: CompleteMoveInput,
    ): Promise<SplitResult<{ move: PendingMove; transaction: Transaction }>> =>
      store.atomic(async (repositories) => {
        const { journal, splits } = repositories;
        const move = await splits.getMove(input.moveId);
        if (!move) return notFound('Move');
        if (move.status !== 'pending') {
          return err(splitError('move-not-pending', 'This move is no longer pending.'));
        }
        const entry = await moveEntry(repositories, move, input);
        if (!entry.ok) return entry;
        const transaction = await buildEntry(repositories, entry.value, {
          id: generateId(),
          occurredAt: clock.now().toISOString(),
          existing: null,
        });
        if (!transaction.ok) return transaction;
        await journal.save(transaction.value);
        await splits.markMoveDone(move.id, transaction.value.id);
        return ok({
          move: { ...move, status: 'done', ledgerTransactionId: transaction.value.id },
          transaction: transaction.value,
        });
      }),

    skipMove: (id: string): Promise<SplitResult<void>> =>
      store.atomic(async ({ splits }) => {
        const move = await splits.getMove(id);
        if (!move) return notFound('Move');
        if (move.status !== 'pending') {
          return err(splitError('move-not-pending', 'This move is no longer pending.'));
        }
        await splits.markMoveSkipped(id);
        return ok(undefined);
      }),

    /** Returns a done or skipped move to pending, removing any linked transaction. */
    undoMove: (id: string): Promise<SplitResult<void>> =>
      store.atomic(async ({ journal, splits }) => {
        const move = await splits.getMove(id);
        if (!move) return notFound('Move');
        if (move.status === 'pending') {
          return err(splitError('move-not-reversible', 'This move is already pending.'));
        }
        await splits.markMovePending(id);
        if (move.ledgerTransactionId) await journal.remove(move.ledgerTransactionId);
        return ok(undefined);
      }),
  };
}

export type SplitService = ReturnType<typeof createSplitService>;
