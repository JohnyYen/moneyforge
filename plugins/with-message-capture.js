const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

const RECEIVE_SMS = 'android.permission.RECEIVE_SMS';
const SMS_RECEIVED = 'android.provider.Telephony.SMS_RECEIVED';
const RECEIVER = 'app.moneyforge.messagecapture.SmsCaptureReceiver';
const SEND = 'android.intent.action.SEND';

const VARIANTS = ['play', 'full'];

const isShareFilter = (filter) =>
  (filter.action ?? []).some(({ $ }) => $['android:name'] === SEND);

function addShareTarget(activity) {
  const filters = activity['intent-filter'] ?? [];
  if (filters.some(isShareFilter)) return;
  activity['intent-filter'] = [
    ...filters,
    {
      action: [{ $: { 'android:name': SEND } }],
      category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
      data: [{ $: { 'android:mimeType': 'text/plain' } }],
    },
  ];
}

/** Also clears a stale full prebuild, so a Play build can never inherit its SMS entries. */
function removeSmsCapture(manifest, application) {
  manifest.manifest['uses-permission'] = (manifest.manifest['uses-permission'] ?? []).filter(
    ({ $ }) => $['android:name'] !== RECEIVE_SMS,
  );
  application.receiver = (application.receiver ?? []).filter(
    ({ $ }) => $['android:name'] !== RECEIVER,
  );
}

function addSmsCapture(manifest, application) {
  manifest.manifest['uses-permission'].push({ $: { 'android:name': RECEIVE_SMS } });
  application.receiver.push({
    $: {
      'android:name': RECEIVER,
      'android:exported': 'true',
      // Only the system holds this, so no other app can feed the queue a forged SMS.
      'android:permission': 'android.permission.BROADCAST_SMS',
    },
    'intent-filter': [{ action: [{ $: { 'android:name': SMS_RECEIVED } }] }],
  });
}

function applyMessageCapture(manifest, variant) {
  const application = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
  addShareTarget(AndroidConfig.Manifest.getMainActivityOrThrow(manifest));
  removeSmsCapture(manifest, application);
  if (variant === 'full') addSmsCapture(manifest, application);
  return manifest;
}

function withMessageCapture(config, { variant }) {
  if (!VARIANTS.includes(variant)) throw new Error(`Unknown APP_VARIANT: ${variant}`);
  return withAndroidManifest(config, (next) => {
    next.modResults = applyMessageCapture(next.modResults, variant);
    return next;
  });
}

module.exports = withMessageCapture;
module.exports.default = withMessageCapture;
module.exports.applyMessageCapture = applyMessageCapture;
