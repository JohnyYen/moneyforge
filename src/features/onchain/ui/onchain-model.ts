import { formatDecimal, formatDisplay } from '@/features/ledger/domain/money';

import type { ChainInput, TokenInput } from '../application/catalog-use-cases';
import type { RefreshOutcome, WatchedInput, WatchedView } from '../application/watch-use-cases';
import type { Chain, ChainFamily, LastRead, Token } from '../domain/onchain';

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-6)}`;
}

export function amountLabel(read: LastRead | null, symbol: string): string {
  if (!read) return 'Not read yet';
  return formatDisplay(read.amount, { code: symbol, symbol, decimals: read.decimals });
}

export function watchedSubtitle({ watched, chain, token, stale }: WatchedView): string {
  const amount = amountLabel(watched.lastRead, token.symbol);
  return `${token.symbol} on ${chain.name}. ${amount}.${stale ? ' Stale.' : ''}`;
}

export function differenceLabel({ comparison, account, currency }: WatchedView): string | null {
  if (!comparison || !account || !currency) return null;
  const { status, difference } = comparison;
  if (status === 'matches') return `Matches ${account.name} in MoneyForge.`;
  if (status === 'within-precision') {
    return `Matches ${account.name} to the ${currency.decimals} decimals it keeps.`;
  }
  const amount = formatDisplay(difference < 0n ? -difference : difference, currency);
  return `On-chain is ${amount} ${difference > 0n ? 'above' : 'below'} ${account.name} in MoneyForge.`;
}

/** What the reconcile form opens with. Only the person can record it, by pressing Reconcile. */
export function reconcileTarget({
  comparison,
  account,
  currency,
}: WatchedView): { id: string; counted: string } | null {
  if (comparison?.status !== 'differs' || !account || !currency) return null;
  return { id: account.id, counted: formatDecimal(comparison.counted, currency.decimals) };
}

export function refreshFailures(outcomes: readonly RefreshOutcome[]): string[] {
  return outcomes.flatMap(({ label, error }) => (error ? [`${label}: ${error}`] : []));
}

export type WatchedDraft = {
  readonly chainId: string;
  readonly tokenId: string;
  readonly address: string;
  readonly label: string;
  /** Empty means none. */
  readonly accountId: string;
};

export const emptyWatchedDraft = (chains: readonly Chain[]): WatchedDraft => ({
  chainId: chains[0]?.id ?? '',
  tokenId: '',
  address: '',
  label: '',
  accountId: '',
});

export const toWatchedDraft = ({ watched }: WatchedView): WatchedDraft => ({
  chainId: watched.chainId,
  tokenId: watched.tokenId,
  address: watched.address,
  label: watched.label,
  accountId: watched.accountId ?? '',
});

export const toWatchedInput = (draft: WatchedDraft, id: string | null): WatchedInput => ({
  ...draft,
  id,
  accountId: draft.accountId || null,
});

export type ChainDraft = {
  readonly name: string;
  readonly family: ChainFamily;
  readonly endpoint: string;
  readonly evmChainId: string;
};

export const emptyChainDraft: ChainDraft = {
  name: '',
  family: 'evm',
  endpoint: '',
  evmChainId: '',
};

export const toChainDraft = ({ name, family, endpoint, evmChainId }: Chain): ChainDraft => ({
  name,
  family,
  endpoint,
  evmChainId: evmChainId ?? '',
});

export const toChainInput = (draft: ChainDraft, id: string | null): ChainInput => ({
  ...draft,
  id,
  evmChainId: draft.family === 'evm' ? draft.evmChainId : null,
});

export type TokenDraft = {
  readonly chainId: string;
  readonly symbol: string;
  readonly contract: string;
  readonly decimals: string;
};

export const toTokenDraft = ({ chainId, symbol, contract, decimals }: Token): TokenDraft => ({
  chainId,
  symbol,
  contract,
  decimals: String(decimals),
});

/** Anything but digits becomes NaN, which the domain refuses. */
export const toTokenInput = (draft: TokenDraft, id: string | null): TokenInput => {
  const decimals = draft.decimals.trim();
  return { ...draft, id, decimals: /^\d+$/.test(decimals) ? Number(decimals) : Number.NaN };
};
