import { captureSwitch, permissionNotice } from './capture-model';

describe('captureSwitch', () => {
  it('offers to turn on when off', () => {
    expect(captureSwitch({ enabled: false, permitted: false })).toEqual({
      label: 'Off',
      action: 'Turn on',
      warning: null,
    });
  });

  it('offers to turn off when on', () => {
    expect(captureSwitch({ enabled: true, permitted: true })).toEqual({
      label: 'On',
      action: 'Turn off',
      warning: null,
    });
  });

  it('warns when the permission went away while on', () => {
    const view = captureSwitch({ enabled: true, permitted: false });

    expect(view.label).toBe('Paused');
    expect(view.action).toBe('Turn on');
    expect(view.warning).toContain('permission');
  });
});

describe('permissionNotice', () => {
  it('says nothing after a grant', () => {
    expect(permissionNotice('granted')).toBeNull();
  });

  it('explains a denial', () => {
    expect(permissionNotice('denied')).toContain('stays off');
  });

  it('points a blocked request at app info', () => {
    expect(permissionNotice('blocked')).toContain('App info');
  });
});
