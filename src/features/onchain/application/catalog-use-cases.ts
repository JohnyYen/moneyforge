import { err, ok, type Result } from '@/shared/result';

import { validateChain, validateToken, type Chain, type Token } from '../domain/onchain';
import { onChainError, type OnChainError } from '../domain/onchain-error';
import { looksLikeSecret, SECRET_REFUSED_MESSAGE } from '../domain/secret-guard';
import type { OnChainDeps } from './ports';

const NETWORK_KEY = 'onchain.network_enabled';

export type ChainInput = Omit<Chain, 'id'> & { readonly id: string | null };
export type TokenInput = Omit<Token, 'id'> & { readonly id: string | null };

/** Runs first on anything typed, so a pasted key meets nothing that could store or echo it. */
export function refuseSecrets(...fields: readonly string[]): Result<void, OnChainError> {
  return fields.some(looksLikeSecret)
    ? err(onChainError('secret-refused', SECRET_REFUSED_MESSAGE))
    : ok(undefined);
}

const notFound = (what: string) => err(onChainError('not-found', `${what} not found.`));

export function createCatalogUseCases({ store, generateId }: OnChainDeps) {
  return {
    /** Off until a person turns it on. Nothing here contacts anything. */
    networkEnabled: async () => (await store.settings.get(NETWORK_KEY)) === 'true',

    setNetworkEnabled: (enabled: boolean) => store.settings.set(NETWORK_KEY, String(enabled)),

    listChains: () => store.onchain.listChains(),
    getChain: (id: string) => store.onchain.getChain(id),
    listTokens: () => store.onchain.listTokens(),
    getToken: (id: string) => store.onchain.getToken(id),

    /**
     * The family of a saved chain stays, because its tokens and addresses are written for it.
     * A new endpoint or chain ID may be another network, so amounts read before go with it.
     */
    saveChain: async (input: ChainInput): Promise<Result<Chain, OnChainError>> => {
      const clean = refuseSecrets(input.name, input.endpoint, input.evmChainId ?? '');
      if (!clean.ok) return clean;
      return store.atomic(async ({ onchain }) => {
        const existing = input.id ? await onchain.getChain(input.id) : null;
        if (input.id && !existing) return notFound('Chain');
        const id = input.id ?? generateId();
        const chain = validateChain({ ...input, id, family: existing?.family ?? input.family });
        if (!chain.ok) return chain;
        await onchain.saveChain(chain.value);
        const { endpoint, evmChainId } = chain.value;
        if (existing && (existing.endpoint !== endpoint || existing.evmChainId !== evmChainId)) {
          await onchain.clearChainReads(id);
        }
        return chain;
      });
    },

    /** A new contract is another token, so amounts read from the old one go with it. */
    saveToken: async (input: TokenInput): Promise<Result<Token, OnChainError>> => {
      const clean = refuseSecrets(input.symbol, input.contract);
      if (!clean.ok) return clean;
      return store.atomic(async ({ onchain }) => {
        const existing = input.id ? await onchain.getToken(input.id) : null;
        if (input.id && !existing) return notFound('Token');
        const chainId = existing?.chainId ?? input.chainId;
        const chain = await onchain.getChain(chainId);
        if (!chain) return notFound('Chain');
        const id = input.id ?? generateId();
        const token = validateToken({ ...input, id, chainId }, chain.family);
        if (!token.ok) return token;
        const { contract } = token.value;
        const taken = (await onchain.listTokens()).some(
          (other) => other.id !== id && other.chainId === chainId && other.contract === contract,
        );
        if (taken) return err(onChainError('invalid-token', 'This chain already has that contract.'));
        await onchain.saveToken(token.value);
        if (existing && existing.contract !== contract) await onchain.clearReads(id);
        return token;
      });
    },
  };
}
