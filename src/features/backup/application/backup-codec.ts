import { err, type Result } from '@/shared/result';

import {
  DEFAULT_KDF,
  containerPrefix,
  encodeContainer,
  type Container,
} from '../domain/backup-container';
import {
  decodeSnapshot,
  encodeSnapshot,
  validateSnapshot,
  type BackupSnapshot,
  type SnapshotError,
} from '../domain/backup-snapshot';
import type { BackupCipher } from './ports';

const SALT_BYTES = 16;
const NONCE_BYTES = 12;

export type OpenError = SnapshotError | { readonly code: 'cannot-open'; readonly message: string };

function asciiBytes(text: string): Uint8Array {
  return Uint8Array.from(text, (char) => char.charCodeAt(0));
}

/** The passphrase is text, and a device may hold any character in it. */
export function utf8Bytes(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
}

/** A fresh salt and nonce per file, so two exports of the same ledger share nothing. */
export async function sealSnapshot(
  snapshot: BackupSnapshot,
  passphrase: string,
  cipher: BackupCipher,
): Promise<string> {
  const salt = await cipher.randomBytes(SALT_BYTES);
  const nonce = await cipher.randomBytes(NONCE_BYTES);
  const key = await cipher.deriveKey(utf8Bytes(passphrase), salt, DEFAULT_KDF);
  const header = { schemaVersion: snapshot.schemaVersion, kdf: DEFAULT_KDF, salt, nonce };
  const sealed = await cipher.seal(
    key,
    nonce,
    encodeSnapshot(snapshot),
    asciiBytes(containerPrefix(header)),
  );
  return encodeContainer(header, sealed);
}

/**
 * Authenticates the header and the payload together, then checks what the file claims: the
 * header of a file edited by hand no longer opens, and a damaged order of tables is refused
 * before any write.
 */
export async function openContainer(
  container: Container,
  passphrase: string,
  cipher: BackupCipher,
): Promise<Result<BackupSnapshot, OpenError>> {
  const { header } = container;
  const { nonce } = header;
  let plaintext: Uint8Array;
  try {
    const key = await cipher.deriveKey(utf8Bytes(passphrase), header.salt, header.kdf);
    plaintext = await cipher.open(key, nonce, container.ciphertext, container.additionalData);
  } catch {
    return err({
      code: 'cannot-open',
      message: 'The passphrase does not open this backup, or the file was changed.',
    });
  }
  const snapshot = decodeSnapshot(plaintext);
  if (!snapshot) {
    return err({ code: 'invalid-contents', message: 'This backup holds nothing readable.' });
  }
  return validateSnapshot(snapshot, header.schemaVersion);
}
