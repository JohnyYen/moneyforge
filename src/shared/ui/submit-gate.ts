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
