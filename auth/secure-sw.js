const PUBLIC_CACHE = 'climaflux-auth-public-v1';
const PUBLIC_ASSETS = ['/icon.svg', '/manifest.webmanifest', '/auth.css', '/login.js'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(PUBLIC_CACHE).then((cache) => cache.addAll(PUBLIC_ASSETS)).catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(names.filter((name) => name !== PUBLIC_CACHE).map((name) => caches.delete(name)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (PUBLIC_ASSETS.includes(url.pathname)) {
    event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
    return;
  }
  event.respondWith(fetch(event.request, { cache: 'no-store' }));
});
