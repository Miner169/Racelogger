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
const ux = read('app/ux-v193.js');
const backend = read('Code.gs');
const sw = read('sw.js');

assert.match(backend, /const APP_VERSION = "19\.3\.0"/);
assert.match(backend, /const DATA_COLUMN_COUNT = 29/);
assert.match(backend, /"Reason Code".*"Reconciliation Flags".*"Record Checksum"/s);
assert.match(backend, /const COMMAND_OPS_SHEET_NAME = "CommandOps"/);
assert.match(backend, /const WEATHER_RISK_SHEET_NAME = "WeatherRisk"/);
assert.match(backend, /function getCommandOpsRecords_\(/);
assert.match(backend, /function upsertCommandOp_\(/);
assert.match(backend, /function getWeatherRisk_\(/);
assert.match(backend, /action === "command_ops"/);
assert.match(backend, /action === "command_op_upsert"/);
assert.match(backend, /EVENT_EPOCH_MISMATCH/);
assert.match(backend, /eventEpoch: eventEpoch/);
assert.match(backend, /action === "reconciliation_count"/);
assert.match(backend, /action === "operational_batch"/);
assert.match(backend, /checksumVerified: checksumResult\.verified === true/);
assert.match(backend, /recordChecksumsVerified: checksumResult\.recordsVerified === true/);
assert.match(backend, /function getSafetyActionCard_\(/);
assert.match(backend, /function upsertCheckpointStatus_\(/);
assert.match(backend, /"Resolved At", "Resolution"/);
assert.doesNotMatch(backend, /getRange\(2, ORIGINAL_DEVICE_TIME_COL,[^\n]+clearContent/, 'v19 migration must not erase existing S:V audit fields.');

for (const id of ['v19DecisionModal', 'clockDriftBlocker', 'reconciliationView', 'recoveryWizard', 'offlineSafetyActionCard', 'directorCheckpointHealthBody', 'directorMapBody', 'safetyBibHeader', 'safetyLastSeenHeader', 'minimalBibRepeatHint']) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `Missing UI element #${id}`);
}
for (const file of ['constants', 'contracts', 'state-store', 'errors', 'components', 'integrity', 'main', 'operations-v19', 'director-ops-v192', 'ux-v193']) {
  assert.match(html, new RegExp(`app/${file}\\.js`), `Missing module script ${file}.js`);
}
assert.ok(html.split('\n').length < 5000, 'index.html should remain presentation-first after module extraction.');
assert.ok(main.split('\n').length > 10000, 'Existing application runtime should be preserved in app/main.js.');
assert.match(main, /function renderDirectorGpsMap_\(/);
assert.match(main, /function setSafetySort_\(/);
assert.match(main, /addCombo\('', 'Uncategorized', 'system'\)/);
assert.match(main, /resolveDirectorDistanceCategory_/);
assert.match(main, /scheduleMinimalBibRepeatedLookup_/);
assert.match(main, /'post-race-report': 'director-post-race-report-body'/);
assert.match(html, /director-icon-action/);
assert.match(html, /tbody td:first-child:not\(\.virtual-spacer-cell\)/);
assert.match(ops, /Duplicate passage warning/);
assert.doesNotMatch(ops, /title: 'Runner not found'/);
assert.match(ops, /UNKNOWN_NOT_IN_SETUP/);
assert.match(ops, /Checkpoint sequence exception/);
assert.match(ops, /Race-Day Recovery Wizard|runAllRecoveryChecks_/);
assert.match(ops, /operational_batch/);
assert.match(ops, /checksum acknowledgement did not match/i);

for (const feature of [
  'Checkpoint Load Heatmap', 'COT Risk Funnel', 'Route Anomaly Diagram',
  'Finish Projection', 'DNS / DNF / Withdrawal / Medical', 'Shift Handover',
  'Post-Race Command Report'
]) assert.match(command, new RegExp(feature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
for (const removedFeature of [
  'Missing Runner Workflow', 'Medical Capacity Board', 'Sweep & Transport Tracking',
  'Weather Risk', 'Checkpoint Supply Status'
]) assert.doesNotMatch(command.match(/const WIDGETS = \[[\s\S]*?\n  \];/)?.[0] || '', new RegExp(removedFeature));
assert.match(main, /maps\.googleapis\.com\/maps\/api\/js/);
assert.match(main, /gestureHandling: 'greedy'/);
assert.match(backend, /GOOGLE_MAPS_BROWSER_API_KEY/);
assert.match(backend, /mapConfig: getGoogleMapsClientConfig_\(\)/);
assert.match(main, /next10/);
assert.match(main, /next20/);
assert.match(main, /next30/);
assert.match(backend, /next10/);
assert.match(backend, /next20/);
assert.match(backend, /next30/);
assert.match(command, /resolveV192CotAlert_/);
assert.match(command, /connectivity/);
assert.match(command, /gpsCapturedAt/);
assert.match(sw, /app\/operations-v19\.js/);
assert.match(sw, /app\/director-ops-v192\.js/);
assert.match(sw, /app\/ux-v193\.js/);
assert.match(sw, /race-logger-static-v19-3-0/);
assert.match(ux, /showDirectorToolbarHint/);
assert.match(ux, /requestMinimalWakeLock/);
assert.match(ux, /buildDirectorSectionNav/);
assert.match(ux, /installMapFullscreen/);
assert.match(html, /id="directorSectionNav"/);
assert.match(html, /id="minimalActiveTargetPill"/);
assert.match(html, /id="successToastBib"/);
assert.match(sw, /attachRecordChecksums_\(unsynced\)/);
assert.match(sw, /checksumBatch_\(unsynced\)/);
assert.match(sw, /operational_batch/);
console.log('Static integration checks passed.');
