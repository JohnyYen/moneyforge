import { err, ok, type Result } from '@/shared/result';

import type { BalanceQuery, BalanceRead, OnChainClient } from '../application/ports';
import {
  BALANCE_OF_SELECTOR,
  DECIMALS_SELECTOR,
  parseDecimalsWord,
  parseUintWord,
} from '../domain/abi';
import { addressWord } from '../domain/address';
import { hostOf } from '../domain/onchain';
import { onChainError, type OnChainError, type OnChainErrorCode } from '../domain/onchain-error';

export type HttpResponse = {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
};

export type HttpFetch = (
  url: string,
  init: {
    readonly method: 'POST';
    readonly headers: Record<string, string>;
    readonly body: string;
    readonly signal: AbortSignal;
    readonly redirect: 'error';
    readonly credentials: 'omit';
  },
) => Promise<HttpResponse>;

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_ATTEMPTS = 2;
const DEFAULT_BACKOFF_MS = 300;
/** A contract read is a few hundred bytes, or a few KB with Tron's echoed transaction. */
const MAX_RESPONSE_BYTES = 64 * 1024;

const RETRIED: readonly OnChainErrorCode[] = ['timeout', 'network-failed'];

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

type Reply = Result<unknown, OnChainError>;

/**
 * Talks to a user's endpoint, so every answer is untrusted: it is checked by shape, its own text
 * never reaches a message, and a message names only the host, since a path may hold an API key.
 * `response.text()` has no byte limit in React Native, so a body with no declared length is
 * bounded by the timeout and refused after reading.
 */
export function createFetchOnChainClient({
  fetch: send = (url, init) => fetch(url, init),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  attempts = DEFAULT_ATTEMPTS,
  backoffMs = DEFAULT_BACKOFF_MS,
  sleep = delay,
}: {
  readonly fetch?: HttpFetch;
  readonly timeoutMs?: number;
  readonly attempts?: number;
  readonly backoffMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
} = {}): OnChainClient {
  async function exchange(url: string, payload: object, signal: AbortSignal): Promise<Reply> {
    const host = hostOf(url);
    const malformed = err(
      onChainError('malformed-response', `${host} sent an answer MoneyForge cannot read.`),
    );
    const oversized = err(onChainError('oversized-response', `${host} sent too much data.`));
    try {
      const response = await send(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal,
        redirect: 'error',
        credentials: 'omit',
      });
      if (response.status === 429) {
        const message = `${host} is limiting requests. Wait a little, or set another endpoint.`;
        return err(onChainError('network-failed', message));
      }
      if (!response.ok) {
        const code = response.status >= 500 ? 'network-failed' : 'endpoint-refused';
        return err(onChainError(code, `${host} answered with status ${response.status}.`));
      }
      const declared = Number(response.headers.get('content-length') ?? 0);
      if (declared > MAX_RESPONSE_BYTES) return oversized;
      const text = await response.text();
      if (text.length > MAX_RESPONSE_BYTES) return oversized;
      try {
        return ok(JSON.parse(text) as unknown);
      } catch {
        return malformed;
      }
    } catch {
      return err(onChainError('network-failed', `Could not reach ${host}.`));
    }
  }

  /** Raced, because a React Native body read may not stop on abort. */
  async function attempt(url: string, payload: object): Promise<Reply> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<Reply>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve(err(onChainError('timeout', `${hostOf(url)} took too long to answer.`)));
      }, timeoutMs);
    });
    const reply = await Promise.race([exchange(url, payload, controller.signal), timedOut]);
    clearTimeout(timer);
    return reply;
  }

  async function post(url: string, payload: object): Promise<Reply> {
    let reply = await attempt(url, payload);
    for (let tried = 1; tried < attempts; tried += 1) {
      if (reply.ok || !RETRIED.includes(reply.error.code)) return reply;
      await sleep(backoffMs * tried);
      reply = await attempt(url, payload);
    }
    return reply;
  }

  const malformedFrom = (endpoint: string) =>
    err(onChainError('malformed-response', `${hostOf(endpoint)} sent an answer MoneyForge cannot read.`));

  async function rpc(endpoint: string, id: number, method: string, params: unknown[]) {
    const reply = await post(endpoint, { jsonrpc: '2.0', id, method, params });
    if (!reply.ok) return reply;
    const body = reply.value;
    if (!isRecord(body) || body.id !== id) return malformedFrom(endpoint);
    if (isRecord(body.error)) {
      const message = `${hostOf(endpoint)} refused the call, code ${Number(body.error.code)}.`;
      return err(onChainError('endpoint-refused', message));
    }
    return typeof body.result === 'string' ? ok(body.result) : malformedFrom(endpoint);
  }

  const noContract = (contract: string) =>
    err(onChainError('no-contract', `No token contract answered at ${contract} on this network.`));

  async function evmCall({ endpoint, contract }: BalanceQuery, id: number, data: string) {
    const reply = await rpc(endpoint, id, 'eth_call', [{ to: contract, data: `0x${data}` }, 'latest']);
    return reply.ok && reply.value === '0x' ? noContract(contract) : reply;
  }

  async function confirmChain({ endpoint, evmChainId }: BalanceQuery) {
    const reply = await rpc(endpoint, 1, 'eth_chainId', []);
    if (!reply.ok) return reply;
    if (!/^0x[0-9a-fA-F]+$/.test(reply.value)) return malformedFrom(endpoint);
    if (BigInt(reply.value).toString() === evmChainId) return ok(undefined);
    const message = `${hostOf(endpoint)} serves another network. Check the endpoint and the chain ID.`;
    return err(onChainError('chain-mismatch', message));
  }

  /** Decimals first, so a contract that cannot answer them costs no further call. */
  async function readBoth(
    { endpoint }: BalanceQuery,
    readDecimals: () => Promise<Result<string, OnChainError>>,
    readBalanceWord: () => Promise<Result<string, OnChainError>>,
  ): Promise<Result<BalanceRead, OnChainError>> {
    const decimalsReply = await readDecimals();
    if (!decimalsReply.ok) return decimalsReply;
    const decimals = parseDecimalsWord(decimalsReply.value);
    if (decimals === null) return malformedFrom(endpoint);
    const balanceReply = await readBalanceWord();
    if (!balanceReply.ok) return balanceReply;
    const balance = parseUintWord(balanceReply.value);
    return balance === null ? malformedFrom(endpoint) : ok({ balance, decimals });
  }

  async function readEvm(query: BalanceQuery): Promise<Result<BalanceRead, OnChainError>> {
    const chain = await confirmChain(query);
    if (!chain.ok) return chain;
    const word = addressWord('evm', query.address);
    return readBoth(
      query,
      () => evmCall(query, 2, DECIMALS_SELECTOR),
      () => evmCall(query, 3, `${BALANCE_OF_SELECTOR}${word}`),
    );
  }

  async function tronCall(
    { endpoint, contract, address }: BalanceQuery,
    selector: string,
    parameter: string,
  ): Promise<Result<string, OnChainError>> {
    const reply = await post(`${endpoint}/wallet/triggerconstantcontract`, {
      owner_address: address,
      contract_address: contract,
      function_selector: selector,
      parameter,
      visible: true,
    });
    if (!reply.ok) return reply;
    const body = reply.value;
    if (!isRecord(body) || !isRecord(body.result)) return malformedFrom(endpoint);
    const { result } = body;
    if (result.code === 'CONTRACT_VALIDATE_ERROR') return noContract(contract);
    if (result.result !== true) {
      const code = typeof result.code === 'string' ? result.code : 'unknown';
      const message = `${hostOf(endpoint)} refused the call, code ${code.slice(0, 40)}.`;
      return err(onChainError('endpoint-refused', message));
    }
    const words = body.constant_result;
    if (!Array.isArray(words) || words.length !== 1) return malformedFrom(endpoint);
    const [word] = words as unknown[];
    if (word === '') return noContract(contract);
    return typeof word === 'string' ? ok(word) : malformedFrom(endpoint);
  }

  const readTron = (query: BalanceQuery) =>
    readBoth(
      query,
      () => tronCall(query, 'decimals()', ''),
      () => tronCall(query, 'balanceOf(address)', addressWord('tron', query.address)),
    );

  return {
    readBalance: (query) => (query.family === 'evm' ? readEvm(query) : readTron(query)),
  };
}
