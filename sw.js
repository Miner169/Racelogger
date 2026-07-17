const CACHE_NAME = 'race-logger-v2';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json'
];

// Install and Cache Local Assets
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});

// Activate & Claim immediately
self.addEventListener('activate', e => {
  e.waitUntil(self.clients.claim());
});

// SAFE FETCH: Only intercept local GET requests (HTML, JS, CSS). 
// Completely bypasses Google Apps Script POST requests.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) {
    return; // Let the browser handle network POST/API requests natively
  }
  e.respondWith(
    caches.match(e.request).then(response => response || fetch(e.request))
  );
});

// BACKGROUND SYNC EVENT
self.addEventListener('sync', event => {
  if (event.tag === 'sync-logs') {
    event.waitUntil(backgroundSyncLogs());
  }
});

async function backgroundSyncLogs() {
  return new Promise((resolve, reject) => {
    const dbReq = indexedDB.open("RaceLoggerDB", 1);
    dbReq.onerror = () => reject();
    dbReq.onsuccess = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("logs")) return resolve();
      
      const tx = db.transaction(["logs"], "readwrite");
      const store = tx.objectStore("logs");
      const getAllReq = store.getAll();

      getAllReq.onsuccess = () => {
        const logs = getAllReq.result;
        const unsynced = logs.filter(log => !log.synced);
        if (unsynced.length === 0) return resolve();

        const syncUrl = localStorage.getItem("syncUrl");
        if (!syncUrl) return resolve();
        
        fetch(syncUrl, {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: JSON.stringify({ action: "batch_sync", data: unsynced })
        })
        .then(res => res.json())
        .then(res => {
          if (res.status === "success") {
            const writeTx = db.transaction(["logs"], "readwrite");
            const writeStore = writeTx.objectStore("logs");
            unsynced.forEach(row => {
              row.synced = true;
              writeStore.put(row);
            });
            writeTx.oncomplete = () => resolve();
          } else {
            reject();
          }
        })
        .catch(() => reject());
      };
    };
  });
}