import { useCallback, useState } from 'react';

import {
  Button,
  ErrorBanner,
  ListRow,
  QueryBoundary,
  Screen,
  TextField,
} from '@/shared/ui/primitives';
import { useFocusQuery } from '@/shared/ui/use-focus-query';
import { useSubmit } from '@/shared/ui/use-submit';

import type { AssetType } from '../domain/asset';
import { useAssets } from './assets-context';

export function AssetTypesScreen() {
  const assets = useAssets();
  const load = useCallback(() => assets.listTypes(), [assets]);
  const { state, reload } = useFocusQuery(load);
  const [editing, setEditing] = useState<AssetType | null>(null);
  const [name, setName] = useState('');
  const clear = () => {
    setEditing(null);
    setName('');
    reload();
  };
  const save = useSubmit(() => assets.saveType({ id: editing?.id ?? null, name }), clear);
  const archive = useSubmit(
    ({ id, archived }: AssetType) => assets.setTypeArchived(id, !archived),
    clear,
  );

  return (
    <QueryBoundary state={state} onRetry={reload}>
      {(types) => (
        <Screen>
          {types.map((type) => (
            <ListRow
              key={type.id}
              title={type.name}
              subtitle={type.archived ? 'Archived' : undefined}
              onPress={() => {
                setEditing(type);
                setName(type.name);
              }}
            />
          ))}
          <TextField label={editing ? 'Rename type' : 'New type'} value={name} onChangeText={setName} />
          <ErrorBanner message={save.error ?? archive.error} />
          <Button label="Save" disabled={save.submitting} onPress={() => void save.submit(undefined)} />
          {editing ? (
            <Button
              label={editing.archived ? 'Restore' : 'Archive'}
              variant="secondary"
              disabled={archive.submitting}
              onPress={() => void archive.submit(editing)}
            />
          ) : null}
        </Screen>
      )}
    </QueryBoundary>
  );
}
