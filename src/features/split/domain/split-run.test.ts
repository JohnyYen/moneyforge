import { createSplitRun, hasDoneMoves, type SplitRunInput } from './split-run';
import type { SplitStructure } from './split-structure';

const structure: SplitStructure = {
  id: 's1',
  name: 'Salary',
  active: true,
  lines: [
    { label: 'Stay', targetAccountId: 'income-account', percentage: '50', isRemainder: false },
    { label: 'Savings', targetAccountId: 'savings', percentage: '30', isRemainder: false },
    { label: 'Fun', targetAccountId: 'fun', percentage: null, isRemainder: true },
  ],
};

let nextId = 0;
const input = (overrides: Partial<SplitRunInput> = {}): SplitRunInput => ({
  id: 'run',
  transactionId: 'tx',
  structure,
  sourceAccountId: 'income-account',
  currencyCode: 'USD',
  amount: 1000n,
  createdAt: '2026-03-10T12:00:00.000Z',
  generateId: () => `move-${++nextId}`,
  ...overrides,
});

describe('createSplitRun', () => {
  beforeEach(() => {
    nextId = 0;
  });

  it('snapshots every line with its resolved percentage and amount', () => {
    const { run } = createSplitRun(input());

    expect(run.structureName).toBe('Salary');
    expect(run.lines).toEqual([
      expect.objectContaining({ position: 0, label: 'Stay', percentage: '50', amount: 500n }),
      expect.objectContaining({ position: 1, label: 'Savings', percentage: '30', amount: 300n }),
      expect.objectContaining({
        position: 2,
        label: 'Fun',
        targetAccountId: 'fun',
        percentage: '20',
        isRemainder: true,
        amount: 200n,
      }),
    ]);
  });

  it('yields no move for a line that stays in the income account', () => {
    const { moves } = createSplitRun(input());

    expect(moves.map(({ label }) => label)).toEqual(['Savings', 'Fun']);
    expect(moves[0]).toEqual({
      id: 'move-1',
      runId: 'run',
      position: 1,
      label: 'Savings',
      fromAccountId: 'income-account',
      toAccountId: 'savings',
      amount: 300n,
      currencyCode: 'USD',
      status: 'pending',
      ledgerTransactionId: null,
    });
  });

  it('yields no move for a line allocated nothing', () => {
    const { run, moves } = createSplitRun(input({ amount: 1n }));

    expect(run.lines.map(({ amount }) => amount)).toEqual([1n, 0n, 0n]);
    expect(moves).toEqual([]);
  });

  it('allocates the whole income across lines', () => {
    const { run } = createSplitRun(input({ amount: 999n }));

    expect(run.lines.reduce((total, { amount }) => total + amount, 0n)).toBe(999n);
  });

  it('tells when any move is done', () => {
    const { moves } = createSplitRun(input());

    expect(hasDoneMoves(moves)).toBe(false);
    expect(hasDoneMoves([{ ...moves[0], status: 'skipped' }])).toBe(false);
    expect(hasDoneMoves([moves[0], { ...moves[1], status: 'done' }])).toBe(true);
  });
});
