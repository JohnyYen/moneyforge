import { absentMessageCapture } from '../application/message-capture';
import {
  createNativeMessageCapture,
  parseQueue,
  type SmsPermissions,
} from './native-message-capture';

const permissions = (over: Partial<SmsPermissions> = {}): SmsPermissions => ({
  check: async () => true,
  request: async () => 'granted',
  openAppInfo: async () => undefined,
  ...over,
});

function fakeNative() {
  return {
    smsCaptureAvailable: true,
    isEnabled: jest.fn(async () => true),
    setEnabled: jest.fn(async () => undefined),
    setSenders: jest.fn(async () => undefined),
    readQueue: jest.fn(async () => '[]'),
    removeQueued: jest.fn(async () => undefined),
    takeSharedText: jest.fn(async (): Promise<string | null> => null),
    addListener: jest.fn(() => ({ remove: jest.fn() })),
  };
}

describe('parseQueue', () => {
  it('reads entries, turning the arrival time into a date', () => {
    const text = JSON.stringify([
      { id: 'a', sender: 'bankco', body: 'Paid', receivedAt: 1773140400000 },
    ]);

    expect(parseQueue(text)).toEqual([
      { id: 'a', sender: 'bankco', body: 'Paid', receivedAt: '2026-03-10T11:00:00.000Z' },
    ]);
  });

  it.each(['', 'not json', '{}', 'null'])('reads %j as an empty queue', (text) => {
    expect(parseQueue(text)).toEqual([]);
  });

  it('leaves out entries of the wrong shape', () => {
    const text = JSON.stringify([
      { id: 'a', sender: 'bankco', body: 'Paid', receivedAt: 'yesterday' },
      { id: 1, sender: 'bankco', body: 'Paid', receivedAt: 1 },
      { sender: 'bankco', body: 'Paid', receivedAt: 1 },
      null,
      { id: 'b', sender: 'bankco', body: 'Paid', receivedAt: 1773140400000 },
    ]);

    expect(parseQueue(text).map(({ id }) => id)).toEqual(['b']);
  });

  it('leaves out an arrival time no date can hold', () => {
    const text = JSON.stringify([{ id: 'a', sender: 'x', body: 'Paid', receivedAt: 1e300 }]);

    expect(parseQueue(text)).toEqual([]);
  });
});

describe('createNativeMessageCapture', () => {
  it('falls back to the absent port when the module is missing', () => {
    expect(createNativeMessageCapture(null, permissions())).toBe(absentMessageCapture);
  });

  it('reports availability from the native constant', () => {
    const native = { ...fakeNative(), smsCaptureAvailable: false };

    expect(createNativeMessageCapture(native, permissions()).available).toBe(false);
  });

  it('reads the queue from native text', async () => {
    const native = fakeNative();
    native.readQueue.mockResolvedValue(
      JSON.stringify([{ id: 'a', sender: 'x', body: 'Paid', receivedAt: 0 }]),
    );

    await expect(createNativeMessageCapture(native, permissions()).readQueue()).resolves.toEqual([
      { id: 'a', sender: 'x', body: 'Paid', receivedAt: '1970-01-01T00:00:00.000Z' },
    ]);
  });

  it('stops listening when the subscription ends', () => {
    const native = fakeNative();
    const remove = jest.fn();
    native.addListener.mockReturnValue({ remove });

    const stop = createNativeMessageCapture(native, permissions()).onSharedText(() => undefined);
    stop();

    expect(native.addListener).toHaveBeenCalledWith('onSharedText', expect.any(Function));
    expect(remove).toHaveBeenCalledTimes(1);
  });
});

describe('absentMessageCapture', () => {
  it('answers everything without a native module', async () => {
    expect(absentMessageCapture.available).toBe(false);
    await expect(absentMessageCapture.takeSharedText()).resolves.toBeNull();
    await expect(absentMessageCapture.readQueue()).resolves.toEqual([]);
    await expect(absentMessageCapture.hasPermission()).resolves.toBe(false);
    expect(() => absentMessageCapture.onSharedText(() => undefined)()).not.toThrow();
  });
});
