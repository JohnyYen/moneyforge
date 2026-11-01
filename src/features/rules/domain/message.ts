export const MESSAGE_CHANNELS = ['sms', 'paste'] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];

/** Above this length a message is never matched, which bounds the work on any input. */
export const MAX_MESSAGE_LENGTH = 2000;

export function normalizeSender(sender: string): string {
  return sender
    .trim()
    .toLowerCase()
    .replace(/[\s\-().]/g, '');
}

export function normalizeBody(body: string): string {
  return body
    .replace(/[​-‍﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Lowercases one unit at a time, so every index still points into the original text. */
export function foldCase(text: string): string {
  let folded = '';
  for (let index = 0; index < text.length; index += 1) {
    const lower = text[index].toLowerCase();
    folded += lower.length === 1 ? lower : text[index];
  }
  return folded;
}

export function normalizeReference(reference: string | null): string | null {
  const key = reference?.trim().toUpperCase();
  return key ? key : null;
}

/** A paste may name any source, because it came from a person. An SMS proves only its sender. */
export function acceptsChannel(
  source: { readonly channel: MessageChannel },
  channel: MessageChannel,
): boolean {
  return channel === 'paste' || source.channel === 'sms';
}

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const HASH_MASK = 0xffffffffffffffffn;

/** FNV-1a over the normalized text: a dedup key that outlives the erased body. */
export function hashBody(body: string): string {
  const text = foldCase(normalizeBody(body));
  let hash = FNV_OFFSET;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash ^ BigInt(text.charCodeAt(index))) * FNV_PRIME) & HASH_MASK;
  }
  return hash.toString(16).padStart(16, '0');
}

// Every pattern below has fixed alternatives and no nested repetition, so none can backtrack
// badly, and each runs on text already capped at MAX_MESSAGE_LENGTH.
const ONE_TIME_WORDS =
  /\b(?:otp|one[- ]time|passcode|(?:verification|verify|security|login|auth|authentication) code|c[oó]digo de (?:verificaci[oó]n|seguridad|acceso)|clave (?:din[aá]mica|temporal))\b/i;
const CODE_WORDS = /\b(?:codes?|c[oó]digo|pin|token|clave)\b/i;
const DIGIT_CODE = /\b[0-9]{4,8}\b/;
const BARE_CODE = /^[a-z]{0,2}-?[0-9]{4,8}\.?$/i;

export function looksLikeOneTimeCode(body: string): boolean {
  const text = normalizeBody(body);
  return (
    ONE_TIME_WORDS.test(text) ||
    BARE_CODE.test(text) ||
    (CODE_WORDS.test(text) && DIGIT_CODE.test(text))
  );
}
