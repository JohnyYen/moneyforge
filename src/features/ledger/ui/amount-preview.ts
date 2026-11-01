import type { Currency } from '../domain/currency';
import { formatDisplay, parseDecimal } from '../domain/money';
import { convertMinor, formatRate, parseRate } from '../domain/rate';

/** Which amounts a field accepts: `any` suits a balance, which may be zero or overdrawn. */
export type AmountRule = 'positive' | 'non-negative' | 'any';

const NOT_POSITIVE = 'The amount must be greater than zero.';
const NEGATIVE = 'The amount cannot be negative.';

function ruleViolation(minor: bigint, rule: AmountRule): string | null {
  if (rule === 'positive' && minor <= 0n) return NOT_POSITIVE;
  if (rule === 'non-negative' && minor < 0n) return NEGATIVE;
  return null;
}

export function amountPreview(
  text: string,
  currency: Currency | undefined,
  rule: AmountRule = 'positive',
): string | null {
  if (!text.trim() || !currency) return null;
  const parsed = parseDecimal(text, currency.decimals);
  if (!parsed.ok) return parsed.error.message;
  return ruleViolation(parsed.value, rule) ?? `Saved as ${formatDisplay(parsed.value, currency)}`;
}

/** The field left blank stores what the rate yields, so that is what it previews. */
export function receivedPreview({
  received,
  sent,
  rate,
  source,
  target,
}: {
  received: string;
  sent: string;
  rate: string;
  source: Currency | undefined;
  target: Currency | undefined;
}): string | null {
  if (received) return amountPreview(received, target);
  if (!source || !target) return null;
  const amount = parseDecimal(sent, source.decimals);
  const parsedRate = parseRate(rate);
  if (!amount.ok || !parsedRate.ok || amount.value <= 0n) return null;
  const derived = convertMinor(amount.value, parsedRate.value, source.decimals, target.decimals);
  return ruleViolation(derived, 'positive') ?? `Saved as ${formatDisplay(derived, target)}`;
}

export function ratePreview(
  text: string,
  fromCode: string | null | undefined,
  toCode: string | null | undefined,
): string | null {
  if (!text.trim()) return null;
  const parsed = parseRate(text);
  if (!parsed.ok) return parsed.error.message;
  const rate = formatRate(parsed.value);
  return `Saved as ${fromCode && toCode ? `1 ${fromCode} = ${rate} ${toCode}` : rate}`;
}
