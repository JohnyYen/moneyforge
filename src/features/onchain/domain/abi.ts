import { isValidDecimals } from '@/features/ledger/domain/money';

export const BALANCE_OF_SELECTOR = '70a08231';
export const DECIMALS_SELECTOR = '313ce567';

const WORD_PATTERN = /^(?:0x)?[0-9a-fA-F]{64}$/;

/** One 32 byte unsigned word, exactly, as a `bigint`. Anything else is not an answer. */
export function parseUintWord(text: string): bigint | null {
  if (!WORD_PATTERN.test(text)) return null;
  return BigInt(`0x${text.replace(/^0x/, '')}`);
}

export function parseDecimalsWord(text: string): number | null {
  const value = parseUintWord(text);
  if (value === null || value > 255n) return null;
  return isValidDecimals(Number(value)) ? Number(value) : null;
}
