/*
 * @typedef {Object} LogRecord
 * @property {number=} id
 * @property {string} uid
 * @property {string} bib
 * @property {string} time
 * @property {string} checkpoint
 * @property {string} volunteer
 * @property {string} device
 * @property {string=} remark
 * @property {string=} reasonCode Pipe-delimited machine-readable reason codes.
 * @property {string=} reconciliationFlags Comma-delimited reconciliation flags.
 * @property {string=} routeExceptionReason
 * @property {boolean=} unknownBib
 * @property {string=} recordChecksum
 * @property {string=} editedAt
 * @property {string=} editedBy
 * @property {number=} latitude
 * @property {number=} longitude
 * @property {number=} gpsAccuracyM
 * @property {string=} gpsValidationStatus
 * @property {boolean} synced
 *
 * @typedef {Object} Incident
 * @property {string} id
 * @property {string=} bib
 * @property {string} type
 * @property {string} severity
 * @property {string} status
 * @property {string=} checkpoint
 * @property {string=} notes
 * @property {boolean=} synced
 *
 * @typedef {Object} CotAlert
 * @property {string} key
 * @property {string} bib
 * @property {string} level
 * @property {string=} reasonCode
 * @property {number=} occurrenceCount
 * @property {string=} firstSeenAt
 * @property {string=} lastSeenAt
 * @property {boolean=} acknowledged
 * @property {boolean=} synced
 *
 * @typedef {Object} DeviceHealth
 * @property {string} deviceId
 * @property {string} checkpoint
 * @property {string} volunteer
 * @property {number=} batteryPercent
 * @property {number} queueCount
 * @property {number} clockOffsetMs
 * @property {number} clockConfidenceMs
 *
 * @typedef {Object} CheckpointStatus
 * @property {string} checkpoint
 * @property {'Operational'|'Busy'|'Degraded'|'Offline'|'Closing'|'Closed'} status
 * @property {string=} note
 * @property {string=} updatedBy
 * @property {string=} updatedAt
 * @property {boolean=} synced
 *
 * @typedef {Object} SafetyActionCard
 * @property {string=} emergencyProcedures
 * @property {string=} escalationContacts
 * @property {Object<string,string>=} checkpointInstructions
 * @property {string=} updatedAt
 * @property {string=} updatedBy
 *
 * @typedef {Object} QueueSummary
 * @property {number} logs
 * @property {number} incidents
 * @property {number} safetyNotes
 * @property {number} acknowledgements
 * @property {number} checkpointStatuses
 * @property {number} total
 *
 * @typedef {Object} EventConfig
 * @property {string} eventName
 * @property {number=} clockDriftBlockSeconds
 * @property {Array<Object>} categories
 * @property {Object=} safetyActionCard
 *
 * @typedef {Object} ServerResponse
 * @property {'success'|'error'} status
 * @property {string=} message
 * @property {string=} serverTime
 * @property {string=} ackChecksum
 * @property {boolean=} checksumVerified
 * @property {boolean=} recordChecksumsVerified
 */
(function (global) {
  'use strict';
  global.RaceContracts = Object.freeze({ version: 2 });
})(window);

/**
 * @typedef {Object} CommandOp
 * @property {string} id
 * @property {'missing_runner'|'medical_resource'|'transport_resource'|'checkpoint_supply'} type
 * @property {string} name
 * @property {string} bib
 * @property {string} checkpoint
 * @property {string} status
 * @property {string} owner
 * @property {Object<string, string|number|boolean>} details
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {string} updatedBy
 * @property {string} deviceId
 * @property {?number} latitude
 * @property {?number} longitude
 * @property {boolean} synced
 */

/**
 * @typedef {Object} WeatherRisk
 * @property {string} source
 * @property {string} observedAt
 * @property {?number} temperatureC
 * @property {?number} rainMmPerHour
 * @property {?number} windKph
 * @property {?number} lightningDistanceKm
 * @property {string} alert
 * @property {'normal'|'warning'|'critical'} level
 * @property {Array<{code:string,level:string,message:string}>} risks
 */
