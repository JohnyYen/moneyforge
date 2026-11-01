import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';

import { toLocalDay } from '@/features/ledger/application/overview-use-cases';
import type { Category } from '@/features/ledger/domain/category';
import { useLedger } from '@/features/ledger/ui/ledger-context';
import { ScheduleFields } from '@/features/planning/ui/schedule-fields';
import { leaveScreen } from '@/shared/ui/leave-screen';
import {
  AmountField,
  Button,
  ChoiceChips,
  EmptyState,
  ErrorBanner,
  QueryBoundary,
  Screen,
  TextField,
} from '@/shared/ui/primitives';
import { useFocusQuery } from '@/shared/ui/use-focus-query';
import { useSubmit } from '@/shared/ui/use-submit';

import type { StreamKind } from '../domain/asset';
import {
  emptyStreamDraft,
  toStreamDraft,
  toStreamInput,
  type StreamDraft,
} from './asset-model';
import { useAssets } from './assets-context';

const NO_CATEGORY = 'none';

const KIND_OPTIONS: readonly { value: StreamKind; label: string }[] = [
  { value: 'income', label: 'Income' },
  { value: 'expense', label: 'Expense' },
];

function StreamForm({
  initial,
  categories,
  error,
  submitting,
  onSubmit,
  onRemove,
}: {
  initial: StreamDraft;
  categories: readonly Category[];
  error: string | null;
  submitting: boolean;
  onSubmit: (draft: StreamDraft) => void;
  onRemove?: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const update = (change: Partial<StreamDraft>) =>
    setDraft((current) => ({ ...current, ...change }));
  const categoryOptions = [
    { value: NO_CATEGORY, label: 'None' },
    ...categories
      .filter(({ kind }) => kind === draft.kind)
      .map(({ id, name }) => ({ value: id, label: name })),
  ];

  return (
    <Screen>
      <TextField label="Name" value={draft.name} onChangeText={(name) => update({ name })} />
      <ChoiceChips
        label="Type"
        options={KIND_OPTIONS}
        value={draft.kind}
        onChange={(kind) => update({ kind, categoryId: '' })}
      />
      <AmountField
        label="Amount"
        value={draft.amount}
        onChangeText={(amount) => update({ amount })}
      />
      <ChoiceChips
        label="Category (optional)"
        options={categoryOptions}
        value={draft.categoryId || NO_CATEGORY}
        onChange={(value) => update({ categoryId: value === NO_CATEGORY ? '' : value })}
      />
      <ScheduleFields draft={draft} onChange={update} />
      <ErrorBanner message={error} />
      <Button label="Save" disabled={submitting} onPress={() => onSubmit(draft)} />
      {onRemove ? (
        <Button label="Remove" variant="secondary" disabled={submitting} onPress={onRemove} />
      ) : null}
    </Screen>
  );
}

export function StreamEditorScreen() {
  const { id = '', streamId } = useLocalSearchParams<{ id: string; streamId?: string }>();
  const assets = useAssets();
  const ledger = useLedger();
  const router = useRouter();
  const load = useCallback(async () => {
    const [asset, currencies, stream, categories] = await Promise.all([
      assets.getAsset(id),
      ledger.listCurrencies(),
      streamId ? assets.getStream(streamId) : null,
      ledger.listCategories(),
    ]);
    return {
      stream,
      currency: currencies.find(({ code }) => code === asset?.currencyCode),
      categories: categories.filter(
        (category) => !category.archived || category.id === stream?.categoryId,
      ),
    };
  }, [assets, id, ledger, streamId]);
  const { state, reload } = useFocusQuery(load);
  const exit = () => leaveScreen(router);
  const save = useSubmit(
    (draft: StreamDraft) =>
      streamId
        ? assets.updateStream(streamId, toStreamInput(draft))
        : assets.createStream(id, toStreamInput(draft)),
    exit,
    { exitsOnSuccess: true },
  );
  const remove = useSubmit(() => assets.removeStream(streamId ?? ''), exit, {
    exitsOnSuccess: true,
  });

  return (
    <QueryBoundary state={state} onRetry={reload}>
      {({ stream, currency, categories }) => {
        if (!currency || (streamId && !stream)) {
          return (
            <Screen>
              <EmptyState title="Not found" />
            </Screen>
          );
        }
        return (
          <StreamForm
            initial={
              stream ? toStreamDraft(stream, currency) : emptyStreamDraft(toLocalDay(new Date()))
            }
            categories={categories}
            error={save.error ?? remove.error}
            submitting={save.submitting || remove.submitting}
            onSubmit={(draft) => void save.submit(draft)}
            onRemove={streamId ? () => void remove.submit(undefined) : undefined}
          />
        );
      }}
    </QueryBoundary>
  );
}
