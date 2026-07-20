/**
 * Race Logger service worker.
 *
 * Two jobs:
 *  1. Cache the app shell (this page + manifest) so the app still opens on a bad/no
 *     connection at the start of a shift, before the first successful network fetch.
 *  2. Handle the Background Sync API's 'sync' event, tagged 'race-log-sync', so a
 *     queued log entry still gets flushed to the server soon after connectivity comes
 *     back — even if the browser tab/app isn't open at that moment. (Not supported on
 *     Safari/iOS; the page's own setInterval-based polling remains the fallback there,
 *     unchanged — this is additive, not a replacement.)
 *
 * IMPORTANT: this file must be served from the same directory as index.html (its scope
 * defaults to the directory it's registered from) — e.g. alongside index.html and
 * manifest.json, NOT under a /js/ subfolder, or the 'sync' event and fetch caching won't
 * cover the app shell correctly.
 */

const SHELL_CACHE_NAME = 'race-logger-shell-v2';
const SHELL_ASSETS = ['./', './index.html', './manifest.json', './tailwind.css', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-512-maskable.png'];
const DB_NAME = 'RaceLoggerDB';
const DB_VERSION = 2;
const BATCH_SYNC_TAG = 'race-log-sync';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .catch(() => { /* offline install or asset missing — non-fatal, just no shell cache yet */ })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== SHELL_CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

// Network-first for everything (so the live app + API responses are always preferred),
// falling back to the cached shell only when the network request fails outright — i.e.
// truly offline, not just "server returned an error".
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return; // never intercept POST (sync/API calls)

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Only shell-cache same-origin, successful responses — never cache the Apps
        // Script API responses (they're dynamic and cross-origin).
        if (response && response.ok && new URL(event.request.url).origin === self.location.origin) {
          const clone = response.clone();
          caches.open(SHELL_CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match('./index.html')))
  );
});

self.addEventListener('sync', (event) => {
  if (event.tag === BATCH_SYNC_TAG) {
    event.waitUntil(flushQueuedLogs_());
  }
});

function openDb_() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    // Deliberately no onupgradeneeded here — the page itself owns schema creation.
    // If the SW ever runs before the page has created the DB/stores, these reads will
    // just come back empty, which is safe (no logs to flush yet).
  });
}

function getAll_(db, storeName) {
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(storeName)) { resolve([]); return; }
    const tx = db.transaction([storeName], 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function putAll_(db, storeName, rows) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([storeName], 'readwrite');
    const store = tx.objectStore(storeName);
    rows.forEach((r) => store.put(r));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function fetchWithTimeout_(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, Object.assign({}, options, { signal: controller.signal }))
    .finally(() => clearTimeout(timeoutId));
}

async function flushQueuedLogs_() {
  const db = await openDb_();
  const metaRows = await getAll_(db, 'meta');
  const syncUrl = (metaRows.find((m) => m.key === 'syncUrl') || {}).value;
  if (!syncUrl) return; // page hasn't recorded a syncUrl yet — nothing we can do here

  const logs = await getAll_(db, 'logs');
  const unsynced = logs.filter((l) => !l.synced);
  if (unsynced.length === 0) return;

  const liveSyncUrl = syncUrl + (syncUrl.includes('?') ? '&' : '?') + 'nocache=' + Date.now();
  // 25s cap: a hung fetch here would otherwise hold the browser's background-sync event
  // open indefinitely; failing fast lets the browser's own retry/backoff policy kick in
  // instead of the event silently stalling.
  const res = await fetchWithTimeout_(liveSyncUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'batch_sync', data: unsynced })
  }, 25000);
  const data = await res.json();
  if (data.status !== 'success') throw new Error(data.message || 'Rejected'); // rejecting re-arms retry

  const confirmedIds = new Set(data.confirmedIds || []);
  const remakeIds = new Set(data.remakeIds || []);
  unsynced.forEach((log) => {
    if (remakeIds.has(log.uid)) {
      log.synced = false; log.remake = true; log.syncAttempts = 0;
    } else if (confirmedIds.has(log.uid)) {
      log.synced = true; log.remake = false; log.syncAttempts = 0;
    } else {
      log.syncAttempts = (log.syncAttempts || 0) + 1;
    }
  });
  await putAll_(db, 'logs', unsynced);

  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  clients.forEach((client) => client.postMessage({ type: 'race-log-sync-complete', summary: data.summary || null }));
}
