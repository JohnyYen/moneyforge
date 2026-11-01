import {
  summarizeLines,
  type LinesSummary,
  type SplitLine,
  type SplitStructure,
} from '../domain/split-structure';

export type DraftLine = {
  readonly key: string;
  readonly label: string;
  readonly targetAccountId: string | null;
  readonly percentage: string;
  readonly isRemainder: boolean;
};

export type StructureDraft = {
  readonly name: string;
  readonly lines: readonly DraftLine[];
  readonly nextKey: number;
};

const blankLine = (key: number): DraftLine => ({
  key: String(key),
  label: '',
  targetAccountId: null,
  percentage: '',
  isRemainder: false,
});

export function emptyDraft(): StructureDraft {
  return { name: '', lines: [blankLine(0)], nextKey: 1 };
}

export function toDraft(structure: SplitStructure): StructureDraft {
  return {
    name: structure.name,
    lines: structure.lines.map((line, index) => ({
      key: String(index),
      label: line.label,
      targetAccountId: line.targetAccountId,
      percentage: line.percentage ?? '',
      isRemainder: line.isRemainder,
    })),
    nextKey: structure.lines.length,
  };
}

export function addDraftLine(draft: StructureDraft): StructureDraft {
  return {
    ...draft,
    lines: [...draft.lines, blankLine(draft.nextKey)],
    nextKey: draft.nextKey + 1,
  };
}

export function removeDraftLine(draft: StructureDraft, key: string): StructureDraft {
  return { ...draft, lines: draft.lines.filter((line) => line.key !== key) };
}

export function updateDraftLine(
  draft: StructureDraft,
  key: string,
  change: Partial<Omit<DraftLine, 'key'>>,
): StructureDraft {
  return {
    ...draft,
    lines: draft.lines.map((line) => (line.key === key ? { ...line, ...change } : line)),
  };
}

export function toggleRemainder(draft: StructureDraft, key: string): StructureDraft {
  return {
    ...draft,
    lines: draft.lines.map((line) => ({
      ...line,
      isRemainder: line.key === key && !line.isRemainder,
    })),
  };
}

const toLines = (draft: StructureDraft): SplitLine[] =>
  draft.lines.map(({ label, targetAccountId, percentage, isRemainder }) => ({
    label,
    targetAccountId: targetAccountId ?? '',
    percentage: isRemainder ? null : percentage,
    isRemainder,
  }));

export function toStructureInput(draft: StructureDraft) {
  return { name: draft.name, lines: toLines(draft) };
}

export function draftTotal(draft: StructureDraft): string {
  return describeTotal(summarizeLines(toLines(draft)));
}

export function describeTotal({ total, remainder, missing, excess }: LinesSummary): string {
  const prefix = `Total ${total}%`;
  if (remainder) return `${prefix}, remainder ${remainder}%`;
  if (missing) return `${prefix}, ${missing}% still to assign`;
  if (excess) return `${prefix}, ${excess}% too much`;
  return prefix;
}
