#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const html = read('index.html');
const main = read('app/main.js');
const map = read('app/slippy-map-v1936.js');
const css = read('app/ux-v1936.css');
const backend = read('Code.gs');
const sw = read('sw.js');
const operations = read('app/operations-v19.js');
const directorOps = read('app/director-ops-v192.js');

assert.match(backend, /const APP_VERSION = "19\.3\.6"/);
assert.match(main, /const APP_VERSION = "19\.3\.6"/);
assert.match(backend, /const DATA_COLUMN_COUNT = 29/);
assert.match(backend, /action === "reconciliation_count"/);
assert.match(backend, /action === "operational_batch"/);
assert.match(backend, /checksumVerified: checksumResult\.verified === true/);

for (const id of [
  'minimalNativeBibInput', 'minimalKeyboardLogButton', 'minimalTabLetters',
  'safetyTableViewport', 'safetyLogBody', 'directorModeView', 'directorMapBody'
]) assert.match(html, new RegExp(`id=["']${id}["']`), `Missing UI element #${id}`);

for (const file of [
  'constants', 'contracts', 'state-store', 'errors', 'components', 'integrity',
  'slippy-map-v1936', 'main', 'operations-v19', 'director-ops-v192', 'ux-v1936'
]) assert.match(html, new RegExp(`app/${file}\\.js(?:\\?v=19\\.3\\.6)?`), `Missing module script ${file}.js`);

assert.ok(html.split('\n').length < 5200, 'index.html should remain presentation-first.');
assert.ok(main.split('\n').length > 10000, 'Existing application runtime should be preserved.');

// iPhone Quick Entry behavior.
assert.match(html, /ontouchstart="submitMinimalBibFromKeyboard_\(event\)"/);
assert.match(html, /onmousedown="submitMinimalBibFromKeyboard_\(event\)"/);
assert.match(html, /onclick="submitMinimalBibFromKeyboard_\(event\)"/);
assert.match(main, /function submitMinimalBibFromKeyboard_\(event\)/);
assert.match(main, /minimalReopenKeyboardAfterSubmit_/);
assert.match(main, /try \{ nativeBib\.focus\(\{ preventScroll: true \}\); \}/);
assert.doesNotMatch(main, /setTimeout\(\(\) => nativeBib\.focus\(\{ preventScroll: true \}\), 30\)/);


// Unknown runners use a compact, reason-free thumb confirmation.
assert.match(operations, /variant: 'compact'/);
assert.match(operations, /confirmLabel: 'Log BIB'/);
assert.match(operations, /reasonCodes\.push\('UNKNOWN_NOT_IN_SETUP'\)/);
assert.doesNotMatch(operations, /title: 'Runner not found'[\s\S]{0,420}reasons:/);
assert.match(css, /v19-decision-card-compact/);

// Tapping the remark opens the native keyboard directly from 123 mode.
assert.match(html, /onclick="activateMinimalRemarkKeyboard_\(\)"/);
assert.match(main, /function activateMinimalRemarkKeyboard_\(\)/);
assert.match(main, /activateMinimalEntryTarget_\('remark'\);[\s\S]{0,100}openMinimalNativeKeyboard_\(\);/);

// Retired Director workflows are removed from the injected widget set.
const widgetBlock = directorOps.match(/const WIDGETS = \[[\s\S]*?\n  \];/)?.[0] || '';
const renderAllBlock = directorOps.match(/function renderAll_\(logs\) \{[\s\S]*?\n  \}/)?.[0] || '';
for (const id of ['missing-runners','medical-capacity','transport-sweep','weather-risk','supplies','handover','post-race-report']) {
  assert.match(directorOps, new RegExp(`REMOVED_WIDGET_IDS[\\s\\S]*['"]${id}['"]`));
  assert.doesNotMatch(widgetBlock, new RegExp(`['"]${id}['"]`));
}
assert.doesNotMatch(renderAllBlock, /renderMissingRunners_|renderResourceBoard_|renderWeather_|renderHandover_|renderPostRaceReport_/);

// Safety roster must not create an empty virtual spacer for normal race sizes.
assert.match(main, /const SAFETY_VIRTUAL_THRESHOLD_ = 600/);
assert.match(main, /if \(total <= SAFETY_VIRTUAL_THRESHOLD_\)/);
assert.match(main, /const topSpacer = topHeight > 0/);
assert.match(css, /tr\.virtual-spacer-row/);

// API-key-free interactive map and inferred CP markers.
assert.match(map, /https:\/\/tile\.openstreetmap\.org\/\{z\}\/\{x\}\/\{y\}\.png/);
assert.match(main, /new window\.RaceSlippyMap/);
assert.match(main, /Inferred CP position/);
assert.match(main, /function updateGoogleMapsSettingsState_\(\) \{\}/);
assert.doesNotMatch(html + main, /GOOGLE_MAPS_BROWSER_API_KEY/);
assert.doesNotMatch(html + main, /Google Maps deployment configuration required/);

// Full mobile command title and cache busting.
assert.match(css, /\.director-mode-title \{[\s\S]*max-width: none !important/);
assert.match(sw, /race-logger-static-v19-3-6-r1/);
assert.match(sw, /slippy-map-v1936\.js\?v=19\.3\.6/);
assert.match(sw, /tile\.openstreetmap\.org/);
assert.match(main, /register\('sw\.js\?v=19\.3\.6', \{ updateViaCache: 'none' \}\)/);

console.log('Static integration checks passed.');
