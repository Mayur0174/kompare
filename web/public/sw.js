// Kompare service worker: app-shell caching + offline fallback for catalogue reads.
const VERSION = 'kompare-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // Personal data is never cached.
  if (url.pathname.startsWith('/api/')) {
    if (req.headers.has('authorization') || !/^\/api\/(meta|deals|products|suggest)/.test(url.pathname)) return;
    // Network-first for public catalogue data, cached copy when offline.
    e.respondWith(fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then((r) => r || new Response(JSON.stringify({ error: 'You are offline' }), { status: 503, headers: { 'Content-Type': 'application/json' } }))));
    return;
  }
  // Hashed assets: cache-first (immutable).
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    e.respondWith(caches.match(req).then((r) => r || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  // Navigations: network-first, fall back to cached shell (SPA routing works offline).
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => {
      const copy = res.clone(); caches.open(VERSION).then((c) => c.put('/', copy));
      return res;
    }).catch(() => caches.match('/')));
  }
});
