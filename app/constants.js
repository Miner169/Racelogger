/* Race Bib Logger v19 constants. Classic script namespace for broad PWA support. */
(function (global) {
  'use strict';
  global.RaceConfig = Object.freeze({
    appVersion: '19.2.0',
    dbName: 'RaceLoggerDB',
    queueBatchSize: 50,
    operationalBatchSize: 25,
    retryBaseMs: 2500,
    retryMaxMs: 60000,
    retryJitterRatio: 0.25,
    defaultClockDriftBlockSeconds: 60,
    clockDriftMinimumSamples: 2,
    clockDriftMaximumConfidenceMs: 5000,
    reconciliationRefreshMs: 45000,
    recoveryReportKey: 'raceRecoveryReport_v19',
    safetyCardStorageKey: 'offlineSafetyActionCard_v19',
    serverReconciliationKey: 'serverReconciliationSnapshot_v19',
    commandOpsStorageKey: 'raceCommandOps_v19_2',
    weatherRiskRefreshMs: 60000,
    reasonCodes: Object.freeze({
      duplicate: Object.freeze([
        ['DUPLICATE_SECOND_PASSAGE', 'Legitimate second passage'],
        ['DUPLICATE_RESCAN_CORRECTION', 'Rescan after correction'],
        ['DUPLICATE_SUPERVISOR_OVERRIDE', 'Supervisor override'],
        ['DUPLICATE_OTHER', 'Other duplicate reason']
      ]),
      unknown: Object.freeze([
        ['UNKNOWN_LATE_REGISTRATION', 'Late registration'],
        ['UNKNOWN_REPLACEMENT_BIB', 'Replacement BIB'],
        ['UNKNOWN_MANUAL_ASSIGNMENT', 'Manual assignment'],
        ['UNKNOWN_OTHER', 'Other unknown-runner reason']
      ]),
      route: Object.freeze([
        ['ROUTE_MARSHAL_INSTRUCTION', 'Course marshal instruction'],
        ['ROUTE_RELAY', 'Relay transition'],
        ['ROUTE_EMERGENCY_DIVERSION', 'Emergency diversion'],
        ['ROUTE_MISSED_SCAN_CONFIRMED', 'Missed checkpoint scan confirmed'],
        ['ROUTE_COURSE_REROUTE', 'Course reroute'],
        ['ROUTE_OTHER', 'Other route exception']
      ])
    }),
    errorCodes: Object.freeze({
      SYNC_TIMEOUT: 'SYNC_TIMEOUT',
      SYNC_CHECKSUM_MISMATCH: 'SYNC_CHECKSUM_MISMATCH',
      GPS_DENIED: 'GPS_DENIED',
      GPS_UNAVAILABLE: 'GPS_UNAVAILABLE',
      DB_QUOTA: 'DB_QUOTA',
      DB_READ_FAILED: 'DB_READ_FAILED',
      DB_WRITE_FAILED: 'DB_WRITE_FAILED',
      CONFIG_STALE: 'CONFIG_STALE',
      CLOCK_DRIFT_BLOCKED: 'CLOCK_DRIFT_BLOCKED',
      SERVER_COUNT_MISMATCH: 'SERVER_COUNT_MISMATCH',
      NETWORK_UNAVAILABLE: 'NETWORK_UNAVAILABLE',
      UNKNOWN: 'UNKNOWN'
    })
  });
})(window);
