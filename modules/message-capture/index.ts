import { requireOptionalNativeModule } from 'expo';

export interface MessageCaptureNative {
  /** True only when the manifest of this build declares `RECEIVE_SMS`. */
  readonly smsCaptureAvailable: boolean;
  isEnabled(): Promise<boolean>;
  setEnabled(enabled: boolean): Promise<void>;
  setSenders(senders: readonly string[]): Promise<void>;
  /** The queue file as JSON text. */
  readQueue(): Promise<string>;
  removeQueued(id: string): Promise<void>;
  takeSharedText(): Promise<string | null>;
  addListener(event: 'onSharedText', listener: () => void): { remove(): void };
}

/** Null where the module is not linked, such as Jest or a bundle on an older binary. */
export const MessageCapture = requireOptionalNativeModule<MessageCaptureNative>('MessageCapture');
