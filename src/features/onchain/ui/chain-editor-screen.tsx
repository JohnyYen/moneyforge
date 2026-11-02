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

import type { ChainFamily } from '../domain/onchain';
import { ScreenedField } from './screened-field';
import { useOnChain } from './onchain-context';
import { emptyChainDraft, toChainDraft, toChainInput, type ChainDraft } from './onchain-model';

const FAMILY_OPTIONS: readonly { value: ChainFamily; label: string }[] = [
  { value: 'evm', label: 'EVM' },
  { value: 'tron', label: 'Tron' },
];

function ChainForm({
  initial,
  isNew,
  error,
  submitting,
  onSubmit,
}: {
  initial: ChainDraft;
  isNew: boolean;
  error: string | null;
  submitting: boolean;
  onSubmit: (draft: ChainDraft) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const update = (change: Partial<ChainDraft>) =>
    setDraft((current) => ({ ...current, ...change }));

  return (
    <Screen>
      <ScreenedField label="Name" value={draft.name} onChangeText={(name) => update({ name })} />
      {isNew ? (
        <ChoiceChips
          label="Family"
          options={FAMILY_OPTIONS}
          value={draft.family}
          onChange={(family) => update({ family })}
        />
      ) : null}
      <ScreenedField
        label="Endpoint, https://"
        value={draft.endpoint}
        onChangeText={(endpoint) => update({ endpoint })}
      />
      <Muted>An API key in this address stays on this device, and leaves it only in reads.</Muted>
      {draft.family === 'evm' ? (
        <ScreenedField
          label="Chain ID"
          value={draft.evmChainId}
          onChangeText={(evmChainId) => update({ evmChainId })}
        />
      ) : null}
      <ErrorBanner message={error} />
      <Button label="Save" disabled={submitting} onPress={() => onSubmit(draft)} />
    </Screen>
  );
}

export function ChainEditorScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const onchain = useOnChain();
  const router = useRouter();
  const load = useCallback(async () => (id ? onchain.getChain(id) : null), [id, onchain]);
  const { state, reload } = useFocusQuery(load);
  const save = useSubmit(
    (draft: ChainDraft) => onchain.saveChain(toChainInput(draft, id ?? null)),
    () => leaveScreen(router),
    { exitsOnSuccess: true },
  );

  return (
    <QueryBoundary state={state} onRetry={reload}>
      {(chain) => (
        <ChainForm
          initial={chain ? toChainDraft(chain) : emptyChainDraft}
          isNew={!chain}
          error={save.error}
          submitting={save.submitting}
          onSubmit={(draft) => void save.submit(draft)}
        />
      )}
    </QueryBoundary>
  );
}
