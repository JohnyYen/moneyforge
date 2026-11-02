import { createAppServices, type AppServices } from '@/app-services/create-app-services';
import { migrations } from '@/shared/persistence/migrations';
import { runMigrations } from '@/shared/persistence/migrator';
import { createNodeSqliteDriver } from '@/shared/persistence/node-sqlite-driver';
import type { SqlDriver } from '@/shared/persistence/sql-driver';
import type { Result } from '@/shared/result';

import { absentMessageCapture } from './message-capture';

function unwrap<T>(result: Result<T, { code: string; message: string }>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

const TABLES = ['message_sources', 'message_rules', 'inbox_items', 'accounts', 'categories'];

const PACK = JSON.stringify({
  format: 'moneyforge-rule-pack',
  version: 1,
  name: 'Example',
  sources: [
    {
      name: 'Example bank',
      channel: 'sms',
      sender: 'EXAMPLE',
      rules: [
        {
          name: 'Pay',
          priority: 5,
          template: 'Received {amount} from {counterparty}.',
          format: { decimal: '.', thousands: ',' },
          kind: 'income',
          account: 'Main',
          category: 'Income',
        },
        {
          name: 'Move',
          priority: 0,
          template: 'Sent {amount} to savings',
          format: { decimal: '.', thousands: ',' },
          kind: 'transfer_out',
          account: 'Main',
          counterpart: 'Savings',
        },
      ],
    },
  ],
});

describe('rule packs', () => {
  let driver: SqlDriver;
  let services: AppServices;
  let main: string;
  let savings: string;
  let category: string;
  let sequence: number;
  let announced: number;

  beforeEach(async () => {
    driver = createNodeSqliteDriver();
    await runMigrations(driver, migrations);
    sequence = 0;
    announced = 0;
    services = createAppServices({
      driver,
      clock: { now: () => new Date('2026-03-10T12:00:00.000Z') },
      generateId: () => `id-${++sequence}`,
      generateSecret: () => 'test-secret',
      messageCapture: {
        ...absentMessageCapture,
        available: true,
        setSenders: async () => {
          announced += 1;
        },
      },
    });
    await services.ledger.initialize();
    unwrap(await services.ledger.setBaseCurrency('USD'));
    const account = async (name: string) =>
      unwrap(
        await services.ledger.createAccount({
          name,
          type: 'Bank',
          currencyCode: 'USD',
          openingBalance: '0',
        }),
      ).id;
    main = await account('My private checking 4242');
    savings = await account('My private savings');
    category = unwrap(
      await services.ledger.createCategory({ name: 'Secret job', kind: 'income', parentId: null }),
    ).id;
  });

  afterEach(() => driver.close());

  const snapshot = async () =>
    JSON.stringify(
      await Promise.all(TABLES.map((table) => driver.all(`SELECT * FROM ${table} ORDER BY id`))),
    );

  const mapping = (change = {}) => ({
    text: PACK,
    accounts: new Map([
      ['Main', main],
      ['Savings', savings],
    ]),
    categories: new Map([['Income', category]]),
    enabledSenders: new Set<string>(),
    ...change,
  });

  const allRules = async () => {
    const sources = await services.rules.listSources();
    return (await Promise.all(sources.map(({ id }) => services.rules.listRules(id)))).flat();
  };

  describe('import', () => {
    it('shows a preview that writes nothing', async () => {
      const before = await snapshot();
      const preview = unwrap(await services.rules.previewRulePack(PACK));
      expect(preview.slots).toEqual({
        accounts: ['Main', 'Savings'],
        categories: [{ name: 'Income', kind: 'income' }],
      });
      expect(preview.sources).toEqual([
        {
          name: 'Example bank',
          sender: 'example',
          isNew: true,
          rules: [
            { name: 'Pay', priority: 5, template: 'Received {amount} from {counterparty}.' },
            { name: 'Move', priority: 0, template: 'Sent {amount} to savings' },
          ],
          knownRules: 0,
        },
      ]);
      expect(await snapshot()).toBe(before);
    });

    it('writes nothing for a hostile pack, even with a mapping', async () => {
      const before = await snapshot();
      const hostile = PACK.replace('"name":"Pay",', '"name":"Pay","autoPost":true,');
      await expect(services.rules.previewRulePack(hostile)).resolves.toMatchObject({ ok: false });
      await expect(
        services.rules.importRulePack(mapping({ text: hostile })),
      ).resolves.toMatchObject({ ok: false, error: { code: 'invalid-pack' } });
      expect(await snapshot()).toBe(before);
    });

    it('never auto-posts, and asks about a split on income', async () => {
      expect(unwrap(await services.rules.importRulePack(mapping()))).toEqual({
        sources: 1,
        enabled: 0,
        rules: 2,
        skipped: 0,
      });
      const rules = await allRules();
      expect(rules.map(({ autoPost }) => autoPost)).toEqual([false, false]);
      expect(rules.find(({ kind }) => kind === 'income')).toMatchObject({
        splitMode: 'ask',
        splitStructureId: null,
        accountId: main,
        categoryId: category,
        samples: [],
      });
      expect(rules.find(({ kind }) => kind === 'transfer_out')).toMatchObject({
        splitMode: 'none',
        counterpartAccountId: savings,
      });
    });

    it('posts nothing by itself from a message an imported rule matches', async () => {
      unwrap(
        await services.rules.importRulePack(mapping({ enabledSenders: new Set(['example']) })),
      );
      const result = await services.rules.ingestMessage({
        channel: 'sms',
        sender: 'EXAMPLE',
        body: 'Received 10.00 from Someone.',
        receivedAt: '2026-03-10T12:00:00.000Z',
      });
      expect(result).toMatchObject({ outcome: 'inbox' });
      await expect(services.ledger.listTransactions({ kind: 'income' })).resolves.toEqual([]);
    });

    it('duplicates nothing when imported twice', async () => {
      unwrap(await services.rules.importRulePack(mapping()));
      const before = await snapshot();
      expect(unwrap(await services.rules.previewRulePack(PACK)).sources).toEqual([
        { name: 'Example bank', sender: 'example', isNew: false, rules: [], knownRules: 2 },
      ]);
      expect(unwrap(await services.rules.importRulePack(mapping()))).toEqual({
        sources: 0,
        enabled: 0,
        rules: 0,
        skipped: 2,
      });
      expect(await snapshot()).toBe(before);
    });

    it('keeps an existing source as the person set it', async () => {
      const mine = unwrap(
        await services.rules.createSource({
          name: 'Mine',
          channel: 'paste',
          sender: 'example',
          enabled: false,
        }),
      );
      unwrap(await services.rules.importRulePack(mapping()));
      await expect(services.rules.listSources()).resolves.toEqual([mine]);
    });

    it('refuses an unmapped account slot and writes nothing', async () => {
      const before = await snapshot();
      await expect(
        services.rules.importRulePack(mapping({ accounts: new Map([['Main', main]]) })),
      ).resolves.toMatchObject({ ok: false, error: { code: 'invalid-pack' } });
      expect(await snapshot()).toBe(before);
    });

    it('rolls everything back when a later rule fails its mapping', async () => {
      const before = await snapshot();
      await expect(
        services.rules.importRulePack(
          mapping({
            accounts: new Map([
              ['Main', main],
              ['Savings', main],
            ]),
          }),
        ),
      ).resolves.toMatchObject({ ok: false });
      expect(await snapshot()).toBe(before);
    });

    it('allows a category slot left empty', async () => {
      unwrap(await services.rules.importRulePack(mapping({ categories: new Map() })));
      expect((await allRules()).find(({ kind }) => kind === 'income')?.categoryId).toBeNull();
    });

    it('survives a slot called __proto__', async () => {
      const text = PACK.replaceAll('"Main"', '"__proto__"');
      const accounts = new Map([
        ['__proto__', main],
        ['Savings', savings],
      ]);
      unwrap(await services.rules.importRulePack(mapping({ text, accounts })));
      expect(await allRules()).toHaveLength(2);
    });

    it('tells capture about a sender only once it is on and the write is done', async () => {
      unwrap(await services.rules.importRulePack(mapping()));
      expect(announced).toBe(0);
      const on = mapping({ text: PACK.replace('EXAMPLE', 'OTHER'), enabledSenders: new Set(['other']) });
      unwrap(await services.rules.importRulePack(on));
      expect(announced).toBe(1);
      unwrap(await services.rules.importRulePack(on));
      expect(announced).toBe(1);
    });

    describe('a new source', () => {
      const message = {
        channel: 'sms',
        sender: 'EXAMPLE',
        body: 'Received 10.00 from Someone.',
        receivedAt: '2026-03-10T12:00:00.000Z',
      } as const;

      it('starts off, so its sender stores nothing', async () => {
        const report = unwrap(await services.rules.importRulePack(mapping()));
        expect(report.enabled).toBe(0);
        await expect(services.rules.listSources()).resolves.toMatchObject([{ enabled: false }]);
        await expect(services.rules.ingestMessage(message)).resolves.toEqual({ outcome: 'dropped' });
      });

      it('turns on only the senders chosen one by one', async () => {
        const text = PACK.replace(
          '"sources":[',
          `"sources":[{"name":"Chat","channel":"sms","sender":"WhatsApp","rules":[]},`,
        );
        const report = unwrap(
          await services.rules.importRulePack(
            mapping({ text, enabledSenders: new Set(['example']) }),
          ),
        );
        expect(report).toMatchObject({ sources: 2, enabled: 1 });
        const sources = await services.rules.listSources();
        expect(sources.find(({ sender }) => sender === 'example')?.enabled).toBe(true);
        expect(sources.find(({ sender }) => sender === 'whatsapp')?.enabled).toBe(false);
      });
    });

    describe('on a source that already has rules', () => {
      const mine = async (priority: number) => {
        const source = unwrap(
          await services.rules.createSource({
            name: 'Mine',
            channel: 'sms',
            sender: 'EXAMPLE',
            enabled: true,
          }),
        );
        return unwrap(
          await services.rules.createRule({
            sourceId: source.id,
            name: 'Mine',
            priority,
            template: 'Received {amount} from {*}',
            format: { decimal: '.', thousands: ',' },
            kind: 'income',
            accountId: savings,
            categoryId: null,
            counterpartAccountId: null,
            currencyCode: null,
            autoPost: false,
            splitMode: 'none',
            splitStructureId: null,
            samples: [],
          }),
        );
      };

      it('places pack rules below the lowest, in their order, as the preview said', async () => {
        await mine(3);
        const [source] = unwrap(await services.rules.previewRulePack(PACK)).sources;
        expect(source.rules.map(({ priority }) => priority)).toEqual([2, -3]);
        unwrap(await services.rules.importRulePack(mapping()));
        const priorities = (await allRules()).map(({ name, priority }) => [name, priority]);
        expect(priorities).toEqual(
          expect.arrayContaining([['Mine', 3], ['Pay', 2], ['Move', -3]]),
        );
      });

      it('keeps the existing rule deciding a message both could read', async () => {
        const rule = await mine(0);
        unwrap(await services.rules.importRulePack(mapping()));
        await services.rules.ingestMessage({
          channel: 'sms',
          sender: 'EXAMPLE',
          body: 'Received 10.00 from Someone.',
          receivedAt: '2026-03-10T12:00:00.000Z',
        });
        const [item] = await driver.all<{ rule_id: string }>('SELECT rule_id FROM inbox_items');
        expect(item.rule_id).toBe(rule.id);
      });
    });
  });

  describe('export', () => {
    const seed = async () => {
      const source = unwrap(
        await services.rules.createSource({
          name: 'Bank',
          channel: 'sms',
          sender: 'BANK',
          enabled: true,
        }),
      );
      unwrap(
        await services.rules.createRule({
          sourceId: source.id,
          name: 'Income',
          priority: 3,
          template: 'Got {amount} today',
          format: { decimal: '.', thousands: ',' },
          kind: 'income',
          accountId: main,
          categoryId: category,
          counterpartAccountId: null,
          currencyCode: 'USD',
          autoPost: true,
          splitMode: 'none',
          splitStructureId: null,
          samples: ['Got 5.00 today from a private sample'],
        }),
      );
      return source;
    };

    it('leaves out samples, ids, names of accounts and categories, and posting choices', async () => {
      const source = await seed();
      const text = unwrap(
        await services.rules.exportRulePack({ name: 'Mine', sourceIds: [source.id] }),
      );
      expect(text).not.toMatch(/private|Secret job|4242|autoPost|splitMode|samples/);
      expect(text).not.toContain(main);
      expect(text).not.toContain(source.id);
      const parsed = JSON.parse(text);
      expect(parsed.sources[0].rules[0]).toMatchObject({ account: 'Account 1' });
      expect(parsed.sources[0].rules[0].category).toBe('Income category 1');
    });

    it('exports only the chosen sources', async () => {
      await seed();
      const other = unwrap(
        await services.rules.createSource({
          name: 'Other',
          channel: 'paste',
          sender: 'OTHER',
          enabled: true,
        }),
      );
      const text = unwrap(await services.rules.exportRulePack({ name: 'x', sourceIds: [other.id] }));
      expect(text).not.toContain('bank');
    });

    it('produces what its own import accepts, and nothing doubles after a round trip', async () => {
      const source = await seed();
      const text = unwrap(
        await services.rules.exportRulePack({ name: 'Mine', sourceIds: [source.id] }),
      );
      expect(
        unwrap(
          await services.rules.importRulePack({
            text,
            accounts: new Map([['Account 1', main]]),
            categories: new Map([['Income category 1', category]]),
            enabledSenders: new Set(),
          }),
        ),
      ).toEqual({ sources: 0, enabled: 0, rules: 0, skipped: 1 });
    });

    it('refuses an unknown source', async () => {
      await expect(
        services.rules.exportRulePack({ name: 'x', sourceIds: ['nope'] }),
      ).resolves.toMatchObject({ ok: false, error: { code: 'not-found' } });
    });
  });
});
