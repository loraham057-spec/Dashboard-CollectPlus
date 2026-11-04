const CACHE_NAME = 'collectplus-shell-v6';
const SHELL = ['/', '/static/styles.css', '/static/app.js', '/static/icon.svg', '/static/default-forms.json', '/manifest.webmanifest'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.startsWith('/api/')) return;
  event.respondWith(fetch(req).then(resp => {
    if (resp.ok && url.origin === self.location.origin) {
      const copy = resp.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
    }
    return resp;
  }).catch(() => caches.match(req).then(cached => cached || caches.match('/'))));
});
