import { allocate } from './allocation';
import { resolveLines, type SplitStructure } from './split-structure';

export const MOVE_STATUSES = ['pending', 'done', 'skipped'] as const;
export type MoveStatus = (typeof MOVE_STATUSES)[number];

/** One line as it was when the run was made. Later structure edits never reach it. */
export type SplitRunLine = {
  readonly position: number;
  readonly label: string;
  readonly targetAccountId: string;
  readonly percentage: string;
  readonly isRemainder: boolean;
  readonly amount: bigint;
};

export type SplitRun = {
  readonly id: string;
  readonly transactionId: string;
  readonly structureId: string;
  readonly structureName: string;
  readonly sourceAccountId: string;
  readonly currencyCode: string;
  readonly amount: bigint;
  readonly createdAt: string;
  readonly lines: readonly SplitRunLine[];
};

export type PendingMove = {
  readonly id: string;
  readonly runId: string;
  readonly position: number;
  readonly label: string;
  readonly fromAccountId: string;
  readonly toAccountId: string;
  /** In the income's currency. A conversion's received amount is entered at completion. */
  readonly amount: bigint;
  readonly currencyCode: string;
  readonly status: MoveStatus;
  readonly ledgerTransactionId: string | null;
};

export type SplitRunInput = {
  readonly id: string;
  readonly transactionId: string;
  readonly structure: SplitStructure;
  readonly sourceAccountId: string;
  readonly currencyCode: string;
  readonly amount: bigint;
  readonly createdAt: string;
  readonly generateId: () => string;
};

export function allocateStructure(amount: bigint, structure: Pick<SplitStructure, 'lines'>) {
  const lines = resolveLines(structure.lines);
  const amounts = allocate(
    amount,
    lines.map(({ percentage }) => percentage),
  );
  return lines.map((line, position): SplitRunLine => ({
    position,
    label: line.label,
    targetAccountId: line.targetAccountId,
    percentage: line.percentage,
    isRemainder: line.isRemainder,
    amount: amounts[position],
  }));
}

export function createSplitRun(input: SplitRunInput): {
  readonly run: SplitRun;
  readonly moves: readonly PendingMove[];
} {
  const { structure, sourceAccountId, currencyCode, generateId, ...fields } = input;
  const lines = allocateStructure(input.amount, structure);
  const run: SplitRun = {
    ...fields,
    structureId: structure.id,
    structureName: structure.name,
    sourceAccountId,
    currencyCode,
    lines,
  };
  const moves = lines
    .filter((line) => line.targetAccountId !== sourceAccountId && line.amount > 0n)
    .map((line): PendingMove => ({
      id: generateId(),
      runId: input.id,
      position: line.position,
      label: line.label,
      fromAccountId: sourceAccountId,
      toAccountId: line.targetAccountId,
      amount: line.amount,
      currencyCode,
      status: 'pending',
      ledgerTransactionId: null,
    }));
  return { run, moves };
}

export function hasDoneMoves(moves: readonly PendingMove[]): boolean {
  return moves.some((move) => move.status === 'done');
}
