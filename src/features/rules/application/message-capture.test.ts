import { createAppServices, type AppServices } from '@/app-services/create-app-services';
import { migrations } from '@/shared/persistence/migrations';
import { runMigrations } from '@/shared/persistence/migrator';
import { createNodeSqliteDriver } from '@/shared/persistence/node-sqlite-driver';
import type { SqlDriver } from '@/shared/persistence/sql-driver';
import type { Result } from '@/shared/result';

import type { MessageSource } from '../domain/source';
import type { IncomingMessage, IngestResult } from './ingest-message';
import {
  absentMessageCapture,
  createMessageCapture,
  type MessageCapturePort,
  type PermissionOutcome,
  type QueuedMessage,
} from './message-capture';

function unwrap<T>(result: Result<T, { code: string; message: string }>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

/** Holds what the native side holds, so a test can read it back. */
function fakePort(over: Partial<MessageCapturePort> = {}) {
  const state = {
    enabled: false,
    senders: [] as string[],
    queue: [] as QueuedMessage[],
    shared: null as string | null,
    permitted: false,
    permission: 'granted' as PermissionOutcome,
    calls: [] as string[],
  };
  const port: MessageCapturePort = {
    available: true,
    isEnabled: async () => state.enabled,
    setEnabled: async (enabled) => {
      state.calls.push(`setEnabled:${enabled}`);
      state.enabled = enabled;
    },
    setSenders: async (senders) => {
      state.calls.push('setSenders');
      state.senders = [...senders];
    },
    readQueue: async () => [...state.queue],
    removeQueued: async (id) => {
      state.calls.push(`remove:${id}`);
      state.queue = state.queue.filter((entry) => entry.id !== id);
    },
    takeSharedText: async () => {
      const text = state.shared;
      state.shared = null;
      return text;
    },
    onSharedText: () => () => undefined,
    hasPermission: async () => state.permitted,
    requestPermission: async () => {
      state.calls.push('requestPermission');
      state.permitted = state.permission === 'granted';
      return state.permission;
    },
    openAppInfo: async () => undefined,
    ...over,
  };
  return { port, state };
}

const queued = (id: string, body = `Paid ${id}`): QueuedMessage => ({
  id,
  sender: 'bankco',
  body,
  receivedAt: '2026-03-10T11:00:00.000Z',
});

const source = (over: Partial<MessageSource> = {}): MessageSource => ({
  id: 's1',
  name: 'Bank',
  channel: 'sms',
  sender: 'bankco',
  enabled: true,
  ...over,
});

function fakeRules(over: { ingest?: (message: IncomingMessage) => Promise<IngestResult> } = {}) {
  const ingested: IncomingMessage[] = [];
  return {
    ingested,
    rules: {
      listSources: async () => [source()],
      ingestMessage: async (message: IncomingMessage): Promise<IngestResult> => {
        ingested.push(message);
        return over.ingest ? over.ingest(message) : { outcome: 'duplicate' };
      },
    },
  };
}

describe('drain', () => {
  it('sends each entry through ingest as an SMS, in order, and removes it', async () => {
    const { port, state } = fakePort();
    state.queue = [queued('a'), queued('b')];
    const { rules, ingested } = fakeRules();

    const result = await createMessageCapture({ port, rules }).drain();

    expect(ingested).toEqual([
      { channel: 'sms', sender: 'bankco', body: 'Paid a', receivedAt: queued('a').receivedAt },
      { channel: 'sms', sender: 'bankco', body: 'Paid b', receivedAt: queued('b').receivedAt },
    ]);
    expect(state.queue).toEqual([]);
    expect(result).toEqual({ ingested: 2, failed: 0 });
  });

  it('removes an entry only after ingest resolved', async () => {
    const { port, state } = fakePort();
    state.queue = [queued('a')];
    let finish: (result: IngestResult) => void = () => undefined;
    const { rules } = fakeRules({
      ingest: () => new Promise((resolve) => (finish = resolve)),
    });

    const drained = createMessageCapture({ port, rules }).drain();
    await new Promise((resolve) => setImmediate(resolve));
    expect(state.queue).toHaveLength(1);

    finish({ outcome: 'duplicate' });
    await drained;
    expect(state.queue).toEqual([]);
  });

  it('keeps an entry whose ingest failed and still handles the next one', async () => {
    const { port, state } = fakePort();
    state.queue = [queued('bad'), queued('good')];
    const { rules } = fakeRules({
      ingest: async ({ body }) => {
        if (body === 'Paid bad') throw new Error('disk failure');
        return { outcome: 'duplicate' };
      },
    });

    const result = await createMessageCapture({ port, rules }).drain();

    expect(state.queue.map(({ id }) => id)).toEqual(['bad']);
    expect(result).toEqual({ ingested: 1, failed: 1 });
  });

  it('removes entries that ingest discarded, because they are finished', async () => {
    const { port, state } = fakePort();
    state.queue = [queued('otp'), queued('gone')];
    const outcomes: IngestResult[] = [{ outcome: 'one-time-code' }, { outcome: 'dropped' }];
    const { rules } = fakeRules({ ingest: async () => outcomes.shift()! });

    await createMessageCapture({ port, rules }).drain();

    expect(state.queue).toEqual([]);
  });

  it('never ingests an entry twice when drains overlap', async () => {
    const { port, state } = fakePort();
    state.queue = [queued('a')];
    const { rules, ingested } = fakeRules();
    const capture = createMessageCapture({ port, rules });

    await Promise.all([capture.drain(), capture.drain(), capture.drain()]);

    expect(ingested).toHaveLength(1);
  });

  it('drains again once the previous drain finished', async () => {
    const { port, state } = fakePort();
    const { rules, ingested } = fakeRules();
    const capture = createMessageCapture({ port, rules });

    await capture.drain();
    state.queue = [queued('later')];
    await capture.drain();

    expect(ingested).toHaveLength(1);
  });

  it('recovers from a queue that could not be read', async () => {
    const { port, state } = fakePort({
      readQueue: () => Promise.reject(new Error('unreadable')),
    });
    state.queue = [queued('a')];
    const { rules } = fakeRules();

    await expect(createMessageCapture({ port, rules }).drain()).resolves.toEqual({
      ingested: 0,
      failed: 0,
    });
  });
});

describe('sender sync', () => {
  it('sends only enabled sources that accept SMS', async () => {
    const { port, state } = fakePort();
    const capture = createMessageCapture({
      port,
      rules: {
        ...fakeRules().rules,
        listSources: async () => [
          source({ sender: 'bankco' }),
          source({ id: 's2', sender: 'off', enabled: false }),
          source({ id: 's3', sender: 'pasted', channel: 'paste' }),
        ],
      },
    });

    await capture.syncSenders();

    expect(state.senders).toEqual(['bankco']);
  });
});

describe('capture switch', () => {
  it('is off until the user turns it on', async () => {
    const { port } = fakePort();

    await expect(createMessageCapture({ port, rules: fakeRules().rules }).status()).resolves.toEqual(
      { available: true, enabled: false, permitted: false },
    );
  });

  it('asks for the permission, then syncs senders before enabling', async () => {
    const { port, state } = fakePort();

    const outcome = await createMessageCapture({ port, rules: fakeRules().rules }).enable();

    expect(outcome).toBe('granted');
    expect(state.calls).toEqual(['requestPermission', 'setSenders', 'setEnabled:true']);
  });

  it.each(['denied', 'blocked'] as const)('stays off when the permission is %s', async (result) => {
    const { port, state } = fakePort();
    state.permission = result;

    const outcome = await createMessageCapture({ port, rules: fakeRules().rules }).enable();

    expect(outcome).toBe(result);
    expect(state.enabled).toBe(false);
    expect(state.calls).toEqual(['requestPermission']);
  });

  it('stops capture first, then drains what was already accepted', async () => {
    const { port, state } = fakePort();
    state.enabled = true;
    state.queue = [queued('a')];
    const { rules, ingested } = fakeRules();

    await createMessageCapture({ port, rules }).disable();

    expect(state.calls[0]).toBe('setEnabled:false');
    expect(ingested).toHaveLength(1);
    expect(state.queue).toEqual([]);
  });

  it('reports when the permission was taken away while capture is on', async () => {
    const { port, state } = fakePort();
    state.enabled = true;
    state.permitted = false;

    await expect(createMessageCapture({ port, rules: fakeRules().rules }).status()).resolves.toEqual(
      { available: true, enabled: true, permitted: false },
    );
  });
});

describe('refresh', () => {
  it('syncs and drains together, and a failure in one leaves the other', async () => {
    const { port, state } = fakePort({
      setSenders: () => Promise.reject(new Error('prefs failed')),
    });
    state.queue = [queued('a')];
    const { rules, ingested } = fakeRules();

    await expect(createMessageCapture({ port, rules }).refresh()).resolves.toBeUndefined();

    expect(ingested).toHaveLength(1);
  });
});

describe('a build with no native capture', () => {
  const inertPort = () => {
    const touched: string[] = [];
    const port: MessageCapturePort = {
      ...absentMessageCapture,
      setEnabled: async () => void touched.push('setEnabled'),
      setSenders: async () => void touched.push('setSenders'),
      readQueue: async () => {
        touched.push('readQueue');
        return [queued('a')];
      },
      requestPermission: async () => {
        touched.push('requestPermission');
        return 'granted';
      },
    };
    return { port, touched };
  };

  it('never touches capture, even if an entry could be read', async () => {
    const { port, touched } = inertPort();
    const { rules, ingested } = fakeRules();
    const capture = createMessageCapture({ port, rules });

    await capture.syncSenders();
    await capture.refresh();
    await capture.drain();
    await capture.disable();

    expect(touched).toEqual([]);
    expect(ingested).toEqual([]);
  });

  it('refuses to enable and reports no availability', async () => {
    const { port, touched } = inertPort();
    const capture = createMessageCapture({ port, rules: fakeRules().rules });

    await expect(capture.enable()).resolves.toBe('denied');
    await expect(capture.status()).resolves.toEqual({
      available: false,
      enabled: false,
      permitted: false,
    });
    expect(touched).toEqual([]);
  });

  it('works from the absent port itself', async () => {
    const capture = createMessageCapture({
      port: absentMessageCapture,
      rules: fakeRules().rules,
    });

    await expect(capture.receiveShared()).resolves.toBe(false);
    await expect(capture.drain()).resolves.toEqual({ ingested: 0, failed: 0 });
    expect(capture.available).toBe(false);
  });
});

describe('shared text', () => {
  it('holds the text in memory until the paste screen clears it', async () => {
    const { port, state } = fakePort();
    state.shared = 'Paid 10 USD';
    const { rules, ingested } = fakeRules();
    const capture = createMessageCapture({ port, rules });

    await expect(capture.receiveShared()).resolves.toBe(true);

    expect(capture.peekShared()).toBe('Paid 10 USD');
    expect(capture.peekShared()).toBe('Paid 10 USD');
    capture.clearShared();
    expect(capture.peekShared()).toBeNull();
    expect(ingested).toEqual([]);
  });

  it.each([null, '', '  \n '])('opens nothing for %j', async (text) => {
    const { port, state } = fakePort();
    state.shared = text;
    const capture = createMessageCapture({ port, rules: fakeRules().rules });

    await expect(capture.receiveShared()).resolves.toBe(false);
    expect(capture.peekShared()).toBeNull();
  });

  it('works in a build with no SMS capture, because sharing is in both variants', async () => {
    const { port, state } = fakePort({ available: false });
    state.shared = 'Paid 10 USD';

    const capture = createMessageCapture({ port, rules: fakeRules().rules });

    await expect(capture.receiveShared()).resolves.toBe(true);
  });

  it('opens nothing when the text cannot be read', async () => {
    const { port } = fakePort({
      takeSharedText: () => Promise.reject(new Error('lost context')),
    });

    await expect(
      createMessageCapture({ port, rules: fakeRules().rules }).receiveShared(),
    ).resolves.toBe(false);
  });
});

describe('with the real rules engine', () => {
  const NOW = '2026-03-10T12:00:00.000Z';
  let driver: SqlDriver;
  let services: AppServices;
  let sequence = 0;

  const open = (port: MessageCapturePort) =>
    createAppServices({
      driver,
      clock: { now: () => new Date(NOW) },
      generateId: () => `id-${++sequence}`,
      generateSecret: () => 'test-secret',
      messageCapture: port,
    });

  const bank = (over: Partial<Omit<MessageSource, 'id'>> = {}) =>
    services.rules.createSource({
      name: 'Bank',
      channel: 'sms',
      sender: 'Bank-Co',
      enabled: true,
      ...over,
    });

  const inboxBodies = async () => {
    const rows = await driver.all<{ body: string | null }>(`SELECT body FROM inbox_items`);
    return rows.map(({ body }) => body);
  };

  beforeEach(async () => {
    driver = createNodeSqliteDriver();
    await runMigrations(driver, migrations);
  });

  afterEach(async () => {
    await driver.close();
  });

  it('syncs when a source is created, and again when it is turned off', async () => {
    const { port, state } = fakePort();
    services = open(port);

    const source = unwrap(await bank());
    expect(state.senders).toEqual(['bankco']);

    unwrap(await services.rules.updateSource({ ...source, enabled: false }));
    expect(state.senders).toEqual([]);
  });

  it('does not sync when a source is rejected', async () => {
    const { port, state } = fakePort();
    services = open(port);

    await services.rules.createSource({ name: '', channel: 'sms', sender: 'x', enabled: true });

    expect(state.calls).toEqual([]);
  });

  it('keeps a saved source when the sync fails, because the next refresh retries', async () => {
    const { port } = fakePort({ setSenders: () => Promise.reject(new Error('prefs failed')) });
    services = open(port);

    expect((await bank()).ok).toBe(true);
    expect(await services.rules.listSources()).toHaveLength(1);
  });

  it('puts a drained message in the inbox and empties the queue', async () => {
    const { port, state } = fakePort();
    services = open(port);
    unwrap(await bank());
    state.queue = [queued('a', 'Spent 10 USD at Acme')];

    await services.capture.drain();

    expect(await inboxBodies()).toEqual(['Spent 10 USD at Acme']);
    expect(state.queue).toEqual([]);
  });

  it('treats a replay after a crash as a repeat, not as a new message', async () => {
    const { port, state } = fakePort();
    services = open(port);
    await services.ledger.initialize();
    const source = unwrap(await bank());
    const account = unwrap(
      await services.ledger.createAccount({
        name: 'Checking',
        type: 'Bank',
        currencyCode: 'USD',
        openingBalance: '0',
      }),
    );
    unwrap(
      await services.rules.createRule({
        sourceId: source.id,
        name: 'Salary',
        priority: 0,
        template: 'You received {amount} {currency} from {counterparty}. Ref {reference}',
        format: { decimal: '.', thousands: ',' },
        kind: 'income',
        accountId: account.id,
        categoryId: null,
        counterpartAccountId: null,
        currencyCode: null,
        autoPost: false,
        splitMode: 'none',
        splitStructureId: null,
        samples: [],
      }),
    );
    const message = queued('a', 'You received 10.00 USD from Acme. Ref R-1');
    state.queue = [message];
    await services.capture.drain();

    // The first drain ingested, but the process died before the entry was removed.
    state.queue = [message];
    await services.capture.drain();

    expect(await inboxBodies()).toHaveLength(1);
    expect(state.queue).toEqual([]);
  });

  it('drops a queued one-time code without writing it anywhere', async () => {
    const { port, state } = fakePort();
    services = open(port);
    unwrap(await bank());
    state.queue = [queued('otp', 'Your OTP is 482913')];

    await services.capture.drain();

    expect(await inboxBodies()).toEqual([]);
    expect(state.queue).toEqual([]);
  });

  it('drops a queued message whose source was turned off after it arrived', async () => {
    const { port, state } = fakePort();
    services = open(port);
    const source = unwrap(await bank());
    unwrap(await services.rules.updateSource({ ...source, enabled: false }));
    state.queue = [queued('a')];

    await services.capture.drain();

    expect(await inboxBodies()).toEqual([]);
    expect(state.queue).toEqual([]);
  });
});
