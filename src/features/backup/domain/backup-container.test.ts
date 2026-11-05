import {
  decodeBase64,
  encodeBase64,
} from './base64';
import {
  BACKUP_MAGIC,
  DEFAULT_KDF,
  containerPrefix,
  encodeContainer,
  parseContainer,
  type ContainerHeader,
} from './backup-container';

const header: ContainerHeader = {
  schemaVersion: 7,
  kdf: DEFAULT_KDF,
  salt: new Uint8Array(16).fill(1),
  nonce: new Uint8Array(12).fill(2),
};
const ciphertext = new Uint8Array(40).fill(3);
const encoded = encodeContainer(header, ciphertext);

const rewriteHeader = (change: (fields: Record<string, unknown>) => void) => {
  const parts = encoded.split('.');
  const bytes = decodeBase64(parts[2]);
  if (!bytes) throw new Error('bad fixture');
  const fields = JSON.parse(String.fromCharCode(...bytes)) as Record<string, unknown>;
  change(fields);
  const json = JSON.stringify(fields);
  parts[2] = encodeBase64(Uint8Array.from(json, (char) => char.charCodeAt(0)));
  return parts.join('.');
};

const errorCode = (text: string, current = 7) => {
  const parsed = parseContainer(text, current);
  return parsed.ok ? 'parsed' : parsed.error.code;
};

describe('base64', () => {
  it.each([[''], ['f'], ['fo'], ['foo'], ['foob'], ['fooba'], ['foobar']])('round trips %j', (text) => {
    const bytes = Uint8Array.from(text, (char) => char.charCodeAt(0));
    const encodedText = encodeBase64(bytes);
    expect(encodedText).toBe(Buffer.from(text).toString('base64'));
    expect(decodeBase64(encodedText)).toEqual(bytes);
  });

  it('round trips every byte value', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);
    expect(decodeBase64(encodeBase64(bytes))).toEqual(bytes);
  });

  it.each([['Zg='], ['Zh=='], ['Zm9='], ['Z g=='], ['Zg==Zg=='], ['Z==='], ['*g==']])(
    'refuses %j, so one text has one meaning',
    (text) => {
      expect(decodeBase64(text)).toBeNull();
    },
  );
});

describe('container', () => {
  it('reads back what it wrote', () => {
    const parsed = parseContainer(encoded, 7);
    expect(parsed).toMatchObject({ ok: true, value: { header, ciphertext } });
    if (parsed.ok) {
      expect(String.fromCharCode(...parsed.value.additionalData)).toBe(containerPrefix(header));
    }
  });

  it('is text that starts with the magic and format version', () => {
    expect(encoded.startsWith(`${BACKUP_MAGIC}.1.`)).toBe(true);
    expect(encoded).toMatch(/^[\x21-\x7e]+$/);
  });

  it('survives the line breaks a messaging app may add', () => {
    const wrapped = `  ${encoded.replace(/(.{40})/g, '$1\n')}\n`;
    expect(parseContainer(wrapped, 7)).toMatchObject({ ok: true, value: { header } });
  });

  it('accepts an older schema and refuses a newer one by name', () => {
    expect(errorCode(encoded, 8)).toBe('parsed');
    expect(errorCode(encoded, 6)).toBe('newer-schema');
    const parsed = parseContainer(encoded, 6);
    expect(parsed.ok ? '' : parsed.error.message).toMatch(/update/i);
  });

  it('refuses a newer container format by name', () => {
    expect(errorCode(encoded.replace(`${BACKUP_MAGIC}.1.`, `${BACKUP_MAGIC}.2.`))).toBe('newer-format');
  });

  it.each([
    ['empty text', ''],
    ['unrelated text', 'hello'],
    ['a CSV', 'Date,Amount\n2026-01-01,1'],
    ['a lower case magic', encoded.toLowerCase()],
    ['format zero', encoded.replace(`${BACKUP_MAGIC}.1.`, `${BACKUP_MAGIC}.0.`)],
  ])('says %s is not a backup', (_, text) => {
    expect(errorCode(text)).toBe('not-a-backup');
  });

  it('refuses a cut at every length', () => {
    for (let length = BACKUP_MAGIC.length + 3; length < encoded.length; length += 1) {
      const cut = encoded.slice(0, length);
      const parsed = parseContainer(cut, 7);
      // A cut landing on a whole base64 group can still parse, and only the tag can refuse it.
      if (parsed.ok) expect(parsed.value.ciphertext.length).toBeLessThan(ciphertext.length);
    }
    expect(errorCode(encoded.slice(0, encoded.lastIndexOf('.')))).toBe('damaged');
  });

  it('refuses a ciphertext too short to hold its tag', () => {
    expect(errorCode(encodeContainer(header, new Uint8Array(15)))).toBe('damaged');
  });

  it.each([
    ['unknown KDF', (fields: Record<string, unknown>) => {
      fields.kdf = { ...DEFAULT_KDF, name: 'pbkdf2' };
    }],
    ['a cost that would exhaust memory', (fields: Record<string, unknown>) => {
      fields.kdf = { ...DEFAULT_KDF, N: 2 ** 24 };
    }],
    ['a cost below the floor', (fields: Record<string, unknown>) => {
      fields.kdf = { ...DEFAULT_KDF, N: 2 ** 10 };
    }],
    ['a cost that is no power of two', (fields: Record<string, unknown>) => {
      fields.kdf = { ...DEFAULT_KDF, N: 30000 };
    }],
    ['a block size scrypt was not chosen with', (fields: Record<string, unknown>) => {
      fields.kdf = { ...DEFAULT_KDF, r: 1024 };
    }],
    ['parallelism', (fields: Record<string, unknown>) => {
      fields.kdf = { ...DEFAULT_KDF, p: 64 };
    }],
    ['a short salt', (fields: Record<string, unknown>) => {
      fields.salt = 'AQ==';
    }],
    ['a short nonce', (fields: Record<string, unknown>) => {
      fields.nonce = 'AQ==';
    }],
    ['an unknown field', (fields: Record<string, unknown>) => {
      fields.extra = 1;
    }],
    ['a text schema version', (fields: Record<string, unknown>) => {
      fields.schemaVersion = '7';
    }],
    ['a schema version of zero', (fields: Record<string, unknown>) => {
      fields.schemaVersion = 0;
    }],
  ])('refuses %s in the header', (_, change) => {
    expect(errorCode(rewriteHeader(change))).toBe('damaged');
  });

  it('refuses a header that is not JSON', () => {
    const parts = encoded.split('.');
    parts[2] = encodeBase64(Uint8Array.of(123, 123));
    expect(errorCode(parts.join('.'))).toBe('damaged');
  });

  it('keeps nothing but what the format needs in the clear', () => {
    const fields = JSON.parse(
      Buffer.from(encoded.split('.')[2], 'base64').toString('ascii'),
    ) as Record<string, unknown>;
    expect(Object.keys(fields).sort()).toEqual(['kdf', 'nonce', 'salt', 'schemaVersion']);
  });
});
