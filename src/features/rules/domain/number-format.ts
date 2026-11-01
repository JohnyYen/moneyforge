export const DECIMAL_SEPARATORS = ['.', ','] as const;
export const THOUSANDS_SEPARATORS = [',', '.', ' ', "'", ''] as const;

export type NumberFormat = {
  readonly decimal: (typeof DECIMAL_SEPARATORS)[number];
  readonly thousands: (typeof THOUSANDS_SEPARATORS)[number];
};

export function isValidNumberFormat({ decimal, thousands }: {
  readonly decimal: string;
  readonly thousands: string;
}): boolean {
  return (
    (DECIMAL_SEPARATORS as readonly string[]).includes(decimal) &&
    (THOUSANDS_SEPARATORS as readonly string[]).includes(thousands) &&
    decimal !== thousands
  );
}

const DIGITS = /^[0-9]+$/;
const FIRST_GROUP = /^[0-9]{1,3}$/;
const LATER_GROUP = /^[0-9]{3}$/;

function plainWholePart(text: string, thousands: string): string | null {
  if (thousands === '' || !text.includes(thousands)) return DIGITS.test(text) ? text : null;
  const [first, ...rest] = text.split(thousands);
  const valid = FIRST_GROUP.test(first) && rest.every((group) => LATER_GROUP.test(group));
  return valid ? [first, ...rest].join('') : null;
}

/**
 * Rewrites an amount as a plain decimal such as `1500.25`, or returns null. It reads only
 * what the rule's format allows, because `1.500` means 1.5 or 1500 depending on the bank.
 */
export function parseAmountText(text: string, format: NumberFormat): string | null {
  const [whole, fraction, extra] = text.split(format.decimal);
  if (extra !== undefined) return null;
  if (fraction !== undefined && !DIGITS.test(fraction)) return null;
  const plain = plainWholePart(whole, format.thousands);
  if (plain === null) return null;
  return fraction === undefined ? plain : `${plain}.${fraction}`;
}
