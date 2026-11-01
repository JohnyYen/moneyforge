import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';

import { toLocalDay } from '@/features/ledger/application/overview-use-cases';
import type { Account } from '@/features/ledger/domain/account';
import type { Currency } from '@/features/ledger/domain/currency';
import { useLedger } from '@/features/ledger/ui/ledger-context';
import { leaveScreen } from '@/shared/ui/leave-screen';
import {
  Button,
  ChoiceChips,
  EmptyState,
  ErrorBanner,
  Muted,
  QueryBoundary,
  Screen,
  TextField,
} from '@/shared/ui/primitives';
import { useFocusQuery } from '@/shared/ui/use-focus-query';
import { useSubmit } from '@/shared/ui/use-submit';

import type { Asset, AssetType } from '../domain/asset';
import { emptyAssetDraft, toAssetDraft, toAssetInput, type AssetDraft } from './asset-model';
import { useAssets } from './assets-context';

const NO_ACCOUNT = 'none';

function AssetForm({
  initial,
  asset,
  types,
  accounts,
  currencies,
  error,
  submitting,
  onSubmit,
}: {
  initial: AssetDraft;
  asset: Asset | null;
  types: readonly AssetType[];
  accounts: readonly Account[];
  currencies: readonly Currency[];
  error: string | null;
  submitting: boolean;
  onSubmit: (draft: AssetDraft) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const update = (change: Partial<AssetDraft>) => setDraft((current) => ({ ...current, ...change }));
  const accountOptions = [
    { value: NO_ACCOUNT, label: 'None' },
    ...accounts
      .filter(({ currencyCode }) => currencyCode === draft.currencyCode)
      .map(({ id, name }) => ({ value: id, label: name })),
  ];

  return (
    <>
      <TextField label="Name" value={draft.name} onChangeText={(name) => update({ name })} />
      <ChoiceChips
        label="Type"
        options={types.map(({ id, name }) => ({ value: id, label: name }))}
        value={draft.typeId}
        onChange={(typeId) => update({ typeId })}
      />
      {asset ? (
        <Muted>Currency: {asset.currencyCode}. It stays fixed, because values are stored in it.</Muted>
      ) : (
        <ChoiceChips
          label="Currency"
          options={currencies.map(({ code }) => ({ value: code, label: code }))}
          value={draft.currencyCode}
          onChange={(currencyCode) => update({ currencyCode, accountId: '' })}
        />
      )}
      <ChoiceChips
        label="Linked account, in this currency (optional)"
        options={accountOptions}
        value={draft.accountId || NO_ACCOUNT}
        onChange={(value) => update({ accountId: value === NO_ACCOUNT ? '' : value })}
      />
      <TextField
        label="Notes (optional)"
        multiline
        value={draft.notes}
        onChangeText={(notes) => update({ notes })}
      />
      <ErrorBanner message={error} />
      <Button label="Save" disabled={submitting} onPress={() => onSubmit(draft)} />
    </>
  );
}

function SaleSection({ asset, onDone }: { asset: Asset; onDone: () => void }) {
  const assets = useAssets();
  const [soldOn, setSoldOn] = useState(toLocalDay(new Date()));
  const sell = useSubmit((day: string) => assets.sellAsset(asset.id, day), onDone, {
    exitsOnSuccess: true,
  });
  const reopen = useSubmit(() => assets.reopenAsset(asset.id), onDone, { exitsOnSuccess: true });

  if (asset.soldOn) {
    return (
      <>
        <ErrorBanner message={reopen.error} />
        <Button
          label="Reopen asset"
          variant="secondary"
          disabled={reopen.submitting}
          onPress={() => void reopen.submit(undefined)}
        />
      </>
    );
  }
  return (
    <>
      <TextField label="Sale date, YYYY-MM-DD" value={soldOn} onChangeText={setSoldOn} />
      <Muted>Expected flows stop from this date. Record the sale itself as a transaction.</Muted>
      <ErrorBanner message={sell.error} />
      <Button
        label="Mark as sold"
        variant="secondary"
        disabled={sell.submitting}
        onPress={() => void sell.submit(soldOn)}
      />
    </>
  );
}

export function AssetEditorScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const assets = useAssets();
  const ledger = useLedger();
  const router = useRouter();
  const load = useCallback(async () => {
    const [types, accounts, currencies, base, asset] = await Promise.all([
      assets.listTypes(),
      ledger.listAccounts(),
      ledger.listCurrencies(),
      ledger.getBaseCurrency(),
      id ? assets.getAsset(id) : null,
    ]);
    return {
      asset,
      base,
      currencies,
      types: types.filter((type) => !type.archived || type.id === asset?.typeId),
      accounts: accounts.filter((account) => !account.archived || account.id === asset?.accountId),
    };
  }, [assets, id, ledger]);
  const { state, reload } = useFocusQuery(load);
  const exit = () => leaveScreen(router);
  const save = useSubmit(
    (draft: AssetDraft) =>
      id ? assets.updateAsset(id, toAssetInput(draft)) : assets.createAsset(toAssetInput(draft)),
    exit,
    { exitsOnSuccess: true },
  );

  return (
    <QueryBoundary state={state} onRetry={reload}>
      {({ asset, base, currencies, types, accounts }) => {
        if ((id && !asset) || types.length === 0) {
          return (
            <Screen>
              <EmptyState title={id ? 'Asset not found' : 'Add an asset type first'} />
            </Screen>
          );
        }
        return (
          <Screen>
            <AssetForm
              initial={
                asset
                  ? toAssetDraft(asset)
                  : emptyAssetDraft(types[0].id, base?.code ?? currencies[0]?.code ?? '')
              }
              asset={asset}
              types={types}
              accounts={accounts}
              currencies={currencies}
              error={save.error}
              submitting={save.submitting}
              onSubmit={(draft) => void save.submit(draft)}
            />
            {asset ? <SaleSection asset={asset} onDone={exit} /> : null}
          </Screen>
        );
      }}
    </QueryBoundary>
  );
}
