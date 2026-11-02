import { useRouter } from 'expo-router';
import { useCallback } from 'react';

import { ok } from '@/shared/result';
import {
  Button,
  ErrorBanner,
  ListRow,
  Muted,
  Notice,
  QueryBoundary,
  Screen,
  SectionLabel,
} from '@/shared/ui/primitives';
import { useFocusQuery } from '@/shared/ui/use-focus-query';
import { useSubmit } from '@/shared/ui/use-submit';

import { hostOf } from '../domain/onchain';
import { useOnChain } from './onchain-context';
import { shortAddress } from './onchain-model';

export function NetworkSettingsScreen() {
  const onchain = useOnChain();
  const router = useRouter();
  const load = useCallback(async () => {
    const [enabled, chains, tokens] = await Promise.all([
      onchain.networkEnabled(),
      onchain.listChains(),
      onchain.listTokens(),
    ]);
    return { enabled, chains, tokens };
  }, [onchain]);
  const { state, reload } = useFocusQuery(load);
  const toggle = useSubmit(async (enabled: boolean) => {
    await onchain.setNetworkEnabled(enabled);
    return ok(undefined);
  }, reload);

  return (
    <QueryBoundary state={state} onRetry={reload}>
      {({ enabled, chains, tokens }) => (
        <Screen>
          <Notice>
            A refresh sends the address to the endpoint of its chain, and the endpoint sees your IP
            address, so it can tie the two together. Addresses are public by design, and their
            balances can be read by anyone. Nothing is contacted until you turn this on, and only
            when you press Refresh.
          </Notice>
          <ErrorBanner message={toggle.error} />
          <Button
            label={enabled ? 'Turn network reads off' : 'Turn network reads on'}
            variant={enabled ? 'secondary' : 'primary'}
            disabled={toggle.submitting}
            onPress={() => void toggle.submit(!enabled)}
          />
          <SectionLabel>Chains</SectionLabel>
          <Muted>Public endpoints may limit requests. Use your own if a refresh is refused.</Muted>
          {chains.map(({ id, name, endpoint }) => (
            <ListRow
              key={id}
              title={name}
              subtitle={hostOf(endpoint)}
              onPress={() => router.push({ pathname: '/onchain/chain', params: { id } })}
            />
          ))}
          <Button
            label="Add a chain"
            variant="secondary"
            onPress={() => router.push('/onchain/chain')}
          />
          <SectionLabel>Tokens</SectionLabel>
          {tokens.map(({ id, symbol, contract, chainId }) => (
            <ListRow
              key={id}
              title={symbol}
              subtitle={`${chains.find((chain) => chain.id === chainId)?.name ?? ''} ${shortAddress(contract)}`}
              onPress={() => router.push({ pathname: '/onchain/token', params: { id } })}
            />
          ))}
          <Button
            label="Add a token"
            variant="secondary"
            onPress={() => router.push('/onchain/token')}
          />
        </Screen>
      )}
    </QueryBoundary>
  );
}
