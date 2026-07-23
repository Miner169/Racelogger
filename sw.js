// v6: bumped so every device drops the old cached app shell and picks up the
// new index.html (deleted-status purging, camera scanner fixes, export scope
// prompt). The fetch strategy below is also network-first for the app shell
// now — the old cache-first strategy served a stale index.html forever, which
// is why UI fixes (e.g. the camera button) never seemed to arrive on devices.
const CACHE_NAME = 'race-logger-v6-cache';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/tailwind.css',
  '/manifest.json'
];

// App-shell URLs that should always prefer the network (so deploys actually
// reach devices) while still falling back to cache offline.
function isShellRequest_(request) {
  if (request.mode === 'navigate') return true;
  const url = new URL(request.url);
  return ASSETS_TO_CACHE.some((path) => url.pathname === path || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/tailwind.css') || url.pathname.endsWith('/manifest.json'));
}

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

  // ── App shell: NETWORK-FIRST with cache fallback ─────────────────────────
  // Fresh HTML/CSS whenever online, cached copy when offline. This replaces
  // the old cache-first behavior that pinned devices to whatever index.html
  // they first installed.
  if (isShellRequest_(event.request)) {
    event.respondWith(
      fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
        }
        return networkResponse;
      }).catch(() => {
        return caches.match(event.request).then((cached) => {
          if (cached) return cached;
          if (event.request.mode === 'navigate') return caches.match('/index.html');
        });
      })
    );
    return;
  }

  // ── Everything else: cache-first (offline-friendly CDN libs, icons, etc.) ─
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
            const deletedUidsSet = new Set(result.deletedUids || []);
            const writeTx = db.transaction(["logs"], "readwrite");
            const writeStore = writeTx.objectStore("logs");

            if (deletedUidsSet.size) {
              allLogs.forEach(l => { if (deletedUidsSet.has(l.uid)) writeStore.delete(l.id); });
            }

            unsynced.forEach(log => {
              // Deleted server-side (admin delete / already-deleted UID): the
              // delete above is final — skip every other branch so a put()
              // below can't quietly resurrect the record.
              if (deletedUidsSet.has(log.uid)) return;
              if (remakeIds.has(log.uid)) { log.synced = false; log.remake = true; log.syncAttempts = 0; writeStore.put(log); }
              else if (log.pendingDelete) {
                // Queued delete (see deleteRow() in index.html): confirmedIds here means
                // the server marked it Deleted, so remove the local record entirely instead
                // of marking it synced -- this is what lets a delete made while offline
                // still reach every other device once connectivity (or just background
                // sync) comes back, even if the tab that queued it is now closed.
                if (confirmedIds.has(log.uid)) { writeStore.delete(log.id); }
                else { log.syncAttempts = (log.syncAttempts || 0) + 1; writeStore.put(log); }
              }
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
