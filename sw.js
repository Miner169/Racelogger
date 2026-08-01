// v18: aggregate indexes, virtual safety rows, cached operations summaries, clock audit,
// route validation, device health, structured incidents, COT alerts and accessibility.
const CACHE_NAME = 'race-logger-v18-cache';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/tailwind.css',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-512-maskable.png'
];

// App-shell URLs that should always prefer the network (so deploys actually
// reach devices) while still falling back to cache offline.
function isShellRequest_(request) {
  if (request.mode === 'navigate') return true;
  const url = new URL(request.url);
  return ASSETS_TO_CACHE.some((path) => url.pathname === path || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/tailwind.css') || url.pathname.endsWith('/manifest.json'));
}

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

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
        if (!networkResponse || (!networkResponse.ok && networkResponse.type !== 'opaque')) {
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


function parseClientTimeMs_(value) {
  if (!value) return Date.now();
  const text = String(value).trim();
  let match = text.match(/^(\d{2})[\/-](\d{2})[\/-](\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)?$/i);
  if (match) {
    let hour = Number(match[4]);
    const meridiem = String(match[7] || '').toUpperCase();
    if (meridiem === 'PM' && hour < 12) hour += 12;
    if (meridiem === 'AM' && hour === 12) hour = 0;
    const time = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]), hour, Number(match[5]), Number(match[6])).getTime();
    if (Number.isFinite(time)) return time;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function readStoreAll_(db, storeName) {
  return new Promise((resolve) => {
    if (!db.objectStoreNames.contains(storeName)) { resolve([]); return; }
    try {
      const req = db.transaction([storeName], 'readonly').objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    } catch (_) { resolve([]); }
  });
}

function putStoreRecord_(db, storeName, record) {
  return new Promise((resolve) => {
    if (!db.objectStoreNames.contains(storeName)) { resolve(); return; }
    try {
      const tx = db.transaction([storeName], 'readwrite');
      tx.objectStore(storeName).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch (_) { resolve(); }
  });
}

async function postOperationalRecord_(syncUrl, action, key, value) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`${syncUrl}${syncUrl.includes('?') ? '&' : '?'}nocache=${Date.now()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, [key]: value }),
      signal: controller.signal
    });
    return await response.json();
  } finally { clearTimeout(timeoutId); }
}

async function syncOperationalStores_(db, syncUrl) {
  const incidents = (await readStoreAll_(db, 'incidents')).filter(row => row && row.synced === false);
  for (const incident of incidents) {
    try {
      const result = await postOperationalRecord_(syncUrl, 'incident_upsert', 'incident', incident);
      if (result.status === 'success' && result.incident) {
        await putStoreRecord_(db, 'incidents', Object.assign({}, result.incident, { synced: true }));
      }
    } catch (_) { /* keep queued for next background sync */ }
  }
  const alerts = (await readStoreAll_(db, 'cotAlerts')).filter(row => row && row.synced === false);
  for (const alert of alerts) {
    try {
      const result = await postOperationalRecord_(syncUrl, 'cot_alert_upsert', 'alert', alert);
      if (result.status === 'success' && result.alert) {
        await putStoreRecord_(db, 'cotAlerts', Object.assign({}, result.alert, { synced: true }));
      }
    } catch (_) { /* keep queued for next background sync */ }
  }
}

async function syncPendingLogs() {
  const allClients = await self.clients.matchAll({ includeUncontrolled: true });
  for (const client of allClients) {
    client.postMessage({ type: 'race-log-sync-start' });
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open("RaceLoggerDB", 5);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('RaceLoggerDB upgrade is blocked by another open tab.'));
    request.onupgradeneeded = () => {
      const db = request.result;
      const logStore = db.objectStoreNames.contains("logs")
        ? request.transaction.objectStore("logs")
        : db.createObjectStore("logs", { keyPath: "id", autoIncrement: true });
      [
        ["byUid", "uid"],
        ["byBib", "bib"],
        ["byCheckpoint", "checkpoint"],
        ["byClientTime", "clientTimeMs"],
        ["byCategory", "category"],
        ["byStatus", "status"]
      ].forEach(([name, keyPath]) => {
        if (!logStore.indexNames.contains(name)) logStore.createIndex(name, keyPath, { unique: false });
      });
      const cursorReq = logStore.openCursor();
      cursorReq.onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) return;
        const log = cursor.value;
        if (!Number.isFinite(Number(log.clientTimeMs))) {
          log.clientTimeMs = parseClientTimeMs_(log.time);
          cursor.update(log);
        }
        cursor.continue();
      };
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
      if (!db.objectStoreNames.contains("safetyNotes")) db.createObjectStore("safetyNotes", { keyPath: "bib" });
      if (!db.objectStoreNames.contains("aggregates")) db.createObjectStore("aggregates", { keyPath: "key" });
      if (!db.objectStoreNames.contains("incidents")) db.createObjectStore("incidents", { keyPath: "id" });
      if (!db.objectStoreNames.contains("cotAlerts")) db.createObjectStore("cotAlerts", { keyPath: "key" });
      if (!db.objectStoreNames.contains("deviceHealth")) db.createObjectStore("deviceHealth", { keyPath: "deviceId" });
    };
    request.onsuccess = async () => {
      const db = request.result;
      db.onversionchange = () => db.close();
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

      const tx = db.transaction(["logs"], "readonly");
      const store = tx.objectStore("logs");
      const getAllReq = store.getAll();
      getAllReq.onerror = () => reject(getAllReq.error || new Error('Could not read pending logs.'));

      getAllReq.onsuccess = async () => {
        const allLogs = getAllReq.result || [];
        const unsynced = allLogs.filter(log => !log.synced);
        if (unsynced.length === 0) {
          try { await syncOperationalStores_(db, syncUrl); } catch (_) { /* queued for next attempt */ }
          resolve(); return;
        }

        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 25000);
          let response;
          try {
            response = await fetch(`${syncUrl}${syncUrl.includes('?') ? '&' : '?'}nocache=${Date.now()}`, {
              method: "POST",
              headers: { "Content-Type": "text/plain;charset=utf-8" },
              body: JSON.stringify({ action: "batch_sync", data: unsynced }),
              signal: controller.signal
            });
          } finally {
            clearTimeout(timeoutId);
          }
          const result = await response.json();
          if (result.status === "success") {
            const confirmedIds = new Set(result.confirmedIds || []);
            const remakeIds = new Set(result.remakeIds || []);
            const deletedUidsSet = new Set(result.deletedUids || []);
            const duplicateUpdatesByUid = new Map((result.duplicateUpdates || []).filter(Boolean).map(update => [update.uid, update]));
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
              else if (confirmedIds.has(log.uid)) {
                log.synced = true; log.remake = false; log.syncAttempts = 0;
                const duplicateUpdate = duplicateUpdatesByUid.get(log.uid);
                if (duplicateUpdate) {
                  log.status = duplicateUpdate.status || 'Duplicate';
                  log.duplicateOfUid = duplicateUpdate.duplicateOfUid || '';
                  log.duplicateDeviceCount = Number(duplicateUpdate.duplicateDeviceCount) || 2;
                }
                writeStore.put(log);
              }
              else { log.syncAttempts = (log.syncAttempts || 0) + 1; writeStore.put(log); }
            });

            writeTx.onerror = () => reject(writeTx.error || new Error('Could not update synced logs.'));
            writeTx.onabort = () => reject(writeTx.error || new Error('Background sync update was aborted.'));
            writeTx.oncomplete = async () => {
              try { await syncOperationalStores_(db, syncUrl); } catch (_) { /* queued for next attempt */ }
              for (const client of allClients) {
                client.postMessage({
                  type: 'race-log-sync-complete',
                  summary: result.summary,
                  configMeta: result.configMeta,
                  appRefreshEpoch: result.appRefreshEpoch,
                  dataRevision: result.dataRevision
                });
              }
              resolve();
            };
          } else { reject(new Error(result.message || "Server sync failed")); }
        } catch (err) { reject(err); }
      };
    };
  });
}
