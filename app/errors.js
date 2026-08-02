/* Formal error catalogue and supervisor-safe diagnostics. */
(function (global) {
  'use strict';
  const C = global.RaceConfig.errorCodes;
  const catalogue = Object.freeze({
    [C.SYNC_TIMEOUT]: ['The server did not respond in time.', 'Check connectivity; the record remains queued.'],
    [C.SYNC_CHECKSUM_MISMATCH]: ['The server could not verify the sync payload.', 'No unverified records were accepted. Retry or open Reconciliation.'],
    [C.GPS_DENIED]: ['Location permission is blocked.', 'Allow location access or record the approved override reason.'],
    [C.GPS_UNAVAILABLE]: ['A usable GPS reading is not available.', 'Move outdoors or use the checkpoint override workflow.'],
    [C.DB_QUOTA]: ['Local storage is full.', 'Export a backup and clear only after confirming sync.'],
    [C.DB_READ_FAILED]: ['Local records could not be read.', 'Restart the PWA and use the recovery wizard.'],
    [C.DB_WRITE_FAILED]: ['The entry could not be saved locally.', 'Do not assume it was recorded; retry after recovery checks.'],
    [C.CONFIG_STALE]: ['The event configuration is stale.', 'Refresh the Setup configuration before continuing.'],
    [C.CLOCK_DRIFT_BLOCKED]: ['This device clock differs too much from server time.', 'Correct the device clock and retest the connection.'],
    [C.SERVER_COUNT_MISMATCH]: ['Local and server-confirmed record counts differ.', 'Open Reconciliation and inspect unsynced or rejected records.'],
    [C.NETWORK_UNAVAILABLE]: ['The device is offline.', 'Operational records stay queued and will retry automatically.'],
    [C.UNKNOWN]: ['An unexpected error occurred.', 'Open diagnostics and note the error code for a supervisor.']
  });

  function normalize(error, fallbackCode) {
    const code = error && error.code && catalogue[error.code] ? error.code : (fallbackCode || C.UNKNOWN);
    const entry = catalogue[code] || catalogue[C.UNKNOWN];
    return {
      code: code,
      message: (error && error.message) || entry[0],
      userMessage: entry[0],
      recovery: entry[1],
      details: error && (error.stack || String(error)) || '',
      at: new Date().toISOString()
    };
  }

  function appendDiagnostic(normalized) {
    try {
      const key = 'raceErrorDiagnostics_v19';
      const list = JSON.parse(global.localStorage.getItem(key) || '[]');
      list.push(normalized);
      global.localStorage.setItem(key, JSON.stringify(list.slice(-50)));
    } catch (_) {}
  }

  function report(error, fallbackCode) {
    const normalized = normalize(error, fallbackCode);
    if (global.RaceState && typeof global.RaceState.setState === 'function') {
      global.RaceState.setState({ lastError: normalized });
    }
    appendDiagnostic(normalized);
    console.error('Race error', normalized.code, normalized.details || normalized.message);
    return normalized;
  }

  // Top-level runtime boundary: keep a bounded supervisor diagnostic trail while
  // allowing feature-level handlers to show the context-specific recovery UI.
  global.addEventListener('error', function (event) {
    const error = event && (event.error || new Error(event.message || 'Unhandled window error'));
    report(error, C.UNKNOWN);
  });
  global.addEventListener('unhandledrejection', function (event) {
    const reason = event && event.reason;
    report(reason instanceof Error ? reason : new Error(String(reason || 'Unhandled promise rejection')), C.UNKNOWN);
  });

  global.RaceErrors = Object.freeze({ catalogue: catalogue, normalize: normalize, report: report });
})(window);
