const CACHE_NAME = 'oki-toki-cache-v2';

const STATIC_FILES = [
  './',
  './index.html',
  './manifest.json',
  './style.css',
  './script.js',
  './peerjs.min.js',
  './bootstrap.min.css',
  './bootstrap.min.js',
  './fonts.googleapis.css',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// INSTALL
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_FILES);
    })
  );
  self.skipWaiting();
});

// ACTIVATE
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      )
    )
  );
  self.clients.claim();
});

// FETCH (SAFE)
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // ❌ ignore peerjs / websocket / stun
  if (
    url.includes('peerjs') ||
    url.includes('ws:') ||
    url.includes('wss:') ||
    url.includes('stun:') ||
    url.includes('turn:')
  ) {
    return;
  }

  // Only cache same-origin
  if (!url.startsWith(self.location.origin)) {
    return fetch(event.request);
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      return (
        cached ||
        fetch(event.request).then((response) => {
          return caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, response.clone());
            return response;
          });
        })
      );
    }).catch(() => {
      return caches.match('./index.html');
    })
  );
});