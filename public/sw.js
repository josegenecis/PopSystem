const CACHE_VERSION = 'popsystem-shell-v9';
const ASSET_CACHE_VERSION = 'popsystem-assets-v9';
const IMAGE_CACHE_VERSION = 'popsystem-images-v1';
const APP_SHELL = ['/', '/offline.html', '/manifest.json', '/manifest-totem.json', '/manifest-motoboy.json', '/icon-192x192.png', '/icon-512x512.png'];

const fetchWithTimeout = (request, timeoutMs = 15000) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(request, { signal: controller.signal }).finally(() => clearTimeout(timeoutId));
};

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => ![CACHE_VERSION, ASSET_CACHE_VERSION, IMAGE_CACHE_VERSION].includes(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event?.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Imagens de produtos podem vir do Supabase, iFood ou outro CDN. Mantemos
  // uma copia local e atualizamos em segundo plano, inclusive cross-origin.
  const isImage = request.destination === 'image' || /\.(?:png|jpg|jpeg|webp|gif|avif|svg)$/i.test(url.pathname);
  if (isImage) {
    const networkResponse = fetch(request).then((response) => {
      if (response.ok || response.type === 'opaque') {
        const copy = response.clone();
        void caches.open(IMAGE_CACHE_VERSION).then((cache) => cache.put(request, copy));
      }
      return response;
    });

    event.waitUntil(networkResponse.then(() => undefined).catch(() => undefined));
    event.respondWith(
      caches.open(IMAGE_CACHE_VERSION)
        .then((cache) => cache.match(request))
        .then((cached) => cached || networkResponse)
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Dados de pedidos, clientes e pagamentos nunca sao gravados no cache do navegador.
  if (url.pathname.startsWith('/api/') || url.pathname.includes('/functions/v1/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put('/', copy));
          return response;
        })
        .catch(async () => (await caches.match('/')) || (await caches.match('/offline.html')))
    );
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    // Os bundles do Vite possuem hash no nome: uma versao em cache nunca fica
    // obsoleta. Isso evita baixar novamente cada tela ao navegar pelo PWA.
    event.respondWith(
      caches.open(ASSET_CACHE_VERSION).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;

        const response = await fetchWithTimeout(request);
        if (response.ok) await cache.put(request, response.clone());
        return response;
      })
    );
    return;
  }

  if (/\.(?:woff2?)$/i.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      }))
    );
  }
});
