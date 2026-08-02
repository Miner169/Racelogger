#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { TextEncoder } from 'node:util';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const context = { window: {}, TextEncoder, crypto: webcrypto, console };
context.window.window = context.window;
context.window.crypto = webcrypto;
context.window.TextEncoder = TextEncoder;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'app/integrity.js'), 'utf8'), context, { filename: 'integrity.js' });

const integrity = context.window.RaceIntegrity;
assert.ok(integrity, 'RaceIntegrity should be exported.');
assert.equal(integrity.canonicalFields.length, 17);

const a = { uid: 'u2', bib: '22', checkpoint: 'CP2', unknownBib: false, clockOffsetMs: 0 };
const b = { uid: 'u1', bib: '11', checkpoint: 'CP1', unknownBib: true, clockOffsetMs: 125 };
assert.equal(integrity.canonicalBatch([a, b]), integrity.canonicalBatch([b, a]), 'Batch canonicalization must be UID-order independent.');
assert.match(integrity.canonicalRecord(b), /unknownBib=true/);
assert.match(integrity.canonicalRecord(b), /clockOffsetMs=125/);

const one = await integrity.checksumBatch([a, b]);
const two = await integrity.checksumBatch([b, a]);
assert.equal(one.algorithm, 'SHA-256');
assert.equal(one.checksum, two.checksum, 'Equal batches must have equal checksums.');
assert.equal(one.checksum.length, 64);

const changed = await integrity.checksumBatch([a, { ...b, bib: '12' }]);
assert.notEqual(changed.checksum, one.checksum, 'A changed record must change the batch checksum.');
console.log('Integrity unit tests passed.');
