import { createCatalogUseCases } from './catalog-use-cases';
import type { OnChainDeps } from './ports';
import { createWatchUseCases } from './watch-use-cases';

export function createOnChainService(deps: OnChainDeps) {
  const catalog = createCatalogUseCases(deps);
  return { ...catalog, ...createWatchUseCases(deps, catalog.networkEnabled) };
}

export type OnChainService = ReturnType<typeof createOnChainService>;
