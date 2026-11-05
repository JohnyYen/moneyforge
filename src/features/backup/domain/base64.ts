const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const VALUES = new Map<string, number>(
  [...ALPHABET].map((char, index) => [char, index] as const),
);

/**
 * Standard base64 with padding, and nothing else.
 *
 * The container is a text a person may carry between devices, so the same bytes must always
 * read back as the same bytes: every encoding this function accepts has one meaning, and an
 * encoding with unused bits set is refused instead of guessed.
 */
export function encodeBase64(bytes: Uint8Array): string {
  let text = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const [first, second, third] = [bytes[index], bytes[index + 1], bytes[index + 2]];
    const group = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    text += ALPHABET[(group >> 18) & 63];
    text += ALPHABET[(group >> 12) & 63];
    text += second === undefined ? '=' : ALPHABET[(group >> 6) & 63];
    text += third === undefined ? '=' : ALPHABET[group & 63];
  }
  return text;
}

/** Read back what `encodeBase64` wrote, or `null` when the text has no single meaning. */
export function decodeBase64(text: string): Uint8Array | null {
  if (text === '') return new Uint8Array(0);
  if (text.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return null;

  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  const body = padding === 0 ? text : text.slice(0, -padding);
  const bytes: number[] = [];

  for (let index = 0; index < body.length; index += 4) {
    const chunk = body.slice(index, index + 4);
    const values = [...chunk].map((char) => VALUES.get(char));
    if (values.some((value) => value === undefined)) return null;
    const [first, second, third, fourth] = values as number[];
    const group =
      ((first ?? 0) << 18) | ((second ?? 0) << 12) | ((third ?? 0) << 6) | (fourth ?? 0);
    bytes.push((group >> 16) & 255);
    if (third !== undefined) bytes.push((group >> 8) & 255);
    if (fourth !== undefined) bytes.push(group & 255);
  }

  // Padding must cover exactly the bytes the text did not carry, and no more.
  const last = body.slice(-1);
  const tail = VALUES.get(last);
  if (padding === 2 && (tail === undefined || (tail & 0b1111) !== 0)) return null;
  if (padding === 1 && (tail === undefined || (tail & 0b11) !== 0)) return null;
  if (padding === 0 && body.length % 4 !== 0) return null;

  return Uint8Array.from(bytes);
}
