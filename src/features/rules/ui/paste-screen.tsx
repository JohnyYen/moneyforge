import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { ok } from '@/shared/result';
import {
  Button,
  ChoiceChips,
  EmptyState,
  ErrorBanner,
  Muted,
  Notice,
  QueryBoundary,
  Screen,
  TextField,
} from '@/shared/ui/primitives';
import { useFocusQuery } from '@/shared/ui/use-focus-query';
import { useSubmit } from '@/shared/ui/use-submit';

import type { MessageSource } from '../domain/source';
import { useCapture } from './capture-context';
import { useRules } from './rules-context';
import { ingestResultLabel } from './rules-model';

function PasteForm({
  sources,
  sharedText,
  notice,
  error,
  submitting,
  onSubmit,
  sharedAction,
}: {
  sources: readonly MessageSource[];
  sharedText: string | null;
  notice: string | null;
  error: string | null;
  submitting: boolean;
  onSubmit: (source: MessageSource, body: string) => void;
  sharedAction: ReactNode;
}) {
  const [sourceId, setSourceId] = useState(sources.length === 1 ? sources[0].id : null);
  const [body, setBody] = useState(sharedText ?? '');
  const source = sources.find(({ id }) => id === sourceId);

  return (
    <Screen>
      <Muted>
        {sharedText
          ? 'Choose the source of this shared message. Nothing is saved until you add it.'
          : 'Paste a message from your bank. It runs through the same rules as an SMS.'}
      </Muted>
      <ChoiceChips
        label="Source"
        options={sources.map(({ id, name }) => ({ value: id, label: name }))}
        value={sourceId}
        onChange={setSourceId}
      />
      <TextField label="Message" multiline value={body} onChangeText={setBody} />
      {notice ? <Notice>{notice}</Notice> : null}
      <ErrorBanner message={error} />
      <Button
        label="Add message"
        disabled={submitting || !source || !body.trim()}
        onPress={() => source && onSubmit(source, body)}
      />
      {sharedAction}
    </Screen>
  );
}

/** `renderSharedAction` lets another feature offer what shared text could be instead. */
export function PasteScreen({
  renderSharedAction,
}: {
  renderSharedAction?: (text: string) => ReactNode;
}) {
  const rules = useRules();
  const capture = useCapture();
  const router = useRouter();
  // Read once, and only this screen's state keeps it after the effect below.
  const [sharedText] = useState(() => capture.peekShared());
  useEffect(() => capture.clearShared(), [capture]);
  const load = useCallback(() => rules.listSources(), [rules]);
  const { state, reload } = useFocusQuery(load);
  const [notice, setNotice] = useState<string | null>(null);
  const sharedAction = sharedText ? renderSharedAction?.(sharedText) : null;
  const add = useSubmit(
    async ({ source, body }: { source: MessageSource; body: string }) =>
      ok(
        await rules.ingestMessage({
          channel: 'paste',
          sender: source.sender,
          body,
          receivedAt: new Date().toISOString(),
        }),
      ),
    (result) => {
      setNotice(ingestResultLabel(result));
      if (result.outcome === 'inbox' || result.outcome === 'posted') {
        router.replace({ pathname: '/inbox/[id]', params: { id: result.itemId } });
      }
    },
  );

  return (
    <QueryBoundary state={state} onRetry={reload}>
      {(sources) => {
        const enabled = sources.filter((source) => source.enabled);
        if (enabled.length === 0) {
          return (
            <Screen>
              <EmptyState
                title="No sources yet"
                hint={
                  sharedText
                    ? 'Add a source, then share this message again.'
                    : 'Add a source before pasting a message.'
                }
              />
              {sharedAction}
            </Screen>
          );
        }
        return (
          <PasteForm
            sources={enabled}
            sharedText={sharedText}
            notice={notice}
            error={add.error}
            submitting={add.submitting}
            onSubmit={(source, body) => void add.submit({ source, body })}
            sharedAction={sharedAction}
          />
        );
      }}
    </QueryBoundary>
  );
}
