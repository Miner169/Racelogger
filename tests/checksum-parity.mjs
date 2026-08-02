#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { TextEncoder } from 'node:util';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'tests/checksum-fixture.json'), 'utf8'));
const fields = [
  'uid', 'bib', 'time', 'checkpoint', 'volunteer', 'device', 'creatorId', 'status',
  'reasonCode', 'reconciliationFlags', 'routeExceptionReason', 'unknownBib',
  'originalDeviceTime', 'clockOffsetMs', 'clockConfidenceMs', 'editedAt', 'editedBy'
];
const normalize = (value) => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  return String(value).replace(/\r\n/g, '\n').trim();
};
const serverCanonical = fixture.slice().sort((a, b) => String(a.uid || '').localeCompare(String(b.uid || '')))
  .map((record) => fields.map((field) => `${field}=${normalize(record[field])}`).join('\u001f')).join('\n');
const serverDigest = crypto.createHash('sha256').update(serverCanonical, 'utf8').digest('hex');

const context = { window: {}, TextEncoder, crypto: webcrypto, console };
context.window.window = context.window;
context.window.crypto = webcrypto;
context.window.TextEncoder = TextEncoder;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'app/integrity.js'), 'utf8'), context);
const clientDigest = await context.window.RaceIntegrity.checksumBatch(fixture);
assert.equal(clientDigest.algorithm, 'SHA-256');
assert.equal(clientDigest.checksum, serverDigest, 'Client and backend canonical SHA-256 rules must match.');
console.log(`Checksum parity passed: ${serverDigest}`);
