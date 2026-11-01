import { generateId } from '@/shared/id';
import { openExpoSqliteDriver } from '@/shared/persistence/expo-sqlite-driver';
import { migrations } from '@/shared/persistence/migrations';
import { runMigrations } from '@/shared/persistence/migrator';
import { generateSecret } from '@/shared/secret';

import { createAppServices, type AppServices } from './create-app-services';

const DATABASE_NAME = 'moneyforge.db';

export async function openAppServices(): Promise<AppServices> {
  const driver = await openExpoSqliteDriver(DATABASE_NAME);
  await runMigrations(driver, migrations);
  const services = createAppServices({
    driver,
    clock: { now: () => new Date() },
    generateId,
    generateSecret,
  });
  await services.ledger.initialize();
  // Retried on the next start: a failed cleanup must not keep the user out of their ledger.
  await services.rules.purgeExpired(new Date()).catch(() => undefined);
  return services;
}
