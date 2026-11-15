// Service worker : le site s'ouvre même hors connexion.
const CACHE = 'mabiblio-v9';
const SHELL = ['./', 'index.html', 'css/app.css', 'js/config.js', 'js/store.js', 'js/app.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'data/library.json', 'data/releases.json'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin === location.origin) {
    // Réseau d'abord (pour avoir la dernière version), cache si hors ligne
    e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
  } else if (url.hostname === 'cdn.mangaupdates.com') {
    // Couvertures : cache d'abord
    e.respondWith(caches.open(CACHE + '-img').then(async (c) => {
      const hit = await c.match(e.request); if (hit) return hit;
      const r = await fetch(e.request); if (r.ok || r.type === 'opaque') c.put(e.request, r.clone()); return r;
    }).catch(() => fetch(e.request)));
  }
});
