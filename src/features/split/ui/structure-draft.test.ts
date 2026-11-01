import {
  addDraftLine,
  describeTotal,
  emptyDraft,
  removeDraftLine,
  toDraft,
  toggleRemainder,
  toStructureInput,
} from './structure-draft';

describe('structure draft', () => {
  it('starts with one blank line', () => {
    expect(emptyDraft().lines).toHaveLength(1);
  });

  it('gives each line a distinct key, even after removals', () => {
    const start = addDraftLine(addDraftLine(emptyDraft()));
    const removed = removeDraftLine(start, start.lines[1].key);
    const grown = addDraftLine(removed);

    expect(new Set(grown.lines.map(({ key }) => key)).size).toBe(3);
  });

  it('keeps at most one remainder line', () => {
    const draft = addDraftLine(emptyDraft());
    const [first, second] = draft.lines;

    const one = toggleRemainder(draft, first.key);
    const moved = toggleRemainder(one, second.key);
    const none = toggleRemainder(moved, second.key);

    expect(one.lines.map(({ isRemainder }) => isRemainder)).toEqual([true, false]);
    expect(moved.lines.map(({ isRemainder }) => isRemainder)).toEqual([false, true]);
    expect(none.lines.map(({ isRemainder }) => isRemainder)).toEqual([false, false]);
  });

  it('turns into structure input, dropping the percentage of the remainder', () => {
    const draft = toggleRemainder(
      {
        ...emptyDraft(),
        name: 'Salary',
        lines: [
          { key: 'a', label: 'Save', targetAccountId: 'one', percentage: '60', isRemainder: false },
          { key: 'b', label: 'Rest', targetAccountId: null, percentage: '5', isRemainder: false },
        ],
      },
      'b',
    );

    expect(toStructureInput(draft)).toEqual({
      name: 'Salary',
      lines: [
        { label: 'Save', targetAccountId: 'one', percentage: '60', isRemainder: false },
        { label: 'Rest', targetAccountId: '', percentage: null, isRemainder: true },
      ],
    });
  });

  it('reads a saved structure back', () => {
    const draft = toDraft({
      id: 's1',
      name: 'Salary',
      active: true,
      lines: [{ label: 'Rest', targetAccountId: 'one', percentage: null, isRemainder: true }],
    });

    expect(draft.name).toBe('Salary');
    expect(draft.lines[0]).toMatchObject({ label: 'Rest', percentage: '', isRemainder: true });
  });

  describe('live total', () => {
    it.each([
      [{ total: '100', remainder: null, missing: null, excess: null }, 'Total 100%'],
      [{ total: '100', remainder: '12.5', missing: null, excess: null }, 'Total 100%, remainder 12.5%'],
      [{ total: '70', remainder: null, missing: '30', excess: null }, 'Total 70%, 30% still to assign'],
      [{ total: '110', remainder: null, missing: null, excess: '10' }, 'Total 110%, 10% too much'],
    ])('describes %j', (summary, text) => {
      expect(describeTotal(summary)).toBe(text);
    });
  });
});
