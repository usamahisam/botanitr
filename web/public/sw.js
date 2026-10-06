/* Botani Terminal service worker: app-shell cache-first agar bisa di-install & dibuka cepat di Android. */
const VERSION = 'botani-v1';
const CORE = ['/', '/index.html', '/manifest.webmanifest', '/logo.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting()).catch(() => {}));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // API & socket jangan di-cache
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/socket.io')) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: false }).then(hit => {
      if (hit) return hit;
      return fetch(e.request).then(res => {
        if (res.ok && (url.pathname.startsWith('/assets/') || url.pathname.endsWith('.js') || url.pathname.endsWith('.css') || url.pathname.endsWith('.svg') || url.pathname.endsWith('.png'))) {
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      }).catch(() => {
        // Offline: kembalikan shell agar SPA router tetap jalan
        if (e.request.mode === 'navigate') return caches.match('/index.html');
        throw e;
      });
    })
  );
});
