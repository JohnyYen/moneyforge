import { createSplitStructure, resolveLines, summarizeLines, type SplitLine } from './split-structure';

const line = (percentage: string | null, isRemainder = false, label = 'Line'): SplitLine => ({
  label,
  targetAccountId: 'account',
  percentage,
  isRemainder,
});

const build = (lines: readonly SplitLine[], name = 'Salary') =>
  createSplitStructure({ id: 's1', name, active: true, lines });

describe('split structure', () => {
  it('accepts lines totaling exactly 100', () => {
    expect(build([line('33.33'), line('33.33'), line('33.34')]).ok).toBe(true);
  });

  it('rejects lines that miss 100 with no remainder', () => {
    expect(build([line('50'), line('49.99')])).toMatchObject({
      ok: false,
      error: { code: 'invalid-structure' },
    });
    expect(build([line('50'), line('50.01')]).ok).toBe(false);
  });

  it('accepts a remainder line while the rest stays under 100', () => {
    const structure = build([line('60'), line(null, true)]);
    expect(structure.ok).toBe(true);
  });

  it('rejects a remainder line with nothing left for it', () => {
    expect(build([line('100'), line(null, true)]).ok).toBe(false);
    expect(build([line('70'), line('40'), line(null, true)]).ok).toBe(false);
  });

  it('rejects two remainder lines', () => {
    expect(build([line('10'), line(null, true), line(null, true)]).ok).toBe(false);
  });

  it('ignores a percentage typed on the remainder line', () => {
    const structure = build([line('60'), line('5', true)]);
    expect(structure).toMatchObject({ ok: true, value: { lines: [{}, { percentage: null }] } });
  });

  it('needs a name, lines, labels, and targets', () => {
    expect(build([line('100')], '  ').ok).toBe(false);
    expect(build([]).ok).toBe(false);
    expect(build([line('100', false, ' ')]).ok).toBe(false);
    expect(build([{ ...line('100'), targetAccountId: '' }]).ok).toBe(false);
  });

  it('rejects a non-remainder line with no percentage', () => {
    expect(build([line(null)]).ok).toBe(false);
  });

  it('normalizes names, labels, and percentages', () => {
    const structure = build([line('100.0', false, ' Savings ')], ' Salary ');
    expect(structure).toMatchObject({
      ok: true,
      value: { name: 'Salary', lines: [{ label: 'Savings', percentage: '100' }] },
    });
  });

  it('resolves the remainder to an exact percentage', () => {
    const resolved = resolveLines([line('33.3'), line(null, true), line('0.05')]);
    expect(resolved.map(({ percentage }) => percentage)).toEqual(['33.3', '66.65', '0.05']);
  });

  describe('summary for the live total', () => {
    it('reports a complete structure', () => {
      expect(summarizeLines([line('50'), line('50')])).toEqual({
        total: '100',
        remainder: null,
        missing: null,
        excess: null,
      });
    });

    it('reports what is missing', () => {
      expect(summarizeLines([line('50'), line('20.5')])).toMatchObject({
        total: '70.5',
        missing: '29.5',
      });
    });

    it('reports what is over', () => {
      expect(summarizeLines([line('90'), line('20')])).toMatchObject({
        total: '110',
        excess: '10',
      });
    });

    it('reports the remainder share', () => {
      expect(summarizeLines([line('90'), line(null, true)])).toMatchObject({
        total: '100',
        remainder: '10',
        missing: null,
      });
    });

    it('treats unfinished text as zero while typing', () => {
      expect(summarizeLines([line('50'), line('abc'), line('')])).toMatchObject({ total: '50' });
    });
  });
});
