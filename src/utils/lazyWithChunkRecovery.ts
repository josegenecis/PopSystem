import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { recoverFromStaleChunk } from '@/utils/chunkRecovery';

type ComponentModule<T extends ComponentType> = { default: T };

/**
 * Keeps React on its Suspense fallback while an obsolete PWA chunk is being
 * replaced. Without this wrapper the global error screen flashes before the
 * automatic reload has time to recover the current route.
 */
export function lazyWithChunkRecovery<T extends ComponentType>(
  loader: () => Promise<ComponentModule<T>>,
): LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      return await loader();
    } catch (error) {
      if (await recoverFromStaleChunk(error)) {
        return await new Promise<ComponentModule<T>>(() => undefined);
      }
      throw error;
    }
  });
}
