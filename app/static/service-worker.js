const CACHE_NAME = 'collectplus-shell-v8';
const SHELL = ['/', '/static/styles.css', '/static/util.js', '/static/charts.js', '/static/geomap.js', '/static/formkit.js', '/static/app.js', '/static/icons.svg', '/static/icon.svg', '/static/geo/index.json', '/manifest.webmanifest'];
self.addEventListener('install', event => {
  // addAll échoue si une ressource est en erreur (ex. « / » protégé avant connexion) : on ajoute au mieux, une par une.
  event.waitUntil(caches.open(CACHE_NAME).then(cache => Promise.allSettled(SHELL.map(u => cache.add(u)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/public/')) return; // jamais d'API ni de formulaire public en cache
  event.respondWith(fetch(req).then(resp => {
    if (resp.ok) { const copy = resp.clone(); caches.open(CACHE_NAME).then(cache => cache.put(req, copy)); }
    return resp;
  }).catch(() => caches.match(req).then(cached => cached || (req.mode === 'navigate' ? caches.match('/') : Response.error()))));
});
