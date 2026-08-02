/* Deterministic client-side integrity checks used by batch synchronization. */
(function (global) {
  'use strict';

  const canonicalFields = Object.freeze([
    'uid', 'bib', 'time', 'checkpoint', 'volunteer', 'device', 'creatorId', 'status',
    'reasonCode', 'reconciliationFlags', 'routeExceptionReason', 'unknownBib',
    'originalDeviceTime', 'clockOffsetMs', 'clockConfidenceMs', 'editedAt', 'editedBy'
  ]);

  function normalizeValue(value) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
    return String(value).replace(/\r\n/g, '\n').trim();
  }

  function canonicalRecord(record) {
    return canonicalFields.map(function (field) {
      return field + '=' + normalizeValue(record && record[field]);
    }).join('\u001f');
  }

  function canonicalBatch(records) {
    return (records || []).slice().sort(function (a, b) {
      const left = String(a && a.uid || '');
      const right = String(b && b.uid || '');
      return left < right ? -1 : (left > right ? 1 : 0);
    }).map(canonicalRecord).join('\n');
  }

  function bytesToHex(bytes) {
    return Array.from(bytes).map(function (byte) { return byte.toString(16).padStart(2, '0'); }).join('');
  }

  function fnv1a64(text) {
    let hash = BigInt('14695981039346656037');
    const prime = BigInt('1099511628211');
    const mask = BigInt('0xffffffffffffffff');
    const bytes = new TextEncoder().encode(String(text || ''));
    for (const byte of bytes) {
      hash ^= BigInt(byte);
      hash = (hash * prime) & mask;
    }
    return hash.toString(16).padStart(16, '0');
  }

  async function digestText(text) {
    if (global.crypto && global.crypto.subtle && global.TextEncoder) {
      const digest = await global.crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text || '')));
      return { algorithm: 'SHA-256', checksum: bytesToHex(new Uint8Array(digest)) };
    }
    return { algorithm: 'FNV1A-64', checksum: fnv1a64(text) };
  }

  async function checksumRecord(record) {
    return digestText(canonicalRecord(record));
  }

  async function checksumBatch(records) {
    return digestText(canonicalBatch(records));
  }

  global.RaceIntegrity = Object.freeze({
    canonicalFields: canonicalFields,
    canonicalRecord: canonicalRecord,
    canonicalBatch: canonicalBatch,
    digestText: digestText,
    checksumRecord: checksumRecord,
    checksumBatch: checksumBatch,
    fnv1a64: fnv1a64
  });
})(window);
