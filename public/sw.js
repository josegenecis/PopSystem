const CACHE_VERSION = 'popsystem-shell-v7';
const IMAGE_CACHE_VERSION = 'popsystem-images-v1';
const APP_SHELL = ['/', '/offline.html', '/manifest.json', '/manifest-totem.json', '/manifest-motoboy.json', '/icon-192x192.png', '/icon-512x512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => ![CACHE_VERSION, IMAGE_CACHE_VERSION].includes(key)).map((key) => caches.delete(key))))
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
    // Bundles have hashes in their names. Never turn a missing/obsolete bundle
    // into a persistent cached failure after a production deployment.
    event.respondWith(fetch(request).catch(() => caches.match(request)));
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
