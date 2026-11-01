import { createContext, useContext } from 'react';

import type { AssetService } from '../application/asset-service';

export const AssetsContext = createContext<AssetService | null>(null);

export function useAssets(): AssetService {
  const assets = useContext(AssetsContext);
  if (!assets) throw new Error('useAssets needs an AssetsContext provider');
  return assets;
}
