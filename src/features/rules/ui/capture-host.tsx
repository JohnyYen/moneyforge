import { router, useRootNavigationState } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { AppState } from 'react-native';

import { useCapture } from './capture-context';
import { createCaptureHostFlow } from './capture-host-flow';

/** Runs capture work at app start and on foreground. */
export function CaptureHost() {
  const capture = useCapture();
  const navigatorReady = Boolean(useRootNavigationState()?.key);
  const flow = useMemo(
    () => createCaptureHostFlow(capture, () => router.push('/inbox/paste')),
    [capture],
  );

  useEffect(() => {
    flow.onForeground();
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') flow.onForeground();
    });
    const stopSharing = capture.onSharedText(flow.onSharedText);
    return () => {
      appState.remove();
      stopSharing();
    };
  }, [capture, flow]);

  useEffect(() => {
    flow.setNavigatorReady(navigatorReady);
  }, [flow, navigatorReady]);

  return null;
}
