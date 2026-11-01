import type { Account } from '@/features/ledger/domain/account';
import type { Currency } from '@/features/ledger/domain/currency';
import { formatDecimal, formatDisplay } from '@/features/ledger/domain/money';

import type { SplitDetails } from '../application/split-service';
import {
  allocateStructure,
  type MoveStatus,
  type PendingMove,
  type SplitRunLine,
} from '../domain/split-run';
import type { SplitStructure } from '../domain/split-structure';

export type SplitLookups = {
  readonly accounts: readonly Account[];
  readonly currencies: readonly Currency[];
};

export type SplitRow = {
  readonly key: string;
  readonly title: string;
  readonly subtitle: string;
  readonly amount: string;
  readonly moveId: string | null;
};

const STATUS_LABELS: Record<MoveStatus, string> = {
  pending: 'Pending',
  done: 'Done',
  skipped: 'Skipped',
};

const accountName = (id: string, { accounts }: SplitLookups) =>
  accounts.find((account) => account.id === id)?.name ?? 'Unknown account';

const accountOf = (id: string, { accounts }: SplitLookups) =>
  accounts.find((account) => account.id === id);

function money(amount: bigint, code: string, { currencies }: SplitLookups): string {
  const currency = currencies.find((candidate) => candidate.code === code);
  return currency ? formatDisplay(amount, currency) : `${formatDecimal(amount, 0)} ${code}`;
}

export function pendingMovesLabel(count: number): string {
  return count === 1 ? '1 pending move' : `${count} pending moves`;
}

export function moveKindOf(
  move: Pick<PendingMove, 'toAccountId' | 'currencyCode'>,
  lookups: SplitLookups,
): 'transfer' | 'conversion' {
  const target = accountOf(move.toAccountId, lookups);
  return target && target.currencyCode !== move.currencyCode ? 'conversion' : 'transfer';
}

export function toMoveRow(move: PendingMove, lookups: SplitLookups) {
  return {
    id: move.id,
    title: move.label,
    subtitle: `${accountName(move.fromAccountId, lookups)} → ${accountName(move.toAccountId, lookups)}`,
    amount: money(move.amount, move.currencyCode, lookups),
  };
}

function toRow(
  line: SplitRunLine,
  currencyCode: string,
  standing: string,
  moveId: string | null,
  lookups: SplitLookups,
): SplitRow {
  return {
    key: String(line.position),
    title: line.label,
    subtitle: [`${line.percentage}%`, accountName(line.targetAccountId, lookups), standing].join(
      ' · ',
    ),
    amount: money(line.amount, currencyCode, lookups),
    moveId,
  };
}

export function runRows({ run, moves }: SplitDetails, lookups: SplitLookups): SplitRow[] {
  return run.lines.map((line) => {
    const move = moves.find(({ position }) => position === line.position);
    const stays = line.targetAccountId === run.sourceAccountId;
    const standing = move
      ? STATUS_LABELS[move.status]
      : stays
        ? 'Stays in place'
        : 'Nothing to move';
    return toRow(line, run.currencyCode, standing, move?.id ?? null, lookups);
  });
}

export function previewRows(
  amount: bigint,
  sourceAccountId: string,
  currencyCode: string,
  structure: Pick<SplitStructure, 'lines'>,
  lookups: SplitLookups,
): SplitRow[] {
  return allocateStructure(amount, structure).map((line) => {
    const kind = moveKindOf({ toAccountId: line.targetAccountId, currencyCode }, lookups);
    const standing =
      line.targetAccountId === sourceAccountId
        ? 'Stays in place'
        : line.amount === 0n
          ? 'Nothing to move'
          : kind === 'conversion'
            ? 'Conversion'
            : 'Transfer';
    return toRow(line, currencyCode, standing, null, lookups);
  });
}
