/**
 * sw.js — offline support for Flappy Bird.
 *
 * Strategies
 *   navigation : network-first with a cached-shell fallback (so a fresh build
 *                is picked up immediately, but the game still opens offline).
 *   app shell  : stale-while-revalidate — instant from cache, refreshed in the
 *                background for the next launch.
 *
 * The whole game is a handful of small text files, so the cache stays tiny.
 */

const VERSION = 'v1.0.0';
const SHELL_CACHE = `flappy-shell-${VERSION}`;

const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/main.js',
  './js/game.js',
  './js/audio.js',
  './js/storage.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon.png',
];

/* --------------------------------------------------------------- install */

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // addAll() is atomic — one missing file would abort the whole install,
      // so each asset is added individually and failures are tolerated.
      await Promise.allSettled(
        SHELL_ASSETS.map(async (url) => {
          try {
            const res = await fetch(new Request(url, { cache: 'reload' }));
            if (res.ok) await cache.put(url, res);
          } catch {
            /* offline during install — the runtime cache will fill it in */
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

/* -------------------------------------------------------------- activate */

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key.startsWith('flappy-') && key !== SHELL_CACHE).map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

/* ----------------------------------------------------------------- fetch */

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never intercept the worker itself.
  if (url.pathname.endsWith('/sw.js')) return;

  if (request.mode === 'navigate') {
    event.respondWith(navigationStrategy(request));
    return;
  }

  event.respondWith(shellStrategy(request));
});

async function navigationStrategy(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const network = await fetch(request);
    if (network && network.ok) cache.put('./index.html', network.clone());
    return network;
  } catch {
    return (
      (await cache.match('./index.html')) ||
      (await cache.match('./')) ||
      new Response(
        '<!doctype html><meta charset="utf-8"><title>Offline</title>' +
          '<body style="font-family:system-ui;padding:2rem;background:#050b16;color:#f2f8ff">' +
          '<h1>Offline</h1><p>Open Flappy Bird once while online so it can be cached for offline play.</p>',
        { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 },
      )
    );
  }
}

async function shellStrategy(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then(async (response) => {
      if (response && response.ok && response.type === 'basic') {
        try {
          await cache.put(request, response.clone());
        } catch {
          /* quota exceeded — ignore */
        }
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    network.catch(() => {});
    return cached;
  }

  const fresh = await network;
  if (fresh) return fresh;

  return new Response('', { status: 504, statusText: 'Offline' });
}
