const CACHE_NAME = "race-logger-v4";
const ASSETS_TO_CACHE = [
  "./",
  "./index.html",
  "./manifest.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      );
    })
  );
  self.clients.claim();
});

// THE ROOT CAUSE FIX:
self.addEventListener("fetch", (event) => {
  // 1. If the request is NOT a GET request (e.g., POST sync), do not touch it.
  if (event.request.method !== "GET") {
    return; 
  }

  // 2. If the request is going outside your local domain (e.g., Google Script), do not touch it.
  if (!event.request.url.startsWith(self.location.origin)) {
    return; 
  }

  // 3. Only serve local static files from cache
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      return cachedResponse || fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200) {
          return networkResponse;
        }
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        return networkResponse;
      });
    })
  );
});
