import { migrations } from '@/shared/persistence/migrations';
import { runMigrations } from '@/shared/persistence/migrator';
import { createNodeSqliteDriver } from '@/shared/persistence/node-sqlite-driver';
import type { SqlDriver } from '@/shared/persistence/sql-driver';

import { createLedgerRepositories } from '@/features/ledger/infrastructure/sqlite-ledger-store';

import type { Asset, ExpectedStream } from '../domain/asset';
import { createSqliteAssetRepository } from './sqlite-asset-repository';

describe('sqlite asset repository', () => {
  let driver: SqlDriver;

  const asset: Asset = {
    id: 'a1',
    name: 'Flat',
    typeId: 'default-real-estate',
    currencyCode: 'DAI',
    accountId: null,
    status: 'active',
    soldOn: null,
    notes: 'Corner',
  };

  const stream: ExpectedStream = {
    id: 's1',
    assetId: 'a1',
    name: 'Rent',
    kind: 'income',
    amount: 1000000000000000001n,
    categoryId: null,
    schedule: { unit: 'month', every: 1, startOn: '2026-01-31', endOn: '2027-01-31', dayOfMonth: 15 },
  };

  beforeEach(async () => {
    driver = createNodeSqliteDriver();
    await runMigrations(driver, migrations);
    await driver.run(
      `INSERT INTO currencies (code, name, decimals, symbol, kind)
       VALUES ('DAI', 'Dai', 18, 'DAI', 'stablecoin')`,
    );
  });

  afterEach(() => driver.close());

  it('round trips an asset and a stream, with amounts stored as text', async () => {
    const assets = createSqliteAssetRepository(driver);
    await assets.saveAsset(asset);
    await assets.saveStream(stream);
    await assets.saveAsset({ ...asset, status: 'sold', soldOn: '2026-02-01' });

    await expect(assets.getAsset('a1')).resolves.toEqual({
      ...asset,
      status: 'sold',
      soldOn: '2026-02-01',
    });
    await expect(assets.getStream('s1')).resolves.toEqual(stream);
    await driver.run(
      `INSERT INTO categories (id, name, kind, archived) VALUES ('food', 'Food', 'expense', 0)`,
    );
    await assets.saveStream({ ...stream, categoryId: 'food' });
    await expect(assets.getStream('s1')).resolves.toMatchObject({ categoryId: 'food' });
    await expect(driver.get('SELECT typeof(amount) AS kind FROM asset_streams')).resolves.toEqual({
      kind: 'text',
    });
  });

  it('reads a payment from its transaction, on the real account', async () => {
    const assets = createSqliteAssetRepository(driver);
    const { journal } = createLedgerRepositories(driver);
    await driver.run(
      `INSERT INTO accounts (id, name, type, currency_code, opening_balance, archived)
       VALUES ('bank', 'Bank', 'Bank', 'DAI', '0', 0),
              ('system', 'Income', 'System', 'DAI', '0', 0)`,
    );
    await driver.run(`UPDATE accounts SET system_role = 'income' WHERE id = 'system'`);
    await assets.saveAsset(asset);
    await assets.saveStream(stream);
    const occurredAt = new Date(2026, 2, 10, 12).toISOString();
    await journal.save({
      id: 't1',
      occurredAt,
      kind: 'income',
      description: '',
      categoryId: null,
      metadata: null,
      postings: [
        { accountId: 'system', amount: -7n, currency: 'DAI' },
        { accountId: 'bank', amount: 7n, currency: 'DAI' },
      ],
    });
    await assets.saveLink({ transactionId: 't1', assetId: 'a1', streamId: 's1', dueOn: '2026-03-15' });

    await expect(assets.listPayments()).resolves.toEqual([
      {
        transactionId: 't1',
        assetId: 'a1',
        streamId: 's1',
        dueOn: '2026-03-15',
        kind: 'income',
        day: '2026-03-10',
        minor: 7n,
        currency: 'DAI',
      },
    ]);
  });

  it('refuses a sold asset with no date at the database too', async () => {
    const assets = createSqliteAssetRepository(driver);
    await expect(assets.saveAsset({ ...asset, status: 'sold' })).rejects.toThrow();
  });

  it('reads an amount of a currency only through its asset', async () => {
    const assets = createSqliteAssetRepository(driver);
    await expect(assets.isCurrencyInUse('DAI')).resolves.toBe(false);
    await assets.saveAsset(asset);
    await expect(assets.isCurrencyInUse('DAI')).resolves.toBe(true);
  });
});
