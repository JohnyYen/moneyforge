import { err, ok, type Result } from '@/shared/result';

import { buildSystemAccounts } from '../domain/account';
import type { Currency } from '../domain/currency';
import { ledgerError, type LedgerError } from '../domain/ledger-error';
import { DEFAULT_CATEGORIES, DEFAULT_CURRENCIES } from './default-data';
import type { LedgerDeps } from './ledger-deps';

export const BASE_CURRENCY_KEY = 'base_currency';
const SEEDED_KEY = 'defaults_seeded';

export function createSetupUseCases({ store, generateId }: LedgerDeps) {
  async function getBaseCurrency(): Promise<Currency | null> {
    const code = await store.settings.get(BASE_CURRENCY_KEY);
    return code ? store.currencies.get(code) : null;
  }

  return {
    /** Seeds defaults once, so anything the user later changes stays changed. */
    initialize: () =>
      store.atomic(async ({ settings, currencies, accounts, categories }) => {
        if (await settings.get(SEEDED_KEY)) return;
        for (const currency of DEFAULT_CURRENCIES) {
          await currencies.save(currency);
          for (const system of buildSystemAccounts(currency.code)) await accounts.save(system);
        }
        for (const category of DEFAULT_CATEGORIES) {
          await categories.save({ ...category, id: generateId(), parentId: null, archived: false });
        }
        await settings.set(SEEDED_KEY, 'true');
      }),

    getBaseCurrency,

    async setBaseCurrency(code: string): Promise<Result<Currency, LedgerError>> {
      const currency = await store.currencies.get(code);
      if (!currency) return err(ledgerError('not-found', `Unknown currency ${code}.`));
      await store.settings.set(BASE_CURRENCY_KEY, code);
      return ok(currency);
    },
  };
}
