import { leaveScreen } from './leave-screen';

function fakeRouter(canGoBack: boolean) {
  return { canGoBack: () => canGoBack, back: jest.fn(), replace: jest.fn() };
}

describe('leaveScreen', () => {
  it('goes back when there is somewhere to go', () => {
    const router = fakeRouter(true);

    leaveScreen(router);

    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('goes home with no history, where going back would silently do nothing', () => {
    const router = fakeRouter(false);

    leaveScreen(router);

    expect(router.replace).toHaveBeenCalledWith('/');
    expect(router.back).not.toHaveBeenCalled();
  });
});
