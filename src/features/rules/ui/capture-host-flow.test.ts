import { createCaptureHostFlow } from './capture-host-flow';

function fakeCapture(shared: boolean[] = []) {
  return {
    refresh: jest.fn(async () => undefined),
    receiveShared: jest.fn(async () => shared.shift() ?? false),
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('createCaptureHostFlow', () => {
  it('drains on foreground before the navigator is ready', async () => {
    const capture = fakeCapture();
    const flow = createCaptureHostFlow(capture, jest.fn());

    flow.onForeground();
    await settle();

    expect(capture.refresh).toHaveBeenCalledTimes(1);
  });

  it('drains and receives even if the navigator never becomes ready', async () => {
    const capture = fakeCapture([true]);
    const openShared = jest.fn();
    const flow = createCaptureHostFlow(capture, openShared);

    flow.onForeground();
    flow.onForeground();
    await settle();

    expect(capture.refresh).toHaveBeenCalledTimes(2);
    expect(capture.receiveShared).toHaveBeenCalledTimes(2);
    expect(openShared).not.toHaveBeenCalled();
  });

  it('opens a share received early once the navigator is ready', async () => {
    const capture = fakeCapture([true]);
    const openShared = jest.fn();
    const flow = createCaptureHostFlow(capture, openShared);

    flow.onForeground();
    await settle();
    flow.setNavigatorReady(true);

    expect(openShared).toHaveBeenCalledTimes(1);
  });

  it('opens a share right away when the navigator is ready', async () => {
    const capture = fakeCapture([true]);
    const openShared = jest.fn();
    const flow = createCaptureHostFlow(capture, openShared);

    flow.setNavigatorReady(true);
    flow.onSharedText();
    await settle();

    expect(openShared).toHaveBeenCalledTimes(1);
  });

  it('opens one share once, however often readiness is reported', async () => {
    const capture = fakeCapture([true]);
    const openShared = jest.fn();
    const flow = createCaptureHostFlow(capture, openShared);

    flow.onSharedText();
    await settle();
    flow.setNavigatorReady(true);
    flow.setNavigatorReady(false);
    flow.setNavigatorReady(true);

    expect(openShared).toHaveBeenCalledTimes(1);
  });

  it('opens nothing without a share', async () => {
    const capture = fakeCapture([false]);
    const openShared = jest.fn();
    const flow = createCaptureHostFlow(capture, openShared);

    flow.setNavigatorReady(true);
    flow.onForeground();
    await settle();

    expect(openShared).not.toHaveBeenCalled();
  });

  it('does not ask for a share when text arrives outside a foreground, only receives it', async () => {
    const capture = fakeCapture([true]);
    const flow = createCaptureHostFlow(capture, jest.fn());

    flow.onSharedText();
    await settle();

    expect(capture.refresh).not.toHaveBeenCalled();
    expect(capture.receiveShared).toHaveBeenCalledTimes(1);
  });
});
