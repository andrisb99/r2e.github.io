/* Nyugta Feldolgozó AI - service worker (offline app shell) */
const VERSION = 'v4';
const CACHE = 'nyugta-ai-' + VERSION;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/icon-180.png'
];

const CDN_ASSETS = [
  'https://cdn.tailwindcss.com/',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Local files are same-origin; CDN files are cached as opaque responses
      // because most of them are served without CORS headers.
      const requests = [
        ...APP_SHELL.map((url) => new Request(url, { cache: 'reload' })),
        ...CDN_ASSETS.map((url) => new Request(url, { cache: 'reload', mode: 'no-cors' }))
      ];
      // Each asset is cached independently so one failure cannot break the install.
      // fetch + put is used instead of cache.add because CDN responses are opaque
      // (status 0) and Cache.addAll rejects those.
      const preload = async (request) => {
        const response = await fetch(request);
        if (response && (response.ok || response.type === 'opaque')) {
          await cache.put(request, response);
        }
      };
      await Promise.allSettled(requests.map(preload));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
      await self.clients.claim();
    })()
  );
});

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response && (response.ok || response.type === 'opaque')) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);
  return cached || (await network) || Response.error();
}

async function networkFirstNavigation(request) {
  const cache = await caches.open(CACHE);
  const cached = async () =>
    (await cache.match('./index.html')) || (await cache.match('./')) || Response.error();
  try {
    const response = await fetch(request);
    // A server/proxy error (offline, 5xx) should still show the cached app.
    if (response && response.ok) {
      cache.put('./index.html', response.clone());
      return response;
    }
    return (await cached()) || response;
  } catch (error) {
    return cached();
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch (error) {
    return;
  }

  // Never interfere with the Gemini API.
  if (url.hostname === 'generativelanguage.googleapis.com') return;

  // App navigation: fresh copy when online, cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  // Same-origin assets and CDN files: instant cache response, updated in background.
  event.respondWith(staleWhileRevalidate(request));
});
