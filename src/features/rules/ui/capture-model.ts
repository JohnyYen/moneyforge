import type { CaptureStatus, PermissionOutcome } from '../application/message-capture';

export function captureSwitch({ enabled, permitted }: Pick<CaptureStatus, 'enabled' | 'permitted'>) {
  if (!enabled) return { label: 'Off', action: 'Turn on', warning: null };
  if (permitted) return { label: 'On', action: 'Turn off', warning: null };
  return {
    label: 'Paused',
    action: 'Turn on',
    warning: 'The SMS permission was removed, so no messages are being captured.',
  };
}

export function permissionNotice(outcome: PermissionOutcome): string | null {
  if (outcome === 'granted') return null;
  if (outcome === 'denied') return 'Permission denied, so capture stays off.';
  return 'Android will not ask again. Open App info to allow SMS for this app.';
}
