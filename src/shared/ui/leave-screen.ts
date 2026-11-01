type ScreenRouter = {
  canGoBack(): boolean;
  back(): void;
  replace(href: '/'): void;
};

/** `back` with no history is a silent no-op, which would strand a form that just saved. */
export function leaveScreen(router: ScreenRouter) {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}
