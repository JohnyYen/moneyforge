import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

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

/** The label keeps a body and a reference with the same text from sharing a key. */
const keyedHash = (label: string, text: string, secret: string) =>
  bytesToHex(hmac(sha256, utf8ToBytes(secret), utf8ToBytes(`${label}\0${text}`)));

/** A dedup key that outlives the erased body and reveals nothing without the install's secret. */
export function hashBody(body: string, secret: string): string {
  return keyedHash('body', foldCase(normalizeBody(body)), secret);
}

/** The kind is part of the key, so a reversal or the other side of a transfer stays apart. */
export function referenceKeyFor(
  kind: string,
  reference: string | null,
  secret: string,
): string | null {
  const key = normalizeReference(reference);
  return key ? keyedHash('reference', `${kind}\0${key}`, secret) : null;
}

// Every pattern below has fixed alternatives and no nested repetition, so none can backtrack
// badly, and each runs on text already capped at MAX_MESSAGE_LENGTH.
const ONE_TIME_WORDS =
  /\b(?:otp|one[- ]time|passcode|(?:verification|verify|security|login|authentication) code|c[oó]digo de (?:verificaci[oó]n|seguridad|acceso)|clave (?:din[aá]mica|temporal))\b/i;
const CODE_WORDS = /\b(?:codes?|c[oó]digo|pin|token|clave)\b/i;
const DIGIT_CODE = /\b[0-9]{4,8}\b/;
const BARE_CODE = /^[a-z]{0,2}-?[0-9]{4,8}\.?$/i;
// A purchase notice names these, so only there do they say nothing about a one-time code.
const AUTHORIZATION_CODE =
  /\b(?:(?:auth(?:orization)?|approval) codes?|c[oó]digos? de (?:autorizaci[oó]n|aprobaci[oó]n))\b/gi;
// With the digits it names, so the code itself can never pass as the amount of its own notice.
const AUTHORIZATION_CODE_VALUE = new RegExp(
  `${AUTHORIZATION_CODE.source}[\\s:#]*(?:(?:is|es|of|de|no\\.?)\\s+)?[0-9]+`,
  'gi',
);
const PURCHASE_CONTEXT =
  /\b(?:purchase|paid|payment|charged|approved|transaction|compra|pago|cargo|aprobad[ao]|transacci[oó]n)\b/i;
// Dates and times stay one token, which then fails the shape of an amount.
const NUMBER_TOKEN = /[0-9]+(?:[.,/:-][0-9]+)*/g;
const AMOUNT_SHAPE = /^[0-9]+(?:[.,][0-9]{3})*(?:[.,][0-9]{1,2})?$/;
const DECIMAL_PART = /[.,][0-9]{2}$/;
const YEAR = /^(?:19|20)[0-9]{2}$/;
const SYMBOL_BEFORE = /[$€£¥₹]\s*$/;
const SYMBOL_AFTER = /^\s*[$€£¥₹]/;
// A known list, because any three letters would let `REF 5521` pass as an amount.
const CURRENCY_NAMES =
  'usd|eur|gbp|jpy|cny|chf|cad|aud|nzd|sek|nok|dkk|mxn|cop|brl|ars|clp|pen|uyu|bob|pyg|ves|dop|crc|gtq|hnl|nio|pab|inr|krw|try|zar|usdt|usdc|dai|btc|eth|pesos|d[oó]lares|dollars|euros';
const CURRENCY_BEFORE = new RegExp(`\\b(?:${CURRENCY_NAMES})\\s*$`, 'i');
const CURRENCY_AFTER = new RegExp(`^\\s*(?:${CURRENCY_NAMES})\\b`, 'i');
const AMOUNT_WORD_BEFORE = /\b(?:of|de|por|amount|monto|valor|total)[\s:]*$/i;
const COUNTED_THING_AFTER =
  /^\s*(?:sec|secs|seconds?|min|mins|minutes?|hours?|hrs?|days?|digits?|segundos?|minutos?|horas?|d[ií]as?|d[ií]gitos?)\b/i;
const DO_NOT_SHARE =/\b(?:do not|don'?t|never) share\b|\bno (?:lo |la )?compart[ai]s?\b/i;

/** A count alone proves nothing: a date or a second code would pass as the amount. */
function hasMoneyAmount(text: string): boolean {
  for (const match of text.matchAll(NUMBER_TOKEN)) {
    const token = match[0];
    if (!AMOUNT_SHAPE.test(token)) continue;
    const before = text.slice(0, match.index);
    const after = text.slice(match.index + token.length);
    if (SYMBOL_BEFORE.test(before) || SYMBOL_AFTER.test(after)) return true;
    if (CURRENCY_BEFORE.test(before) || CURRENCY_AFTER.test(after)) return true;
    if (DECIMAL_PART.test(token)) return true;
    const counted = YEAR.test(token) || COUNTED_THING_AFTER.test(after);
    if (AMOUNT_WORD_BEFORE.test(before) && !counted) return true;
  }
  return false;
}

export function looksLikeOneTimeCode(body: string): boolean {
  const text = normalizeBody(body);
  if (ONE_TIME_WORDS.test(text) || BARE_CODE.test(text)) return true;
  if (DO_NOT_SHARE.test(text) && DIGIT_CODE.test(text)) return true;
  // A code alone is not a purchase notice: without a separate amount no rule could post it anyway,
  // so failing toward privacy here loses nothing.
  const isPurchaseNotice =
    PURCHASE_CONTEXT.test(text) && hasMoneyAmount(text.replace(AUTHORIZATION_CODE_VALUE, ' '));
  const rest = isPurchaseNotice ? text.replace(AUTHORIZATION_CODE, ' ') : text;
  return CODE_WORDS.test(rest) && DIGIT_CODE.test(rest);
}
