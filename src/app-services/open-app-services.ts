import type { BackupTransport } from '@/features/backup/application/ports';
import { createExpoBackupCipher } from '@/features/backup/infrastructure/expo-backup-cipher';
import { createFetchOnChainClient } from '@/features/onchain/infrastructure/fetch-onchain-client';
import {
  androidSmsPermissions,
  createNativeMessageCapture,
} from '@/features/rules/infrastructure/native-message-capture';
import { generateId } from '@/shared/id';
import { openExpoSqliteDriver } from '@/shared/persistence/expo-sqlite-driver';
import { migrations } from '@/shared/persistence/migrations';
import { runMigrations } from '@/shared/persistence/migrator';
import type { SqlDriver } from '@/shared/persistence/sql-driver';
import { generateSecret } from '@/shared/secret';
import { ok } from '@/shared/result';
import { shareText } from '@/shared/ui/share-text';

import { MessageCapture } from '../../modules/message-capture';
import { createAppServices, type AppServices } from './create-app-services';

const DATABASE_NAME = 'moneyforge.db';

/** Past this a share sheet may truncate, and a truncated file is one that cannot open. */
const MAX_SHARE_CHARS = 1_000_000;

const backupTransport: BackupTransport = {
  maxChars: MAX_SHARE_CHARS,
  send: async (text) => {
    const shared = await shareText('MoneyForge backup', text);
    return shared.ok
      ? shared
      : { ok: false, error: { code: 'share-failed', message: shared.error.message } };
  },
  receive: async (text) => ok(text),
};

export type OpenedAppServices = {
  readonly services: AppServices;
  /** Closes the database once the work already queued on it has run. */
  readonly close: () => Promise<void>;
};

export async function openAppServices(): Promise<OpenedAppServices> {
  const driver = await openExpoSqliteDriver(DATABASE_NAME);
  try {
    return { services: await startServices(driver), close: () => driver.close() };
  } catch (error) {
    // A launch that fails leaves no handle open behind it; a retry opens a new one.
    await driver.close().catch(() => undefined);
    throw error;
  }
}

async function startServices(driver: SqlDriver): Promise<AppServices> {
  await runMigrations(driver, migrations);
  const services = createAppServices({
    driver,
    clock: { now: () => new Date() },
    generateId,
    generateSecret,
    messageCapture: createNativeMessageCapture(MessageCapture, androidSmsPermissions),
    onChainClient: createFetchOnChainClient(),
    backupCipher: createExpoBackupCipher(),
    backupTransport,
  });
  await services.ledger.initialize();
  // Retried on the next start: a failed cleanup must not keep the user out of their ledger.
  await services.rules.purgeExpired(new Date()).catch(() => undefined);
  await services.planning.materializeDue().catch(() => undefined);
  return services;
}
