import { createNodeSqliteDriver } from '@/shared/persistence/node-sqlite-driver';
import { migrations } from '@/shared/persistence/migrations';
import { runMigrations } from '@/shared/persistence/migrator';
import type { SqlDriver } from '@/shared/persistence/sql-driver';
import type { Result } from '@/shared/result';

import { createLedgerService, type LedgerService } from '../../application/ledger-service';
import { toLocalDay } from '../../application/overview-use-cases';
import { createAdjustment, type Transaction } from '../../domain/journal';
import type { LedgerError } from '../../domain/ledger-error';
import { createSqliteLedgerStore } from '../../infrastructure/sqlite-ledger-store';
import { toEntryInput, toEntryValues } from './entry-values';

function unwrap<T>(result: Result<T, LedgerError>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe('entry values', () => {
  let driver: SqlDriver;
  let ledger: LedgerService;
  let dollars: string;
  let savings: string;
  let wallet: string;

  beforeEach(async () => {
    driver = createNodeSqliteDriver();
    await runMigrations(driver, migrations);
    let sequence = 0;
    ledger = createLedgerService({
      store: createSqliteLedgerStore(driver),
      clock: { now: () => new Date('2026-03-10T12:00:00.000Z') },
      generateId: () => `id-${++sequence}`,
    });
    await ledger.initialize();
    const open = async (name: string, currencyCode: string) =>
      unwrap(await ledger.createAccount({ name, type: 'Bank', currencyCode, openingBalance: '500' }))
        .id;
    dollars = await open('Dollars', 'USD');
    savings = await open('Savings', 'USD');
    wallet = await open('Wallet', 'DAI');
  });

  afterEach(() => driver.close());

  const roundTrip = async (transaction: Transaction) => {
    const values = toEntryValues(transaction, await ledger.listCurrencies());
    if (!values) throw new Error('Expected an editable transaction');
    return unwrap(
      await ledger.updateTransaction(transaction.id, unwrap(toEntryInput(values, undefined))),
    );
  };

  it('fills the form with what was recorded', async () => {
    const recorded = unwrap(
      await ledger.recordTransfer({
        fromAccountId: dollars,
        toAccountId: savings,
        amount: '40',
        fee: '1.50',
        description: 'Move',
      }),
    );

    expect(toEntryValues(recorded, await ledger.listCurrencies())).toEqual({
      kind: 'transfer',
      accountId: dollars,
      toAccountId: savings,
      categoryId: null,
      amount: '40.00',
      targetAmount: '',
      rate: '',
      fee: '1.50',
      feeCurrency: null,
      description: 'Move',
      day: toLocalDay(new Date(recorded.occurredAt)),
    });
  });

  it('has nothing to edit on an adjustment', async () => {
    const adjustment = unwrap(
      createAdjustment({
        id: 'a',
        occurredAt: '2026-01-01T00:00:00.000Z',
        description: '',
        account: { id: dollars, currencyCode: 'USD' },
        difference: 5n,
      }),
    );

    expect(toEntryValues(adjustment, await ledger.listCurrencies())).toBeNull();
  });

  it.each([
    ['income', () => ledger.recordIncome({ accountId: dollars, amount: '12.34' })],
    ['expense', () => ledger.recordExpense({ accountId: dollars, amount: '12.34' })],
    [
      'transfer with a fee',
      () =>
        ledger.recordTransfer({
          fromAccountId: dollars,
          toAccountId: savings,
          amount: '40',
          fee: '1.50',
        }),
    ],
    [
      'conversion with a source fee',
      () =>
        ledger.recordConversion({
          fromAccountId: dollars,
          toAccountId: wallet,
          sourceAmount: '10',
          rate: '0.998877665544332211',
          fee: '0.25',
          feeCurrency: 'USD',
        }),
    ],
    [
      'conversion with a target fee',
      () =>
        ledger.recordConversion({
          fromAccountId: dollars,
          toAccountId: wallet,
          sourceAmount: '10',
          targetAmount: '9.98',
          rate: '0.998',
          fee: '0.000000000000000001',
          feeCurrency: 'DAI',
        }),
    ],
  ])('saves an unchanged %s back identically', async (_name, record) => {
    const recorded = unwrap(await record());

    await expect(roundTrip(recorded)).resolves.toEqual(recorded);
  });
});

describe('toEntryInput', () => {
  const values = {
    kind: 'transfer',
    accountId: 'a',
    toAccountId: null,
    categoryId: null,
    amount: '1',
    targetAmount: '',
    rate: '',
    fee: '',
    feeCurrency: null,
    description: '',
    day: '2026-01-01',
  } as const;

  it('needs both accounts', () => {
    expect(toEntryInput(values, undefined)).toMatchObject({
      ok: false,
      error: { code: 'not-found' },
    });
    expect(toEntryInput({ ...values, accountId: null }, undefined)).toMatchObject({ ok: false });
  });
});
