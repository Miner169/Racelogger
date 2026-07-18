const CACHE_NAME = "race-logger-v3";
const ASSETS_TO_CACHE = [
  "./",
  "./index.html",
  "./manifest.json"
];

// 1. Install Event - Force fresh asset ingestion immediately
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting(); // Force the updated worker to take control right away
});

// 2. Activate Event - Obliterate old stale caches immediately
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim(); // Immediately control all open PWA instances
});

// 3. Flawless Fetch Interceptor - Handles static assets & passes API traffic safely
self.addEventListener("fetch", (event) => {
  const url = event.request.url;

  // RULE 1: CRITICAL BYPASS FOR GOOGLE SHEET SYNC ENDPOINTS
  // Completely isolate external sync endpoints away from local asset management loops
  if (url.includes("script.google.com") || url.includes("google")) {
    event.respondWith(
      fetch(event.request).catch((err) => {
        console.error("Service Worker direct network sync failed:", err);
        return new Response(
          JSON.stringify({ status: "offline_pending", message: "Network unavailable. Keeping log in queue." }),
          { headers: { "Content-Type": "application/json" } }
        );
      })
    );
    return; // Exit early to avoid catching/blocking rules below
  }

  // RULE 2: CRITICAL SAFEGUARD FOR NON-GET REQUESTS
  // Browser asset cache engines CANNOT match or store POST/PUT requests.
  // We must return them directly to the open web or they will crash the app wrapper loop.
  if (event.request.method !== "GET") {
    event.respondWith(fetch(event.request));
    return;
  }

  // RULE 3: Cache-First Strategy for standard user interface assets (HTML, JSON, CSS)
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse; // Return ultra-fast offline access instantly
      }
      
      return fetch(event.request).then((networkResponse) => {
        // Only cache valid standard GET requests
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
