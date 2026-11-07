import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';

import type { Account } from '@/features/ledger/domain/account';
import { useLedger } from '@/features/ledger/ui/ledger-context';
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

import type { Chain, Token } from '../domain/onchain';
import { ScreenedField } from './screened-field';
import { useOnChain } from './onchain-context';
import {
  emptyWatchedDraft,
  toWatchedDraft,
  toWatchedInput,
  type WatchedDraft,
} from './onchain-model';

const NONE = 'none';

function WatchedForm({
  initial,
  chains,
  tokens,
  accounts,
  error,
  submitting,
  onSubmit,
  onRemove,
}: {
  initial: WatchedDraft;
  chains: readonly Chain[];
  tokens: readonly Token[];
  accounts: readonly Account[];
  error: string | null;
  submitting: boolean;
  onSubmit: (draft: WatchedDraft) => void;
  onRemove?: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const update = (change: Partial<WatchedDraft>) =>
    setDraft((current) => ({ ...current, ...change }));
  const onChain = tokens.filter(({ chainId }) => chainId === draft.chainId);
  const token = tokens.find(({ id }) => id === draft.tokenId);
  const linkable = accounts.filter(
    (account) =>
      account.currencyCode === token?.symbol && (!account.archived || account.id === draft.accountId),
  );

  return (
    <Screen>
      <ChoiceChips
        label="Chain"
        options={chains.map(({ id, name }) => ({ value: id, label: name }))}
        value={draft.chainId}
        onChange={(chainId) => update({ chainId, tokenId: '', accountId: '' })}
      />
      <ChoiceChips
        label="Token"
        options={onChain.map(({ id, symbol }) => ({ value: id, label: symbol }))}
        value={draft.tokenId}
        onChange={(tokenId) => update({ tokenId, accountId: '' })}
      />
      <ScreenedField
        label="Public address"
        value={draft.address}
        onChangeText={(address) => update({ address })}
      />
      <ScreenedField
        label="Label"
        value={draft.label}
        onChangeText={(label) => update({ label })}
      />
      <ChoiceChips
        label="Account to compare with (optional)"
        options={[
          { value: NONE, label: 'None' },
          ...linkable.map(({ id, name }) => ({ value: id, label: name })),
        ]}
        value={draft.accountId || NONE}
        onChange={(value) => update({ accountId: value === NONE ? '' : value })}
      />
      <Muted>Only a public address is needed. Never enter a private key or a seed phrase.</Muted>
      <ErrorBanner message={error} />
      <Button label="Save" disabled={submitting} onPress={() => onSubmit(draft)} />
      {onRemove ? (
        <Button label="Stop watching" variant="secondary" disabled={submitting} onPress={onRemove} />
      ) : null}
    </Screen>
  );
}

export function WatchedEditorScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const onchain = useOnChain();
  const ledger = useLedger();
  const router = useRouter();
  const load = useCallback(async () => {
    const [chains, tokens, accounts, view] = await Promise.all([
      onchain.listChains(),
      onchain.listTokens(),
      ledger.listAccountsForDisplay(),
      id ? onchain.getWatched(id) : null,
    ]);
    return { chains, tokens, accounts, view };
  }, [id, ledger, onchain]);
  const { state, reload } = useFocusQuery(load);
  const save = useSubmit(
    (draft: WatchedDraft) => onchain.saveWatched(toWatchedInput(draft, id ?? null)),
    () => leaveScreen(router),
    { exitsOnSuccess: true },
  );
  // Past the detail screen too, which would only say the address is gone.
  const remove = useSubmit(
    () => onchain.removeWatched(id ?? ''),
    () => router.dismissTo('/onchain'),
    { exitsOnSuccess: true },
  );

  return (
    <QueryBoundary state={state} onRetry={reload}>
      {({ chains, tokens, accounts, view }) => (
        <WatchedForm
          initial={view ? toWatchedDraft(view) : emptyWatchedDraft(chains)}
          chains={chains}
          tokens={tokens}
          accounts={accounts}
          error={save.error ?? remove.error}
          submitting={save.submitting || remove.submitting}
          onSubmit={(draft) => void save.submit(draft)}
          onRemove={id ? () => void remove.submit(undefined) : undefined}
        />
      )}
    </QueryBoundary>
  );
}
