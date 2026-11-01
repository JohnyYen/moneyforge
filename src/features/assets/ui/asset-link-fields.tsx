import { useCallback } from 'react';

import { ChoiceChips } from '@/shared/ui/primitives';
import { useFocusQuery } from '@/shared/ui/use-focus-query';

import { NO_SELECTION, type AssetSelection } from './asset-model';
import { useAssets } from './assets-context';

const NONE = 'none';

/** Picks an asset and, when it has any, the stream this money fulfils. */
export function AssetLinkFields({
  value,
  onChange,
}: {
  value: AssetSelection;
  onChange: (selection: AssetSelection) => void;
}) {
  const assets = useAssets();
  const load = useCallback(async () => {
    const active = (await assets.listAssets()).filter(({ status }) => status === 'active');
    const streams = await Promise.all(active.map(({ id }) => assets.listStreams(id)));
    return { active, streams: streams.flat() };
  }, [assets]);
  const { state } = useFocusQuery(load);

  if (state.status !== 'ready' || state.data.active.length === 0) return null;
  const { active, streams } = state.data;
  const ofAsset = streams.filter(({ assetId }) => assetId === value.assetId);
  return (
    <>
      <ChoiceChips
        label="Asset (optional)"
        options={[
          { value: NONE, label: 'None' },
          ...active.map(({ id, name }) => ({ value: id, label: name })),
        ]}
        value={value.assetId ?? NONE}
        onChange={(id) => onChange(id === NONE ? NO_SELECTION : { assetId: id, stream: null })}
      />
      {ofAsset.length > 0 ? (
        <ChoiceChips
          label="Expected flow (optional)"
          options={[
            { value: NONE, label: 'None' },
            ...ofAsset.map(({ id, name }) => ({ value: id, label: name })),
          ]}
          value={value.stream?.id ?? NONE}
          onChange={(id) =>
            onChange({ ...value, stream: ofAsset.find((stream) => stream.id === id) ?? null })
          }
        />
      ) : null}
    </>
  );
}
