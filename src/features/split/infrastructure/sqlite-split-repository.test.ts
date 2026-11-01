import { createSqliteLedgerStore } from '@/features/ledger/infrastructure/sqlite-ledger-store';
import { migrations } from '@/shared/persistence/migrations';
import { runMigrations } from '@/shared/persistence/migrator';
import { createNodeSqliteDriver } from '@/shared/persistence/node-sqlite-driver';
import type { SqlDriver } from '@/shared/persistence/sql-driver';

import type { SplitRepository } from '../application/ports';
import { createSplitRun } from '../domain/split-run';
import type { SplitStructure } from '../domain/split-structure';
import { createSqliteSplitRepository } from './sqlite-split-repository';

const HUGE = 123456789012345678901234567890n;

const structure: SplitStructure = {
  id: 's1',
  name: 'Salary',
  active: true,
  lines: [
    { label: 'Save', targetAccountId: 'savings', percentage: '33.333', isRemainder: false },
    { label: 'Rest', targetAccountId: 'other', percentage: null, isRemainder: true },
  ],
};

describe('sqlite split repository', () => {
  let driver: SqlDriver;
  let repository: SplitRepository;
  let sequence: number;

  beforeEach(async () => {
    driver = createNodeSqliteDriver();
    await runMigrations(driver, migrations);
    repository = createSqliteSplitRepository(driver);
    sequence = 0;
    await driver.exec(`
      INSERT INTO currencies (code, name, decimals, symbol, kind)
        VALUES ('DAI', 'Dai', 18, 'DAI', 'stablecoin');
      INSERT INTO accounts (id, name, type, currency_code)
        VALUES ('checking', 'Checking', 'Bank', 'DAI'),
               ('savings', 'Savings', 'Bank', 'DAI'),
               ('other', 'Other', 'Bank', 'DAI');
      INSERT INTO transactions (id, occurred_at, kind, description)
        VALUES ('tx', '2026-03-10T12:00:00.000Z', 'income', ''),
               ('transfer', '2026-03-10T12:00:00.000Z', 'transfer', '');
    `);
    await repository.saveStructure(structure);
  });

  afterEach(() => driver.close());

  const plan = () =>
    createSplitRun({
      id: 'run',
      transactionId: 'tx',
      structure,
      sourceAccountId: 'checking',
      currencyCode: 'DAI',
      amount: HUGE,
      createdAt: '2026-03-10T12:00:00.000Z',
      generateId: () => `move-${++sequence}`,
    });

  it('round-trips a structure and replaces its lines on save', async () => {
    await expect(repository.getStructure('s1')).resolves.toEqual(structure);

    const edited = { ...structure, name: 'Edited', active: false, lines: [structure.lines[1]] };
    await repository.saveStructure(edited);

    await expect(repository.getStructure('s1')).resolves.toEqual(edited);
    await expect(repository.listStructures()).resolves.toEqual([edited]);
    await expect(repository.getStructure('missing')).resolves.toBeNull();
  });

  it('round-trips a run and its moves past the safe integer range', async () => {
    const { run, moves } = plan();
    await repository.saveRun(run, moves);

    await expect(repository.getRunForTransaction('tx')).resolves.toEqual(run);
    await expect(repository.listMoves('run')).resolves.toEqual(moves);
    await expect(repository.getMove(moves[0].id)).resolves.toEqual(moves[0]);
    await expect(repository.getRunForTransaction('transfer')).resolves.toBeNull();
    await expect(repository.getMove('missing')).resolves.toBeNull();
  });

  it('keeps defaults, one per scope', async () => {
    const entry = { scope: 'account', scopeId: 'checking', structureId: 's1' } as const;
    await repository.setDefault(entry);
    await repository.setDefault(entry);

    await expect(repository.listDefaults()).resolves.toEqual([entry]);
    await expect(repository.getDefault('account', 'checking')).resolves.toBe('s1');
    await expect(repository.getDefault('category', 'checking')).resolves.toBeNull();

    await repository.clearDefault('account', 'checking');
    await expect(repository.listDefaults()).resolves.toEqual([]);
  });

  it('tracks a move through its statuses', async () => {
    const { run, moves } = plan();
    await repository.saveRun(run, moves);
    const [move] = moves;

    await repository.markMoveDone(move.id, 'transfer');
    await expect(repository.getMoveByLedgerTransaction('transfer')).resolves.toMatchObject({
      id: move.id,
      status: 'done',
    });

    await repository.markMovePending(move.id);
    await expect(repository.getMove(move.id)).resolves.toMatchObject({
      status: 'pending',
      ledgerTransactionId: null,
    });

    await repository.markMoveSkipped(move.id);
    await expect(repository.countPendingMoves()).resolves.toBe(moves.length - 1);
    await expect(repository.getMoveByLedgerTransaction('transfer')).resolves.toBeNull();
  });

  it('removes a run with its lines and moves', async () => {
    const { run, moves } = plan();
    await repository.saveRun(run, moves);

    await repository.removeRun('run');

    await expect(repository.getRunForTransaction('tx')).resolves.toBeNull();
    await expect(driver.all('SELECT 1 FROM split_run_lines')).resolves.toEqual([]);
    await expect(repository.listMoves('run')).resolves.toEqual([]);
  });

  describe('schema backstops', () => {
    it('refuses a second run for one transaction', async () => {
      const { run } = plan();
      await repository.saveRun(run, []);

      await expect(repository.saveRun({ ...run, id: 'run-2', lines: [] }, [])).rejects.toThrow();
    });

    it('refuses to delete an income that still has a run', async () => {
      const { run, moves } = plan();
      await repository.saveRun(run, moves);
      const store = createSqliteLedgerStore(driver);

      await expect(store.journal.remove('tx')).rejects.toThrow();
    });

    it('refuses to delete a transaction still linked to a move', async () => {
      const { run, moves } = plan();
      await repository.saveRun(run, moves);
      await repository.markMoveDone(moves[0].id, 'transfer');
      const store = createSqliteLedgerStore(driver);

      await expect(store.journal.remove('transfer')).rejects.toThrow();
    });

    it('refuses a done move with no linked transaction', async () => {
      const { run, moves } = plan();
      await repository.saveRun(run, moves);

      await expect(
        driver.run(`UPDATE pending_moves SET status = 'done' WHERE id = ?`, [moves[0].id]),
      ).rejects.toThrow();
    });
  });
});
