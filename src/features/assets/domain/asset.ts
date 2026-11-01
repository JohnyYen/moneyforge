import { isValidDate } from '@/features/ledger/domain/exchange-rate';
import type { Day } from '@/features/planning/domain/calendar';
import { validateSchedule, type Schedule } from '@/features/planning/domain/schedule';
import { err, ok, type Result } from '@/shared/result';

import { assetError, type AssetError } from './asset-error';

/** User data. The defaults are seeded once by the migration and stay editable. */
export type AssetType = { readonly id: string; readonly name: string; readonly archived: boolean };

export type AssetStatus = 'active' | 'sold';

export type Asset = {
  readonly id: string;
  readonly name: string;
  readonly typeId: string;
  /** What values and streams are written in. Fixed once created, since they store minor units. */
  readonly currencyCode: string;
  /** Where its streams land. In the asset's currency, because a projection needs no rate then. */
  readonly accountId: string | null;
  readonly status: AssetStatus;
  /** Set only when sold. Expected flows stop from this day on. */
  readonly soldOn: Day | null;
  readonly notes: string;
};

/** A dated value. It is not cash, so it never reaches the ledger. */
export type Valuation = {
  readonly id: string;
  readonly assetId: string;
  readonly valuedOn: Day;
  readonly amount: bigint;
};

export const STREAM_KINDS = ['income', 'expense'] as const;
export type StreamKind = (typeof STREAM_KINDS)[number];

/** Money the user expects from an asset, in its currency, on planning's own schedule. */
export type ExpectedStream = {
  readonly id: string;
  readonly assetId: string;
  readonly name: string;
  readonly kind: StreamKind;
  readonly amount: bigint;
  readonly schedule: Schedule;
};

/** Ties a ledger entry to an asset, and optionally to the date of a stream it fulfils. */
export type TransactionLink = {
  readonly transactionId: string;
  readonly assetId: string;
  readonly streamId: string | null;
  readonly dueOn: Day | null;
};

/** What a message rule's entries link to. */
export type RuleLink = {
  readonly ruleId: string;
  readonly assetId: string;
  readonly streamId: string | null;
};

const invalid = (message: string) => err(assetError('invalid-asset', message));

export function validateAsset(asset: Asset): Result<Asset, AssetError> {
  const name = asset.name.trim();
  if (!name) return invalid('Enter a name.');
  if (!asset.typeId) return invalid('Choose a type.');
  if (!asset.currencyCode) return invalid('Choose a currency.');
  if ((asset.status === 'sold') !== (asset.soldOn !== null)) {
    return invalid('A sold asset needs its sale date.');
  }
  return ok({ ...asset, name, notes: asset.notes.trim() });
}

export function sellAsset(asset: Asset, soldOn: Day, today: Day): Result<Asset, AssetError> {
  if (!isValidDate(soldOn)) return invalid('Enter the sale date as YYYY-MM-DD.');
  if (soldOn > today) return invalid('The sale date cannot be in the future.');
  return ok({ ...asset, status: 'sold', soldOn });
}

export function validateValuation(
  valuation: Valuation,
  today: Day,
): Result<Valuation, AssetError> {
  const invalidValue = (message: string) => err(assetError('invalid-valuation', message));
  if (!isValidDate(valuation.valuedOn)) return invalidValue('Enter the date as YYYY-MM-DD.');
  if (valuation.valuedOn > today) return invalidValue('The date cannot be in the future.');
  if (valuation.amount < 0n) return invalidValue('A value cannot be negative.');
  return ok(valuation);
}

export function latestValuation(valuations: readonly Valuation[]): Valuation | null {
  return valuations.reduce<Valuation | null>(
    (latest, valuation) => (!latest || valuation.valuedOn > latest.valuedOn ? valuation : latest),
    null,
  );
}

export function validateStream(stream: ExpectedStream): Result<ExpectedStream, AssetError> {
  const invalidStream = (message: string) => err(assetError('invalid-stream', message));
  const name = stream.name.trim();
  if (!name) return invalidStream('Enter a name.');
  if (!STREAM_KINDS.includes(stream.kind)) return invalidStream('Choose income or expense.');
  if (stream.amount <= 0n) return invalidStream('The amount must be greater than zero.');
  const schedule = validateSchedule(stream.schedule);
  return schedule.ok ? ok({ ...stream, name, schedule: schedule.value }) : schedule;
}
