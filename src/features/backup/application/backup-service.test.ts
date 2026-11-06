import { createHash } from 'node:crypto';

import { createAppServices, type AppServices } from '@/app-services/create-app-services';
import { absentMessageCapture } from '@/features/rules/application/message-capture';
import { DEDUP_SECRET_KEY } from '@/features/rules/domain/message-settings';
import type { Migration } from '@/shared/persistence/migrator';
import { migrations } from '@/shared/persistence/migrations';
import { runMigrations } from '@/shared/persistence/migrator';
import { createNodeSqliteDriver } from '@/shared/persistence/node-sqlite-driver';
import type { SqlDriver } from '@/shared/persistence/sql-driver';
import { ok, type Result } from '@/shared/result';

import { DEFAULT_KDF, parseContainer } from '../domain/backup-container';
import { decodeBase64, encodeBase64 } from '../domain/base64';
import { BACKUP_TABLES, EXCLUDED_TABLES } from '../domain/backup-tables';
import type { BackupSnapshot } from '../domain/backup-snapshot';
import { createNodeBackupCipher } from '../infrastructure/node-backup-cipher';
import { createSqliteBackupStore } from '../infrastructure/sqlite-backup-store';
import { openContainer, sealSnapshot } from './backup-codec';
import type { BackupCipher, BackupTransport } from './ports';
import { RESTORE_CONFIRMATION, type PreparedRestore } from './backup-service';

const PASSPHRASE = 'a long enough passphrase';
const LATEST = migrations[migrations.length - 1].version;
const HUGE_AMOUNT = '123456789012345678.123456789012345678';
const DESCRIPTION = 'Unmistakable lunch description';
const SECRET_BODY = 'Raw message body with card 4242';
const CSV = 'Date,Description,Amount\n2026-01-02,Salary,1000.50\n2026-01-03,Coffee,-3.25\n';

function unwrap<T>(result: Result<T, { code: string; message: string }>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

/** Replaces only the slow KDF, so a test can try every position of a file. */
const fastCipher: BackupCipher = {
  ...createNodeBackupCipher(),
  deriveKey: async (passphrase, salt, kdf) =>
    new Uint8Array(
      createHash('sha256').update(passphrase).update(salt).update(JSON.stringify(kdf)).digest(),
    ),
};

const memoryTransport = (maxChars = 10_000_000) => {
  const sent: string[] = [];
  const transport: BackupTransport = {
    maxChars,
    send: async (text) => {
      sent.push(text);
      return ok(undefined);
    },
    receive: async (pasted) => ok(pasted),
  };
  return { sent, transport };
};

type Device = {
  driver: SqlDriver;
  services: AppServices;
  sent: string[];
  setSenders: jest.Mock;
};

async function openDevice(options: {
  schema?: readonly Migration[];
  cipher?: BackupCipher;
  transport?: BackupTransport;
  id?: string;
} = {}): Promise<Device> {
  const driver = createNodeSqliteDriver();
  const schema = options.schema ?? migrations;
  await runMigrations(driver, schema);
  const { sent, transport } = memoryTransport();
  const setSenders = jest.fn().mockResolvedValue(undefined);
  let sequence = 0;
  const services = createAppServices({
    driver,
    clock: { now: () => new Date('2026-03-10T12:00:00.000Z') },
    generateId: () => `${options.id ?? 'id'}-${++sequence}`,
    generateSecret: () => 'dedup-secret-for-tests',
    messageCapture: { ...absentMessageCapture, available: true, setSenders },
    backupCipher: options.cipher ?? fastCipher,
    backupTransport: options.transport ?? transport,
    backupMigrations: schema,
  });
  return { driver, services, sent, setSenders };
}

const devices: Device[] = [];
const device = async (options?: Parameters<typeof openDevice>[0]) => {
  const opened = await openDevice(options);
  devices.push(opened);
  return opened;
};
afterEach(async () => {
  await Promise.all(devices.splice(0).map(({ driver }) => driver.close()));
});

/** Every row of every table, plus the schema itself. */
async function dump(driver: SqlDriver) {
  const objects = await driver.all<{ name: string; type: string; sql: string | null }>(
    "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
  );
  const tables = objects.filter(({ type }) => type === 'table').map(({ name }) => name);
  const rows: Record<string, unknown[]> = {};
  for (const table of tables) {
    rows[table] = await driver.all(`SELECT * FROM "${table}" ORDER BY 1`);
  }
  return { objects, rows };
}

async function seed({ services, driver }: Device) {
  await services.ledger.initialize();
  unwrap(await services.ledger.setBaseCurrency('USD'));
  unwrap(
    await services.ledger.updateCurrency({
      code: 'USDT',
      name: 'Tether',
      decimals: 18,
      symbol: 'USDT',
      kind: 'stablecoin',
    }),
  );
  const cash = unwrap(
    await services.ledger.createAccount({
      name: 'Cash',
      type: 'Bank',
      currencyCode: 'USD',
      openingBalance: '100',
    }),
  );
  const wallet = unwrap(
    await services.ledger.createAccount({
      name: 'Wallet',
      type: 'Crypto',
      currencyCode: 'USDT',
      openingBalance: HUGE_AMOUNT,
    }),
  );
  const food = unwrap(
    await services.ledger.createCategory({ name: 'Food', kind: 'expense', parentId: null }),
  );
  unwrap(
    await services.ledger.recordExpense({
      accountId: cash.id,
      amount: '12.34',
      categoryId: food.id,
      description: DESCRIPTION,
      occurredAt: '2026-02-01T12:00:00.000Z',
    }),
  );
  unwrap(await services.transfer.importCsv(csvInput(cash.id)));
  await driver.run(
    `INSERT INTO message_sources (id, name, channel, sender) VALUES ('s1', 'Bank', 'sms', 'BANK')`,
  );
  for (const [id, status] of [['pending', 'proposed'], ['unread', 'unmatched']]) {
    await driver.run(
      `INSERT INTO inbox_items (id, source_id, status, channel, received_at, body, body_hash)
       VALUES (?, 's1', ?, 'sms', '2026-02-01', ?, ?)`,
      [id, status, SECRET_BODY, `hash-${id}`],
    );
  }
  await driver.run(`UPDATE onchain_chains SET endpoint = 'https://rpc.example/key-in-path'`);
  return { cash, wallet };
}

const csvInput = (accountId: string) => ({
  text: CSV,
  separator: ',' as const,
  hasHeader: true,
  accountId,
  mapping: {
    date: 0,
    description: 1,
    amount: { mode: 'single' as const, column: 2, positive: 'income' as const },
    category: null,
    currency: null,
    dateFormat: 'ymd' as const,
    numberFormat: { decimal: '.' as const, thousands: ',' as const },
  },
  unknownCategories: { action: 'fallback' as const, income: null, expense: null },
});

const exportFrom = async ({ services, sent }: Device) => {
  unwrap(await services.backup.exportBackup({ passphrase: PASSPHRASE, confirmation: PASSPHRASE }));
  return sent[sent.length - 1];
};

const snapshotOf = async (text: string, passphrase = PASSPHRASE, current = LATEST) =>
  unwrap(await openContainer(unwrap(parseContainer(text, current)), passphrase, fastCipher));

const reseal = (snapshot: BackupSnapshot) => sealSnapshot(snapshot, PASSPHRASE, fastCipher);

/** A snapshot with one table's rows changed, sealed under the right passphrase. */
const withTable = (
  snapshot: BackupSnapshot,
  name: string,
  change: (table: BackupSnapshot['tables'][number]) => BackupSnapshot['tables'][number],
): BackupSnapshot => ({
  ...snapshot,
  tables: snapshot.tables.map((table) => (table.name === name ? change(table) : table)),
});

const restore = async ({ services }: Device, text: string, passphrase = PASSPHRASE) => {
  const prepared = await services.backup.prepareRestore({ text, passphrase });
  if (!prepared.ok) return prepared;
  return services.backup.applyRestore(prepared.value, RESTORE_CONFIRMATION);
};

const codeOf = (result: Result<unknown, { code: string }>) =>
  result.ok ? 'ok' : result.error.code;

describe('backup table coverage', () => {
  it('names every table in the schema as included or excluded on purpose', async () => {
    const { driver } = await device();
    const tables = await driver.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    );
    const included = BACKUP_TABLES.map(({ name }) => name);
    const excluded = Object.keys(EXCLUDED_TABLES);
    expect([...included, ...excluded].sort()).toEqual(tables.map(({ name }) => name).sort());
    expect(included).toEqual(expect.arrayContaining(['settings', 'imported_rows', 'inbox_items']));
    expect(included.filter((name) => excluded.includes(name))).toEqual([]);
  });
});

describe('export', () => {
  it('holds no amount or text of the ledger outside the encryption', async () => {
    const source = await device();
    await seed(source);
    const text = await exportFrom(source);
    const bytes = text
      .split('.')
      .slice(2)
      .map((part) => Buffer.from(decodeBase64(part) ?? []).toString('latin1'))
      .join('\n');
    for (const needle of [
      DESCRIPTION,
      '12.34',
      '1234',
      '123456789012345678',
      'Wallet',
      'dedup-secret-for-tests',
      'key-in-path',
    ]) {
      expect(text).not.toContain(needle);
      expect(bytes).not.toContain(needle);
    }
  });

  it('carries the dedup secret, import fingerprints, and endpoints, but no message text', async () => {
    const source = await device();
    await seed(source);
    const snapshot = await snapshotOf(await exportFrom(source));
    const payload = JSON.stringify(snapshot);
    const table = (name: string) => snapshot.tables.find((item) => item.name === name);

    expect(table('settings')?.rows).toEqual(
      expect.arrayContaining([[DEDUP_SECRET_KEY, 'dedup-secret-for-tests']]),
    );
    expect(table('imported_rows')?.rows).toHaveLength(2);
    expect(table('imported_rows')?.columns).toContain('batch_id');
    expect(payload).toContain('key-in-path');
    expect(payload).not.toContain(SECRET_BODY);
    const inboxIds = table('inbox_items')?.rows.map((row) => row[0]);
    expect(inboxIds).toEqual(['pending']);
    expect(table('schema_migrations')).toBeUndefined();
  });

  it('uses a fresh salt and nonce every time', async () => {
    const source = await device();
    await seed(source);
    const headers = [await exportFrom(source), await exportFrom(source)].map((text) =>
      unwrap(parseContainer(text, LATEST)).header,
    );
    expect(headers[0].salt).not.toEqual(headers[1].salt);
    expect(headers[0].nonce).not.toEqual(headers[1].nonce);
    expect(headers[0].kdf).toEqual(DEFAULT_KDF);
  });

  it('refuses a weak or mistyped passphrase before reading anything', async () => {
    const { services, sent } = await device();
    expect(
      codeOf(await services.backup.exportBackup({ passphrase: 'short', confirmation: 'short' })),
    ).toBe('weak-passphrase');
    expect(
      codeOf(await services.backup.exportBackup({ passphrase: PASSPHRASE, confirmation: 'other' })),
    ).toBe('passphrase-mismatch');
    expect(sent).toEqual([]);
  });

  it('refuses past what the transport can carry, and says what to do', async () => {
    const { sent, transport } = memoryTransport(100);
    const source = await device({ transport });
    const result = await source.services.backup.exportBackup({
      passphrase: PASSPHRASE,
      confirmation: PASSPHRASE,
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'too-large' } });
    expect(result.ok ? '' : result.error.message).toMatch(/100/);
    expect(sent).toEqual([]);
  });

  it('shares nothing when the file does not read back', async () => {
    const { sent, transport } = memoryTransport();
    const cipher: BackupCipher = {
      ...fastCipher,
      open: () => Promise.reject(new Error('native failure')),
    };
    const source = await device({ cipher, transport });
    const result = await source.services.backup.exportBackup({
      passphrase: PASSPHRASE,
      confirmation: PASSPHRASE,
    });
    expect(codeOf(result)).toBe('export-failed');
    expect(sent).toEqual([]);
  });

  it('refuses to write a backup that could never restore', async () => {
    const source = await device();
    await seed(source);
    await source.driver.run(`UPDATE postings SET amount = '1' WHERE id = 1`);
    const result = await source.services.backup.exportBackup({
      passphrase: PASSPHRASE,
      confirmation: PASSPHRASE,
    });
    expect(codeOf(result)).toBe('unbalanced');
    expect(source.sent).toEqual([]);
  });
});

describe('restore', () => {
  it('restores identical data, 18 decimal amounts included, over existing data', async () => {
    const source = await device();
    await seed(source);
    const text = await exportFrom(source);
    await source.driver.run(`DELETE FROM inbox_items WHERE id = 'unread'`);
    await source.driver.run(`UPDATE inbox_items SET body = NULL`);
    const expected = await dump(source.driver);

    const target = await device({ id: 'other' });
    await target.services.ledger.initialize();
    unwrap(await target.services.ledger.setBaseCurrency('EUR'));
    unwrap(await restore(target, text));

    expect(await dump(target.driver)).toEqual(expected);
    expect(await target.driver.all('PRAGMA foreign_key_check')).toEqual([]);
    const balances = await target.services.ledger.accountBalances();
    expect(balances.map(({ balance }) => balance)).toEqual(
      expect.arrayContaining([
        (await source.services.ledger.accountBalances())[1].balance,
      ]),
    );
    const postings = await target.driver.all<{ amount: string }>(
      `SELECT amount FROM postings WHERE currency_code = 'USDT'`,
    );
    expect(postings.map(({ amount }) => amount)).toContain(HUGE_AMOUNT.replace('.', ''));
  });

  it('keeps stored keys matching: the same CSV imported after a restore adds nothing', async () => {
    const source = await device();
    const { cash } = await seed(source);
    const target = await device();
    unwrap(await restore(target, await exportFrom(source)));

    const report = unwrap(await target.services.transfer.importCsv(csvInput(cash.id)));
    expect(report).toMatchObject({ imported: 0 });
    expect(await target.services.rules.loadDedupSecret()).toBe('dedup-secret-for-tests');
  });

  it('tells capture about the restored senders', async () => {
    const source = await device();
    await seed(source);
    const target = await device();
    unwrap(await restore(target, await exportFrom(source)));
    expect(target.setSenders).toHaveBeenLastCalledWith(['BANK']);
  });

  it('summarizes what was found before anything is replaced', async () => {
    const source = await device();
    await seed(source);
    const target = await device();
    const before = await dump(target.driver);
    const prepared = unwrap(
      await target.services.backup.prepareRestore({
        text: await exportFrom(source),
        passphrase: PASSPHRASE,
      }),
    );
    expect(prepared.summary).toMatchObject({
      createdAt: '2026-03-10T12:00:00.000Z',
      schemaVersion: LATEST,
      upgrades: false,
      accounts: expect.any(Number),
      transactions: expect.any(Number),
    });
    expect(prepared.summary.accounts).toBeGreaterThanOrEqual(2);
    expect(await dump(target.driver)).toEqual(before);
  });

  it.each([[''], ['replace'], ['yes'], [`${RESTORE_CONFIRMATION}!`]])(
    'writes nothing without the typed word, given %j',
    async (typed) => {
      const source = await device();
      await seed(source);
      const target = await device();
      const before = await dump(target.driver);
      const prepared = unwrap(
        await target.services.backup.prepareRestore({
          text: await exportFrom(source),
          passphrase: PASSPHRASE,
        }),
      );
      const result = await target.services.backup.applyRestore(prepared, typed);
      expect(codeOf(result)).toBe('confirmation-required');
      expect(await dump(target.driver)).toEqual(before);
    },
  );

  describe('refusals', () => {
    let text: string;
    let source: Device;
    let target: Device;
    let before: Awaited<ReturnType<typeof dump>>;

    beforeEach(async () => {
      source = await device();
      await seed(source);
      text = await exportFrom(source);
      target = await device();
      await target.services.ledger.initialize();
      unwrap(await target.services.ledger.setBaseCurrency('EUR'));
      before = await dump(target.driver);
    });

    const refused = async (attempt: string, passphrase = PASSPHRASE) => {
      const result = await restore(target, attempt, passphrase);
      expect(result.ok).toBe(false);
      return codeOf(result);
    };

    afterEach(async () => {
      expect(await dump(target.driver)).toEqual(before);
    });

    it('refuses a wrong passphrase with a clear message', async () => {
      const result = await restore(target, text, 'not the passphrase');
      expect(result).toMatchObject({ ok: false, error: { code: 'cannot-open' } });
      expect(result.ok ? '' : result.error.message).toMatch(/passphrase/i);
    });

    it('refuses one changed character at every position of the file', async () => {
      const wrongs: string[] = [];
      for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        const other = char === 'A' ? 'B' : 'A';
        const changed = text.slice(0, index) + other + text.slice(index + 1);
        const result = await target.services.backup.prepareRestore({
          text: changed,
          passphrase: PASSPHRASE,
        });
        if (result.ok) wrongs.push(`position ${index}`);
      }
      expect(wrongs).toEqual([]);
    });

    it('refuses one flipped bit of every byte of the encrypted part', async () => {
      const parts = text.split('.');
      const bytes = decodeBase64(parts[3]);
      if (!bytes) throw new Error('bad fixture');
      for (const index of [0, 1, bytes.length >> 1, bytes.length - 17, bytes.length - 16, bytes.length - 1]) {
        const flipped = bytes.slice();
        flipped[index] ^= 0x01;
        parts[3] = encodeBase64(flipped);
        expect(await refused(parts.join('.'))).toBe('cannot-open');
      }
    });

    it.each<[string, (fields: Record<string, any>) => void]>([
      ['a lower schema version', (fields) => (fields.schemaVersion = 6)],
      ['a higher KDF cost', (fields) => (fields.kdf.N = 2 ** 16)],
      ['another salt', (fields) => (fields.salt = encodeBase64(new Uint8Array(16)))],
      ['another nonce', (fields) => (fields.nonce = encodeBase64(new Uint8Array(12)))],
    ])('refuses a validly rewritten header with %s', async (_, change) => {
      const parts = text.split('.');
      const fields = JSON.parse(Buffer.from(parts[2], 'base64').toString('ascii')) as Record<
        string,
        unknown
      >;
      change(fields);
      parts[2] = Buffer.from(JSON.stringify(fields), 'ascii').toString('base64');
      expect(await refused(parts.join('.'))).toBe('cannot-open');
    });

    it('refuses a file cut short', async () => {
      for (const length of [10, 30, text.lastIndexOf('.'), text.length - 8, text.length - 4]) {
        expect(await refused(text.slice(0, length))).not.toBe('ok');
      }
    });

    it('refuses a newer schema before asking the KDF for anything', async () => {
      const snapshot = await snapshotOf(text);
      const newer = await reseal({ ...snapshot, schemaVersion: LATEST + 1 });
      const spy = jest.spyOn(fastCipher, 'deriveKey');
      try {
        const result = await restore(target, newer);
        expect(codeOf(result)).toBe('newer-schema');
        expect(result.ok ? '' : result.error.message).toMatch(/newer/i);
        expect(spy).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });

    it('refuses an unbalanced journal, under the right passphrase', async () => {
      const snapshot = await snapshotOf(text);
      const unbalanced = await reseal(
        withTable(snapshot, 'postings', (table) => {
          const amount = table.columns.indexOf('amount');
          const [first, ...rest] = table.rows;
          const changed = [...first];
          changed[amount] = `${String(first[amount])}1`;
          return { ...table, rows: [changed, ...rest] };
        }),
      );
      expect(await refused(unbalanced)).toBe('unbalanced');
    });

    it.each<[string, (table: BackupSnapshot['tables'][number]) => BackupSnapshot['tables'][number]]>([
      ['an unknown column', (table) => ({
        ...table,
        columns: [...table.columns, 'extra'],
        rows: table.rows.map((row) => [...row, 'x']),
      })],
      ['a missing column', (table) => ({
        ...table,
        columns: table.columns.slice(1),
        rows: table.rows.map((row) => row.slice(1)),
      })],
      ['an injected column', (table) => ({
        ...table,
        columns: [...table.columns.slice(1), 'x"); DROP TABLE accounts; --'],
      })],
      ['an empty required cell', (table) => ({
        ...table,
        rows: table.rows.map((row) => row.map(() => null)),
      })],
    ])('refuses %s before any write', async (_, change) => {
      const snapshot = await snapshotOf(text);
      expect(await refused(await reseal(withTable(snapshot, 'accounts', change)))).toBe(
        'invalid-contents',
      );
    });

    it('refuses a table the schema does not know, whatever its name', async () => {
      const snapshot = await snapshotOf(text);
      const extra = { name: 'x"; DROP TABLE accounts; --', columns: [], rows: [] };
      expect(await refused(await reseal({ ...snapshot, tables: [...snapshot.tables, extra] }))).toBe(
        'invalid-contents',
      );
    });

    it('rolls back when the database refuses a row', async () => {
      const snapshot = await snapshotOf(text);
      const bad = await reseal(
        withTable(snapshot, 'currencies', (table) => ({
          ...table,
          rows: table.rows.map((row) => row.map((cell) => (cell === 'fiat' ? 'bogus' : cell))),
        })),
      );
      expect(await refused(bad)).toBe('restore-failed');
    });

    it('rolls back when rows point at nothing', async () => {
      const snapshot = await snapshotOf(text);
      const bad = await reseal(
        withTable(snapshot, 'accounts', (table) => {
          const currency = table.columns.indexOf('currency_code');
          return {
            ...table,
            rows: table.rows.map((row) => row.map((cell, at) => (at === currency ? 'NONE' : cell))),
          };
        }),
      );
      expect(await refused(bad)).toBe('restore-failed');
    });

    it('rolls back when a later migration fails', async () => {
      const failing = await device({
        schema: migrations,
      });
      await failing.services.ledger.initialize();
      const start = await dump(failing.driver);
      const store = createSqliteBackupStore(failing.driver, [
        ...migrations,
        { version: LATEST + 1, name: 'broken', sql: 'CREATE TABLE settings (a)' },
      ]);
      await expect(store.replaceAll(await snapshotOf(text))).rejects.toThrow();
      expect(await dump(failing.driver)).toEqual(start);
    });
  });

  describe('older schemas', () => {
    /**
     * Undoes later migrations by hand, so a database the current code filled stands as an older
     * app left it. The current store writes columns an older schema lacks, so it cannot fill one.
     */
    const ROLLBACKS: Record<number, string> = {
      8: `DROP INDEX accounts_group_currency;
          ALTER TABLE accounts DROP COLUMN group_id;
          DROP TABLE account_groups;`,
      7: 'DROP TABLE imported_rows;',
    };

    const rollBack = async ({ driver }: Device, version: number) => {
      for (let at = LATEST; at > version; at--) {
        await driver.exec(ROLLBACKS[at]);
        await driver.run('DELETE FROM schema_migrations WHERE version = ?', [at]);
      }
    };

    it('restores a version 6 backup through the migrator', async () => {
      const source = await device();
      await source.services.ledger.initialize();
      unwrap(await source.services.ledger.setBaseCurrency('USD'));
      await source.driver.run(`UPDATE onchain_chains SET name = 'Renamed chain'`);
      await rollBack(source, 6);
      const expected = await source.driver.all('SELECT * FROM currencies ORDER BY code');

      const text = await exportFrom(source);
      expect(unwrap(parseContainer(text, LATEST)).header.schemaVersion).toBe(6);
      const snapshot = await snapshotOf(text);
      expect(snapshot.tables.map(({ name }) => name)).not.toContain('imported_rows');

      const target = await device();
      const prepared = unwrap(
        await target.services.backup.prepareRestore({ text, passphrase: PASSPHRASE }),
      );
      expect(prepared.summary).toMatchObject({ schemaVersion: 6, upgrades: true });
      unwrap(await target.services.backup.applyRestore(prepared, RESTORE_CONFIRMATION));

      expect(await target.driver.all('SELECT * FROM currencies ORDER BY code')).toEqual(expected);
      const applied = await target.driver.all<{ version: number }>(
        'SELECT version FROM schema_migrations ORDER BY version',
      );
      expect(applied.map(({ version }) => version)).toEqual(migrations.map(({ version }) => version));
      expect(await target.driver.all('SELECT * FROM imported_rows')).toEqual([]);
      const chains = await target.driver.all<{ name: string }>('SELECT name FROM onchain_chains');
      expect(new Set(chains.map(({ name }) => name))).toEqual(new Set(['Renamed chain']));
    });

    it('restores a version 7 backup with every account outside a group', async () => {
      const source = await device();
      await seed(source);
      await rollBack(source, 7);
      const expected = await source.driver.all('SELECT * FROM accounts ORDER BY id');
      const text = await exportFrom(source);
      const snapshot = await snapshotOf(text);
      expect(snapshot.schemaVersion).toBe(7);
      expect(snapshot.tables.map(({ name }) => name)).not.toContain('account_groups');
      const accounts = snapshot.tables.find(({ name }) => name === 'accounts');
      expect(accounts?.columns).not.toContain('group_id');

      const target = await device();
      unwrap(await restore(target, text));

      expect(await target.driver.all('SELECT * FROM accounts ORDER BY id')).toEqual(
        expected.map((row) => ({ ...(row as object), group_id: null })),
      );
      expect(await target.driver.all('SELECT * FROM account_groups')).toEqual([]);
    });

    it('carries account groups and the group of each account', async () => {
      const source = await device();
      await source.services.ledger.initialize();
      unwrap(await source.services.ledger.setBaseCurrency('USD'));
      const { group } = unwrap(
        await source.services.ledger.createAccountGroup({
          name: 'Bank X',
          type: 'Bank',
          currencies: [
            { currencyCode: 'USD', openingBalance: '10' },
            { currencyCode: 'EUR', openingBalance: '5' },
          ],
        }),
      );
      const text = await exportFrom(source);

      const target = await device();
      unwrap(await restore(target, text));

      await expect(target.services.ledger.listAccountGroups()).resolves.toEqual([group]);
      const accounts = await target.services.ledger.listAccounts();
      expect(accounts.map(({ groupId }) => groupId)).toEqual([group.id, group.id]);
    });

    it('replaces groups the target already holds, with accounts pointing at them', async () => {
      const bank = (ledger: Device['services']['ledger'], name: string, codes: string[]) =>
        ledger.createAccountGroup({
          name,
          type: 'Bank',
          currencies: codes.map((currencyCode) => ({ currencyCode, openingBalance: '7' })),
        });
      const source = await device();
      await source.services.ledger.initialize();
      unwrap(await source.services.ledger.setBaseCurrency('USD'));
      unwrap(await bank(source.services.ledger, 'Bank X', ['USD', 'EUR']));
      const text = await exportFrom(source);
      const expected = await dump(source.driver);

      const target = await device({ id: 'other' });
      await target.services.ledger.initialize();
      unwrap(await target.services.ledger.setBaseCurrency('EUR'));
      unwrap(await bank(target.services.ledger, 'Bank Y', ['EUR', 'COP']));
      unwrap(await bank(target.services.ledger, 'Bank Z', ['USD']));
      unwrap(await restore(target, text));

      expect(await dump(target.driver)).toEqual(expected);
      expect(await target.driver.all('PRAGMA foreign_key_check')).toEqual([]);
    });

    it('runs later migrations over the restored rows', async () => {
      const source = await device();
      await seed(source);
      const text = await exportFrom(source);
      const nextSchema: Migration[] = [
        ...migrations,
        {
          version: LATEST + 1,
          name: 'later',
          sql: `ALTER TABLE accounts ADD COLUMN shout TEXT;
                UPDATE accounts SET shout = upper(name);`,
        },
      ];
      const target = await device({ schema: nextSchema });
      unwrap(await restore(target, text));
      const rows = await target.driver.all<{ shout: string }>(
        `SELECT shout FROM accounts WHERE name = 'Wallet'`,
      );
      expect(rows).toEqual([{ shout: 'WALLET' }]);
    });

    it('checks an older file against the older schema, and rolls back', async () => {
      const source = await device();
      await source.services.ledger.initialize();
      await rollBack(source, 6);
      const snapshot = await snapshotOf(await exportFrom(source));
      const target = await device();
      await target.services.ledger.initialize();
      const before = await dump(target.driver);
      const bad = await reseal({
        ...snapshot,
        tables: [...snapshot.tables, { name: 'imported_rows', columns: ['x'], rows: [] }],
      });
      expect(codeOf(await restore(target, bad))).toBe('invalid-contents');
      expect(await dump(target.driver)).toEqual(before);
    });
  });
});

describe('secrets', () => {
  it('stay out of logs and every error, on success and failure', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      jest.spyOn(console, method).mockImplementation(() => undefined),
    );
    const source = await device();
    await seed(source);
    const text = await exportFrom(source);
    const target = await device();
    const failures: unknown[] = [
      await target.services.backup.prepareRestore({ text, passphrase: 'wrong passphrase here' }),
      await target.services.backup.prepareRestore({ text: 'junk', passphrase: PASSPHRASE }),
      await target.services.backup.exportBackup({ passphrase: PASSPHRASE, confirmation: 'x' }),
      await target.services.backup.exportBackup({ passphrase: 'wrong', confirmation: 'wrong' }),
    ];
    const snapshot = await snapshotOf(text);
    const bad = await reseal(
      withTable(snapshot, 'currencies', (table) => ({
        ...table,
        rows: table.rows.map((row) => row.map((cell) => (cell === 'fiat' ? 'bogus' : cell))),
      })),
    );
    failures.push(await restore(target, bad));
    unwrap(await restore(target, text));

    const output = JSON.stringify([failures, spies.map((spy) => spy.mock.calls)]);
    for (const secret of [PASSPHRASE, 'wrong passphrase here', 'dedup-secret-for-tests', DESCRIPTION]) {
      expect(output).not.toContain(secret);
    }
    expect(spies.flatMap((spy) => spy.mock.calls)).toEqual([]);
    spies.forEach((spy) => spy.mockRestore());
  });

  it('keeps the passphrase out of what a prepared restore holds', async () => {
    const source = await device();
    await seed(source);
    const target = await device();
    const prepared: PreparedRestore = unwrap(
      await target.services.backup.prepareRestore({
        text: await exportFrom(source),
        passphrase: PASSPHRASE,
      }),
    );
    expect(JSON.stringify(prepared)).not.toContain(PASSPHRASE);
  });
});

describe('with no transport', () => {
  it('refuses plainly rather than reading anything', async () => {
    const driver = createNodeSqliteDriver();
    await runMigrations(driver, migrations);
    const services = createAppServices({
      driver,
      clock: { now: () => new Date() },
      generateId: () => 'id',
      generateSecret: () => 'secret',
    });
    const result = await services.backup.exportBackup({
      passphrase: PASSPHRASE,
      confirmation: PASSPHRASE,
    });
    expect(codeOf(result)).toBe('export-failed');
    await driver.close();
  });
});
