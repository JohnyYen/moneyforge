import { acceptsChannel } from '../domain/message';
import type { MessageSource } from '../domain/source';
import type { IngestResult, IncomingMessage } from './ingest-message';

export type QueuedMessage = {
  readonly id: string;
  /** Already normalized by the receiver. */
  readonly sender: string;
  readonly body: string;
  readonly receivedAt: string;
};

/** `blocked` means Android will not ask again, so only app info can change the answer. */
export type PermissionOutcome = 'granted' | 'denied' | 'blocked';

export interface MessageCapturePort {
  /** True only in a build whose manifest declares `RECEIVE_SMS`. */
  readonly available: boolean;
  isEnabled(): Promise<boolean>;
  setEnabled(enabled: boolean): Promise<void>;
  setSenders(senders: readonly string[]): Promise<void>;
  readQueue(): Promise<QueuedMessage[]>;
  removeQueued(id: string): Promise<void>;
  takeSharedText(): Promise<string | null>;
  /** Returns a function that stops listening. */
  onSharedText(listener: () => void): () => void;
  hasPermission(): Promise<boolean>;
  requestPermission(): Promise<PermissionOutcome>;
  openAppInfo(): Promise<void>;
}

/** Stands in for the native module where it is not linked. */
export const absentMessageCapture: MessageCapturePort = {
  available: false,
  isEnabled: async () => false,
  setEnabled: async () => undefined,
  setSenders: async () => undefined,
  readQueue: async () => [],
  removeQueued: async () => undefined,
  takeSharedText: async () => null,
  onSharedText: () => () => undefined,
  hasPermission: async () => false,
  requestPermission: async () => 'denied',
  openAppInfo: async () => undefined,
};

export type CaptureStatus = {
  readonly available: boolean;
  readonly enabled: boolean;
  readonly permitted: boolean;
};

export type DrainResult = { readonly ingested: number; readonly failed: number };

const NOTHING_DRAINED: DrainResult = { ingested: 0, failed: 0 };

type CaptureRules = {
  listSources(): Promise<MessageSource[]>;
  ingestMessage(message: IncomingMessage): Promise<IngestResult>;
};

export function createMessageCapture({
  port,
  rules,
}: {
  readonly port: MessageCapturePort;
  readonly rules: CaptureRules;
}) {
  const { available } = port;
  let draining: Promise<DrainResult> | null = null;
  // Kept in memory only: shared text is not stored anywhere until the user submits it.
  let sharedText: string | null = null;

  async function syncSenders(): Promise<void> {
    if (!available) return;
    const sources = await rules.listSources();
    await port.setSenders(
      sources
        .filter((source) => source.enabled && acceptsChannel(source, 'sms'))
        .map(({ sender }) => sender),
    );
  }

  /** An entry leaves the queue only after ingest resolves, so a crash replays it into dedup. */
  async function drainQueue(): Promise<DrainResult> {
    const entries = await port.readQueue().catch(() => []);
    let ingested = 0;
    let failed = 0;
    for (const { id, sender, body, receivedAt } of entries) {
      try {
        await rules.ingestMessage({ channel: 'sms', sender, body, receivedAt });
        await port.removeQueued(id);
        ingested += 1;
      } catch {
        // It stays queued for the next drain, and must not hold up the entries after it.
        failed += 1;
      }
    }
    return { ingested, failed };
  }

  /** Overlapping callers share one run, because a second one would ingest the same entries. */
  function drain(): Promise<DrainResult> {
    if (!available) return Promise.resolve(NOTHING_DRAINED);
    draining ??= drainQueue().finally(() => {
      draining = null;
    });
    return draining;
  }

  return {
    available,
    syncSenders,
    drain,

    /** For app start and foreground. Never rejects: whatever failed runs again next time. */
    refresh: async (): Promise<void> => {
      await Promise.allSettled([syncSenders(), drain()]);
    },

    status: async (): Promise<CaptureStatus> => {
      if (!available) return { available, enabled: false, permitted: false };
      const [enabled, permitted] = await Promise.all([port.isEnabled(), port.hasPermission()]);
      return { available, enabled, permitted };
    },

    /** Senders go first, so capture never starts on a stale allowlist. */
    enable: async (): Promise<PermissionOutcome> => {
      if (!available) return 'denied';
      const outcome = await port.requestPermission();
      if (outcome !== 'granted') return outcome;
      await syncSenders();
      await port.setEnabled(true);
      return outcome;
    },

    /** What was accepted while capture was on still reaches the inbox. */
    disable: async (): Promise<void> => {
      if (!available) return;
      await port.setEnabled(false);
      await drain();
    },

    openAppInfo: () => port.openAppInfo(),
    onSharedText: (listener: () => void) => port.onSharedText(listener),

    /** Sharing works in both variants. True when there is text for the paste screen. */
    receiveShared: async (): Promise<boolean> => {
      const text = await port.takeSharedText().catch(() => null);
      if (!text?.trim()) return false;
      sharedText = text;
      return true;
    },

    peekShared: () => sharedText,
    clearShared: () => {
      sharedText = null;
    },
  };
}

export type MessageCapture = ReturnType<typeof createMessageCapture>;
