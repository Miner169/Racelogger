const CACHE_NAME = 'race-logger-v3-cache';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/tailwind.css',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Cache each asset independently so one missing/renamed file (e.g. during
      // a deploy) doesn't fail the whole install and leave the app with no
      // offline shell at all.
      return Promise.all(
        ASSETS_TO_CACHE.map((url) => cache.add(url).catch((err) => {
          console.warn('SW: failed to precache', url, err);
        }))
      );
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (event.request.url.includes('script.google.com')) return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;
      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        return networkResponse;
      }).catch(() => {
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });
    })
  );
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'race-log-sync') {
    event.waitUntil(syncPendingLogs());
  }
});

async function syncPendingLogs() {
  const allClients = await self.clients.matchAll({ includeUncontrolled: true });
  for (const client of allClients) {
    client.postMessage({ type: 'race-log-sync-start' });
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open("RaceLoggerDB", 2);
    request.onerror = () => reject(request.error);
    request.onsuccess = async () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("logs") || !db.objectStoreNames.contains("meta")) {
        resolve(); return;
      }

      let syncUrl = "";
      try {
        const metaTx = db.transaction(["meta"], "readonly");
        const metaStore = metaTx.objectStore("meta");
        const metaReq = metaStore.get("syncUrl");
        await new Promise((res) => { metaReq.onsuccess = () => { if (metaReq.result) syncUrl = metaReq.result.value; res(); }; metaReq.onerror = () => res(); });
      } catch (e) { /* fallback */ }

      if (!syncUrl) { resolve(); return; }

      const tx = db.transaction(["logs"], "readwrite");
      const store = tx.objectStore("logs");
      const getAllReq = store.getAll();

      getAllReq.onsuccess = async () => {
        const allLogs = getAllReq.result || [];
        const unsynced = allLogs.filter(log => !log.synced);
        if (unsynced.length === 0) { resolve(); return; }

        try {
          const response = await fetch(`${syncUrl}${syncUrl.includes('?') ? '&' : '?'}nocache=${Date.now()}`, {
            method: "POST",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ action: "batch_sync", data: unsynced })
          });
          const result = await response.json();
          if (result.status === "success") {
            const confirmedIds = new Set(result.confirmedIds || []);
            const remakeIds = new Set(result.remakeIds || []);
            const writeTx = db.transaction(["logs"], "readwrite");
            const writeStore = writeTx.objectStore("logs");

            if (result.deletedUids && result.deletedUids.length) {
              const uidsToDelete = new Set(result.deletedUids);
              allLogs.forEach(l => { if (uidsToDelete.has(l.uid)) writeStore.delete(l.id); });
            }

            unsynced.forEach(log => {
              if (remakeIds.has(log.uid)) { log.synced = false; log.remake = true; log.syncAttempts = 0; writeStore.put(log); }
              else if (confirmedIds.has(log.uid)) { log.synced = true; log.remake = false; log.syncAttempts = 0; writeStore.put(log); }
              else { log.syncAttempts = (log.syncAttempts || 0) + 1; writeStore.put(log); }
            });

            writeTx.oncomplete = () => {
              for (const client of allClients) {
                client.postMessage({ type: 'race-log-sync-complete', summary: result.summary });
              }
              resolve();
            };
          } else { reject(new Error(result.message || "Server sync failed")); }
        } catch (err) { reject(err); }
      };
    };
  });
}
