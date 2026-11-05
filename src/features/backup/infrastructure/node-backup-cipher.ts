import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

import type { BackupCipher } from '../application/ports';

const TAG_BYTES = 16;
/** 128 * N * r for the chosen cost is 32 MiB, so this leaves room without inviting a huge N. */
const MAX_MEMORY = 64 * 1024 * 1024;

/**
 * The same format on a desktop: tests and the command line can read what the phone wrote, and
 * the reverse. It exists for that, never for the app itself.
 */
export function createNodeBackupCipher(): BackupCipher {
  return {
    deriveKey: async (passphrase, salt, kdf) =>
      new Uint8Array(
        scryptSync(passphrase, salt, kdf.dkLen, {
          N: kdf.N,
          r: kdf.r,
          p: kdf.p,
          maxmem: MAX_MEMORY,
        }),
      ),
    seal: async (key, nonce, plaintext, additionalData) => {
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      cipher.setAAD(additionalData);
      const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return new Uint8Array(Buffer.concat([body, cipher.getAuthTag()]));
    },
    open: async (key, nonce, sealed, additionalData) => {
      const decipher = createDecipheriv('aes-256-gcm', key, nonce);
      decipher.setAAD(additionalData);
      decipher.setAuthTag(Buffer.from(sealed.subarray(-TAG_BYTES)));
      const body = decipher.update(sealed.subarray(0, -TAG_BYTES));
      return new Uint8Array(Buffer.concat([body, decipher.final()]));
    },
    randomBytes: async (count) => new Uint8Array(randomBytes(count)),
  };
}
