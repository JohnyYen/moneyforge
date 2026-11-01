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
  return variants[variantName];
}

export default function createConfig({ config }: ConfigContext): ExpoConfig {
  const variant = resolveVariant(process.env.APP_VARIANT);

  return {
    ...config,
    name: variant.name,
    slug: 'moneyforge',
    version: '0.1.0',
    platforms: ['android'],
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    scheme: 'moneyforge',
    userInterfaceStyle: 'automatic',
    android: {
      package: variant.package,
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
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
  };
}
