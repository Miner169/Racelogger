// Race Bib Logger v18.0.6 responsive Director Mode, device-local recent entries and letters-only BIB revision.
// Keeps the existing IndexedDB/background-sync logic below unchanged while making
// app-shell caching safe for subdirectory deployments and shared web origins.
const CACHE_PREFIX = 'race-logger-';
const STATIC_CACHE = 'race-logger-static-v18-0-6-r1';
const RUNTIME_CACHE = 'race-logger-runtime-v18-0-6-r1';
const NETWORK_TIMEOUT_MS = 4500;
const MAX_RUNTIME_ENTRIES = 80;

// Resolve every app-shell asset from the service worker's actual scope. This works
// whether the PWA is deployed at the origin root or under a path such as /race-log/.
const SCOPE_URL = new URL(self.registration.scope);
const APP_SHELL_URL = new URL('./index.html', SCOPE_URL).href;
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './tailwind.css',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png'
].map((path) => new URL(path, SCOPE_URL).href);
const SHELL_URLS = new Set(ASSETS_TO_CACHE);

function isShellRequest_(request) {
  if (request.mode === 'navigate') return true;
  return SHELL_URLS.has(new URL(request.url).href);
}

function fetchWithTimeout_(request, timeoutMs = NETWORK_TIMEOUT_MS) {
  if (typeof AbortController === 'undefined') return fetch(request);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(request, { signal: controller.signal })
    .finally(() => clearTimeout(timeoutId));
}

async function trimRuntimeCache_() {
  const cache = await caches.open(RUNTIME_CACHE);
  const keys = await cache.keys();
  const overflow = keys.length - MAX_RUNTIME_ENTRIES;
  if (overflow <= 0) return;
  await Promise.all(keys.slice(0, overflow).map((request) => cache.delete(request)));
}

function canRuntimeCache_(request, response) {
  if (!response) return false;
  if (!(response.ok || response.type === 'opaque')) return false;
  const url = new URL(request.url);
  // Never cache Apps Script/API traffic or non-HTTP(S) requests.
  if (!/^https?:$/.test(url.protocol)) return false;
  if (url.hostname === 'script.google.com' || url.hostname.endsWith('.googleusercontent.com')) return false;
  return true;
}

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('install', (event) => {
  // Preserve the app's existing immediate-update behaviour. Pending race records live
  // in IndexedDB, not in the app-shell cache, so replacing the shell does not erase them.
  self.skipWaiting();
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    await Promise.all(ASSETS_TO_CACHE.map(async (url) => {
      try {
        await cache.add(new Request(url, { cache: 'reload' }));
      } catch (error) {
        // One missing optional asset must not prevent the worker from installing.
        console.warn('SW: failed to precache', url, error);
      }
    }));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const currentCaches = new Set([STATIC_CACHE, RUNTIME_CACHE]);
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        .filter((name) => name.startsWith(CACHE_PREFIX) && !currentCaches.has(name))
        .map((name) => caches.delete(name))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const requestUrl = new URL(request.url);
  if (requestUrl.hostname === 'script.google.com') return;

  // App shell: network first with a short timeout, then static-cache fallback.
  if (isShellRequest_(request)) {
    event.respondWith((async () => {
      try {
        const response = await fetchWithTimeout_(request);
        if (response && response.ok && response.type === 'basic') {
          const cacheWrite = caches.open(STATIC_CACHE)
            .then((cache) => cache.put(request, response.clone()))
            .catch((error) => console.warn('SW: shell cache write failed', error));
          event.waitUntil(cacheWrite);
        }
        return response;
      } catch (_) {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === 'navigate') {
          const fallback = await caches.match(APP_SHELL_URL);
          if (fallback) return fallback;
        }
        return new Response('Offline and the Race Logger app shell is not cached yet.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      }
    })());
    return;
  }

  // Runtime resources: cache first, then network. Keep this separate from the shell
  // so a cache rotation cannot accidentally strand the main application offline.
  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;

    try {
      const response = await fetch(request);
      if (canRuntimeCache_(request, response)) {
        const cacheWrite = caches.open(RUNTIME_CACHE)
          .then((cache) => cache.put(request, response.clone()))
          .then(() => trimRuntimeCache_())
          .catch((error) => console.warn('SW: runtime cache write failed', error));
        event.waitUntil(cacheWrite);
      }
      return response;
    } catch (_) {
      return new Response('', { status: 504, statusText: 'Offline' });
    }
  })());
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
    const request = indexedDB.open("RaceLoggerDB", 7);
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
        ["byBibKey", "bibKey"],
        ["byBibNumberKey", "bibNumberKey"],
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
        let changed = false;
        if (!Number.isFinite(Number(log.clientTimeMs))) {
          log.clientTimeMs = parseClientTimeMs_(log.time);
          changed = true;
        }
        const originalBib = String(log.bib || log.bibKey || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        const bibNumber = String(log.bibNumber || originalBib).replace(/[^0-9]/g, '');
        const bibNumberKey = bibNumber ? (bibNumber.replace(/^0+(?=\d)/, '') || '0') : '';
        const bibKey = originalBib;
        if (log.bib !== originalBib) { log.bib = originalBib; changed = true; }
        if (log.bibNumber !== bibNumber) { log.bibNumber = bibNumber; changed = true; }
        if (log.bibNumberKey !== bibNumberKey) { log.bibNumberKey = bibNumberKey; changed = true; }
        if (log.bibKey !== bibKey) { log.bibKey = bibKey; changed = true; }
        if (!log.category) { log.category = 'Uncategorized'; changed = true; }
        if (changed) cursor.update(log);
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
            const locationUpdatesByUid = new Map((result.locationUpdates || []).filter(Boolean).map(update => [update.uid, update]));
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
                const locationUpdate = locationUpdatesByUid.get(log.uid);
                if (locationUpdate) {
                  log.status = locationUpdate.status || 'Location Spam';
                  log.gpsValidationStatus = locationUpdate.gpsValidationStatus || 'spam';
                  log.gpsNearestCheckpoint = locationUpdate.nearestCheckpoint || log.gpsNearestCheckpoint || '';
                  log.gpsDistanceToNearestM = Number(locationUpdate.distanceM) || log.gpsDistanceToNearestM || null;
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
                  checkpointGps: result.checkpointGps,
                  locationUpdates: result.locationUpdates,
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
