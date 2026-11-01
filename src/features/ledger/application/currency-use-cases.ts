import { err, ok, type Result } from '@/shared/result';

import { buildSystemAccounts } from '../domain/account';
import { validateCurrency, type Currency } from '../domain/currency';
import { ledgerError, type LedgerError } from '../domain/ledger-error';
import type { LedgerDeps } from './ledger-deps';

export function createCurrencyUseCases({ store }: LedgerDeps) {
  return {
    listCurrencies: () => store.currencies.list(),

    createCurrency: (input: Currency): Promise<Result<Currency, LedgerError>> => {
      const validated = validateCurrency(input);
      if (!validated.ok) return Promise.resolve(validated);
      const currency = validated.value;
      return store.atomic(async ({ currencies, accounts }) => {
        if (await currencies.get(currency.code)) {
          return err(ledgerError('already-exists', `${currency.code} already exists.`));
        }
        await currencies.save(currency);
        for (const system of buildSystemAccounts(currency.code)) await accounts.save(system);
        return ok(currency);
      });
    },

    updateCurrency: (input: Currency): Promise<Result<Currency, LedgerError>> => {
      const validated = validateCurrency(input);
      if (!validated.ok) return Promise.resolve(validated);
      const currency = validated.value;
      return store.atomic(async ({ currencies, journal }) => {
        const existing = await currencies.get(currency.code);
        if (!existing) return err(ledgerError('not-found', `Unknown currency ${currency.code}.`));
        if (
          existing.decimals !== currency.decimals &&
          (await journal.currencyHasPostings(currency.code))
        ) {
          return err(
            ledgerError('currency-in-use', 'Decimals cannot change once the currency has entries.'),
          );
        }
        await currencies.save(currency);
        return ok(currency);
      });
    },
  };
}
