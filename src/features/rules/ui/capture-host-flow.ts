type CaptureWork = {
  refresh(): Promise<void>;
  receiveShared(): Promise<boolean>;
};

/**
 * What the capture host does and when. Draining never waits for navigation, and a share is taken
 * as soon as it arrives. Only opening the paste screen waits for a navigator to open it from.
 */
export function createCaptureHostFlow(capture: CaptureWork, openShared: () => void) {
  let navigatorReady = false;
  let shareWaiting = false;

  function openWaitingShare() {
    if (!navigatorReady || !shareWaiting) return;
    shareWaiting = false;
    openShared();
  }

  function receiveShared() {
    void capture.receiveShared().then((received) => {
      if (!received) return;
      shareWaiting = true;
      openWaitingShare();
    });
  }

  return {
    onForeground() {
      void capture.refresh();
      receiveShared();
    },
    onSharedText: receiveShared,
    setNavigatorReady(ready: boolean) {
      navigatorReady = ready;
      openWaitingShare();
    },
  };
}
