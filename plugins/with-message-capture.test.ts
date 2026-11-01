import type { ExpoConfig } from 'expo/config';

import createConfig from '../app.config';
import withMessageCapture, { applyMessageCapture } from './with-message-capture';

const RECEIVER = 'app.moneyforge.messagecapture.SmsCaptureReceiver';
const SMS_RECEIVED = 'android.provider.Telephony.SMS_RECEIVED';

const baseManifest = () => ({
  manifest: {
    $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
    'uses-permission': [{ $: { 'android:name': 'android.permission.INTERNET' } }],
    application: [
      {
        $: { 'android:name': '.MainApplication', 'android:allowBackup': 'false' },
        activity: [
          {
            $: { 'android:name': '.MainActivity', 'android:launchMode': 'singleTask' },
            'intent-filter': [
              {
                action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }],
                category: [{ $: { 'android:name': 'android.intent.category.LAUNCHER' } }],
              },
            ],
          },
        ],
      },
    ],
  },
});

type Manifest = ReturnType<typeof baseManifest>;

const fakeConfig = (): ExpoConfig => ({ name: 'Fake', slug: 'fake' });

/** Runs the mod the plugin registers, the way prebuild runs it. */
async function manifestFor(variant: string, manifest: Manifest = baseManifest()) {
  const config = withMessageCapture(fakeConfig(), { variant }) as ExpoConfig & {
    mods: { android: { manifest: (input: object) => Promise<{ modResults: Manifest }> } };
  };
  const { modResults } = await config.mods.android.manifest({
    ...config,
    modResults: manifest,
    modRequest: { nextMod: async (input: object) => input },
  });
  return modResults;
}

const permissionsOf = (manifest: Manifest) =>
  (manifest.manifest['uses-permission'] ?? []).map(({ $ }) => $['android:name']);

const applicationOf = (manifest: Manifest) => manifest.manifest.application[0] as {
  receiver?: {
    $: Record<string, string>;
    'intent-filter': { action: { $: Record<string, string> }[] }[];
  }[];
  activity: { 'intent-filter': { action: { $: Record<string, string> }[] }[] }[];
};

const receiversOf = (manifest: Manifest) => applicationOf(manifest).receiver ?? [];

const shareFilters = (manifest: Manifest) =>
  applicationOf(manifest).activity[0]['intent-filter'].filter((filter) =>
    filter.action.some(({ $ }) => $['android:name'] === 'android.intent.action.SEND'),
  );

describe('with-message-capture', () => {
  describe('play', () => {
    it('declares no SMS permission', async () => {
      const permissions = permissionsOf(await manifestFor('play'));

      expect(permissions).toEqual(['android.permission.INTERNET']);
      expect(permissions.join()).not.toContain('SMS');
    });

    it('declares no receiver', async () => {
      expect(receiversOf(await manifestFor('play'))).toEqual([]);
    });

    it('still accepts shared text', async () => {
      expect(shareFilters(await manifestFor('play'))).toHaveLength(1);
    });

    it('strips what a stale full prebuild left in the manifest', async () => {
      const stale = await manifestFor('full');

      const manifest = await manifestFor('play', stale);

      expect(permissionsOf(manifest).join()).not.toContain('SMS');
      expect(receiversOf(manifest)).toEqual([]);
    });
  });

  describe('full', () => {
    it('declares RECEIVE_SMS and no other SMS permission', async () => {
      const permissions = permissionsOf(await manifestFor('full'));

      expect(permissions).toContain('android.permission.RECEIVE_SMS');
      expect(permissions).not.toContain('android.permission.READ_SMS');
      expect(permissions).not.toContain('android.permission.SEND_SMS');
    });

    it('declares a receiver only the system can reach, for the broadcast alone', async () => {
      const [receiver, ...others] = receiversOf(await manifestFor('full'));

      expect(others).toEqual([]);
      expect(receiver.$).toEqual({
        'android:name': RECEIVER,
        'android:exported': 'true',
        'android:permission': 'android.permission.BROADCAST_SMS',
      });
      expect(receiver['intent-filter']).toEqual([
        { action: [{ $: { 'android:name': SMS_RECEIVED } }] },
      ]);
    });

    it('accepts shared text', async () => {
      expect(shareFilters(await manifestFor('full'))).toHaveLength(1);
    });

    it('adds nothing twice when it runs twice', async () => {
      const once = await manifestFor('full');
      const twice = await manifestFor('full', structuredClone(once));

      expect(twice).toEqual(once);
    });

    it('leaves unrelated entries alone', async () => {
      const manifest = await manifestFor('full');

      expect(permissionsOf(manifest)).toContain('android.permission.INTERNET');
      expect(applicationOf(manifest).activity[0]['intent-filter'][0].action[0].$).toEqual({
        'android:name': 'android.intent.action.MAIN',
      });
    });
  });

  it('asks for text/plain sends and nothing wider', () => {
    const filter = shareFilters(applyMessageCapture(baseManifest(), 'play'))[0];

    expect(filter).toEqual({
      action: [{ $: { 'android:name': 'android.intent.action.SEND' } }],
      category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
      data: [{ $: { 'android:mimeType': 'text/plain' } }],
    });
  });

  it('leaves the backup setting alone', async () => {
    const manifest = await manifestFor('full');

    expect(manifest.manifest.application[0].$['android:allowBackup']).toBe('false');
  });

  it('rejects an unknown variant instead of guessing a manifest', () => {
    expect(() => withMessageCapture(fakeConfig(), { variant: 'beta' })).toThrow(
      'Unknown APP_VARIANT: beta',
    );
  });

  describe('through app.config', () => {
    const originalVariant = process.env.APP_VARIANT;

    afterEach(() => {
      if (originalVariant === undefined) delete process.env.APP_VARIANT;
      else process.env.APP_VARIANT = originalVariant;
    });

    const pluginProps = (variant: string | undefined) => {
      if (variant === undefined) delete process.env.APP_VARIANT;
      else process.env.APP_VARIANT = variant;
      const config = createConfig({ config: {} } as Parameters<typeof createConfig>[0]);
      const entry = config.plugins?.find(
        (plugin) => Array.isArray(plugin) && plugin[0] === './plugins/with-message-capture',
      );
      return (entry as [string, { variant: string }])[1];
    };

    it.each([
      [undefined, 'play'],
      ['play', 'play'],
      ['full', 'full'],
    ])('passes APP_VARIANT=%s as %s', (value, expected) => {
      expect(pluginProps(value)).toEqual({ variant: expected });
    });
  });
});
