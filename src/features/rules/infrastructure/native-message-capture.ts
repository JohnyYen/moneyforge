import { Linking, PermissionsAndroid } from 'react-native';

import type { MessageCaptureNative } from '../../../../modules/message-capture';
import type {
  MessageCapturePort,
  PermissionOutcome,
  QueuedMessage,
} from '../application/message-capture';
import { absentMessageCapture } from '../application/message-capture';

export type SmsPermissions = {
  check(): Promise<boolean>;
  request(): Promise<PermissionOutcome>;
  openAppInfo(): Promise<void>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

function readJsonArray(text: string): unknown[] {
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function toEntry(value: unknown): QueuedMessage | null {
  if (!isRecord(value)) return null;
  const { id, sender, body, receivedAt } = value;
  if (typeof id !== 'string' || typeof sender !== 'string' || typeof body !== 'string') return null;
  if (typeof receivedAt !== 'number') return null;
  const date = new Date(receivedAt);
  if (Number.isNaN(date.getTime())) return null;
  return { id, sender, body, receivedAt: date.toISOString() };
}

export function parseQueue(text: string): QueuedMessage[] {
  return readJsonArray(text)
    .map(toEntry)
    .filter((entry) => entry !== null);
}

export const androidSmsPermissions: SmsPermissions = {
  check: () => PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS),
  request: async () => {
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS);
    if (result === PermissionsAndroid.RESULTS.GRANTED) return 'granted';
    return result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN ? 'blocked' : 'denied';
  },
  // On Android this opens the system App info page of this app.
  openAppInfo: () => Linking.openSettings(),
};

export function createNativeMessageCapture(
  native: MessageCaptureNative | null,
  permissions: SmsPermissions,
): MessageCapturePort {
  if (!native) return absentMessageCapture;
  return {
    available: native.smsCaptureAvailable,
    isEnabled: () => native.isEnabled(),
    setEnabled: (enabled) => native.setEnabled(enabled),
    setSenders: (senders) => native.setSenders(senders),
    readQueue: async () => parseQueue(await native.readQueue()),
    removeQueued: (id) => native.removeQueued(id),
    takeSharedText: () => native.takeSharedText(),
    onSharedText: (listener) => {
      const subscription = native.addListener('onSharedText', listener);
      return () => subscription.remove();
    },
    hasPermission: () => permissions.check(),
    requestPermission: () => permissions.request(),
    openAppInfo: () => permissions.openAppInfo(),
  };
}
