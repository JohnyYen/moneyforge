import { createAppServices, type AppServices } from '@/app-services/create-app-services';
import { systemAccountId, type Account } from '@/features/ledger/domain/account';
import { migrations } from '@/shared/persistence/migrations';
import { runMigrations } from '@/shared/persistence/migrator';
import { createNodeSqliteDriver } from '@/shared/persistence/node-sqlite-driver';
import type { SqlDriver, SqlExecutor } from '@/shared/persistence/sql-driver';
import type { Result } from '@/shared/result';

import type { SplitLine } from '../domain/split-structure';

function unwrap<T>(result: Result<T, { code: string; message: string }>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

/** Fails any write whose SQL matches, including inside a transaction. */
function failingOn(driver: SqlDriver, pattern: RegExp): SqlExecutor {
  const wrap = (sql: SqlExecutor): SqlExecutor => ({
    exec: (text) => sql.exec(text),
    all: (text, params) => sql.all(text, params),
    get: (text, params) => sql.get(text, params),
    run: async (text, params) => {
      if (pattern.test(text)) throw new Error('disk failure');
      await sql.run(text, params);
    },
    transaction: (work) => sql.transaction((tx) => work(wrap(tx))),
  });
  return wrap(driver);
}

describe('income split', () => {
  let driver: SqlDriver;
  let services: AppServices;
  let sequence: number;

  const servicesOn = (sql: SqlExecutor) =>
    createAppServices({
      driver: sql,
      clock: { now: () => new Date('2026-03-10T12:00:00.000Z') },
      generateId: () => `id-${++sequence}`,
    });

  beforeEach(async () => {
    driver = createNodeSqliteDriver();
    await runMigrations(driver, migrations);
    sequence = 0;
    services = servicesOn(driver);
    await services.ledger.initialize();
  });

  afterEach(() => driver.close());

  const account = async (name: string, currencyCode = 'USD', openingBalance = '0') =>
    unwrap(
      await services.ledger.createAccount({ name, type: 'Bank', currencyCode, openingBalance }),
    );

  const archiveAccount = async ({ id, name, type }: Account) =>
    unwrap(
      await services.ledger.updateAccount({ id, name, type, openingBalance: '0', archived: true }),
    );

  const balanceOf = async (id: string) =>
    (await services.ledger.accountBalances()).find((item) => item.account.id === id)?.balance;

  const incomeCategory = async () => {
    const found = (await services.ledger.listCategories()).find(({ kind }) => kind === 'income');
    if (!found) throw new Error('No income category');
    return found;
  };

  const line = (
    label: string,
    targetAccountId: string,
    percentage: string | null,
    isRemainder = false,
  ): SplitLine => ({ label, targetAccountId, percentage, isRemainder });

  const income = async (accountId: string, amount = '1000.00', categoryId?: string) =>
    unwrap(await services.ledger.recordIncome({ accountId, amount, categoryId }));

  const allPostingsBalance = async () => {
    const rows = await driver.all<{ amount: string; currency_code: string }>(
      'SELECT amount, currency_code FROM postings',
    );
    const totals: Record<string, bigint> = {};
    for (const row of rows) {
      totals[row.currency_code] = (totals[row.currency_code] ?? 0n) + BigInt(row.amount);
    }
    return Object.values(totals).every((total) => total === 0n);
  };

  /** Checking receives income; 60% goes to savings, the rest to euros. */
  const scenario = async () => {
    const checking = await account('Checking');
    const savings = await account('Savings');
    const euros = await account('Euros', 'EUR');
    const structure = unwrap(
      await services.split.createStructure({
        name: 'Salary',
        lines: [line('Savings', savings.id, '60'), line('Euros', euros.id, null, true)],
      }),
    );
    const transaction = await income(checking.id);
    return { checking, savings, euros, structure, transaction };
  };

  const applied = async () => {
    const setup = await scenario();
    const details = unwrap(
      await services.split.applyStructure({
        transactionId: setup.transaction.id,
        structureId: setup.structure.id,
      }),
    );
    const [toSavings, toEuros] = details.moves;
    return { ...setup, ...details, toSavings, toEuros };
  };

  const entryFor = (accountId: string, amount: string, description = '') =>
    ({ kind: 'income', accountId, amount, description }) as const;

  describe('structures', () => {
    it('rejects a target that is a system account or does not exist', async () => {
      const result = await services.split.createStructure({
        name: 'Bad',
        lines: [line('Income', systemAccountId('USD', 'income'), '100')],
      });
      expect(result).toMatchObject({ ok: false, error: { code: 'not-found' } });

      expect(
        await services.split.createStructure({
          name: 'Bad',
          lines: [line('Gone', 'missing', '100')],
        }),
      ).toMatchObject({ ok: false, error: { code: 'not-found' } });
    });

    it('rejects an archived target', async () => {
      const closed = await account('Closed');
      await archiveAccount(closed);

      const result = await services.split.createStructure({
        name: 'Bad',
        lines: [line('Closed', closed.id, '100')],
      });

      expect(result).toMatchObject({ ok: false, error: { code: 'account-archived' } });
    });

    it('edits and archives', async () => {
      const { structure, savings } = await scenario();

      unwrap(
        await services.split.updateStructure({
          id: structure.id,
          name: 'Bonus',
          lines: [line('All', savings.id, '100')],
        }),
      );
      unwrap(await services.split.setStructureActive(structure.id, false));

      await expect(services.split.getStructure(structure.id)).resolves.toMatchObject({
        name: 'Bonus',
        active: false,
        lines: [{ label: 'All', percentage: '100' }],
      });
    });

    it('does not edit a missing structure', async () => {
      const savings = await account('Savings');
      const result = await services.split.updateStructure({
        id: 'missing',
        name: 'x',
        lines: [line('All', savings.id, '100')],
      });
      expect(result).toMatchObject({ ok: false, error: { code: 'not-found' } });
    });
  });

  describe('applying', () => {
    it('records the plan and moves no money', async () => {
      const { checking, savings, run, moves, transaction } = await applied();

      expect(run.transactionId).toBe(transaction.id);
      expect(run.lines.map(({ amount }) => amount)).toEqual([60000n, 40000n]);
      expect(moves.map(({ status }) => status)).toEqual(['pending', 'pending']);
      await expect(balanceOf(checking.id)).resolves.toBe(100000n);
      await expect(balanceOf(savings.id)).resolves.toBe(0n);
    });

    it('rejects a second run for the same income', async () => {
      const { transaction, structure } = await applied();

      const again = await services.split.applyStructure({
        transactionId: transaction.id,
        structureId: structure.id,
      });

      expect(again).toMatchObject({ ok: false, error: { code: 'already-split' } });
      const runs = await driver.all('SELECT id FROM split_runs');
      expect(runs).toHaveLength(1);
    });

    it('rejects a concurrent second run too', async () => {
      const { transaction, structure } = await scenario();
      const apply = () =>
        services.split.applyStructure({
          transactionId: transaction.id,
          structureId: structure.id,
        });

      const results = await Promise.all([apply(), apply()]);

      expect(results.filter(({ ok }) => ok)).toHaveLength(1);
    });

    it('applies only to income', async () => {
      const { checking, savings, structure } = await scenario();
      const expense = unwrap(
        await services.ledger.recordExpense({ accountId: checking.id, amount: '1' }),
      );
      const transfer = unwrap(
        await services.ledger.recordTransfer({
          fromAccountId: checking.id,
          toAccountId: savings.id,
          amount: '1',
        }),
      );

      for (const { id } of [expense, transfer]) {
        expect(
          await services.split.applyStructure({ transactionId: id, structureId: structure.id }),
        ).toMatchObject({ ok: false, error: { code: 'not-income' } });
      }
    });

    it('rejects an archived structure or a target archived since', async () => {
      const first = await scenario();
      await archiveAccount(first.savings);

      expect(
        await services.split.applyStructure({
          transactionId: first.transaction.id,
          structureId: first.structure.id,
        }),
      ).toMatchObject({ ok: false, error: { code: 'account-archived' } });

      unwrap(await services.split.setStructureActive(first.structure.id, false));
      expect(
        await services.split.applyStructure({
          transactionId: first.transaction.id,
          structureId: first.structure.id,
        }),
      ).toMatchObject({ ok: false, error: { code: 'structure-archived' } });
    });

    it('shows a line targeting the income account as allocated, with no move', async () => {
      const { checking, savings, transaction } = await scenario();
      const stay = unwrap(
        await services.split.createStructure({
          name: 'Mostly stay',
          lines: [line('Stay', checking.id, '75'), line('Save', savings.id, '25')],
        }),
      );

      const { run, moves } = unwrap(
        await services.split.applyStructure({
          transactionId: transaction.id,
          structureId: stay.id,
        }),
      );

      expect(run.lines.map(({ amount }) => amount)).toEqual([75000n, 25000n]);
      expect(moves.map(({ label }) => label)).toEqual(['Save']);
    });

    it('keeps a run unchanged when its structure is edited later', async () => {
      const { structure, savings, transaction } = await applied();

      unwrap(
        await services.split.updateStructure({
          id: structure.id,
          name: 'Renamed',
          lines: [line('All', savings.id, '100')],
        }),
      );

      const details = await services.split.splitDetails(transaction.id);
      expect(details?.run.structureName).toBe('Salary');
      expect(details?.run.lines).toMatchObject([
        { label: 'Savings', percentage: '60', amount: 60000n },
        { label: 'Euros', percentage: '40', isRemainder: true, amount: 40000n },
      ]);
    });
  });

  describe('proposal', () => {
    it('prefers the category default over the account default', async () => {
      const { checking, savings, structure } = await scenario();
      const other = unwrap(
        await services.split.createStructure({
          name: 'Other',
          lines: [line('All', savings.id, '100')],
        }),
      );
      const category = await incomeCategory();
      unwrap(
        await services.split.setSplitDefault({
          scope: 'account',
          scopeId: checking.id,
          structureId: structure.id,
        }),
      );
      const byAccount = await income(checking.id);
      expect(await services.split.splitProposal(byAccount.id)).toMatchObject({
        proposedStructureId: structure.id,
      });

      unwrap(
        await services.split.setSplitDefault({
          scope: 'category',
          scopeId: category.id,
          structureId: other.id,
        }),
      );
      const byCategory = await income(checking.id, '10', category.id);

      expect(await services.split.splitProposal(byCategory.id)).toMatchObject({
        proposedStructureId: other.id,
      });
    });

    it('offers every active structure with nothing proposed when no default applies', async () => {
      const { transaction, structure } = await scenario();

      const proposal = await services.split.splitProposal(transaction.id);

      expect(proposal?.proposedStructureId).toBeNull();
      expect(proposal?.structures.map(({ id }) => id)).toEqual([structure.id]);
      expect(proposal?.amount).toBe(100000n);
    });

    it('skips an archived default and clears a default on request', async () => {
      const { checking, structure, transaction } = await scenario();
      const setDefault = (structureId: string | null) =>
        services.split.setSplitDefault({ scope: 'account', scopeId: checking.id, structureId });

      unwrap(await setDefault(structure.id));
      unwrap(await setDefault(null));
      expect((await services.split.splitProposal(transaction.id))?.proposedStructureId).toBeNull();

      unwrap(await setDefault(structure.id));
      unwrap(await services.split.setStructureActive(structure.id, false));
      expect(await services.split.splitProposal(transaction.id)).toBeNull();
      expect(await setDefault(structure.id)).toMatchObject({
        ok: false,
        error: { code: 'structure-archived' },
      });
    });

    it('proposes nothing for other kinds, or an income already split', async () => {
      const { checking, transaction } = await applied();
      const expense = unwrap(
        await services.ledger.recordExpense({ accountId: checking.id, amount: '1' }),
      );

      expect(await services.split.splitProposal(transaction.id)).toBeNull();
      expect(await services.split.splitProposal(expense.id)).toBeNull();
    });
  });

  describe('completing a move', () => {
    it('records a transfer with the actual amount and fee, and links it', async () => {
      const { checking, savings, toSavings } = await applied();

      const { move, transaction } = unwrap(
        await services.split.completeMove({ moveId: toSavings.id, amount: '590', fee: '1.50' }),
      );

      expect(move).toMatchObject({ status: 'done', ledgerTransactionId: transaction.id });
      await expect(services.split.moveCompletedBy(transaction.id)).resolves.toMatchObject({
        id: toSavings.id,
      });
      expect(transaction.kind).toBe('transfer');
      await expect(balanceOf(checking.id)).resolves.toBe(100000n - 59150n);
      await expect(balanceOf(savings.id)).resolves.toBe(59000n);
      await expect(allPostingsBalance()).resolves.toBe(true);
    });

    it('defaults to the planned amount', async () => {
      const { savings, toSavings } = await applied();

      unwrap(await services.split.completeMove({ moveId: toSavings.id }));

      await expect(balanceOf(savings.id)).resolves.toBe(60000n);
    });

    it('records a conversion from the amount received', async () => {
      const { checking, euros, toEuros } = await applied();

      const { transaction } = unwrap(
        await services.split.completeMove({
          moveId: toEuros.id,
          amount: '400',
          targetAmount: '370.50',
          fee: '0.50',
          feeCurrency: 'EUR',
        }),
      );

      expect(transaction.kind).toBe('conversion');
      expect(transaction.metadata?.rate).toBe('0.92625');
      await expect(balanceOf(checking.id)).resolves.toBe(60000n);
      await expect(balanceOf(euros.id)).resolves.toBe(37000n);
      await expect(allPostingsBalance()).resolves.toBe(true);
    });

    it('keeps 18 decimal amounts exact through a conversion', async () => {
      const dai = await account('Dai', 'DAI');
      const dollars = await account('Dollars');
      const structure = unwrap(
        await services.split.createStructure({
          name: 'Cash out',
          lines: [line('Cash', dollars.id, '100')],
        }),
      );
      const transaction = await income(dai.id, '1234.123456789012345678');
      const { moves } = unwrap(
        await services.split.applyStructure({
          transactionId: transaction.id,
          structureId: structure.id,
        }),
      );

      unwrap(await services.split.completeMove({ moveId: moves[0].id, targetAmount: '1234.10' }));

      await expect(balanceOf(dai.id)).resolves.toBe(0n);
      await expect(balanceOf(dollars.id)).resolves.toBe(123410n);
      await expect(allPostingsBalance()).resolves.toBe(true);
    });

    it('stores a derived rate that a later edit still accepts', async () => {
      const { checking, euros, toEuros } = await applied();
      const { transaction } = unwrap(
        await services.split.completeMove({ moveId: toEuros.id, targetAmount: '333.33' }),
      );

      unwrap(
        await services.ledger.updateTransaction(transaction.id, {
          kind: 'conversion',
          fromAccountId: checking.id,
          toAccountId: euros.id,
          sourceAmount: '400',
          targetAmount: '333.33',
          rate: transaction.metadata?.rate ?? '',
        }),
      );

      await expect(balanceOf(euros.id)).resolves.toBe(33333n);
    });

    it('needs the amount received for a conversion', async () => {
      const { toEuros } = await applied();

      expect(await services.split.completeMove({ moveId: toEuros.id })).toMatchObject({
        ok: false,
        error: { code: 'invalid-amount' },
      });
    });

    it('rejects a stated rate that contradicts the amounts', async () => {
      const { toEuros } = await applied();

      const result = await services.split.completeMove({
        moveId: toEuros.id,
        targetAmount: '370',
        rate: '5',
      });

      expect(result).toMatchObject({ ok: false, error: { code: 'inconsistent-conversion' } });
    });

    it('rejects completing a move twice', async () => {
      const { toSavings } = await applied();
      unwrap(await services.split.completeMove({ moveId: toSavings.id }));

      expect(await services.split.completeMove({ moveId: toSavings.id })).toMatchObject({
        ok: false,
        error: { code: 'move-not-pending' },
      });
    });

    it('rolls back the transfer when linking fails midway', async () => {
      const { checking, savings, toSavings } = await applied();
      const broken = servicesOn(failingOn(driver, /UPDATE pending_moves/));

      await expect(broken.split.completeMove({ moveId: toSavings.id })).rejects.toThrow(
        'disk failure',
      );

      await expect(balanceOf(checking.id)).resolves.toBe(100000n);
      await expect(balanceOf(savings.id)).resolves.toBe(0n);
      await expect(driver.all('SELECT id FROM transactions')).resolves.toHaveLength(1);
      await expect(services.split.getMove(toSavings.id)).resolves.toMatchObject({
        status: 'pending',
        ledgerTransactionId: null,
      });
    });

    it('leaves nothing behind when a rule rejects the entry', async () => {
      const { toSavings } = await applied();

      expect(
        await services.split.completeMove({ moveId: toSavings.id, amount: '-5' }),
      ).toMatchObject({ ok: false });

      await expect(services.split.getMove(toSavings.id)).resolves.toMatchObject({
        status: 'pending',
      });
    });
  });

  describe('skipping and undoing', () => {
    it('skips a pending move, and counts only pending ones', async () => {
      const { toSavings, toEuros } = await applied();
      await expect(services.split.countPendingMoves()).resolves.toBe(2);

      unwrap(await services.split.skipMove(toSavings.id));

      await expect(services.split.countPendingMoves()).resolves.toBe(1);
      expect((await services.split.listPendingMoves()).map(({ id }) => id)).toEqual([toEuros.id]);
      expect(await services.split.skipMove(toSavings.id)).toMatchObject({
        ok: false,
        error: { code: 'move-not-pending' },
      });
    });

    it('undoes a completion by removing the ledger transaction', async () => {
      const { checking, savings, toSavings } = await applied();
      const { transaction } = unwrap(await services.split.completeMove({ moveId: toSavings.id }));

      unwrap(await services.split.undoMove(toSavings.id));

      await expect(services.ledger.getTransaction(transaction.id)).resolves.toBeNull();
      await expect(balanceOf(checking.id)).resolves.toBe(100000n);
      await expect(balanceOf(savings.id)).resolves.toBe(0n);
      await expect(services.split.getMove(toSavings.id)).resolves.toMatchObject({
        status: 'pending',
        ledgerTransactionId: null,
      });
    });

    it('rolls back an undo that fails midway', async () => {
      const { savings, toSavings } = await applied();
      unwrap(await services.split.completeMove({ moveId: toSavings.id }));
      const broken = servicesOn(failingOn(driver, /DELETE FROM transactions/));

      await expect(broken.split.undoMove(toSavings.id)).rejects.toThrow('disk failure');

      await expect(balanceOf(savings.id)).resolves.toBe(60000n);
      await expect(services.split.getMove(toSavings.id)).resolves.toMatchObject({ status: 'done' });
    });

    it('returns a skipped move to pending', async () => {
      const { toSavings } = await applied();
      unwrap(await services.split.skipMove(toSavings.id));

      unwrap(await services.split.undoMove(toSavings.id));

      await expect(services.split.getMove(toSavings.id)).resolves.toMatchObject({
        status: 'pending',
      });
    });

    it('has nothing to undo on a pending move', async () => {
      const { toSavings } = await applied();

      expect(await services.split.undoMove(toSavings.id)).toMatchObject({
        ok: false,
        error: { code: 'move-not-reversible' },
      });
    });
  });

  describe('guards on the income', () => {
    const edits = (checkingId: string, savingsId: string) => [
      ['amount', entryFor(checkingId, '999')],
      ['account', entryFor(savingsId, '1000')],
      ['kind', { ...entryFor(checkingId, '1000'), kind: 'expense' as const }],
    ] as const;

    it('refuses material edits and deletion while a move is done', async () => {
      const { checking, savings, toSavings, transaction } = await applied();
      unwrap(await services.split.completeMove({ moveId: toSavings.id }));

      for (const [, entry] of edits(checking.id, savings.id)) {
        expect(
          await services.ledger.updateTransaction(transaction.id, entry, { confirmed: true }),
        ).toMatchObject({ ok: false, error: { code: 'transaction-locked' } });
      }
      expect(
        await services.ledger.deleteTransaction(transaction.id, { confirmed: true }),
      ).toMatchObject({ ok: false, error: { code: 'transaction-locked' } });
      await expect(balanceOf(checking.id)).resolves.toBe(40000n);
      await expect(services.split.splitDetails(transaction.id)).resolves.not.toBeNull();
    });

    it('still allows editing what the split does not depend on', async () => {
      const { checking, toSavings, transaction } = await applied();
      unwrap(await services.split.completeMove({ moveId: toSavings.id }));
      const category = await incomeCategory();

      unwrap(
        await services.ledger.updateTransaction(transaction.id, {
          ...entryFor(checking.id, '1000', 'Salary, March'),
          categoryId: category.id,
          occurredAt: '2026-03-01T12:00:00.000Z',
        }),
      );

      await expect(services.ledger.getTransaction(transaction.id)).resolves.toMatchObject({
        description: 'Salary, March',
        categoryId: category.id,
      });
      await expect(services.split.splitDetails(transaction.id)).resolves.not.toBeNull();
    });

    it.each(['amount', 'account', 'kind'] as const)(
      'asks before a %s edit cancels a pending run, then cancels it',
      async (field) => {
        const { checking, savings, transaction } = await applied();
        const [, entry] = edits(checking.id, savings.id).find(([name]) => name === field)!;

        expect(await services.ledger.updateTransaction(transaction.id, entry)).toMatchObject({
          ok: false,
          error: { code: 'confirmation-required' },
        });
        await expect(services.split.splitDetails(transaction.id)).resolves.not.toBeNull();

        unwrap(await services.ledger.updateTransaction(transaction.id, entry, { confirmed: true }));

        await expect(services.split.splitDetails(transaction.id)).resolves.toBeNull();
        await expect(services.split.countPendingMoves()).resolves.toBe(0);
      },
    );

    it('asks before a delete cancels a pending run, then cancels it', async () => {
      const { transaction } = await applied();

      expect(await services.ledger.deleteTransaction(transaction.id)).toMatchObject({
        ok: false,
        error: { code: 'confirmation-required' },
      });
      await expect(services.ledger.getTransaction(transaction.id)).resolves.not.toBeNull();

      unwrap(await services.ledger.deleteTransaction(transaction.id, { confirmed: true }));

      await expect(services.ledger.getTransaction(transaction.id)).resolves.toBeNull();
      await expect(driver.all('SELECT id FROM split_runs')).resolves.toEqual([]);
      await expect(driver.all('SELECT id FROM pending_moves')).resolves.toEqual([]);
    });

    it('treats skipped moves like pending ones', async () => {
      const { toSavings, toEuros, transaction } = await applied();
      unwrap(await services.split.skipMove(toSavings.id));
      unwrap(await services.split.skipMove(toEuros.id));

      expect(await services.ledger.deleteTransaction(transaction.id)).toMatchObject({
        error: { code: 'confirmation-required' },
      });
      unwrap(await services.ledger.deleteTransaction(transaction.id, { confirmed: true }));
    });

    it('allows a new run after an edit canceled the old one', async () => {
      const { checking, structure, transaction } = await applied();
      unwrap(
        await services.ledger.updateTransaction(transaction.id, entryFor(checking.id, '500'), {
          confirmed: true,
        }),
      );

      const { run } = unwrap(
        await services.split.applyStructure({
          transactionId: transaction.id,
          structureId: structure.id,
        }),
      );

      expect(run.amount).toBe(50000n);
    });

    it('keeps the run when the confirmed delete fails midway', async () => {
      const { transaction } = await applied();
      const broken = servicesOn(failingOn(driver, /DELETE FROM transactions/));

      await expect(
        broken.ledger.deleteTransaction(transaction.id, { confirmed: true }),
      ).rejects.toThrow('disk failure');

      await expect(services.split.splitDetails(transaction.id)).resolves.not.toBeNull();
    });
  });

  describe('guards on a linked transfer', () => {
    it('returns the move to pending when the transfer is deleted', async () => {
      const { savings, toSavings } = await applied();
      const { transaction } = unwrap(await services.split.completeMove({ moveId: toSavings.id }));

      unwrap(await services.ledger.deleteTransaction(transaction.id));

      await expect(services.split.getMove(toSavings.id)).resolves.toMatchObject({
        status: 'pending',
        ledgerTransactionId: null,
      });
      await expect(balanceOf(savings.id)).resolves.toBe(0n);

      unwrap(await services.split.completeMove({ moveId: toSavings.id }));
    });

    it('unlocks the income once its only done move is reverted', async () => {
      const { toSavings, transaction } = await applied();
      const completed = unwrap(await services.split.completeMove({ moveId: toSavings.id }));
      unwrap(await services.ledger.deleteTransaction(completed.transaction.id));

      unwrap(await services.ledger.deleteTransaction(transaction.id, { confirmed: true }));

      await expect(services.ledger.getTransaction(transaction.id)).resolves.toBeNull();
    });

    it('lets the amount and fee be corrected', async () => {
      const { checking, savings, toSavings } = await applied();
      const { transaction } = unwrap(await services.split.completeMove({ moveId: toSavings.id }));

      unwrap(
        await services.ledger.updateTransaction(transaction.id, {
          kind: 'transfer',
          fromAccountId: checking.id,
          toAccountId: savings.id,
          amount: '580',
          fee: '1',
        }),
      );

      await expect(balanceOf(savings.id)).resolves.toBe(58000n);
      await expect(services.split.getMove(toSavings.id)).resolves.toMatchObject({
        status: 'done',
        ledgerTransactionId: transaction.id,
      });
    });

    it('refuses to point it at other accounts or turn it into something else', async () => {
      const { checking, savings, toSavings } = await applied();
      const other = await account('Other');
      const { transaction } = unwrap(await services.split.completeMove({ moveId: toSavings.id }));

      expect(
        await services.ledger.updateTransaction(transaction.id, {
          kind: 'transfer',
          fromAccountId: checking.id,
          toAccountId: other.id,
          amount: '600',
        }),
      ).toMatchObject({ ok: false, error: { code: 'transaction-locked' } });
      expect(
        await services.ledger.updateTransaction(transaction.id, {
          kind: 'expense',
          accountId: checking.id,
          amount: '600',
        }),
      ).toMatchObject({ ok: false, error: { code: 'transaction-locked' } });
      await expect(balanceOf(savings.id)).resolves.toBe(60000n);
    });
  });

  it('leaves transactions with no split alone', async () => {
    const checking = await account('Checking');
    const plain = await income(checking.id);

    unwrap(await services.ledger.updateTransaction(plain.id, entryFor(checking.id, '5')));
    unwrap(await services.ledger.deleteTransaction(plain.id));
  });
});
