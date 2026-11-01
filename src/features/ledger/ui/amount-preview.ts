import type { Currency } from '../domain/currency';
import { formatDisplay, parseDecimal } from '../domain/money';
import { formatRate, parseRate } from '../domain/rate';

export function amountPreview(text: string, currency: Currency | undefined): string | null {
  if (!text.trim() || !currency) return null;
  const parsed = parseDecimal(text, currency.decimals);
  return parsed.ok ? `Saved as ${formatDisplay(parsed.value, currency)}` : parsed.error.message;
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
