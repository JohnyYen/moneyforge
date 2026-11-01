import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';

import type { Transaction } from '@/features/ledger/domain/journal';
import { formatDisplay } from '@/features/ledger/domain/money';
import { useLedger } from '@/features/ledger/ui/ledger-context';
import { missingRatesLabel } from '@/features/planning/ui/plan-model';
import { MainScreen } from '@/features/rules/ui/main-screen';
import { NewTransactionScreen, TransactionScreen } from '@/features/split/ui/ledger-screens';
import {
  Button,
  ChoiceChips,
  ErrorBanner,
  ListRow,
  Muted,
  Notice,
  QueryBoundary,
  SectionLabel,
  Title,
} from '@/shared/ui/primitives';
import { unwrapOrThrow } from '@/shared/ui/unwrap';
import { useFocusQuery } from '@/shared/ui/use-focus-query';
import { useSubmit } from '@/shared/ui/use-submit';

import type { LinkInput } from '../application/link-use-cases';
import { AssetLinkFields } from './asset-link-fields';
import { linkInputFor, NO_SELECTION, type AssetSelection } from './asset-model';
import { useAssets } from './assets-context';

const YES_NO = [
  { value: 'no', label: 'No' },
  { value: 'yes', label: 'Yes' },
] as const;

function NetWorthWithAssets() {
  const assets = useAssets();
  const ledger = useLedger();
  const [include, setInclude] = useState(false);
  const load = useCallback(async () => {
    const [list, worth, base] = await Promise.all([
      assets.listAssets(),
      assets.netWorthWithAssets(),
      ledger.getBaseCurrency(),
    ]);
    return { hasAssets: list.some(({ status }) => status === 'active'), worth, base };
  }, [assets, ledger]);
  const { state } = useFocusQuery(load);

  if (state.status !== 'ready' || !state.data.hasAssets) return null;
  const { worth, base } = state.data;
  const missing = worth.ok ? missingRatesLabel(worth.value.missingRates) : null;
  return (
    <>
      <ChoiceChips
        label="Include assets"
        options={YES_NO}
        value={include ? 'yes' : 'no'}
        onChange={(value) => setInclude(value === 'yes')}
      />
      {include && worth.ok && base ? (
        <>
          <Muted>Net worth with assets</Muted>
          <Title>{formatDisplay(worth.value.total.minor, base)}</Title>
          {missing ? <Notice>{missing}</Notice> : null}
        </>
      ) : null}
    </>
  );
}

/** Ledger screens with assets plugged in, so neither the ledger nor split imports them. */
export function MainScreenWithAssets() {
  return <MainScreen summaryExtra={<NetWorthWithAssets />} />;
}

export function NewTransactionWithAsset() {
  const assets = useAssets();
  const [selection, setSelection] = useState(NO_SELECTION);

  const link = async (transaction: Transaction) => {
    const input = linkInputFor(transaction, selection);
    if (input) unwrapOrThrow(await assets.linkTransaction(input));
  };

  return (
    <NewTransactionScreen
      afterRecorded={link}
      extraFields={<AssetLinkFields value={selection} onChange={setSelection} />}
    />
  );
}

function TransactionAssetSection({ transaction }: { transaction: Transaction }) {
  const { id } = transaction;
  const assets = useAssets();
  const router = useRouter();
  const [selection, setSelection] = useState<AssetSelection>(NO_SELECTION);
  const load = useCallback(async () => {
    const link = await assets.getLink(id);
    return { link, asset: link ? await assets.getAsset(link.assetId) : null };
  }, [assets, id]);
  const { state, reload } = useFocusQuery(load);
  const input = linkInputFor(transaction, selection);
  const save = useSubmit((link: LinkInput) => assets.linkTransaction(link), reload);
  const unlink = useSubmit(() => assets.unlinkTransaction(id), reload);

  if (transaction.kind !== 'income' && transaction.kind !== 'expense') return null;
  return (
    <QueryBoundary state={state} onRetry={reload}>
      {({ link, asset }) => (
        <>
          <SectionLabel>Asset</SectionLabel>
          <ErrorBanner message={save.error ?? unlink.error} />
          {link && asset ? (
            <>
              <ListRow
                title={asset.name}
                subtitle={link.dueOn ? `Fulfils the date ${link.dueOn}` : undefined}
                onPress={() =>
                  router.push({ pathname: '/assets/[id]', params: { id: asset.id } })
                }
              />
              <Button
                label="Remove from asset"
                variant="secondary"
                disabled={unlink.submitting}
                onPress={() => void unlink.submit(undefined)}
              />
            </>
          ) : (
            <>
              <AssetLinkFields value={selection} onChange={setSelection} />
              {input ? (
                <Button
                  label="Link to asset"
                  variant="secondary"
                  disabled={save.submitting}
                  onPress={() => void save.submit(input)}
                />
              ) : null}
            </>
          )}
        </>
      )}
    </QueryBoundary>
  );
}

export function TransactionWithAsset() {
  return (
    <TransactionScreen
      renderExtra={(transaction) => <TransactionAssetSection transaction={transaction} />}
    />
  );
}
