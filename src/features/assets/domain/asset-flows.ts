import { addDays, daysBetween, earlierDay, type Day } from '@/features/planning/domain/calendar';
import type { ExpectedFlow, Movement } from '@/features/planning/domain/cash-flow';
import { convertOn, type ConversionContext } from '@/features/planning/domain/conversion';
import type { RecurringItem } from '@/features/planning/domain/recurring';
import { occurrencesBetween, type Schedule, type ScheduleUnit } from '@/features/planning/domain/schedule';

import type { Asset, ExpectedStream, StreamPayment } from './asset';

/** Dates of a stream from `from` through `to`. A sale stops them from its own day on. */
export function streamDates(
  { schedule }: Pick<ExpectedStream, 'schedule'>,
  { soldOn }: Pick<Asset, 'soldOn'>,
  from: Day,
  to: Day,
): Day[] {
  return occurrencesBetween(schedule, from, soldOn ? earlierDay(to, addDays(soldOn, -1)) : to);
}

const OVERDUE_LOOKBACK_DAYS = 90;

/** A payment in the stream's currency. */
export type PaymentMeasure = (payment: StreamPayment) => bigint;

/** At the rate of the payment's day. With no rate there is no proof of an amount, so it is zero. */
export function paymentMeasure(code: string, context: ConversionContext): PaymentMeasure {
  const target = context.currencies.find((currency) => currency.code === code);
  return ({ minor, currency, day }) => {
    if (currency === code) return minor;
    return (target && convertOn(minor, currency, target, day, context)) ?? 0n;
  };
}

/** What still counts for a stream. An edit can turn a payment into another kind of entry. */
const paymentsOf = (stream: ExpectedStream, payments: readonly StreamPayment[]) =>
  payments.filter(({ streamId, kind }) => streamId === stream.id && kind === stream.kind);

function addPaid(paid: Map<Day, bigint>, dueOn: Day, minor: bigint): bigint {
  const total = (paid.get(dueOn) ?? 0n) + minor;
  paid.set(dueOn, total);
  return total;
}

/**
 * The date each payment of a stream fulfils, by transaction, oldest payment first so the answer
 * does not depend on the order they were linked in. A date stays open to further payments until
 * they reach the amount.
 */
export function assignDueDates(
  stream: ExpectedStream,
  payments: readonly StreamPayment[],
  measure: PaymentMeasure,
): ReadonlyMap<string, Day | null> {
  const ordered = [...paymentsOf(stream, payments)].sort(
    (first, second) =>
      first.day.localeCompare(second.day) ||
      first.transactionId.localeCompare(second.transactionId),
  );
  const paid = new Map<Day, bigint>();
  const full = new Set<Day>();
  const assigned = new Map<string, Day | null>();
  for (const payment of ordered) {
    const dueOn = nearestDue(stream.schedule, payment.day, full);
    assigned.set(payment.transactionId, dueOn);
    if (dueOn && addPaid(paid, dueOn, measure(payment)) >= stream.amount) full.add(dueOn);
  }
  return assigned;
}

/**
 * What is paid towards each date. Placed afresh, because a rate saved after a stored `dueOn` was
 * written can change what a payment is worth, and with it which date the next payment takes.
 */
function paidByDate(
  stream: ExpectedStream,
  payments: readonly StreamPayment[],
  measure: PaymentMeasure,
): ReadonlyMap<Day, bigint> {
  const assigned = assignDueDates(stream, payments, measure);
  const paid = new Map<Day, bigint>();
  for (const payment of paymentsOf(stream, payments)) {
    const dueOn = assigned.get(payment.transactionId);
    if (dueOn) addPaid(paid, dueOn, measure(payment));
  }
  return paid;
}

/**
 * What streams will bring to their accounts. An asset with no account has nowhere to project to,
 * and what linked transactions paid towards a date is real money, already in a balance, so only
 * the rest of each date counts. An unpaid expense is still owed, so its recent dates count today.
 * Income is not assumed to still be coming.
 */
export function expectedAssetFlows(
  input: ConversionContext & {
    readonly assets: readonly Asset[];
    readonly streams: readonly ExpectedStream[];
    readonly payments: readonly StreamPayment[];
    readonly from: Day;
    readonly to: Day;
  },
): ExpectedFlow[] {
  const { assets, streams, payments, from, to, ...context } = input;
  return streams.flatMap((stream) => {
    const asset = assets.find(({ id }) => id === stream.assetId);
    if (!asset?.accountId) return [];
    const { accountId } = asset;
    const { categoryId, kind } = stream;
    const label = `${asset.name}: ${stream.name}`;
    const paid = paidByDate(stream, payments, paymentMeasure(asset.currencyCode, context));
    const owed = (first: Day, last: Day, on?: Day) =>
      streamDates(stream, asset, first, last).flatMap((date) => {
        const left = stream.amount - (paid.get(date) ?? 0n);
        if (left <= 0n) return [];
        const minor = kind === 'income' ? left : -left;
        return [{ day: on ?? date, accountId, minor, label, categoryId }];
      });
    const overdue =
      kind === 'expense' ? owed(addDays(from, -OVERDUE_LOOKBACK_DAYS), addDays(from, -1), from) : [];
    return [...overdue, ...owed(from, to)];
  });
}

/** Whether a recurring item looks like the same money as a stream landing in `accountId`. */
export function overlapsRecurring(
  { kind, amount, schedule }: ExpectedStream,
  accountId: string,
  item: RecurringItem,
): boolean {
  const other = item.schedule;
  return (
    item.active &&
    item.accountId === accountId &&
    item.kind === kind &&
    item.amount === amount &&
    other.unit === schedule.unit &&
    other.every === schedule.every &&
    (other.endOn === null || other.endOn >= schedule.startOn) &&
    (schedule.endOn === null || schedule.endOn >= other.startOn)
  );
}

/** What the streams of an asset promise in a range, shaped like what really moved. */
export function expectedMovements(
  asset: Asset,
  streams: readonly ExpectedStream[],
  from: Day,
  to: Day,
): Movement[] {
  return streams.flatMap((stream) =>
    streamDates(stream, asset, from, to).map((day) => ({
      day,
      kind: stream.kind,
      minor: stream.amount,
      currency: asset.currencyCode,
    })),
  );
}

const DAYS_PER_UNIT: Record<ScheduleUnit, number> = { day: 1, week: 7, month: 31, year: 366 };
const STEPS_SEARCHED = 3;

/**
 * The date of a schedule a transaction on `day` most likely fulfils, so a rule or a form need not
 * ask. A payment within half a step after an open date is late for it. Otherwise the closest date
 * wins, the earlier one on a tie. A few steps either way is enough: further out it is a guess.
 */
export function nearestDue(schedule: Schedule, day: Day, taken: ReadonlySet<Day>): Day | null {
  const step = schedule.every * DAYS_PER_UNIT[schedule.unit];
  const span = step * STEPS_SEARCHED;
  const distance = (date: Day) => Math.abs(daysBetween(day, date));
  const open = occurrencesBetween(schedule, addDays(day, -span), addDays(day, span)).filter(
    (date) => !taken.has(date),
  );
  const past = open.filter((date) => date <= day);
  const late = past[past.length - 1];
  if (late && distance(late) * 2 <= step) return late;
  return open.reduce<Day | null>(
    (best, date) => (best === null || distance(date) < distance(best) ? date : best),
    null,
  );
}
