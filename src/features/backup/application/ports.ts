import type { Result } from '@/shared/result';

import type { KeyDerivation } from '../domain/backup-container';

/**
 * What the platform must provide: a key from the passphrase, AES-256-GCM, and random bytes.
 * Both implementations must agree, or a file written on one device could not open on another.
 */
export type BackupCipher = {
  deriveKey(passphrase: Uint8Array, salt: Uint8Array, kdf: KeyDerivation): Promise<Uint8Array>;
  /** Seals with a 16-byte tag appended to the ciphertext. */
  seal(
    key: Uint8Array,
    nonce: Uint8Array,
    plaintext: Uint8Array,
    additionalData: Uint8Array,
  ): Promise<Uint8Array>;
  /** Opens a sealed value, and rejects when the tag or the additional data does not match. */
  open(
    key: Uint8Array,
    nonce: Uint8Array,
    sealed: Uint8Array,
    additionalData: Uint8Array,
  ): Promise<Uint8Array>;
  randomBytes(count: number): Promise<Uint8Array>;
};

/** How a file leaves and returns: the share sheet, the clipboard, a message to oneself. */
export type BackupTransport = {
  /** The largest text this path is known to carry in one piece. */
  readonly maxChars: number;
  send(text: string): Promise<Result<void, { readonly code: string; readonly message: string }>>;
  receive(text: string): Promise<Result<string, { readonly code: string; readonly message: string }>>;
};
