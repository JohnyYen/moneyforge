import type { ConfigContext } from 'expo/config';

import createConfig from '../../app.config';

const context = { config: {} } as ConfigContext;

describe('app config', () => {
  const originalVariant = process.env.APP_VARIANT;

  afterEach(() => {
    if (originalVariant === undefined) {
      delete process.env.APP_VARIANT;
    } else {
      process.env.APP_VARIANT = originalVariant;
    }
  });

  it('defaults to the play variant', () => {
    delete process.env.APP_VARIANT;

    const config = createConfig(context);

    expect(config.name).toBe('MoneyForge');
    expect(config.android?.package).toBe('app.moneyforge');
  });

  it('suffixes name and package for the full variant', () => {
    process.env.APP_VARIANT = 'full';

    const config = createConfig(context);

    expect(config.name).toBe('MoneyForge Full');
    expect(config.android?.package).toBe('app.moneyforge.full');
  });

  it('rejects an unknown variant instead of building the wrong manifest', () => {
    process.env.APP_VARIANT = 'beta';

    expect(() => createConfig(context)).toThrow('Unknown APP_VARIANT: beta');
  });

  it('keeps the database out of cloud backup', () => {
    expect(createConfig(context).android?.allowBackup).toBe(false);
  });

  it('targets Android only', () => {
    expect(createConfig(context).platforms).toEqual(['android']);
  });
});
