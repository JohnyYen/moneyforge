import { Redirect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { ok } from '@/shared/result';
import {
  Button,
  ErrorBanner,
  ListRow,
  Muted,
  Notice,
  QueryBoundary,
  Screen,
  SectionLabel,
} from '@/shared/ui/primitives';
import { useFocusQuery } from '@/shared/ui/use-focus-query';
import { useSubmit } from '@/shared/ui/use-submit';

import type { PermissionOutcome } from '../application/message-capture';
import { useCapture } from './capture-context';
import { captureSwitch, permissionNotice } from './capture-model';

export function CaptureSettingsScreen() {
  const capture = useCapture();
  const load = useCallback(() => capture.status(), [capture]);
  const { state, reload } = useFocusQuery(load);
  const [notice, setNotice] = useState<string | null>(null);
  const change = useSubmit(
    async (turnOn: boolean) => {
      if (turnOn) return ok<PermissionOutcome>(await capture.enable());
      await capture.disable();
      return ok<PermissionOutcome>('granted');
    },
    (outcome) => {
      setNotice(permissionNotice(outcome));
      reload();
    },
  );

  // The answer may change in App info, which returns here with no navigation event.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') reload();
    });
    return () => subscription.remove();
  }, [reload]);

  if (!capture.available) return <Redirect href="/rules" />;

  return (
    <QueryBoundary state={state} onRetry={reload}>
      {(status) => {
        const view = captureSwitch(status);
        const turnOn = !status.enabled || !status.permitted;
        return (
          <Screen>
            <ListRow title="Automatic SMS capture" trailing={view.label} />
            {view.warning ? <Notice>{view.warning}</Notice> : null}
            {notice ? <Notice>{notice}</Notice> : null}
            <ErrorBanner message={change.error} />
            <Button
              label={view.action}
              disabled={change.submitting}
              onPress={() => void change.submit(turnOn)}
            />

            <SectionLabel>What is read</SectionLabel>
            <Muted>
              Android shows this app each SMS as it arrives. Only messages from your enabled SMS
              sources are kept. Every other message is ignored at once and never saved. Old
              messages in your inbox are never read.
            </Muted>
            <SectionLabel>Where it goes</SectionLabel>
            <Muted>
              Nothing leaves this device. MoneyForge has no server. Accepted messages wait in a
              private file until you next open the app, then go through your rules.
            </Muted>
            <Muted>
              A one-time code from one of your sources also waits in that file until you open the
              app, and is then deleted without being stored.
            </Muted>

            <SectionLabel>If Android blocks the permission</SectionLabel>
            <Muted>
              Android restricts SMS access for apps installed outside a store. If the permission
              is unavailable, open App info, tap the three-dot menu, choose Allow restricted
              settings, and come back to turn this on.
            </Muted>
            <Button
              label="Open App info"
              variant="secondary"
              onPress={() => void capture.openAppInfo()}
            />
          </Screen>
        );
      }}
    </QueryBoundary>
  );
}
