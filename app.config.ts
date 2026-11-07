import type { ConfigContext, ExpoConfig } from 'expo/config';

const variants = {
  play: { name: 'MoneyForge', package: 'app.moneyforge' },
  full: { name: 'MoneyForge Full', package: 'app.moneyforge.full' },
} as const;

function resolveVariant(value: string | undefined) {
  const variantName = value ?? 'play';
  if (variantName !== 'play' && variantName !== 'full') {
    throw new Error(`Unknown APP_VARIANT: ${variantName}`);
  }
  return { variantName, ...variants[variantName] };
}

export default function createConfig({ config }: ConfigContext): ExpoConfig {
  const variant = resolveVariant(process.env.APP_VARIANT);

  return {
    ...config,
    name: variant.name,
    slug: 'moneyforge',
    version: '0.2.1',
    // Web is a development preview only (`pnpm web`); Android is the product target.
    platforms: ['android', 'web'],
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    scheme: 'moneyforge',
    userInterfaceStyle: 'automatic',
    android: {
      package: variant.package,
      // Bump with every release so Android installs the APK as an update.
      versionCode: 3,
      // The database holds financial history, so it must not reach cloud backup.
      allowBackup: false,
      adaptiveIcon: {
        backgroundColor: '#E6F4FE',
        foregroundImage: './assets/images/android-icon-foreground.png',
        backgroundImage: './assets/images/android-icon-background.png',
        monochromeImage: './assets/images/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
    },
    plugins: [
      'expo-router',
      [
        'expo-splash-screen',
        {
          backgroundColor: '#208AEF',
          image: './assets/images/splash-icon.png',
          imageWidth: 76,
        },
      ],
      ['./plugins/with-message-capture', { variant: variant.variantName }],
      './plugins/with-release-signing',
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
  };
}
