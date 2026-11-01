import type { Currency } from '@/features/ledger/domain/currency';

import { addDays, daysBetween, type Day } from './calendar';
import { convertOn, type ConversionContext } from './conversion';
import type { PeriodRange } from './period';

export type Movement = {
  readonly day: Day;
  readonly kind: 'income' | 'expense';
  /** Positive for both kinds. */
  readonly minor: bigint;
  readonly currency: string;
};

export type FlowTotals = {
  readonly income: bigint;
  readonly expense: bigint;
  readonly net: bigint;
};

export type HistoryRow = {
  readonly period: PeriodRange;
  readonly byCurrency: readonly (FlowTotals & { readonly currency: string })[];
  readonly base: FlowTotals;
  /** While this has entries, `base` leaves those currencies out. */
  readonly missingRates: readonly string[];
};

function withMovement(totals: FlowTotals | undefined, kind: Movement['kind'], minor: bigint) {
  const { income = 0n, expense = 0n } = totals ?? {};
  const next = { income, expense, [kind]: (kind === 'income' ? income : expense) + minor };
  return { ...next, net: next.income - next.expense };
}

export function summarizeHistory(
  input: ConversionContext & {
    readonly periods: readonly PeriodRange[];
    readonly movements: readonly Movement[];
    readonly base: Currency;
  },
): HistoryRow[] {
  const { periods, movements, base, ...context } = input;
  return periods.map((period) => {
    const byCurrency = new Map<string, FlowTotals>();
    let baseTotals: FlowTotals = { income: 0n, expense: 0n, net: 0n };
    const missing = new Set<string>();
    for (const { day, kind, minor, currency } of movements) {
      if (day < period.startOn || day > period.endOn) continue;
      byCurrency.set(currency, withMovement(byCurrency.get(currency), kind, minor));
      const converted = convertOn(minor, currency, base, day, context);
      if (converted === null) missing.add(currency);
      else baseTotals = withMovement(baseTotals, kind, converted);
    }
    return {
      period,
      byCurrency: [...byCurrency]
        .map(([currency, totals]) => ({ currency, ...totals }))
        .sort((first, second) => first.currency.localeCompare(second.currency)),
      base: baseTotals,
      missingRates: [...missing].sort(),
    };
  });
}

/** Money expected in an account on a day, positive in and negative out, in its currency. */
export type ExpectedFlow = {
  readonly day: Day;
  readonly accountId: string;
  readonly minor: bigint;
  readonly label: string;
};

export type ProjectedAccount = {
  readonly accountId: string;
  readonly currency: string;
  readonly balance: bigint;
};

export type AccountProjection = ProjectedAccount & {
  readonly balances: readonly bigint[];
  readonly firstNegativeOn: Day | null;
};

export type CashFlowProjection = {
  readonly days: readonly Day[];
  readonly accounts: readonly AccountProjection[];
  readonly total: {
    readonly balances: readonly bigint[];
    readonly firstNegativeOn: Day | null;
    /** While this has entries, `balances` leaves those currencies out. */
    readonly missingRates: readonly string[];
  };
};

function firstNegative(balances: readonly bigint[], days: readonly Day[]): Day | null {
  const index = balances.findIndex((balance) => balance < 0n);
  return index === -1 ? null : days[index];
}

export function projectCashFlow(
  input: ConversionContext & {
    readonly today: Day;
    readonly horizonDays: number;
    readonly accounts: readonly ProjectedAccount[];
    readonly flows: readonly ExpectedFlow[];
    /** In the base currency, taken from the total and from no account. */
    readonly totalOutflows: readonly { readonly day: Day; readonly minor: bigint }[];
    readonly base: Currency;
  },
): CashFlowProjection {
  const { today, horizonDays, accounts, flows, totalOutflows, base, ...context } = input;
  const days = Array.from({ length: horizonDays + 1 }, (_, index) => addDays(today, index));
  const indexOf = (day: Day) => {
    const index = daysBetween(today, day);
    return index >= 0 && index <= horizonDays ? index : null;
  };

  const projected = accounts.map((account) => {
    const changes = new Map<number, bigint>();
    for (const { accountId, day, minor } of flows) {
      const index = indexOf(day);
      if (accountId !== account.accountId || index === null) continue;
      changes.set(index, (changes.get(index) ?? 0n) + minor);
    }
    let balance = account.balance;
    const balances = days.map((_, index) => {
      balance += changes.get(index) ?? 0n;
      return balance;
    });
    return { ...account, balances, firstNegativeOn: firstNegative(balances, days) };
  });

  const outflows = new Map<number, bigint>();
  for (const { day, minor } of totalOutflows) {
    const index = indexOf(day);
    if (index !== null) outflows.set(index, (outflows.get(index) ?? 0n) + minor);
  }

  const missing = new Set<string>();
  let reserved = 0n;
  const totals = days.map((_, index) => {
    const perCurrency = new Map<string, bigint>();
    for (const { currency, balances } of projected) {
      perCurrency.set(currency, (perCurrency.get(currency) ?? 0n) + balances[index]);
    }
    let total = 0n;
    for (const [currency, minor] of perCurrency) {
      const converted = minor === 0n ? 0n : convertOn(minor, currency, base, today, context);
      if (converted === null) missing.add(currency);
      else total += converted;
    }
    reserved += outflows.get(index) ?? 0n;
    return total - reserved;
  });

  return {
    days,
    accounts: projected,
    total: {
      balances: totals,
      firstNegativeOn: firstNegative(totals, days),
      missingRates: [...missing].sort(),
    },
  };
}
