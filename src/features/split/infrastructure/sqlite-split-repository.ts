import type { SqlExecutor } from '@/shared/persistence/sql-driver';

import type { SplitDefault, SplitDefaultScope, SplitRepository } from '../application/ports';
import type { MoveStatus, PendingMove, SplitRun, SplitRunLine } from '../domain/split-run';
import type { SplitLine, SplitStructure } from '../domain/split-structure';

type StructureRow = { id: string; name: string; active: number };

type StructureLineRow = {
  structure_id: string;
  label: string;
  target_account_id: string;
  percentage: string | null;
  is_remainder: number;
};

type DefaultRow = { scope: SplitDefaultScope; scope_id: string; structure_id: string };

type RunRow = {
  id: string;
  transaction_id: string;
  structure_id: string;
  structure_name: string;
  source_account_id: string;
  currency_code: string;
  amount: string;
  created_at: string;
};

type RunLineRow = {
  position: number;
  label: string;
  target_account_id: string;
  percentage: string;
  is_remainder: number;
  amount: string;
};

type MoveRow = {
  id: string;
  run_id: string;
  position: number;
  label: string;
  from_account_id: string;
  to_account_id: string;
  amount: string;
  currency_code: string;
  status: MoveStatus;
  ledger_transaction_id: string | null;
};

const toLine = (row: StructureLineRow): SplitLine => ({
  label: row.label,
  targetAccountId: row.target_account_id,
  percentage: row.percentage,
  isRemainder: row.is_remainder === 1,
});

const toRunLine = (row: RunLineRow): SplitRunLine => ({
  position: row.position,
  label: row.label,
  targetAccountId: row.target_account_id,
  percentage: row.percentage,
  isRemainder: row.is_remainder === 1,
  amount: BigInt(row.amount),
});

const toMove = (row: MoveRow): PendingMove => ({
  id: row.id,
  runId: row.run_id,
  position: row.position,
  label: row.label,
  fromAccountId: row.from_account_id,
  toAccountId: row.to_account_id,
  amount: BigInt(row.amount),
  currencyCode: row.currency_code,
  status: row.status,
  ledgerTransactionId: row.ledger_transaction_id,
});

export function createSqliteSplitRepository(sql: SqlExecutor): SplitRepository {
  const loadLines = async (structureId: string) =>
    (
      await sql.all<StructureLineRow>(
        'SELECT * FROM split_structure_lines WHERE structure_id = ? ORDER BY position',
        [structureId],
      )
    ).map(toLine);

  const toStructure = async (row: StructureRow): Promise<SplitStructure> => ({
    id: row.id,
    name: row.name,
    active: row.active === 1,
    lines: await loadLines(row.id),
  });

  const insertRunLine = (tx: SqlExecutor, runId: string, line: SplitRunLine) =>
    tx.run(
      `INSERT INTO split_run_lines
         (run_id, position, label, target_account_id, percentage, is_remainder, amount)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        runId,
        line.position,
        line.label,
        line.targetAccountId,
        line.percentage,
        line.isRemainder ? 1 : 0,
        line.amount.toString(),
      ],
    );

  const insertMove = (tx: SqlExecutor, move: PendingMove) =>
    tx.run(
      `INSERT INTO pending_moves (id, run_id, position, label, from_account_id, to_account_id,
         amount, currency_code, status, ledger_transaction_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        move.id,
        move.runId,
        move.position,
        move.label,
        move.fromAccountId,
        move.toAccountId,
        move.amount.toString(),
        move.currencyCode,
        move.status,
        move.ledgerTransactionId,
      ],
    );

  return {
    listStructures: async () => {
      const rows = await sql.all<StructureRow>(
        'SELECT * FROM split_structures ORDER BY active DESC, name, id',
      );
      const structures: SplitStructure[] = [];
      for (const row of rows) structures.push(await toStructure(row));
      return structures;
    },

    getStructure: async (id) => {
      const row = await sql.get<StructureRow>('SELECT * FROM split_structures WHERE id = ?', [id]);
      return row ? toStructure(row) : null;
    },

    saveStructure: (structure) =>
      sql.transaction(async (tx) => {
        await tx.run(
          `INSERT INTO split_structures (id, name, active) VALUES (?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET name = excluded.name, active = excluded.active`,
          [structure.id, structure.name, structure.active ? 1 : 0],
        );
        await tx.run('DELETE FROM split_structure_lines WHERE structure_id = ?', [structure.id]);
        let position = 0;
        for (const line of structure.lines) {
          await tx.run(
            `INSERT INTO split_structure_lines
               (structure_id, position, label, target_account_id, percentage, is_remainder)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
              structure.id,
              position,
              line.label,
              line.targetAccountId,
              line.percentage,
              line.isRemainder ? 1 : 0,
            ],
          );
          position += 1;
        }
      }),

    listDefaults: async () =>
      (await sql.all<DefaultRow>('SELECT * FROM split_defaults ORDER BY scope, scope_id')).map(
        (row): SplitDefault => ({
          scope: row.scope,
          scopeId: row.scope_id,
          structureId: row.structure_id,
        }),
      ),

    getDefault: async (scope, scopeId) =>
      (
        await sql.get<DefaultRow>(
          'SELECT * FROM split_defaults WHERE scope = ? AND scope_id = ?',
          [scope, scopeId],
        )
      )?.structure_id ?? null,

    setDefault: ({ scope, scopeId, structureId }) =>
      sql.run(
        `INSERT INTO split_defaults (scope, scope_id, structure_id) VALUES (?, ?, ?)
         ON CONFLICT (scope, scope_id) DO UPDATE SET structure_id = excluded.structure_id`,
        [scope, scopeId, structureId],
      ),

    clearDefault: (scope, scopeId) =>
      sql.run('DELETE FROM split_defaults WHERE scope = ? AND scope_id = ?', [scope, scopeId]),

    saveRun: (run, moves) =>
      sql.transaction(async (tx) => {
        await tx.run(
          `INSERT INTO split_runs (id, transaction_id, structure_id, structure_name,
             source_account_id, currency_code, amount, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            run.id,
            run.transactionId,
            run.structureId,
            run.structureName,
            run.sourceAccountId,
            run.currencyCode,
            run.amount.toString(),
            run.createdAt,
          ],
        );
        for (const line of run.lines) await insertRunLine(tx, run.id, line);
        for (const move of moves) await insertMove(tx, move);
      }),

    removeRun: (id) => sql.run('DELETE FROM split_runs WHERE id = ?', [id]),

    getRunForTransaction: async (transactionId) => {
      const row = await sql.get<RunRow>('SELECT * FROM split_runs WHERE transaction_id = ?', [
        transactionId,
      ]);
      if (!row) return null;
      const lines = await sql.all<RunLineRow>(
        'SELECT * FROM split_run_lines WHERE run_id = ? ORDER BY position',
        [row.id],
      );
      const run: SplitRun = {
        id: row.id,
        transactionId: row.transaction_id,
        structureId: row.structure_id,
        structureName: row.structure_name,
        sourceAccountId: row.source_account_id,
        currencyCode: row.currency_code,
        amount: BigInt(row.amount),
        createdAt: row.created_at,
        lines: lines.map(toRunLine),
      };
      return run;
    },

    listMoves: async (runId) =>
      (
        await sql.all<MoveRow>('SELECT * FROM pending_moves WHERE run_id = ? ORDER BY position', [
          runId,
        ])
      ).map(toMove),

    listPendingMoves: async () =>
      (
        await sql.all<MoveRow>(
          `SELECT m.* FROM pending_moves m JOIN split_runs r ON r.id = m.run_id
           WHERE m.status = 'pending' ORDER BY r.created_at, m.run_id, m.position`,
        )
      ).map(toMove),

    countPendingMoves: async () =>
      (
        await sql.get<{ total: number }>(
          `SELECT COUNT(*) AS total FROM pending_moves WHERE status = 'pending'`,
        )
      )?.total ?? 0,

    getMove: async (id) => {
      const row = await sql.get<MoveRow>('SELECT * FROM pending_moves WHERE id = ?', [id]);
      return row ? toMove(row) : null;
    },

    getMoveByLedgerTransaction: async (transactionId) => {
      const row = await sql.get<MoveRow>(
        'SELECT * FROM pending_moves WHERE ledger_transaction_id = ?',
        [transactionId],
      );
      return row ? toMove(row) : null;
    },

    markMoveDone: (id, ledgerTransactionId) =>
      sql.run(`UPDATE pending_moves SET status = 'done', ledger_transaction_id = ? WHERE id = ?`, [
        ledgerTransactionId,
        id,
      ]),

    markMoveSkipped: (id) =>
      sql.run(`UPDATE pending_moves SET status = 'skipped' WHERE id = ?`, [id]),

    markMovePending: (id) =>
      sql.run(
        `UPDATE pending_moves SET status = 'pending', ledger_transaction_id = NULL WHERE id = ?`,
        [id],
      ),
  };
}
