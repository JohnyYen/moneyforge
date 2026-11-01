import type { Migration } from '../migrator';
import { ledgerMigration } from './001-ledger';
import { splitMigration } from './002-split';
import { rulesMigration } from './003-rules';
import { planningMigration } from './004-planning';

export const migrations: readonly Migration[] = [
  ledgerMigration,
  splitMigration,
  rulesMigration,
  planningMigration,
];
