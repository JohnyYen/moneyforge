import { err, ok, type Result } from '@/shared/result';

import {
  addPercents,
  compareToHundred,
  formatPercent,
  hundredMinus,
  parsePercent,
  readPercentOrZero,
  type Percent,
} from './percentage';
import { splitError, type SplitError } from './split-error';

export type SplitLine = {
  readonly label: string;
  readonly targetAccountId: string;
  /** Null only on the remainder line, whose share is whatever the others leave. */
  readonly percentage: string | null;
  readonly isRemainder: boolean;
};

export type SplitStructure = {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
  readonly lines: readonly SplitLine[];
};

const invalid = (message: string) => err(splitError('invalid-structure', message));

const fixedPercents = (lines: readonly SplitLine[]): Percent[] =>
  lines.filter((line) => !line.isRemainder).map((line) => readPercentOrZero(line.percentage ?? ''));

function checkTotal(lines: readonly SplitLine[], total: Percent): Result<void, SplitError> {
  const hasRemainder = lines.some((line) => line.isRemainder);
  const comparison = compareToHundred(total);
  if (hasRemainder && comparison >= 0) {
    return invalid('With a remainder line, the other lines must stay under 100%.');
  }
  if (!hasRemainder && comparison !== 0) {
    return invalid(`Percentages must total 100%. They total ${formatPercent(total)}%.`);
  }
  return ok(undefined);
}

function normalizeLine(line: SplitLine): Result<SplitLine, SplitError> {
  const label = line.label.trim();
  if (!label) return invalid('Give every line a label.');
  if (!line.targetAccountId) return invalid(`Choose a target account for ${label}.`);
  if (line.isRemainder) return ok({ ...line, label, percentage: null });
  const percent = parsePercent(line.percentage ?? '');
  if (!percent.ok) return percent;
  return ok({ ...line, label, percentage: formatPercent(percent.value) });
}

export function createSplitStructure(
  input: Omit<SplitStructure, 'name'> & { readonly name: string },
): Result<SplitStructure, SplitError> {
  const name = input.name.trim();
  if (!name) return invalid('Enter a structure name.');
  if (input.lines.length === 0) return invalid('Add at least one line.');
  if (input.lines.filter((line) => line.isRemainder).length > 1) {
    return invalid('Only one line can be the remainder.');
  }

  const lines: SplitLine[] = [];
  for (const line of input.lines) {
    const normalized = normalizeLine(line);
    if (!normalized.ok) return normalized;
    lines.push(normalized.value);
  }
  const total = checkTotal(lines, addPercents(fixedPercents(lines)));
  if (!total.ok) return total;
  return ok({ id: input.id, name, active: input.active, lines });
}

/** Fills the remainder line with its exact share, so every line has a percentage. */
export function resolveLines(lines: readonly SplitLine[]): (SplitLine & { percentage: string })[] {
  const rest = formatPercent(hundredMinus(addPercents(fixedPercents(lines))));
  return lines.map((line) => ({
    ...line,
    percentage: line.isRemainder ? rest : (line.percentage ?? '0'),
  }));
}

export type LinesSummary = {
  readonly total: string;
  readonly remainder: string | null;
  readonly missing: string | null;
  readonly excess: string | null;
};

/** The live total of an editor, for lines that may still be half typed. */
export function summarizeLines(lines: readonly SplitLine[]): LinesSummary {
  const fixed = addPercents(fixedPercents(lines));
  const hasRemainder = lines.some((line) => line.isRemainder);
  const comparison = compareToHundred(fixed);
  const gap = hundredMinus(fixed);
  const under = comparison < 0;
  return {
    total: hasRemainder && under ? '100' : formatPercent(fixed),
    remainder: hasRemainder && under ? formatPercent(gap) : null,
    missing: !hasRemainder && under ? formatPercent(gap) : null,
    excess: comparison > 0 ? formatPercent({ ...gap, units: -gap.units }) : null,
  };
}
