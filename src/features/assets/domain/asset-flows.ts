import { addDays, daysBetween, earlierDay, type Day } from '@/features/planning/domain/calendar';
import type { ExpectedFlow, Movement } from '@/features/planning/domain/cash-flow';
import { occurrencesBetween, type Schedule, type ScheduleUnit } from '@/features/planning/domain/schedule';

import type { Asset, ExpectedStream, TransactionLink } from './asset';

/** Dates of a stream from `from` through `to`. A sale stops them from its own day on. */
export function streamDates(
  { schedule }: Pick<ExpectedStream, 'schedule'>,
  { soldOn }: Pick<Asset, 'soldOn'>,
  from: Day,
  to: Day,
): Day[] {
  return occurrencesBetween(schedule, from, soldOn ? earlierDay(to, addDays(soldOn, -1)) : to);
}

const coverKey = (streamId: string, dueOn: Day) => `${streamId}|${dueOn}`;

/**
 * What streams will bring to their accounts. An asset with no account has nowhere to project to,
 * and a date a linked transaction already covers is real money, already in a balance.
 */
export function expectedAssetFlows(input: {
  readonly assets: readonly Asset[];
  readonly streams: readonly ExpectedStream[];
  readonly links: readonly TransactionLink[];
  readonly from: Day;
  readonly to: Day;
}): ExpectedFlow[] {
  const { assets, streams, links, from, to } = input;
  const covered = new Set(
    links.flatMap(({ streamId, dueOn }) => (streamId && dueOn ? [coverKey(streamId, dueOn)] : [])),
  );
  return streams.flatMap((stream) => {
    const asset = assets.find(({ id }) => id === stream.assetId);
    if (!asset?.accountId) return [];
    const { accountId } = asset;
    const minor = stream.kind === 'income' ? stream.amount : -stream.amount;
    const label = `${asset.name}: ${stream.name}`;
    return streamDates(stream, asset, from, to)
      .filter((day) => !covered.has(coverKey(stream.id, day)))
      .map((day) => ({ day, accountId, minor, label }));
  });
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
 * ask. The earlier date wins a tie. A few steps either way is enough: further out it is a guess.
 */
export function nearestDue(schedule: Schedule, day: Day, taken: ReadonlySet<Day>): Day | null {
  const span = schedule.every * DAYS_PER_UNIT[schedule.unit] * STEPS_SEARCHED;
  const dates = occurrencesBetween(schedule, addDays(day, -span), addDays(day, span));
  const distance = (date: Day) => Math.abs(daysBetween(day, date));
  return dates
    .filter((date) => !taken.has(date))
    .reduce<Day | null>(
      (best, date) => (best === null || distance(date) < distance(best) ? date : best),
      null,
    );
}
