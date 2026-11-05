import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

import { sealSnapshot, openContainer } from '../application/backup-codec';
import { DEFAULT_KDF, parseContainer } from '../domain/backup-container';
import { decodeBase64, encodeBase64 } from '../domain/base64';
import type { BackupSnapshot } from '../domain/backup-snapshot';
import { createExpoBackupCipher } from './expo-backup-cipher';
import { createNodeBackupCipher } from './node-backup-cipher';

/**
 * Stands in for the native module, following its typings and `AesCryptoModule.kt`: nonce and
 * additional data arrive base64-encoded, and sealed data holds the ciphertext with its tag.
 */
jest.mock('expo-crypto', () => {
  const crypto = jest.requireActual<typeof import('node:crypto')>('node:crypto');
  const bytesOf = (input: string | Uint8Array) =>
    typeof input === 'string' ? Buffer.from(input, 'base64') : Buffer.from(input);
  class AESSealedData {
    readonly iv: Buffer;
    readonly tagged: Buffer;
    constructor(iv: Buffer, tagged: Buffer) {
      this.iv = iv;
      this.tagged = tagged;
    }
    static fromParts(iv: string, ciphertext: Uint8Array, tagLength: number) {
      if (tagLength !== 16) throw new Error('unexpected tag length');
      return new AESSealedData(bytesOf(iv), bytesOf(ciphertext));
    }
    async ciphertext({ includeTag, encoding }: { includeTag: boolean; encoding: string }) {
      if (!includeTag || encoding !== 'bytes') throw new Error('unexpected ciphertext options');
      return new Uint8Array(this.tagged);
    }
  }
  return {
    AESEncryptionKey: { import: async (key: Uint8Array) => ({ raw: Buffer.from(key) }) },
    AESSealedData,
    getRandomBytesAsync: async (count: number) => new Uint8Array(crypto.randomBytes(count)),
    aesEncryptAsync: async (
      plaintext: Uint8Array,
      key: { raw: Buffer },
      options: { nonce: { bytes: string }; tagLength: number; additionalData: string },
    ) => {
      const iv = bytesOf(options.nonce.bytes);
      const cipher = crypto.createCipheriv('aes-256-gcm', key.raw, iv);
      cipher.setAAD(bytesOf(options.additionalData));
      const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return new AESSealedData(iv, Buffer.concat([body, cipher.getAuthTag()]));
    },
    aesDecryptAsync: async (
      sealed: InstanceType<typeof AESSealedData>,
      key: { raw: Buffer },
      options: { additionalData: string },
    ) => {
      const cipher = crypto.createDecipheriv('aes-256-gcm', key.raw, sealed.iv);
      cipher.setAAD(bytesOf(options.additionalData));
      cipher.setAuthTag(sealed.tagged.subarray(-16));
      const body = sealed.tagged.subarray(0, -16);
      return new Uint8Array(Buffer.concat([cipher.update(body), cipher.final()]));
    },
  };
});

const snapshot: BackupSnapshot = {
  schemaVersion: 7,
  createdAt: '2026-03-10T12:00:00.000Z',
  tables: [
    { name: 'postings', columns: ['transaction_id', 'amount', 'currency_code'], rows: [] },
    { name: 'settings', columns: ['key', 'value'], rows: [['a', 'pagó']] },
  ],
};
const PASSPHRASE = 'correct horse battery';

const open = async (text: string, cipher = createNodeBackupCipher()) => {
  const parsed = parseContainer(text, 7);
  if (!parsed.ok) throw new Error(parsed.error.code);
  return openContainer(parsed.value, PASSPHRASE, cipher);
};

describe('backup ciphers', () => {
  const [expo, node] = [createExpoBackupCipher(), createNodeBackupCipher()];

  it('derives the same key with noble scrypt as Node, for passphrases outside ASCII', async () => {
    const salt = new Uint8Array(16).fill(7);
    const secret = new Uint8Array(Buffer.from('contraseña 💸', 'utf8'));
    const expected = new Uint8Array(
      scryptSync(secret, salt, 32, { N: DEFAULT_KDF.N, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }),
    );
    expect(await expo.deriveKey(secret, salt, DEFAULT_KDF)).toEqual(expected);
    expect(await node.deriveKey(secret, salt, DEFAULT_KDF)).toEqual(expected);
  });

  it('reads in Node what the production cipher wrote, and the reverse', async () => {
    const fromExpo = await sealSnapshot(snapshot, PASSPHRASE, expo);
    const fromNode = await sealSnapshot(snapshot, PASSPHRASE, node);
    expect(await open(fromExpo, node)).toEqual({ ok: true, value: snapshot });
    expect(await open(fromNode, expo)).toEqual({ ok: true, value: snapshot });
  });

  it('matches AES-256-GCM as Node computes it, tag last', async () => {
    const [key, nonce, aad] = [randomBytes(32), randomBytes(12), randomBytes(20)];
    const plaintext = randomBytes(100);
    const direct = createCipheriv('aes-256-gcm', key, nonce).setAAD(aad);
    const body = Buffer.concat([direct.update(plaintext), direct.final(), direct.getAuthTag()]);
    const sealed = await expo.seal(key, nonce, plaintext, aad);
    expect(Buffer.from(sealed).equals(body)).toBe(true);

    const decipher = createDecipheriv('aes-256-gcm', key, nonce).setAAD(aad);
    decipher.setAuthTag(Buffer.from(sealed.subarray(-16)));
    decipher.update(sealed.subarray(0, -16));
    expect(() => decipher.final()).not.toThrow();
  });

  it('refuses a changed tag and changed additional data in both', async () => {
    const [key, nonce] = [new Uint8Array(32).fill(1), new Uint8Array(12).fill(2)];
    const aad = new Uint8Array([1, 2, 3]);
    const sealed = await node.seal(key, nonce, new Uint8Array([9, 9]), aad);
    const flipped = sealed.slice();
    flipped[flipped.length - 1] ^= 1;
    for (const cipher of [expo, node]) {
      await expect(cipher.open(key, nonce, flipped, aad)).rejects.toThrow();
      await expect(cipher.open(key, nonce, sealed, new Uint8Array([1, 2]))).rejects.toThrow();
    }
  });

  it('gives random bytes of the size asked', async () => {
    for (const cipher of [expo, node]) {
      const [first, second] = [await cipher.randomBytes(16), await cipher.randomBytes(16)];
      expect(first).toHaveLength(16);
      expect(first).not.toEqual(second);
    }
  });

  it('keeps reading a container written by this format version', async () => {
    const fixture = await sealSnapshot(snapshot, PASSPHRASE, {
      ...node,
      randomBytes: async (count) => new Uint8Array(count).fill(5),
    });
    expect(fixture.split('.').slice(0, 2)).toEqual(['MONEYFORGE-BACKUP', '1']);
    const [, , header] = fixture.split('.');
    expect(Buffer.from(decodeBase64(header) ?? []).toString()).toBe(
      '{"schemaVersion":7,"kdf":{"name":"scrypt","N":32768,"r":8,"p":1,"dkLen":32},' +
        `"salt":"${encodeBase64(new Uint8Array(16).fill(5))}",` +
        `"nonce":"${encodeBase64(new Uint8Array(12).fill(5))}"}`,
    );
    expect(await open(fixture)).toEqual({ ok: true, value: snapshot });
  });
});
