import type { BalanceQuery } from '../application/ports';
import { createFetchOnChainClient, type HttpFetch, type HttpResponse } from './fetch-onchain-client';

const ENDPOINT = 'https://rpc.example.com/v3/secret-key';
const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const OWNER = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const TRON_USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

const evm: BalanceQuery = {
  family: 'evm',
  endpoint: ENDPOINT,
  evmChainId: '1',
  contract: USDT,
  address: OWNER,
};
const tron: BalanceQuery = {
  family: 'tron',
  endpoint: 'https://tron.example.com',
  evmChainId: null,
  contract: TRON_USDT,
  address: 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb',
};

const word = (value: bigint) => value.toString(16).padStart(64, '0');

const response = (body: string, change: Partial<HttpResponse> = {}): HttpResponse => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  text: async () => body,
  ...change,
});
const failure = (status: number) => response('{}', { ok: false, status });

type Call = { readonly url: string; readonly body: Record<string, unknown> };

/** Answers each call in turn. A JSON-RPC answer takes the request's id. */
function scripted(...replies: ((call: Call) => HttpResponse | Promise<HttpResponse>)[]) {
  const calls: Call[] = [];
  const fetch: HttpFetch = async (url, init) => {
    const call = { url, body: JSON.parse(init.body) as Record<string, unknown> };
    calls.push(call);
    const reply = replies[calls.length - 1];
    if (!reply) throw new Error('unexpected call');
    return reply(call);
  };
  return { fetch, calls };
}

const rpcResult =
  (result: unknown) =>
  ({ body }: Call) =>
    response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));

const tronResult = (...constant: string[]) =>
  (() => response(JSON.stringify({ result: { result: true }, constant_result: constant })));

const evmReplies = (balance: bigint, decimals = 18n, chain = '0x1') => [
  rpcResult(chain),
  rpcResult(`0x${word(decimals)}`),
  rpcResult(`0x${word(balance)}`),
];

const client = (fetch: HttpFetch, change = {}) =>
  createFetchOnChainClient({
    fetch,
    timeoutMs: 20,
    backoffMs: 0,
    ...change,
  });

describe('fetch on-chain client', () => {
  describe('EVM', () => {
    it('confirms the chain, then reads an exact 18 decimal balance by eth_call', async () => {
      const balance = 123456789012345678901234567890n;
      const { fetch, calls } = scripted(...evmReplies(balance));
      await expect(client(fetch).readBalance(evm)).resolves.toEqual({
        ok: true,
        value: { balance, decimals: 18 },
      });
      expect(calls.map(({ url }) => url)).toEqual([ENDPOINT, ENDPOINT, ENDPOINT]);
      expect(calls.map(({ body }) => body.method)).toEqual(['eth_chainId', 'eth_call', 'eth_call']);
      expect(calls[1].body.params).toEqual([{ to: USDT, data: '0x313ce567' }, 'latest']);
      expect(calls[2].body.params).toEqual([
        {
          to: USDT,
          data: '0x70a082310000000000000000000000005aaeb6053f3e94c9b9a09f33669435e7ef1beaed',
        },
        'latest',
      ]);
    });

    it('refuses an endpoint on another chain before asking for the balance', async () => {
      const { fetch, calls } = scripted(rpcResult('0x89'));
      await expect(client(fetch).readBalance(evm)).resolves.toMatchObject({
        ok: false,
        error: { code: 'chain-mismatch' },
      });
      expect(calls).toHaveLength(1);
    });

    it('says when nothing lives at the contract', async () => {
      const { fetch } = scripted(rpcResult('0x1'), rpcResult('0x'));
      await expect(client(fetch).readBalance(evm)).resolves.toMatchObject({
        ok: false,
        error: { code: 'no-contract' },
      });
    });

    it('reports a JSON-RPC error by its code, without the text the endpoint chose', async () => {
      const { fetch } = scripted(({ body }) =>
        response(
          JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -32000, message: 'free text' } }),
        ),
      );
      const result = await client(fetch).readBalance(evm);
      expect(result).toMatchObject({ ok: false, error: { code: 'endpoint-refused' } });
      expect(result.ok ? '' : result.error.message).toMatch(/-32000/);
      expect(result.ok ? '' : result.error.message).not.toMatch(/free text/);
    });

    it.each([
      ['text that is not JSON', () => response('<html>')],
      ['a JSON array', () => response('[]')],
      ['another request id', () => response('{"jsonrpc":"2.0","id":99,"result":"0x1"}')],
      ['no result', ({ body }: Call) => response(JSON.stringify({ id: body.id }))],
      ['a number for a chain', rpcResult(1)],
      ['a chain that is not hex', rpcResult('one')],
    ])('refuses %s', async (_, reply) => {
      const { fetch } = scripted(reply);
      await expect(client(fetch).readBalance(evm)).resolves.toMatchObject({
        ok: false,
        error: { code: 'malformed-response' },
      });
    });

    it.each([
      ['short', '0x01'],
      ['two words', `0x${word(1n)}${word(1n)}`],
      ['not hex', `0x${'z'.repeat(64)}`],
    ])('refuses a %s balance', async (_, result) => {
      const { fetch } = scripted(rpcResult('0x1'), rpcResult(`0x${word(6n)}`), rpcResult(result));
      await expect(client(fetch).readBalance(evm)).resolves.toMatchObject({
        ok: false,
        error: { code: 'malformed-response' },
      });
    });

    it('refuses decimals no currency can hold', async () => {
      const { fetch } = scripted(rpcResult('0x1'), rpcResult(`0x${word(19n)}`));
      await expect(client(fetch).readBalance(evm)).resolves.toMatchObject({
        ok: false,
        error: { code: 'malformed-response' },
      });
    });
  });

  describe('Tron', () => {
    it('reads through triggerconstantcontract', async () => {
      const { fetch, calls } = scripted(tronResult(word(6n)), tronResult(word(1_500_000n)));
      await expect(client(fetch).readBalance(tron)).resolves.toEqual({
        ok: true,
        value: { balance: 1_500_000n, decimals: 6 },
      });
      expect(calls.map(({ url }) => url)).toEqual([
        'https://tron.example.com/wallet/triggerconstantcontract',
        'https://tron.example.com/wallet/triggerconstantcontract',
      ]);
      expect(calls[1].body).toEqual({
        owner_address: tron.address,
        contract_address: TRON_USDT,
        function_selector: 'balanceOf(address)',
        parameter: word(0n),
        visible: true,
      });
    });

    it('says when nothing lives at the contract', async () => {
      const { fetch } = scripted(() =>
        response(JSON.stringify({ result: { code: 'CONTRACT_VALIDATE_ERROR', message: '6e6f' } })),
      );
      await expect(client(fetch).readBalance(tron)).resolves.toMatchObject({
        ok: false,
        error: { code: 'no-contract' },
      });
    });

    it('reports any other refusal without the text the endpoint chose', async () => {
      const { fetch } = scripted(() =>
        response(JSON.stringify({ result: { code: 'OTHER_ERROR', message: 'free text' } })),
      );
      const result = await client(fetch).readBalance(tron);
      expect(result).toMatchObject({ ok: false, error: { code: 'endpoint-refused' } });
      expect(result.ok ? '' : result.error.message).not.toMatch(/free text/);
    });

    it.each([
      ['no result', () => response('{}')],
      ['no constant result', () => response('{"result":{"result":true}}')],
      ['two words', tronResult(word(1n), word(2n))],
      ['a short word', tronResult('01')],
    ])('refuses %s', async (_, reply) => {
      const { fetch } = scripted(reply);
      await expect(client(fetch).readBalance(tron)).resolves.toMatchObject({
        ok: false,
        error: { code: 'malformed-response' },
      });
    });
  });

  describe('limits', () => {
    it('refuses an oversized body by its declared length, without reading it', async () => {
      const text = jest.fn(async () => '{}');
      const { fetch } = scripted(() =>
        response('', { headers: { get: () => '70000' }, text }),
      );
      await expect(client(fetch).readBalance(evm)).resolves.toMatchObject({
        ok: false,
        error: { code: 'oversized-response' },
      });
      expect(text).not.toHaveBeenCalled();
    });

    it('refuses an oversized body that declared nothing, and does not retry', async () => {
      const { fetch, calls } = scripted(() => response(' '.repeat(64 * 1024 + 1)));
      await expect(client(fetch).readBalance(evm)).resolves.toMatchObject({
        ok: false,
        error: { code: 'oversized-response' },
      });
      expect(calls).toHaveLength(1);
    });

    it('times out a call that never answers, even when abort is ignored', async () => {
      const never = () => new Promise<HttpResponse>(() => undefined);
      const { fetch, calls } = scripted(never, never);
      await expect(client(fetch).readBalance(evm)).resolves.toMatchObject({
        ok: false,
        error: { code: 'timeout' },
      });
      expect(calls).toHaveLength(2);
    });

    it('aborts the request it gave up on', async () => {
      const signals: AbortSignal[] = [];
      const fetch: HttpFetch = (_, init) => {
        signals.push(init.signal);
        return new Promise(() => undefined);
      };
      await client(fetch, { attempts: 1 }).readBalance(evm);
      expect(signals[0].aborted).toBe(true);
    });

    it('times out a body that never ends', async () => {
      const { fetch } = scripted(() =>
        response('', { text: () => new Promise<string>(() => undefined) }),
      );
      await expect(client(fetch, { attempts: 1 }).readBalance(evm)).resolves.toMatchObject({
        ok: false,
        error: { code: 'timeout' },
      });
    });

    it('gives a thrown failure as a result', async () => {
      const fetch: HttpFetch = async () => {
        throw new TypeError('Network request failed');
      };
      await expect(client(fetch).readBalance(evm)).resolves.toMatchObject({
        ok: false,
        error: { code: 'network-failed' },
      });
    });
  });

  describe('retry', () => {
    it.each([429, 500, 503])('tries again after a %d', async (status) => {
      const { fetch, calls } = scripted(() => failure(status), ...evmReplies(1n));
      await expect(client(fetch).readBalance(evm)).resolves.toMatchObject({ ok: true });
      expect(calls).toHaveLength(4);
    });

    it('stops at the bound', async () => {
      const { fetch, calls } = scripted(() => failure(503), () => failure(503), () => failure(503));
      await expect(client(fetch).readBalance(evm)).resolves.toMatchObject({
        ok: false,
        error: { code: 'network-failed' },
      });
      expect(calls).toHaveLength(2);
    });

    it('waits between attempts', async () => {
      const sleep = jest.fn(async () => undefined);
      const { fetch } = scripted(() => failure(503), () => failure(503));
      await client(fetch, { backoffMs: 250, sleep }).readBalance(evm);
      expect(sleep.mock.calls).toEqual([[250]]);
    });

    it('does not retry a request the endpoint refused', async () => {
      const { fetch, calls } = scripted(() => failure(403), () => failure(403));
      await expect(client(fetch).readBalance(evm)).resolves.toMatchObject({
        ok: false,
        error: { code: 'endpoint-refused' },
      });
      expect(calls).toHaveLength(1);
    });

    it('does not retry a malformed answer', async () => {
      const { fetch, calls } = scripted(() => response('<html>'), () => response('<html>'));
      await client(fetch).readBalance(evm);
      expect(calls).toHaveLength(1);
    });
  });

  it('names only the host in a message, because a path may hold an API key', async () => {
    const replies: (() => HttpResponse)[] = [() => failure(403)];
    const { fetch } = scripted(...replies);
    const result = await client(fetch).readBalance(evm);
    expect(result.ok ? '' : result.error.message).toMatch(/rpc\.example\.com/);
    expect(result.ok ? '' : result.error.message).not.toMatch(/secret-key/);
  });

  it('sends a plain POST that keeps no credentials and follows no redirect', async () => {
    const init = jest.fn();
    const fetch: HttpFetch = async (_, request) => {
      init(request);
      return failure(403);
    };
    await client(fetch).readBalance(evm);
    expect(init.mock.calls[0][0]).toMatchObject({
      method: 'POST',
      credentials: 'omit',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json' },
    });
  });
});
