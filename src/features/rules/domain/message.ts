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
// A purchase notice names these, so they say nothing about a one-time code.
const AUTHORIZATION_CODE =
  /\b(?:auth(?:orization)?|approval) codes?\b|\bc[oó]digos? de (?:autorizaci[oó]n|aprobaci[oó]n)\b/gi;

export function looksLikeOneTimeCode(body: string): boolean {
  const text = normalizeBody(body);
  if (ONE_TIME_WORDS.test(text) || BARE_CODE.test(text)) return true;
  const rest = text.replace(AUTHORIZATION_CODE, ' ');
  return CODE_WORDS.test(rest) && DIGIT_CODE.test(rest);
}
