import type { Account } from '@/features/ledger/domain/account';
import type { Currency } from '@/features/ledger/domain/currency';
import { err, ok, type Result } from '@/shared/result';

import { normalizeAddress } from '../domain/address';
import { compareBalance, isStale, type BalanceComparison } from '../domain/balance-comparison';
import { validateLabel, type Chain, type Token, type WatchedAddress } from '../domain/onchain';
import { onChainError, type OnChainError } from '../domain/onchain-error';
import { refuseSecrets } from './catalog-use-cases';
import type { OnChainDeps, OnChainRepositories } from './ports';

export type WatchedInput = {
  readonly id: string | null;
  readonly chainId: string;
  readonly tokenId: string;
  readonly address: string;
  readonly label: string;
  readonly accountId: string | null;
};

export type WatchedView = {
  readonly watched: WatchedAddress;
  readonly chain: Chain;
  readonly token: Token;
  readonly account: Account | null;
  /** The linked account's currency. */
  readonly currency: Currency | null;
  readonly stale: boolean;
  /** Empty with no read, no account, or an account in another currency. */
  readonly comparison: BalanceComparison | null;
};

export type RefreshOutcome = {
  readonly id: string;
  readonly label: string;
  readonly error: string | null;
};

const notFound = (what: string) => err(onChainError('not-found', `${what} not found.`));
const disabled = () =>
  err(onChainError('network-disabled', 'Turn on network reads in network settings first.'));

async function checkAccount(
  { accounts }: Pick<OnChainRepositories, 'accounts'>,
  { accountId }: WatchedInput,
  token: Token,
  existing: WatchedAddress | null,
): Promise<Result<void, OnChainError>> {
  if (!accountId) return ok(undefined);
  const account = await accounts.get(accountId);
  if (!account || account.systemRole !== null) return notFound('Account');
  if (account.archived && account.id !== existing?.accountId) {
    return err(onChainError('invalid-watched', `${account.name} is archived.`));
  }
  if (account.currencyCode !== token.symbol) {
    return err(onChainError('currency-mismatch', `Choose an account in ${token.symbol}.`));
  }
  return ok(undefined);
}

export function createWatchUseCases(
  { store, clock, generateId, client }: OnChainDeps,
  networkEnabled: () => Promise<boolean>,
) {
  /** Only reads the database, so listing stays offline. */
  async function views(list: readonly WatchedAddress[]): Promise<WatchedView[]> {
    const [chains, tokens, accounts, currencies, balances] = await Promise.all([
      store.onchain.listChains(),
      store.onchain.listTokens(),
      store.accounts.listUser(),
      store.currencies.list(),
      store.journal.balances(),
    ]);
    return list.flatMap((watched) => {
      const chain = chains.find(({ id }) => id === watched.chainId);
      const token = tokens.find(({ id }) => id === watched.tokenId);
      if (!chain || !token) return [];
      const account = accounts.find(({ id }) => id === watched.accountId) ?? null;
      const currency = currencies.find(({ code }) => code === account?.currencyCode) ?? null;
      const { lastRead } = watched;
      const comparable = lastRead && account && currency && account.currencyCode === token.symbol;
      const comparison = comparable
        ? compareBalance({
            amount: lastRead.amount,
            tokenDecimals: lastRead.decimals,
            ledger: balances[account.id] ?? 0n,
            accountDecimals: currency.decimals,
          })
        : null;
      const stale = lastRead ? isStale(lastRead.readAt, clock.now()) : false;
      return [{ watched, chain, token, account, currency, stale, comparison }];
    });
  }

  async function getWatched(id: string): Promise<WatchedView | null> {
    const watched = await store.onchain.getWatched(id);
    return watched ? ((await views([watched]))[0] ?? null) : null;
  }

  /** Awaits the network, so it must never run inside a write. */
  async function read(id: string): Promise<Result<WatchedView, OnChainError>> {
    const watched = await store.onchain.getWatched(id);
    if (!watched) return notFound('Address');
    const chain = await store.onchain.getChain(watched.chainId);
    const token = await store.onchain.getToken(watched.tokenId);
    if (!chain || !token) return notFound('Token');
    // From the start of the read: of two running at once, the one asked later knows more.
    const readAt = clock.now().toISOString();
    const reply = await client.readBalance({
      family: chain.family,
      endpoint: chain.endpoint,
      evmChainId: chain.evmChainId,
      contract: token.contract,
      address: watched.address,
    });
    if (!reply.ok) return reply;
    const { balance, decimals } = reply.value;
    if (decimals !== token.decimals) {
      const message = `The contract reports ${decimals} decimals, but ${token.symbol} is set to ${token.decimals}. Check the token.`;
      return err(onChainError('decimals-mismatch', message));
    }
    await store.onchain.saveRead(
      watched,
      { contract: token.contract, endpoint: chain.endpoint, evmChainId: chain.evmChainId },
      { amount: balance, decimals, readAt },
      clock.now().toISOString(),
    );
    const view = await getWatched(id);
    return view ? ok(view) : notFound('Address');
  }

  return {
    getWatched,

    listWatched: async () => views(await store.onchain.listWatched()),

    saveWatched: async (input: WatchedInput): Promise<Result<WatchedAddress, OnChainError>> => {
      const clean = refuseSecrets(input.address, input.label);
      if (!clean.ok) return clean;
      return store.atomic(async ({ onchain, accounts }) => {
        const existing = input.id ? await onchain.getWatched(input.id) : null;
        if (input.id && !existing) return notFound('Address');
        const chain = await onchain.getChain(input.chainId);
        const token = await onchain.getToken(input.tokenId);
        if (!chain || !token) return notFound('Token');
        if (token.chainId !== chain.id) {
          return err(onChainError('invalid-watched', `${token.symbol} is not on ${chain.name}.`));
        }
        const address = normalizeAddress(chain.family, input.address);
        if (!address.ok) return address;
        const label = validateLabel(input.label);
        if (!label.ok) return label;
        const allowed = await checkAccount({ accounts }, input, token, existing);
        if (!allowed.ok) return allowed;
        const id = input.id ?? generateId();
        const taken = (await onchain.listWatched()).some(
          (other) =>
            other.id !== id && other.tokenId === token.id && other.address === address.value,
        );
        if (taken) {
          return err(onChainError('invalid-watched', 'You already watch this address and token.'));
        }
        const unchanged = existing?.address === address.value && existing.tokenId === token.id;
        const watched: WatchedAddress = {
          id,
          chainId: chain.id,
          tokenId: token.id,
          address: address.value,
          label: label.value,
          accountId: input.accountId,
          lastRead: unchanged ? existing.lastRead : null,
        };
        await onchain.saveWatched(watched);
        return ok(watched);
      });
    },

    removeWatched: async (id: string): Promise<Result<void, OnChainError>> => {
      await store.onchain.removeWatched(id);
      return ok(undefined);
    },

    /** The only way anything reaches the network, and it asks the switch first. */
    refresh: async (id: string): Promise<Result<WatchedView, OnChainError>> =>
      (await networkEnabled()) ? read(id) : disabled(),

    /**
     * One at a time, so a public endpoint sees no burst. The switch is asked before each address,
     * so turning it off stops the rest of a long run.
     */
    refreshAll: async (): Promise<Result<RefreshOutcome[], OnChainError>> => {
      if (!(await networkEnabled())) return disabled();
      const outcomes: RefreshOutcome[] = [];
      for (const { id, label } of await store.onchain.listWatched()) {
        const reply = (await networkEnabled()) ? await read(id) : disabled();
        outcomes.push({ id, label, error: reply.ok ? null : reply.error.message });
      }
      return ok(outcomes);
    },
  };
}
