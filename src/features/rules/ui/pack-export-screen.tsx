import { useCallback, useState } from 'react';

import { shareText } from '@/shared/ui/share-text';
import {
  Button,
  EmptyState,
  ErrorBanner,
  ListRow,
  Muted,
  Notice,
  QueryBoundary,
  Screen,
  TextField,
} from '@/shared/ui/primitives';
import { useFocusQuery } from '@/shared/ui/use-focus-query';
import { useSubmit } from '@/shared/ui/use-submit';

import { useRules } from './rules-context';

export function PackExportScreen() {
  const rules = useRules();
  const load = useCallback(() => rules.listSources(), [rules]);
  const { state, reload } = useFocusQuery(load);
  const [name, setName] = useState('');
  const [chosen, setChosen] = useState<readonly string[]>([]);
  const share = useSubmit(
    async () => {
      const pack = await rules.exportRulePack({ name, sourceIds: chosen });
      return pack.ok ? shareText(name, pack.value) : pack;
    },
    () => undefined,
  );

  const toggle = (id: string) =>
    setChosen(chosen.includes(id) ? chosen.filter((other) => other !== id) : [...chosen, id]);

  return (
    <QueryBoundary state={state} onRetry={reload}>
      {(sources) => (
        <Screen>
          <Notice>
            A pack holds senders, source and rule names, and templates. It leaves out samples, inbox
            items, and your accounts and categories. Read all of them first: a name or fixed text in
            a template stays in the pack as you wrote it, so replace personal names and numbers.
          </Notice>
          {sources.length === 0 ? <EmptyState title="No sources to export" /> : null}
          <TextField label="Pack name" value={name} onChangeText={setName} />
          <Muted>Choose the sources to include.</Muted>
          {sources.map(({ id, name: title, sender }) => (
            <ListRow
              key={id}
              title={title}
              subtitle={sender}
              trailing={chosen.includes(id) ? 'Included' : undefined}
              onPress={() => toggle(id)}
            />
          ))}
          <ErrorBanner message={share.error} />
          <Button
            label="Share pack"
            disabled={share.submitting || chosen.length === 0 || !name.trim()}
            onPress={() => void share.submit(undefined)}
          />
        </Screen>
      )}
    </QueryBoundary>
  );
}
