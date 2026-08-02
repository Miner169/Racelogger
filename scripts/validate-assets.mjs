#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const errors = [];
const required = [
  'index.html', 'tailwind.css', 'manifest.json', 'sw.js', 'Code.gs',
  'app/constants.js', 'app/contracts.js', 'app/state-store.js', 'app/errors.js',
  'app/components.js', 'app/integrity.js', 'app/slippy-map-v1934.js', 'app/main.js', 'app/operations-v19.js',
  'app/director-ops-v192.js', 'app/ux-v1934.js', 'app/ux-v1934.css'
];

function exists(relative) {
  const full = path.join(root, relative.replace(/^\.\//, ''));
  if (!fs.existsSync(full)) errors.push(`Missing required asset: ${relative}`);
  return fs.existsSync(full);
}

required.forEach(exists);

let manifest = null;
try {
  manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
} catch (error) {
  errors.push(`manifest.json is invalid JSON: ${error.message}`);
}

if (manifest) {
  for (const icon of manifest.icons || []) {
    if (!icon.src) errors.push('Manifest icon is missing src.');
    else exists(icon.src);
  }
  if (!manifest.start_url) errors.push('Manifest is missing start_url.');
  else exists(manifest.start_url);
}

try {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const localScripts = [...html.matchAll(/<script\s+src=["']([^"']+)["']/gi)].map((m) => m[1]).filter((src) => !/^https?:/i.test(src));
  const styles = [...html.matchAll(/<link[^>]+href=["']([^"']+)["']/gi)].map((m) => m[1]).filter((src) => !/^https?:/i.test(src) && !src.startsWith('data:'));
  [...localScripts, ...styles].forEach(exists);
} catch (error) {
  errors.push(`Could not inspect index.html: ${error.message}`);
}

try {
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const cacheArray = sw.match(/const ASSETS_TO_CACHE\s*=\s*\[([\s\S]*?)\]\.map/);
  if (!cacheArray) errors.push('Could not locate ASSETS_TO_CACHE in sw.js.');
  else {
    for (const match of cacheArray[1].matchAll(/["'](\.\/[^"']+)["']/g)) exists(match[1]);
  }
  if (!/race-logger-static-v19-3-4/.test(sw)) errors.push('Service-worker static cache is not versioned for v19.3.4.');
} catch (error) {
  errors.push(`Could not inspect sw.js: ${error.message}`);
}

if (errors.length) {
  console.error('DEPLOYMENT ASSET VALIDATION FAILED');
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log('Deployment asset validation passed.');
console.log(`Checked ${required.length} core files, manifest icons, HTML references, and service-worker app-shell assets.`);
