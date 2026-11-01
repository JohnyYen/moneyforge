import { useCallback } from 'react';

import { toLocalDay } from '@/features/ledger/application/overview-use-cases';
import { useLedger } from '@/features/ledger/ui/ledger-context';
import { usePlanning } from '@/features/planning/ui/planning-context';
import { Notice } from '@/shared/ui/primitives';
import { useFocusQuery } from '@/shared/ui/use-focus-query';

import { projectionNotices } from './asset-model';
import { useAssets } from './assets-context';

/** Streams the projection leaves out or may count twice, of one asset or of all of them. */
export function AssetProjectionNotices({ assetId }: { assetId?: string }) {
  const assets = useAssets();
  const ledger = useLedger();
  const planning = usePlanning();
  const load = useCallback(async () => {
    const [list, accounts, items] = await Promise.all([
      assets.listAssets(),
      ledger.listAccounts(),
      planning.listItems(),
    ]);
    const streams = await Promise.all(list.map(({ id }) => assets.listStreams(id)));
    const today = toLocalDay(new Date());
    return projectionNotices({ assets: list, streams: streams.flat(), accounts, items, today });
  }, [assets, ledger, planning]);
  const { state } = useFocusQuery(load);

  if (state.status !== 'ready') return null;
  const shown = state.data.filter((notice) => !assetId || notice.assetId === assetId);
  return shown.map(({ message }) => <Notice key={message}>{message}</Notice>);
}
