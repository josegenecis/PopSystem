import { normalizeImageUrlForDisplay } from '@/utils/normalizeImageUrl';

const MAX_WARM_IMAGES = 150;
const warmedImages = new Map<string, HTMLImageElement>();

/**
 * Mantem as imagens mais usadas decodificadas durante a sessao. O cache HTTP
 * continua sendo a fonte persistente; esta camada evita o piscar ao remontar
 * PDV/totem depois de navegar por outras telas.
 */
export function warmImageCache(urls: Array<string | null | undefined>) {
  if (typeof window === 'undefined' || typeof Image === 'undefined') return;

  let warmedThisCall = 0;
  for (const rawUrl of urls) {
    if (warmedThisCall >= MAX_WARM_IMAGES) break;
    const url = normalizeImageUrlForDisplay(rawUrl || '');
    if (!url || warmedImages.has(url)) continue;

    const image = new Image();
    image.decoding = 'async';
    image.loading = 'eager';
    image.src = url;
    warmedImages.set(url, image);
    warmedThisCall += 1;

    if (typeof image.decode === 'function') {
      void image.decode().catch(() => undefined);
    }

    if (warmedImages.size > MAX_WARM_IMAGES) {
      const oldestUrl = warmedImages.keys().next().value as string | undefined;
      if (oldestUrl) warmedImages.delete(oldestUrl);
    }
  }
}
