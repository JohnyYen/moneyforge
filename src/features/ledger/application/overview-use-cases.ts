import { err, ok, type Result } from '@/shared/result';

import type { Account } from '../domain/account';
import type { Currency } from '../domain/currency';
import { isValidDate, type ExchangeRate } from '../domain/exchange-rate';
import { ledgerError, type LedgerError } from '../domain/ledger-error';
import { computeNetWorth, type NetWorth } from '../domain/net-worth';
import { parseRate } from '../domain/rate';
import type { LedgerDeps } from './ledger-deps';
import type { TransactionFilter } from './ports';
import { BASE_CURRENCY_KEY } from './setup-use-cases';

export type AccountBalance = {
  readonly account: Account;
  readonly currency: Currency;
  readonly balance: bigint;
};

/** The calendar day of a moment on the device, as `YYYY-MM-DD`. */
export function toLocalDay(moment: Date): string {
  const month = String(moment.getMonth() + 1).padStart(2, '0');
  const day = String(moment.getDate()).padStart(2, '0');
  return `${moment.getFullYear()}-${month}-${day}`;
}

export function createOverviewUseCases({ store, clock, generateId }: LedgerDeps) {
  async function accountBalances(): Promise<AccountBalance[]> {
    const [accounts, currencies, balances] = await Promise.all([
      store.accounts.listUser(),
      store.currencies.list(),
      store.journal.balances(),
    ]);
    const byCode = new Map(currencies.map((currency) => [currency.code, currency]));
    return accounts.flatMap((account) => {
      const currency = byCode.get(account.currencyCode);
      return currency ? [{ account, currency, balance: balances[account.id] ?? 0n }] : [];
    });
  }

  return {
    accountBalances,

    listTransactions: (filter: TransactionFilter) => store.journal.list(filter),

    listRates: () => store.exchangeRates.list(),

    async saveRate(input: {
      fromCode: string;
      toCode: string;
      rate: string;
      effectiveOn: string;
    }): Promise<Result<ExchangeRate, LedgerError>> {
      const rate = parseRate(input.rate);
      if (!rate.ok) return rate;
      if (!isValidDate(input.effectiveOn)) {
        return err(ledgerError('invalid-date', 'Enter a date as YYYY-MM-DD.'));
      }
      if (input.fromCode === input.toCode) {
        return err(ledgerError('currency-mismatch', 'Choose two different currencies.'));
      }
      for (const code of [input.fromCode, input.toCode]) {
        if (!(await store.currencies.get(code))) {
          return err(ledgerError('not-found', `Unknown currency ${code}.`));
        }
      }
      const saved: ExchangeRate = { ...input, id: generateId(), rate: input.rate.trim() };
      await store.exchangeRates.save(saved);
      return ok(saved);
    },

    /** Archived accounts are left out. Currencies with no rate are reported, not valued at zero. */
    async netWorth(): Promise<Result<NetWorth, LedgerError>> {
      const baseCode = await store.settings.get(BASE_CURRENCY_KEY);
      const base = baseCode ? await store.currencies.get(baseCode) : null;
      if (!base) return err(ledgerError('setup-required', 'Choose a base currency first.'));
      const [balances, currencies, rates] = await Promise.all([
        accountBalances(),
        store.currencies.list(),
        store.exchangeRates.list(),
      ]);
      return ok(
        computeNetWorth({
          base,
          currencies,
          rates,
          asOf: toLocalDay(clock.now()),
          balances: balances
            .filter(({ account }) => !account.archived)
            .map(({ account, balance }) => ({ minor: balance, currency: account.currencyCode })),
        }),
      );
    },
  };
}
