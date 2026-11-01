import { generateId } from '@/shared/id';
import { openExpoSqliteDriver } from '@/shared/persistence/expo-sqlite-driver';
import { migrations } from '@/shared/persistence/migrations';
import { runMigrations } from '@/shared/persistence/migrator';

import { createLedgerService, type LedgerService } from '../application/ledger-service';
import { createSqliteLedgerStore } from './sqlite-ledger-store';

const DATABASE_NAME = 'moneyforge.db';

export async function openLedger(): Promise<LedgerService> {
  const driver = await openExpoSqliteDriver(DATABASE_NAME);
  await runMigrations(driver, migrations);
  const ledger = createLedgerService({
    store: createSqliteLedgerStore(driver),
    clock: { now: () => new Date() },
    generateId,
  });
  await ledger.initialize();
  return ledger;
}
