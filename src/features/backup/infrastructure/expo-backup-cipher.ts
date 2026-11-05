import { scryptAsync } from '@noble/hashes/scrypt';
import {
  AESEncryptionKey,
  AESSealedData,
  aesDecryptAsync,
  aesEncryptAsync,
  getRandomBytesAsync,
} from 'expo-crypto';

import type { BackupCipher } from '../application/ports';
import { encodeBase64 as bytesToBase64 } from '../domain/base64';

const TAG_BYTES = 16;
/** 128 * N * r for the chosen cost is 32 MiB, so this leaves room without inviting a huge N. */
const MAX_MEMORY = 64 * 1024 * 1024;

/**
 * The production cipher: noble scrypt derives the key, and the platform seals with AES-256-GCM.
 * The header travels as additional data, so an edited file fails to open rather than being read
 * with another cost or salt.
 */
export function createExpoBackupCipher(): BackupCipher {
  return {
    deriveKey: async (passphrase, salt, kdf) =>
      scryptAsync(passphrase, salt, {
        N: kdf.N,
        r: kdf.r,
        p: kdf.p,
        dkLen: kdf.dkLen,
        maxmem: MAX_MEMORY,
      }),
    seal: async (key, nonce, plaintext, additionalData) => {
      const imported = await AESEncryptionKey.import(key);
      const sealed = await aesEncryptAsync(plaintext, imported, {
        nonce: { bytes: bytesToBase64(nonce) },
        tagLength: TAG_BYTES,
        additionalData: bytesToBase64(additionalData),
      });
      return sealed.ciphertext({ includeTag: true, encoding: 'bytes' });
    },
    open: async (key, nonce, sealed, additionalData) => {
      const imported = await AESEncryptionKey.import(key);
      const data = AESSealedData.fromParts(bytesToBase64(nonce), sealed, TAG_BYTES);
      return aesDecryptAsync(data, imported, { additionalData: bytesToBase64(additionalData) });
    },
    randomBytes: async (count) => new Uint8Array(await getRandomBytesAsync(count)),
  };
}
