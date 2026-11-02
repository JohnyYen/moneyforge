import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';

import { leaveScreen } from '@/shared/ui/leave-screen';
import {
  Button,
  ChoiceChips,
  ErrorBanner,
  Muted,
  QueryBoundary,
  Screen,
} from '@/shared/ui/primitives';
import { useFocusQuery } from '@/shared/ui/use-focus-query';
import { useSubmit } from '@/shared/ui/use-submit';

import type { Chain } from '../domain/onchain';
import { ScreenedField } from './screened-field';
import { useOnChain } from './onchain-context';
import { toTokenDraft, toTokenInput, type TokenDraft } from './onchain-model';

function TokenForm({
  initial,
  chains,
  isNew,
  error,
  submitting,
  onSubmit,
}: {
  initial: TokenDraft;
  chains: readonly Chain[];
  isNew: boolean;
  error: string | null;
  submitting: boolean;
  onSubmit: (draft: TokenDraft) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const update = (change: Partial<TokenDraft>) =>
    setDraft((current) => ({ ...current, ...change }));

  return (
    <Screen>
      {isNew ? (
        <ChoiceChips
          label="Chain"
          options={chains.map(({ id, name }) => ({ value: id, label: name }))}
          value={draft.chainId}
          onChange={(chainId) => update({ chainId })}
        />
      ) : null}
      <ScreenedField
        label="Symbol"
        value={draft.symbol}
        onChangeText={(symbol) => update({ symbol })}
      />
      <Muted>An account compares with this token when its currency code is this symbol.</Muted>
      <ScreenedField
        label="Contract address"
        value={draft.contract}
        onChangeText={(contract) => update({ contract })}
      />
      <ScreenedField
        label="Decimals"
        value={draft.decimals}
        onChangeText={(decimals) => update({ decimals })}
      />
      <Muted>Every read checks these decimals against the contract.</Muted>
      <ErrorBanner message={error} />
      <Button label="Save" disabled={submitting} onPress={() => onSubmit(draft)} />
    </Screen>
  );
}

export function TokenEditorScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const onchain = useOnChain();
  const router = useRouter();
  const load = useCallback(async () => {
    const [chains, token] = await Promise.all([
      onchain.listChains(),
      id ? onchain.getToken(id) : null,
    ]);
    return { chains, token };
  }, [id, onchain]);
  const { state, reload } = useFocusQuery(load);
  const save = useSubmit(
    (draft: TokenDraft) => onchain.saveToken(toTokenInput(draft, id ?? null)),
    () => leaveScreen(router),
    { exitsOnSuccess: true },
  );

  return (
    <QueryBoundary state={state} onRetry={reload}>
      {({ chains, token }) => (
        <TokenForm
          initial={
            token
              ? toTokenDraft(token)
              : { chainId: chains[0]?.id ?? '', symbol: '', contract: '', decimals: '' }
          }
          chains={chains}
          isNew={!token}
          error={save.error}
          submitting={save.submitting}
          onSubmit={(draft) => void save.submit(draft)}
        />
      )}
    </QueryBoundary>
  );
}
