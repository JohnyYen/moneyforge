import { err, ok, type Result } from '@/shared/result';

import { decodeBase64, encodeBase64 } from './base64';

/** The first word of every file, so unrelated text is refused by name and not by luck. */
export const BACKUP_MAGIC = 'MONEYFORGE-BACKUP';

/** The container layout, not the database schema. It changes only when a reader must change. */
export const BACKUP_FORMAT_VERSION = 1;

export type KeyDerivation = {
  readonly name: 'scrypt';
  readonly N: number;
  readonly r: number;
  readonly p: number;
  readonly dkLen: number;
};

/** Chosen once: the cost is written into the file, so a reader uses what the writer used. */
export const DEFAULT_KDF: KeyDerivation = {
  name: 'scrypt',
  N: 32768,
  r: 8,
  p: 1,
  dkLen: 32,
};

const MIN_KDF_N = 2 ** 14;
const MAX_KDF_N = 2 ** 20;
const SALT_BYTES = 16;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export type ContainerHeader = {
  readonly schemaVersion: number;
  readonly kdf: KeyDerivation;
  readonly salt: Uint8Array;
  readonly nonce: Uint8Array;
};

export type Container = {
  readonly header: ContainerHeader;
  readonly ciphertext: Uint8Array;
  /** The header text the cipher authenticated, as bytes. */
  readonly additionalData: Uint8Array;
};

export type ContainerErrorCode = 'not-a-backup' | 'newer-format' | 'newer-schema' | 'damaged';

export type ContainerError = {
  readonly code: ContainerErrorCode;
  readonly message: string;
};

const fail = (code: ContainerErrorCode, message: string) => err<ContainerError>({ code, message });

/** ASCII bytes for the header, which holds nothing but what a reader needs before decrypting. */
function headerText(header: ContainerHeader): string {
  const { kdf } = header;
  return (
    `{"schemaVersion":${header.schemaVersion},` +
    `"kdf":{"name":"${kdf.name}","N":${kdf.N},"r":${kdf.r},"p":${kdf.p},"dkLen":${kdf.dkLen}},` +
    `"salt":"${encodeBase64(header.salt)}",` +
    `"nonce":"${encodeBase64(header.nonce)}"}`
  );
}

/**
 * Everything the cipher authenticates: the magic, the format, and the header. A file whose
 * header was edited therefore fails to open instead of being read with another cost or salt.
 */
export function containerPrefix(header: ContainerHeader): string {
  return `${BACKUP_MAGIC}.${BACKUP_FORMAT_VERSION}.${encodeBase64(asciiBytes(headerText(header)))}`;
}

export function encodeContainer(header: ContainerHeader, ciphertext: Uint8Array): string {
  return `${containerPrefix(header)}.${encodeBase64(ciphertext)}`;
}

function asciiBytes(text: string): Uint8Array {
  return Uint8Array.from(text, (char) => char.charCodeAt(0));
}

function asciiText(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return text;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).sort().join() === [...keys].sort().join();

function readKdf(value: unknown): KeyDerivation | null {
  if (!isObject(value) || !hasExactKeys(value, ['name', 'N', 'r', 'p', 'dkLen'])) return null;
  const { name, N, r, p, dkLen } = value;
  if (name !== 'scrypt' || typeof N !== 'number' || !Number.isInteger(N)) return null;
  if (N < MIN_KDF_N || N > MAX_KDF_N || (N & (N - 1)) !== 0) return null;
  if (r !== 8 || p !== 1 || dkLen !== 32) return null;
  return { name, N, r, p, dkLen };
}

/**
 * Reads a container without decrypting it, so a newer schema, a damaged header, or unrelated
 * text is refused before a passphrase costs anything.
 */
export function parseContainer(
  text: string,
  currentSchemaVersion: number,
): Result<Container, ContainerError> {
  const cleaned = text.replace(/\s+/g, '');
  if (cleaned === '') return fail('not-a-backup', 'That text is empty, so it is not a backup.');

  const parts = cleaned.split('.');
  if (parts[0] !== BACKUP_MAGIC) {
    return fail('not-a-backup', 'That text is not a MoneyForge backup.');
  }
  if (parts.length !== 4) {
    return fail('damaged', 'This backup is incomplete. Copy the whole file and try again.');
  }
  const [, format, headerPart, cipherPart] = parts;
  if (format === '0' || !/^\d+$/.test(format)) {
    return fail('not-a-backup', 'That text is not a MoneyForge backup.');
  }
  if (Number(format) > BACKUP_FORMAT_VERSION) {
    return fail('newer-format', 'This backup needs a newer version of MoneyForge to open.');
  }

  const headerBytes = decodeBase64(headerPart);
  if (!headerBytes || headerBytes.some((byte) => byte > 0x7f)) {
    return fail('damaged', 'This backup header is damaged.');
  }

  let fields: unknown;
  try {
    fields = JSON.parse(asciiText(headerBytes));
  } catch {
    return fail('damaged', 'This backup header is damaged.');
  }
  if (!isObject(fields) || !hasExactKeys(fields, ['schemaVersion', 'kdf', 'salt', 'nonce'])) {
    return fail('damaged', 'This backup header is damaged.');
  }

  const { schemaVersion, salt, nonce } = fields;
  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion) || schemaVersion < 1) {
    return fail('damaged', 'This backup header is damaged.');
  }
  if (schemaVersion > currentSchemaVersion) {
    return fail(
      'newer-schema',
      'This backup was written by a newer version of MoneyForge. Update the app to restore it.',
    );
  }

  const kdf = readKdf(fields.kdf);
  const saltBytes = typeof salt === 'string' ? decodeBase64(salt) : null;
  const nonceBytes = typeof nonce === 'string' ? decodeBase64(nonce) : null;
  if (!kdf || !saltBytes || !nonceBytes) {
    return fail('damaged', 'This backup header is damaged.');
  }
  if (saltBytes.length < SALT_BYTES || nonceBytes.length !== NONCE_BYTES) {
    return fail('damaged', 'This backup header is damaged.');
  }

  const ciphertext = decodeBase64(cipherPart);
  if (!ciphertext || ciphertext.length < TAG_BYTES) {
    return fail('damaged', 'This backup is incomplete. Copy the whole file and try again.');
  }

  const header: ContainerHeader = { schemaVersion, kdf, salt: saltBytes, nonce: nonceBytes };
  return ok({
    header,
    ciphertext,
    additionalData: asciiBytes(containerPrefix(header)),
  });
}
