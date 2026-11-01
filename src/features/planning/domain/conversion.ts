import type { Currency } from '@/features/ledger/domain/currency';
import { findRate, type ExchangeRate } from '@/features/ledger/domain/exchange-rate';
import { convertMinor } from '@/features/ledger/domain/rate';

import type { Day } from './calendar';

export type ConversionContext = {
  readonly rates: readonly ExchangeRate[];
  readonly currencies: readonly Currency[];
};

type Converter = (minor: bigint) => bigint;

/** Resolves the rate once, for many amounts on one day. `null` when no stored rate reaches it. */
export function converterOn(
  from: string,
  to: Currency,
  day: Day,
  { rates, currencies }: ConversionContext,
): Converter | null {
  if (from === to.code) return (minor) => minor;
  const source = currencies.find(({ code }) => code === from);
  const rate = findRate(rates, from, to.code, day);
  if (!source || !rate) return null;
  return (minor) => convertMinor(minor, rate, source.decimals, to.decimals);
}

/** `null` when no stored rate reaches this day, so a caller can never read it as zero. */
export function convertOn(
  minor: bigint,
  from: string,
  to: Currency,
  day: Day,
  context: ConversionContext,
): bigint | null {
  const convert = converterOn(from, to, day, context);
  return convert ? convert(minor) : null;
}
