import { migrations } from '@/shared/persistence/migrations';
import { runMigrations } from '@/shared/persistence/migrator';
import { createNodeSqliteDriver } from '@/shared/persistence/node-sqlite-driver';
import type { SqlDriver } from '@/shared/persistence/sql-driver';

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
    await expect(driver.get('SELECT typeof(amount) AS kind FROM asset_streams')).resolves.toEqual({
      kind: 'text',
    });
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
