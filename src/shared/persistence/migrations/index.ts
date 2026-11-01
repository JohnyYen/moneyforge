import type { Migration } from '../migrator';
import { ledgerMigration } from './001-ledger';

export const migrations: readonly Migration[] = [ledgerMigration];
