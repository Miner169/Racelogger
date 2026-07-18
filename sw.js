const CACHE_NAME = "race-logger-v2";
const ASSETS_TO_CACHE = [
  "./",
  "./index.html",
  "./manifest.json"
];

// Install Event - Pre-cache core application interface files
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// Activate Event - Clean up stale cache contexts
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

// FETCH CONTROLLER - Fixes the standalone pending bug
self.addEventListener("fetch", (event) => {
  const url = event.request.url;

  // CRITICAL BYPASS: If the request is going to Google Script, bypass the cache completely
  if (url.includes("script.google.com") || url.includes("google")) {
    event.respondWith(
      fetch(event.request).catch((err) => {
        // Return a custom offline response text structure if network is truly dead
        return new Response(
          JSON.stringify({ status: "error", message: "Offline network disconnection context." }),
          { headers: { "Content-Type": "application/json" } }
        );
      })
    );
    return; // Exit out, do not allow the cache runner below to touch this request
  }

  // Standard Cache-First approach for UI/Static files (HTML, JSON assets)
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;
      
      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || event.request.method !== "GET") {
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