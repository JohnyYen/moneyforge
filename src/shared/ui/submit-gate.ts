import type { Result } from '@/shared/result';

import { messageOf } from './use-focus-query';

export type SubmitGate = {
  /** Claims the gate synchronously; false means this submission must not run. */
  tryEnter(): boolean;
  leave(succeeded: boolean): void;
  /** True once a success has spent a gate that exits on success. */
  isClosed(): boolean;
};

export function createSubmitGate(exitsOnSuccess: boolean): SubmitGate {
  let state: 'open' | 'running' | 'closed' = 'open';
  return {
    tryEnter() {
      if (state !== 'open') return false;
      state = 'running';
      return true;
    },
    leave(succeeded) {
      state = succeeded && exitsOnSuccess ? 'closed' : 'open';
    },
    isClosed: () => state === 'closed',
  };
}

/** Not a retry prompt: the change is stored, and sending it again would duplicate it. */
export const SAVED_BUT_STUCK = 'Saved, but this screen could not update. Go back to continue.';

/**
 * Settles one claimed submission and always leaves the gate. A failure after the action
 * succeeded still counts as a success, so the gate of a screen that exits stays closed
 * and the user is told why, instead of being offered a second write.
 */
export async function runSubmission<Value>(
  gate: SubmitGate,
  {
    action,
    onSuccess,
    onError,
  }: {
    action: () => Promise<Result<Value, { readonly message: string }>>;
    onSuccess: (value: Value) => void | Promise<void>;
    onError: (message: string) => void;
  },
): Promise<void> {
  let succeeded = false;
  try {
    const result = await action();
    if (result.ok) {
      succeeded = true;
      await onSuccess(result.value);
    } else {
      onError(result.error.message);
    }
  } catch (cause) {
    onError(succeeded ? SAVED_BUT_STUCK : messageOf(cause));
  } finally {
    gate.leave(succeeded);
  }
}
