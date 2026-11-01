import type { Currency } from '@/features/ledger/domain/currency';

import { belongsTo, type BudgetStatus } from './budget';
import { earlierDay, type Day } from './calendar';
import type { ExpectedFlow } from './cash-flow';
import { convertOn, type ConversionContext } from './conversion';

export type BudgetReservation = {
  /** In the base currency, for `projectCashFlow`'s `totalOutflows`. */
  readonly outflows: readonly { readonly day: Day; readonly minor: bigint }[];
  readonly missing: readonly string[];
};

type Reserved = { readonly chosen: ReadonlySet<string>; readonly minor: bigint };

/**
 * What the budgets still hold back beyond the flows already projected, so no amount leaves twice.
 *
 * A budget reserves what remains less two things: expected expenses in it through its period's
 * end, which leave their accounts anyway, and what earlier budgets sharing a category reserved.
 * So, in the order given, the first budget of an overlap takes the flow and shares its reservation
 * with the later ones, and a category reserves once. A later budget reserves only what it has
 * beyond that. A shared category shares the whole reservation, even one made for another category
 * of that budget, so partly overlapping budgets can reserve less than the most they allow.
 *
 * Only outflows count: an expected refund does not raise a reservation.
 */
export function reserveBudgets(
  input: ConversionContext & {
    /** A stable order, since an earlier budget serves the later ones. */
    readonly statuses: readonly BudgetStatus[];
    readonly flows: readonly ExpectedFlow[];
    /** The projected accounts. A flow on any other changes nothing, so it covers nothing. */
    readonly accountCurrencies: ReadonlyMap<string, string>;
    readonly parents: ReadonlyMap<string, string | null>;
    readonly base: Currency;
    readonly today: Day;
    readonly until: Day;
  },
): BudgetReservation {
  const { statuses, flows, accountCurrencies, parents, base, today, until, ...context } = input;
  const toBase = (minor: bigint, currency: string) => convertOn(minor, currency, base, today, context);
  const outflows: { day: Day; minor: bigint }[] = [];
  const missing = new Set<string>();
  const reserved: Reserved[] = [];

  const overlap = (first: ReadonlySet<string>, second: ReadonlySet<string>) =>
    [...first].some((id) => belongsTo(id, second, parents)) ||
    [...second].some((id) => belongsTo(id, first, parents));

  function expectedIn(chosen: ReadonlySet<string>, endOn: Day): bigint {
    let total = 0n;
    for (const { accountId, categoryId = null, day, minor } of flows) {
      const currency = accountCurrencies.get(accountId);
      if (!currency || minor >= 0n || day > endOn) continue;
      if (!belongsTo(categoryId, chosen, parents)) continue;
      const converted = toBase(-minor, currency);
      if (converted === null) missing.add(currency);
      else total += converted;
    }
    return total;
  }

  for (const { budget, period, remaining, missingRates } of statuses) {
    if (today < budget.startsOn) continue;
    for (const code of missingRates) missing.add(code);
    if (remaining <= 0n) continue;
    const held = toBase(remaining, budget.currencyCode);
    if (held === null) {
      missing.add(budget.currencyCode);
      continue;
    }
    const chosen = new Set(budget.categoryIds);
    const shared = reserved
      .filter((earlier) => overlap(earlier.chosen, chosen))
      .reduce((sum, { minor }) => sum + minor, 0n);
    const left = held - expectedIn(chosen, period.endOn) - shared;
    const minor = left > 0n ? left : 0n;
    reserved.push({ chosen, minor });
    if (minor > 0n) outflows.push({ day: earlierDay(period.endOn, until), minor });
  }
  return { outflows, missing: [...missing].sort() };
}
