import { createAppServices, type AppServices } from '@/app-services/create-app-services';
import { formatDecimal } from '@/features/ledger/domain/money';
import { migrations } from '@/shared/persistence/migrations';
import { runMigrations } from '@/shared/persistence/migrator';
import { createNodeSqliteDriver } from '@/shared/persistence/node-sqlite-driver';
import type { SqlDriver } from '@/shared/persistence/sql-driver';
import { err, ok, type Result } from '@/shared/result';

import { validateChain, validateToken } from '../domain/onchain';
import type { OnChainError } from '../domain/onchain-error';
import type { WatchedInput } from './watch-use-cases';
import type { BalanceQuery, BalanceRead } from './ports';

const TRON_ADDRESS = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb';
const EVM_ADDRESS = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const NOW = new Date('2026-03-10T12:00:00.000Z');

const PRIVATE_KEY = '4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318';
const WIF = 'KwdMAjGmerYanjeui5SHS7JkmpZvVipYvB2LJGU1ZxJwYvP98617';
const SEED_12 =
  'abandon ability able about above absent absorb abstract absurd abuse access accident';
const SEED_24 = `${SEED_12} ${SEED_12}`;

function unwrap<T>(result: Result<T, { code: string; message: string }>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

describe('on-chain balances', () => {
  let driver: SqlDriver;
  let services: AppServices;
  let sequence: number;
  let now: Date;
  let queries: BalanceQuery[];
  let answer: (query: BalanceQuery) => Promise<Result<BalanceRead, OnChainError>>;

  beforeEach(async () => {
    driver = createNodeSqliteDriver();
    await runMigrations(driver, migrations);
    sequence = 0;
    now = NOW;
    queries = [];
    answer = async () => ok({ balance: 1_500_000n, decimals: 6 });
    services = createAppServices({
      driver,
      clock: { now: () => now },
      generateId: () => `id-${++sequence}`,
      generateSecret: () => 'test-secret',
      onChainClient: {
        readBalance: (query) => {
          queries.push(query);
          return answer(query);
        },
      },
    });
    await services.ledger.initialize();
    unwrap(await services.ledger.setBaseCurrency('USD'));
  });

  afterEach(() => driver.close());

  const onchain = () => services.onchain;

  const account = async (openingBalance = '0', currencyCode = 'USDT') =>
    unwrap(
      await services.ledger.createAccount({
        name: 'Wallet',
        type: 'Crypto',
        currencyCode,
        openingBalance,
      }),
    ).id;

  const tronInput = (change: Partial<WatchedInput> = {}): WatchedInput => ({
    id: null,
    chainId: 'default-tron',
    tokenId: 'default-usdt-tron',
    address: TRON_ADDRESS,
    label: 'Main',
    accountId: null,
    ...change,
  });

  const watch = async (change: Partial<WatchedInput> = {}) =>
    unwrap(await onchain().saveWatched(tronInput(change)));

  const enabled = () => onchain().setNetworkEnabled(true);

  async function snapshot() {
    const tables = await driver.all<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`,
    );
    const rows: Record<string, unknown[]> = {};
    for (const { name } of tables) rows[name] = await driver.all(`SELECT * FROM "${name}"`);
    return rows;
  }

  describe('seeds', () => {
    it('gives Tron first and valid defaults that stay editable', async () => {
      const chains = await onchain().listChains();
      const tokens = await onchain().listTokens();
      expect(chains.map(({ id }) => id).sort()).toEqual(['default-ethereum', 'default-tron']);
      for (const chain of chains) expect(validateChain(chain)).toEqual(ok(chain));
      for (const token of tokens) {
        const family = chains.find(({ id }) => id === token.chainId)?.family ?? 'evm';
        expect(validateToken(token, family)).toEqual(ok(token));
      }
      expect(tokens.map(({ symbol, contract }) => [symbol, contract]).sort()).toEqual([
        ['USDC', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'],
        ['USDT', '0xdAC17F958D2ee523a2206206994597C13D831ec7'],
        ['USDT', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'],
      ]);
    });

    it('lets a person point a chain at another endpoint', async () => {
      const [chain] = await onchain().listChains();
      unwrap(await onchain().saveChain({ ...chain, endpoint: 'https://node.example.com/' }));
      await expect(onchain().getChain(chain.id)).resolves.toMatchObject({
        endpoint: 'https://node.example.com',
      });
    });

    it('adds a token and a chain, and keeps a family and a token chain fixed', async () => {
      const chain = unwrap(
        await onchain().saveChain({
          id: null,
          name: 'Polygon',
          family: 'evm',
          endpoint: 'https://polygon.example.com',
          evmChainId: '137',
        }),
      );
      const token = unwrap(
        await onchain().saveToken({
          id: null,
          chainId: chain.id,
          symbol: 'USDT',
          contract: EVM_ADDRESS,
          decimals: 6,
        }),
      );
      unwrap(await onchain().saveChain({ ...chain, family: 'tron', evmChainId: '137' }));
      await expect(onchain().getChain(chain.id)).resolves.toMatchObject({ family: 'evm' });
      unwrap(await onchain().saveToken({ ...token, chainId: 'default-ethereum' }));
      await expect(onchain().getToken(token.id)).resolves.toMatchObject({ chainId: chain.id });
    });

    it('refuses the same contract twice on a chain', async () => {
      const [seed] = (await onchain().listTokens()).filter((t) => t.chainId === 'default-tron');
      await expect(
        onchain().saveToken({ ...seed, id: null, symbol: 'Other' }),
      ).resolves.toMatchObject({ ok: false, error: { code: 'invalid-token' } });
    });
  });

  describe('keys and seed phrases', () => {
    const secrets = [
      ['a 64 hex key', PRIVATE_KEY],
      ['a prefixed key', `0x${PRIVATE_KEY}`],
      ['a WIF key', WIF],
      ['12 words', SEED_12],
      ['24 words', SEED_24],
    ];

    it.each(secrets)('stores %s in no table, from any field', async (_, secret) => {
      const before = await snapshot();
      const [chain] = await onchain().listChains();
      const [token] = await onchain().listTokens();
      const attempts = [
        onchain().saveWatched(tronInput({ address: secret })),
        onchain().saveWatched(tronInput({ label: secret })),
        onchain().saveChain({ ...chain, name: secret }),
        onchain().saveChain({ ...chain, endpoint: secret }),
        onchain().saveChain({ ...chain, evmChainId: secret }),
        onchain().saveToken({ ...token, symbol: secret }),
        onchain().saveToken({ ...token, contract: secret }),
      ];
      for (const attempt of attempts) {
        const result = await attempt;
        expect(result).toMatchObject({ ok: false, error: { code: 'secret-refused' } });
        expect(result.ok ? '' : result.error.message).toMatch(/private key or a seed phrase/);
        expect(result.ok ? '' : result.error.message).not.toContain(secret);
      }
      const after = await snapshot();
      expect(after).toEqual(before);
      expect(JSON.stringify(after)).not.toContain(secret);
    });
  });

  it('refuses a key inside an endpoint', async () => {
    const [chain] = await onchain().listChains();
    await expect(
      onchain().saveChain({ ...chain, endpoint: `https://x.example.com/${PRIVATE_KEY}` }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'secret-refused' } });
  });

  describe('watched addresses', () => {
    it('stores the canonical spelling and the label', async () => {
      const saved = await watch({
        chainId: 'default-ethereum',
        tokenId: 'default-usdt-ethereum',
        address: EVM_ADDRESS.toLowerCase(),
        label: ' Cold ',
      });
      expect(saved).toMatchObject({ address: EVM_ADDRESS, label: 'Cold', lastRead: null });
    });

    it('refuses a token of another chain', async () => {
      await expect(
        onchain().saveWatched(tronInput({ tokenId: 'default-usdt-ethereum' })),
      ).resolves.toMatchObject({ ok: false, error: { code: 'invalid-watched' } });
    });

    it('holds a chain and a token apart in the schema too', async () => {
      await expect(
        driver.run(
          `INSERT INTO onchain_watched_addresses (id, chain_id, token_id, address, label)
           VALUES ('x', 'default-tron', 'default-usdt-ethereum', 'a', 'b')`,
        ),
      ).rejects.toThrow(/FOREIGN KEY/);
    });

    it('refuses an address of another family, and a bad checksum', async () => {
      await expect(
        onchain().saveWatched(tronInput({ address: EVM_ADDRESS })),
      ).resolves.toMatchObject({ ok: false, error: { code: 'invalid-address' } });
    });

    it('refuses the same address and token twice', async () => {
      await watch();
      await expect(onchain().saveWatched(tronInput({ label: 'Again' }))).resolves.toMatchObject({
        ok: false,
        error: { code: 'invalid-watched' },
      });
    });

    it('links an account only in the token currency', async () => {
      const dollars = await account('0', 'USD');
      await expect(
        onchain().saveWatched(tronInput({ accountId: dollars })),
      ).resolves.toMatchObject({ ok: false, error: { code: 'currency-mismatch' } });
      await expect(
        onchain().saveWatched(tronInput({ accountId: 'missing' })),
      ).resolves.toMatchObject({ ok: false, error: { code: 'not-found' } });
      await expect(onchain().saveWatched(tronInput({ accountId: await account() }))).resolves
        .toMatchObject({ ok: true });
    });

    it('keeps the last read through a relabel and drops it for another address', async () => {
      await enabled();
      const saved = await watch();
      unwrap(await onchain().refresh(saved.id));
      const relabeled = unwrap(await onchain().saveWatched(tronInput({ id: saved.id, label: 'B' })));
      expect(relabeled.lastRead).not.toBeNull();
      const moved = unwrap(
        await onchain().saveWatched(
          tronInput({ id: saved.id, address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' }),
        ),
      );
      expect(moved.lastRead).toBeNull();
    });

    it('drops reads when a contract changes, not when decimals do', async () => {
      await enabled();
      const saved = await watch();
      unwrap(await onchain().refresh(saved.id));
      const token = await onchain().getToken('default-usdt-tron');
      if (!token) throw new Error('no token');
      unwrap(await onchain().saveToken({ ...token, decimals: 2 }));
      await expect(onchain().getWatched(saved.id)).resolves.toMatchObject({
        watched: { lastRead: { amount: 1_500_000n, decimals: 6 } },
      });
      unwrap(await onchain().saveToken({ ...token, contract: TRON_ADDRESS }));
      await expect(onchain().getWatched(saved.id)).resolves.toMatchObject({
        watched: { lastRead: null },
      });
    });

    it('removes one', async () => {
      const saved = await watch();
      unwrap(await onchain().removeWatched(saved.id));
      await expect(onchain().listWatched()).resolves.toEqual([]);
    });
  });

  describe('the network switch', () => {
    it('starts off and contacts nothing', async () => {
      await expect(onchain().networkEnabled()).resolves.toBe(false);
      const saved = await watch();
      await expect(onchain().refresh(saved.id)).resolves.toMatchObject({
        ok: false,
        error: { code: 'network-disabled' },
      });
      await expect(onchain().refreshAll()).resolves.toMatchObject({
        ok: false,
        error: { code: 'network-disabled' },
      });
      await onchain().listWatched();
      await onchain().getWatched(saved.id);
      expect(queries).toEqual([]);
    });

    it('contacts nothing again once turned back off', async () => {
      const saved = await watch();
      await enabled();
      unwrap(await onchain().refresh(saved.id));
      await onchain().setNetworkEnabled(false);
      await onchain().refresh(saved.id);
      expect(queries).toHaveLength(1);
    });

    it('asks for what the row watches, on the endpoint of its chain', async () => {
      const saved = await watch();
      await enabled();
      unwrap(await onchain().refresh(saved.id));
      expect(queries).toEqual([
        {
          family: 'tron',
          endpoint: 'https://api.trongrid.io',
          evmChainId: null,
          contract: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
          address: TRON_ADDRESS,
        },
      ]);
    });
  });

  describe('reading', () => {
    it('stores the exact amount and the time, and shows it offline', async () => {
      const saved = await watch();
      await enabled();
      answer = async () => ok({ balance: 2n ** 255n, decimals: 6 });
      unwrap(await onchain().refresh(saved.id));
      await onchain().setNetworkEnabled(false);
      await expect(onchain().listWatched()).resolves.toMatchObject([
        {
          stale: false,
          watched: {
            lastRead: { amount: 2n ** 255n, decimals: 6, readAt: NOW.toISOString() },
          },
        },
      ]);
    });

    it('marks a value stale as time passes', async () => {
      const saved = await watch();
      await enabled();
      unwrap(await onchain().refresh(saved.id));
      now = new Date(NOW.getTime() + 2 * 60 * 60 * 1000);
      await expect(onchain().getWatched(saved.id)).resolves.toMatchObject({ stale: true });
    });

    it('keeps the last value when a read fails', async () => {
      const saved = await watch();
      await enabled();
      unwrap(await onchain().refresh(saved.id));
      answer = async () => err({ code: 'timeout', message: 'Too slow.' });
      await expect(onchain().refresh(saved.id)).resolves.toMatchObject({
        ok: false,
        error: { code: 'timeout' },
      });
      await expect(onchain().getWatched(saved.id)).resolves.toMatchObject({
        watched: { lastRead: { amount: 1_500_000n } },
      });
    });

    it('stores nothing when the contract disagrees about decimals', async () => {
      const saved = await watch();
      await enabled();
      answer = async () => ok({ balance: 1n, decimals: 18 });
      const result = await onchain().refresh(saved.id);
      expect(result).toMatchObject({ ok: false, error: { code: 'decimals-mismatch' } });
      expect(result.ok ? '' : result.error.message).toMatch(/18 decimals.*6/);
      await expect(onchain().getWatched(saved.id)).resolves.toMatchObject({
        watched: { lastRead: null },
      });
    });

    it('holds no transaction open during the network call', async () => {
      const saved = await watch();
      await enabled();
      answer = async () => {
        await driver.transaction((tx) => tx.run(`UPDATE settings SET value = value`));
        return ok({ balance: 1n, decimals: 6 });
      };
      await expect(onchain().refresh(saved.id)).resolves.toMatchObject({ ok: true });
    });

    it('drops a read of an address edited while it was running', async () => {
      const saved = await watch();
      await enabled();
      answer = async () => {
        unwrap(
          await onchain().saveWatched(
            tronInput({ id: saved.id, address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' }),
          ),
        );
        return ok({ balance: 1n, decimals: 6 });
      };
      unwrap(await onchain().refresh(saved.id));
      await expect(onchain().getWatched(saved.id)).resolves.toMatchObject({
        watched: { lastRead: null },
      });
    });

    it('drops a read of a contract edited while it was running', async () => {
      const saved = await watch();
      await enabled();
      answer = async () => {
        const token = await onchain().getToken('default-usdt-tron');
        if (token) unwrap(await onchain().saveToken({ ...token, contract: TRON_ADDRESS }));
        return ok({ balance: 1n, decimals: 6 });
      };
      unwrap(await onchain().refresh(saved.id));
      await expect(onchain().getWatched(saved.id)).resolves.toMatchObject({
        watched: { lastRead: null },
      });
    });

    it('survives an address removed while its read was running', async () => {
      const saved = await watch();
      await enabled();
      answer = async () => {
        unwrap(await onchain().removeWatched(saved.id));
        return ok({ balance: 1n, decimals: 6 });
      };
      await expect(onchain().refresh(saved.id)).resolves.toMatchObject({
        ok: false,
        error: { code: 'not-found' },
      });
    });

    it('never lets a read that started first replace one that started later', async () => {
      const saved = await watch();
      await enabled();
      answer = async () => {
        now = new Date(NOW.getTime() + 60_000);
        answer = async () => ok({ balance: 9n, decimals: 6 });
        unwrap(await onchain().refresh(saved.id));
        return ok({ balance: 1n, decimals: 6 });
      };
      unwrap(await onchain().refresh(saved.id));
      await expect(onchain().getWatched(saved.id)).resolves.toMatchObject({
        watched: { lastRead: { amount: 9n } },
      });
    });

    it('replaces a read dated in the future, so a clock set back cannot freeze the value', async () => {
      const saved = await watch();
      await enabled();
      now = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
      unwrap(await onchain().refresh(saved.id));
      now = NOW;
      answer = async () => ok({ balance: 9n, decimals: 6 });
      unwrap(await onchain().refresh(saved.id));
      await expect(onchain().getWatched(saved.id)).resolves.toMatchObject({
        watched: { lastRead: { amount: 9n, readAt: NOW.toISOString() } },
      });
    });

    it('calls a read dated in the future stale', async () => {
      const saved = await watch();
      await enabled();
      now = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
      unwrap(await onchain().refresh(saved.id));
      now = NOW;
      await expect(onchain().getWatched(saved.id)).resolves.toMatchObject({ stale: true });
    });

    const editChain = async (change: { endpoint?: string; name?: string; evmChainId?: string }) => {
      const chain = await onchain().getChain('default-ethereum');
      if (chain) unwrap(await onchain().saveChain({ ...chain, ...change }));
    };

    const watchEvm = async () => {
      const saved = await watch({
        chainId: 'default-ethereum',
        tokenId: 'default-usdt-ethereum',
        address: EVM_ADDRESS,
      });
      await enabled();
      return saved;
    };

    it.each([
      ['endpoint', { endpoint: 'https://other.example.com' }],
      ['chain ID', { evmChainId: '137' }],
    ])('forgets reads of a chain whose %s changes', async (_, change) => {
      const saved = await watchEvm();
      unwrap(await onchain().refresh(saved.id));
      await editChain(change);
      await expect(onchain().getWatched(saved.id)).resolves.toMatchObject({
        watched: { lastRead: null },
      });
    });

    it('keeps reads of a chain only renamed', async () => {
      const saved = await watchEvm();
      unwrap(await onchain().refresh(saved.id));
      await editChain({ name: 'Mainnet' });
      await expect(onchain().getWatched(saved.id)).resolves.toMatchObject({
        watched: { lastRead: { amount: 1_500_000n } },
      });
    });

    it('drops a read of a chain edited while it was running', async () => {
      const saved = await watchEvm();
      answer = async () => {
        await editChain({ endpoint: 'https://other.example.com' });
        return ok({ balance: 1n, decimals: 6 });
      };
      unwrap(await onchain().refresh(saved.id));
      await expect(onchain().getWatched(saved.id)).resolves.toMatchObject({
        watched: { lastRead: null },
      });
    });

    it('stops contacting anything when the switch goes off during refresh all', async () => {
      const first = await watch({ label: 'A' });
      const second = await watch({
        label: 'B',
        chainId: 'default-ethereum',
        tokenId: 'default-usdt-ethereum',
        address: EVM_ADDRESS,
      });
      await enabled();
      answer = async () => {
        await onchain().setNetworkEnabled(false);
        return ok({ balance: 5n, decimals: 6 });
      };
      await expect(onchain().refreshAll()).resolves.toEqual(
        ok([
          { id: first.id, label: 'A', error: null },
          {
            id: second.id,
            label: 'B',
            error: 'Turn on network reads in network settings first.',
          },
        ]),
      );
      expect(queries).toHaveLength(1);
    });

    it('refreshes every address in turn, and one failure does not stop the rest', async () => {
      const first = await watch({ label: 'A' });
      const second = await watch({
        label: 'B',
        chainId: 'default-ethereum',
        tokenId: 'default-usdt-ethereum',
        address: EVM_ADDRESS,
      });
      await enabled();
      answer = async ({ family }) =>
        family === 'tron'
          ? err({ code: 'timeout', message: 'Too slow.' })
          : ok({ balance: 5n, decimals: 6 });
      await expect(onchain().refreshAll()).resolves.toEqual(
        ok([
          { id: first.id, label: 'A', error: 'Too slow.' },
          { id: second.id, label: 'B', error: null },
        ]),
      );
    });
  });

  describe('the difference', () => {
    const posted = async () =>
      JSON.stringify([
        await driver.all('SELECT * FROM transactions'),
        await driver.all('SELECT * FROM postings'),
      ]);

    it('compares with the ledger and posts nothing', async () => {
      const accountId = await account('1.000000');
      const saved = await watch({ accountId });
      await enabled();
      const before = await posted();
      const view = unwrap(await onchain().refresh(saved.id));
      expect(view.comparison).toEqual({
        status: 'differs',
        counted: 1_500_000n,
        difference: 500_000n,
      });
      await onchain().refreshAll();
      await onchain().listWatched();
      expect(await posted()).toBe(before);
    });

    it('settles once the person confirms the reconcile with that amount', async () => {
      const accountId = await account('1.000000');
      const saved = await watch({ accountId });
      await enabled();
      const view = unwrap(await onchain().refresh(saved.id));
      const countedBalance = formatDecimal(view.comparison?.counted ?? 0n, 6);
      unwrap(await services.ledger.reconcile({ accountId, countedBalance }));
      await expect(onchain().getWatched(saved.id)).resolves.toMatchObject({
        comparison: { status: 'matches', difference: 0n },
      });
    });

    it('has nothing to compare with no account or no read', async () => {
      const saved = await watch();
      await enabled();
      await expect(onchain().refresh(saved.id)).resolves.toMatchObject({
        ok: true,
        value: { comparison: null },
      });
      const unread = await watch({
        chainId: 'default-ethereum',
        tokenId: 'default-usdt-ethereum',
        address: EVM_ADDRESS,
        accountId: await account(),
      });
      await expect(onchain().getWatched(unread.id)).resolves.toMatchObject({ comparison: null });
    });

    it('stops comparing when an edited token no longer matches the account', async () => {
      const saved = await watch({ accountId: await account() });
      await enabled();
      unwrap(await onchain().refresh(saved.id));
      const token = await onchain().getToken('default-usdt-tron');
      if (!token) throw new Error('no token');
      unwrap(await onchain().saveToken({ ...token, symbol: 'USDD' }));
      await expect(onchain().getWatched(saved.id)).resolves.toMatchObject({ comparison: null });
    });

    it('compares an old read at the decimals it was read with', async () => {
      const saved = await watch({ accountId: await account('1.500000') });
      await enabled();
      unwrap(await onchain().refresh(saved.id));
      const token = await onchain().getToken('default-usdt-tron');
      if (!token) throw new Error('no token');
      unwrap(await onchain().saveToken({ ...token, decimals: 18 }));
      await expect(onchain().getWatched(saved.id)).resolves.toMatchObject({
        comparison: { status: 'matches' },
      });
    });
  });
});
