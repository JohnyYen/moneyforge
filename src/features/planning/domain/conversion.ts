import type { Currency } from '@/features/ledger/domain/currency';
import { findRate, type ExchangeRate } from '@/features/ledger/domain/exchange-rate';
import { convertMinor } from '@/features/ledger/domain/rate';

import type { Day } from './calendar';

export type ConversionContext = {
  readonly rates: readonly ExchangeRate[];
  readonly currencies: readonly Currency[];
};

/** `null` when no stored rate reaches this day, so a caller can never read it as zero. */
export function convertOn(
  minor: bigint,
  from: string,
  to: Currency,
  day: Day,
  { rates, currencies }: ConversionContext,
): bigint | null {
  if (from === to.code) return minor;
  const source = currencies.find(({ code }) => code === from);
  const rate = findRate(rates, from, to.code, day);
  return source && rate ? convertMinor(minor, rate, source.decimals, to.decimals) : null;
}
