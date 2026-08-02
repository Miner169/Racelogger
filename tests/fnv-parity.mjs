#!/usr/bin/env node
import assert from 'node:assert/strict';

function fnvPair(text) {
  let high = 0xcbf29ce4;
  let low = 0x84222325;
  const bytes = new TextEncoder().encode(String(text || ''));
  for (const byte of bytes) {
    low = (low ^ byte) >>> 0;
    const lowProduct = low * 0x1b3;
    const nextLow = lowProduct >>> 0;
    const carry = Math.floor(lowProduct / 0x100000000);
    high = (high * 0x1b3 + carry + ((low * 0x100) >>> 0)) >>> 0;
    low = nextLow;
  }
  return high.toString(16).padStart(8, '0') + low.toString(16).padStart(8, '0');
}

function fnvBigInt(text) {
  let hash = BigInt('14695981039346656037');
  const prime = BigInt('1099511628211');
  const mask = BigInt('0xffffffffffffffff');
  for (const byte of new TextEncoder().encode(String(text || ''))) {
    hash ^= BigInt(byte);
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}

for (const value of ['', 'hello', 'BIB-123\ncheckpoint=CP1', '😀 UTF-8']) {
  assert.equal(fnvPair(value), fnvBigInt(value), `FNV-1a parity failed for ${JSON.stringify(value)}`);
}
console.log('FNV-1a 64-bit fallback parity passed.');
