const { withAppBuildGradle } = require('expo/config-plugins');

// Both anchors are verbatim text from the Expo SDK 58 template's android/app/build.gradle.
const SIGNING_CONFIGS_ANCHOR = `    signingConfigs {
        debug {
            storeFile file('debug.keystore')`;

const RELEASE_SIGNING_ANCHOR = `            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug`;

const MARKER = '// @generated moneyforge-release-signing';

// Gradle reads the environment when it configures the build, so the keystore and its
// passwords never land in the generated project. Without them, release stays debug-signed.
const RELEASE_SIGNING_CONFIG = `    signingConfigs {
        ${MARKER}
        if (System.getenv('MONEYFORGE_KEYSTORE_PATH')) {
            release {
                storeFile file(System.getenv('MONEYFORGE_KEYSTORE_PATH'))
                storePassword System.getenv('MONEYFORGE_KEYSTORE_PASSWORD')
                keyAlias System.getenv('MONEYFORGE_KEY_ALIAS')
                keyPassword System.getenv('MONEYFORGE_KEY_PASSWORD')
            }
        }
        debug {
            storeFile file('debug.keystore')`;

const RELEASE_SIGNING = `            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig System.getenv('MONEYFORGE_KEYSTORE_PATH') ? signingConfigs.release : signingConfigs.debug`;

function replaceAnchor(contents, anchor, replacement, where) {
  if (!contents.includes(anchor)) {
    throw new Error(
      `with-release-signing: could not find ${where} in android/app/build.gradle. ` +
        'The Expo template changed; update the plugin anchors.',
    );
  }
  return contents.replace(anchor, replacement);
}

function applyReleaseSigning(contents) {
  if (contents.includes(MARKER)) return contents;
  const withConfig = replaceAnchor(
    contents,
    SIGNING_CONFIGS_ANCHOR,
    RELEASE_SIGNING_CONFIG,
    'the signingConfigs debug block',
  );
  return replaceAnchor(
    withConfig,
    RELEASE_SIGNING_ANCHOR,
    RELEASE_SIGNING,
    'the buildTypes.release signingConfig',
  );
}

function withReleaseSigning(config) {
  return withAppBuildGradle(config, (next) => {
    if (next.modResults.language !== 'groovy') {
      throw new Error('with-release-signing: android/app/build.gradle must be Groovy.');
    }
    next.modResults.contents = applyReleaseSigning(next.modResults.contents);
    return next;
  });
}

module.exports = withReleaseSigning;
module.exports.default = withReleaseSigning;
module.exports.applyReleaseSigning = applyReleaseSigning;
