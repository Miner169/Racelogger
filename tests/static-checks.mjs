#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const html = read('index.html');
const main = read('app/main.js');
const ops = read('app/operations-v19.js');
const command = read('app/director-ops-v192.js');
const ux = read('app/ux-v1934.js');
const uxCss = read('app/ux-v1934.css');
const slippy = read('app/slippy-map-v1934.js');
const backend = read('Code.gs');
const sw = read('sw.js');

assert.match(backend, /const APP_VERSION = "19\.3\.4"/);
assert.match(backend, /const DATA_COLUMN_COUNT = 29/);
assert.match(backend, /"Reason Code".*"Reconciliation Flags".*"Record Checksum"/s);
assert.match(backend, /action === "reconciliation_count"/);
assert.match(backend, /action === "operational_batch"/);
assert.match(backend, /checksumVerified: checksumResult\.verified === true/);
assert.match(backend, /recordChecksumsVerified: checksumResult\.recordsVerified === true/);
assert.match(backend, /function getSafetyActionCard_\(/);
assert.match(backend, /function upsertCheckpointStatus_\(/);
assert.doesNotMatch(backend, /getRange\(2, ORIGINAL_DEVICE_TIME_COL,[^\n]+clearContent/, 'Migration must not erase existing S:V audit fields.');

for (const id of [
  'v19DecisionModal', 'clockDriftBlocker', 'reconciliationView', 'recoveryWizard',
  'offlineSafetyActionCard', 'directorCheckpointHealthBody', 'directorMapBody',
  'safetyBibHeader', 'safetyLastSeenHeader', 'minimalBibRepeatHint',
  'minimalNativeBibInput', 'minimalKeyboardLogButton', 'minimalSpaceFeedback', 'bibSpaceFeedback'
]) assert.match(html, new RegExp(`id=["']${id}["']`), `Missing UI element #${id}`);

for (const file of ['constants', 'contracts', 'state-store', 'errors', 'components', 'integrity', 'slippy-map-v1934', 'main', 'operations-v19', 'director-ops-v192', 'ux-v1934']) {
  assert.match(html, new RegExp(`app/${file}\\.js`), `Missing module script ${file}.js`);
}
assert.match(html, /app\/ux-v1934\.css/);
assert.ok(html.split('\n').length < 5000, 'index.html should remain presentation-first.');
assert.ok(main.split('\n').length > 10000, 'Existing application runtime should be preserved in app/main.js.');

assert.match(main, /function renderDirectorGpsMap_\(/);
assert.match(main, /function setSafetySort_\(/);
assert.match(main, /addCombo\('', 'Uncategorized', 'system'\)/);
assert.match(main, /resolveDirectorDistanceCategory_/);
assert.match(main, /scheduleMinimalBibRepeatedLookup_/);
assert.doesNotMatch(main, /director-post-race-report-body|director-handover-body/);
assert.match(main, /openMinimalNativeKeyboard_/);
assert.match(main, /minimalBibKeyboardPage_ = 'numbers'/);
assert.match(main, /showBibSpaceBlockedFeedback_/);
assert.match(main, /incoming\.replace\(\/\\s\+\/g, ''\)/);
assert.match(main, /last4-repeat-\$\{colourBucket\}/);
assert.doesNotMatch(html, /id="minimalTabSymbols"/);
assert.match(html, /id="minimalTabNumbers"/);
assert.match(html, /id="minimalTabLetters"/);
assert.doesNotMatch(html, /id="eventConfigStrip"/);

assert.match(ops, /kind: 'duplicate'/);
assert.match(ops, /title: 'Duplicate BIB'/);
assert.match(ops, /DUPLICATE_CONFIRMED/);
assert.doesNotMatch(ops, /title: 'Runner not found'/);
assert.match(ops, /UNKNOWN_NOT_IN_SETUP/);
assert.match(ops, /Checkpoint sequence exception/);
assert.match(ops, /Race-Day Recovery Wizard|runAllRecoveryChecks_/);
assert.match(ops, /operational_batch/);

for (const feature of [
  'Checkpoint Load Heatmap', 'COT Risk Funnel', 'Route Anomaly Diagram',
  'Finish Projection', 'DNS / DNF / Withdrawal / Medical'
]) assert.match(command, new RegExp(feature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
for (const removedFeature of [
  'Missing Runner Workflow', 'Medical Capacity Board', 'Sweep & Transport Tracking',
  'Weather Risk', 'Checkpoint Supply Status', 'Shift Handover', 'Post-Race Command Report'
]) assert.doesNotMatch(command.match(/const WIDGETS = \[[\s\S]*?\n  \];/)?.[0] || '', new RegExp(removedFeature));
assert.doesNotMatch(command, /renderHandover_|renderPostRaceReport_|downloadV192Report_/);

assert.match(main, /window\.RaceSlippyMap/);
assert.match(main, /directorOpenMapCanvas/);
assert.match(main, /serverOperationsSummary_\?\.devices/);
assert.doesNotMatch(main, /maps\.googleapis\.com|google\.maps|GOOGLE_MAPS_BROWSER_API_KEY/);
assert.match(backend, /provider: 'openstreetmap'/);
assert.doesNotMatch(backend, /getProperty\('GOOGLE_MAPS_BROWSER_API_KEY'\)/);
assert.doesNotMatch(html, /googleMapsApiKeyInput|googleMapsMapIdInput|googleMapsSettingsState/);
assert.match(slippy, /tile\.openstreetmap\.org/);
assert.match(slippy, /fitBounds\(/);
assert.match(slippy, /_wheel\(/);
assert.match(slippy, /pointerdown/);
assert.match(slippy, /OpenStreetMap contributors/);
assert.match(main, /submitMinimalBibFromKeyboard_/);
assert.match(uxCss, /minimal-inline-log-btn/);

assert.match(sw, /app\/operations-v19\.js/);
assert.match(sw, /app\/director-ops-v192\.js/);
assert.match(sw, /app\/slippy-map-v1934\.js/);
assert.match(sw, /app\/ux-v1934\.js/);
assert.match(sw, /app\/ux-v1934\.css/);
assert.match(sw, /race-logger-static-v19-3-4/);
assert.match(sw, /tile\.openstreetmap\.org/);
assert.match(ux, /showDirectorToolbarHint/);
assert.match(ux, /requestMinimalWakeLock/);
assert.doesNotMatch(ux, /buildDirectorSectionNav|scrollIntoView/, 'Director UX must not auto-scroll the command view.');
assert.match(ux, /installMapFullscreen/);
assert.match(uxCss, /#v19DecisionModal\[data-kind="duplicate"\]/);
assert.match(uxCss, /minimal-last4-card\[class\*="last4-repeat-"\] strong/);
assert.match(uxCss, /scan-history-limit-strip/);
assert.match(uxCss, /bib-input-shell:focus-within\.tools-visible/);
assert.match(html, /class="safety-log-topbar"/);
assert.match(html, /id="directorBackToTop"/);
assert.match(sw, /attachRecordChecksums_\(unsynced\)/);
assert.match(sw, /checksumBatch_\(unsynced\)/);
assert.match(sw, /operational_batch/);
console.log('Static integration checks passed.');
