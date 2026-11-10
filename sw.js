/* Bump RELEASE whenever any cached file changes, and keep asset queries in
   sync with index.html. Installation is atomic: failed downloads keep the old app. */
const RELEASE = 'v11';
const CACHE_PREFIX = `ferry-departures:${self.registration.scope}:`;
const CACHE_NAME = `${CACHE_PREFIX}${RELEASE}`;
const SHELL = new URL('index.html', self.registration.scope).href;
const ASSETS = [
  'index.html',
  'styles.css?v=37',
  'data.js?v=16',
  'app.js?v=36',
  'pwa.js?v=1',
  'manifest.webmanifest',
  'icons/ferry.svg',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
].map(path => new URL(path, self.registration.scope).href);

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache =>
    cache.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' })))
  ));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const isBoard = event.request.mode === 'navigate'
    && (url.origin + url.pathname === self.registration.scope || url.origin + url.pathname === SHELL);
  if (!isBoard && !ASSETS.includes(url.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const saved = await cache.match(isBoard ? SHELL : event.request);
    return saved || fetch(event.request);
  })());
});
