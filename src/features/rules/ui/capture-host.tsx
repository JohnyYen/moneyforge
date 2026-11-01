import { useRootNavigationState, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { useCapture } from './capture-context';

/** Runs capture work at app start and on foreground, once there is a navigator to open from. */
export function CaptureHost() {
  const capture = useCapture();
  const router = useRouter();
  const navigatorReady = Boolean(useRootNavigationState()?.key);

  useEffect(() => {
    if (!navigatorReady) return;

    const openShared = () =>
      void capture.receiveShared().then((received) => {
        if (received) router.push('/inbox/paste');
      });
    const refresh = () => {
      void capture.refresh();
      openShared();
    };

    refresh();
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    const stopSharing = capture.onSharedText(openShared);
    return () => {
      appState.remove();
      stopSharing();
    };
  }, [capture, navigatorReady, router]);

  return null;
}
