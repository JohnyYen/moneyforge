import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ExpoConfig } from 'expo/config';

import createConfig from '../app.config';
import withReleaseSigning, { applyReleaseSigning } from './with-release-signing';

/** app/build.gradle exactly as the Expo SDK 58 template (expo/template.tgz) ships it. */
const templateGradle = () =>
  readFileSync(join(__dirname, '__fixtures__', 'app-build.gradle'), 'utf8');

type BuildGradle = { language: string; contents: string };

const fakeConfig = (): ExpoConfig => ({ name: 'Fake', slug: 'fake' });

/** Runs the mod the plugin registers, the way prebuild runs it. */
async function gradleFor(contents: string, language = 'groovy') {
  const config = withReleaseSigning(fakeConfig()) as ExpoConfig & {
    mods: { android: { appBuildGradle: (input: object) => Promise<{ modResults: BuildGradle }> } };
  };
  const { modResults } = await config.mods.android.appBuildGradle({
    ...config,
    modResults: { language, contents },
    modRequest: { nextMod: async (input: object) => input },
  });
  return modResults.contents;
}

/** The body of the top-level `release { ... }` block inside `buildTypes`. */
function releaseBuildType(gradle: string) {
  const start = gradle.indexOf('release {', gradle.indexOf('buildTypes {'));
  return gradle.slice(start, gradle.indexOf('\n        }', start));
}

const count = (text: string, needle: string) => text.split(needle).length - 1;

describe('with-release-signing', () => {
  it('declares a release signing config read from the environment at build time', async () => {
    const gradle = await gradleFor(templateGradle());

    expect(gradle).toContain("if (System.getenv('MONEYFORGE_KEYSTORE_PATH')) {");
    expect(gradle).toContain("storeFile file(System.getenv('MONEYFORGE_KEYSTORE_PATH'))");
    expect(gradle).toContain("storePassword System.getenv('MONEYFORGE_KEYSTORE_PASSWORD')");
    expect(gradle).toContain("keyAlias System.getenv('MONEYFORGE_KEY_ALIAS')");
    expect(gradle).toContain("keyPassword System.getenv('MONEYFORGE_KEY_PASSWORD')");
  });

  it('signs release builds with it only when the keystore path is set', async () => {
    const release = releaseBuildType(await gradleFor(templateGradle()));

    expect(release).toContain(
      "signingConfig System.getenv('MONEYFORGE_KEYSTORE_PATH') ? signingConfigs.release : signingConfigs.debug",
    );
    expect(release).not.toMatch(/^\s*signingConfig signingConfigs\.debug$/m);
  });

  it('keeps debug signing for debug builds', async () => {
    const gradle = await gradleFor(templateGradle());
    const debug = gradle.slice(gradle.indexOf('debug {', gradle.indexOf('buildTypes {')));

    expect(debug.slice(0, debug.indexOf('}'))).toContain('signingConfig signingConfigs.debug');
    expect(gradle).toContain("storeFile file('debug.keystore')");
  });

  it('puts no secret in the generated file', async () => {
    const gradle = await gradleFor(templateGradle());
    const signingConfigs = gradle.slice(gradle.indexOf('signingConfigs {'), gradle.indexOf('debug {'));

    expect(signingConfigs).toContain('release {');
    expect(signingConfigs).not.toMatch(/(storeFile|storePassword|keyPassword|keyAlias) ['"]/);
  });

  it('changes nothing when it runs twice', async () => {
    const once = await gradleFor(templateGradle());

    expect(await gradleFor(once)).toBe(once);
    expect(count(once, 'MONEYFORGE_KEYSTORE_PATH')).toBe(3);
  });

  it('fails loudly when the signing configs anchor is missing', () => {
    const gradle = templateGradle().replace("storeFile file('debug.keystore')", "storeFile file('x')");

    expect(() => applyReleaseSigning(gradle)).toThrow(/signingConfigs/);
  });

  it('fails loudly when the release build type anchor is missing', () => {
    const gradle = templateGradle().replace(
      '// see https://reactnative.dev/docs/signed-apk-android.',
      '// moved',
    );

    expect(() => applyReleaseSigning(gradle)).toThrow(/buildTypes\.release/);
  });

  it('refuses a Kotlin build script instead of skipping it', async () => {
    await expect(gradleFor('android {}', 'kt')).rejects.toThrow(/Groovy/);
  });

  it('is registered in app.config for every variant', () => {
    const original = process.env.APP_VARIANT;
    try {
      for (const variant of ['play', 'full']) {
        process.env.APP_VARIANT = variant;
        const config = createConfig({ config: {} } as Parameters<typeof createConfig>[0]);

        expect(config.plugins).toContain('./plugins/with-release-signing');
      }
    } finally {
      if (original === undefined) delete process.env.APP_VARIANT;
      else process.env.APP_VARIANT = original;
    }
  });
});
