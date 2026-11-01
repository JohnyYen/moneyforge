import { createAccountUseCases } from './account-use-cases';
import { createCategoryUseCases } from './category-use-cases';
import { createCurrencyUseCases } from './currency-use-cases';
import type { LedgerDeps } from './ledger-deps';
import { createOverviewUseCases } from './overview-use-cases';
import { createSetupUseCases } from './setup-use-cases';
import { createTransactionUseCases } from './transaction-use-cases';

export function createLedgerService(deps: LedgerDeps) {
  return {
    ...createSetupUseCases(deps),
    ...createCurrencyUseCases(deps),
    ...createAccountUseCases(deps),
    ...createCategoryUseCases(deps),
    ...createTransactionUseCases(deps),
    ...createOverviewUseCases(deps),
  };
}

export type LedgerService = ReturnType<typeof createLedgerService>;
