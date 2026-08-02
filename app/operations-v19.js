/* Race Bib Logger v19 operational workflows and compatibility overrides. */
(function (global) {
  'use strict';

  const RC = global.RaceConfig;
  const UI = global.RaceComponents;
  const ERR = global.RaceErrors;
  const INTEGRITY = global.RaceIntegrity;
  let decisionResolver_ = null;
  let reconciliationTimer_ = null;
  let queueRefreshTimer_ = null;
  let operationalRetryTimeout_ = null;
  let originalUpdateQueueStatus_ = null;
  let originalOpenSafetyLog_ = null;
  let originalOpenDirectorMode_ = null;
  let originalRenderDirectorModeContent_ = null;
  let originalRenderDirectorOperations_ = null;
  let originalReportDeviceHealth_ = null;
  let localCheckpointStatuses_ = loadJson_('checkpointStatuses_v19', {});
  let lastQueueSummary_ = { logs: 0, incidents: 0, safetyNotes: 0, acknowledgements: 0, checkpointStatuses: 0, total: 0 };

  function loadJson_(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || '') || fallback; } catch (_) { return fallback; }
  }

  function saveJson_(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  }

  function formatElapsed_(milliseconds) {
    const seconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000));
    if (seconds < 60) return seconds + ' sec ago';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + ' min ' + (seconds % 60) + ' sec ago';
    const hours = Math.floor(minutes / 60);
    return hours + ' hr ' + (minutes % 60) + ' min ago';
  }

  function reasonOptionsHtml_(options) {
    return (options || []).map(function (item) {
      return '<option value="' + UI.escapeHtml(item[0]) + '">' + UI.escapeHtml(item[1]) + '</option>';
    }).join('');
  }

  function openDecision_(options) {
    const modal = document.getElementById('v19DecisionModal');
    if (!modal) return Promise.resolve({ approved: false });
    UI.setText('v19DecisionTitle', options.title || 'Confirm action');
    UI.setHtml('v19DecisionBody', options.bodyHtml || '');
    const reasonWrap = document.getElementById('v19DecisionReasonWrap');
    const reasonSelect = document.getElementById('v19DecisionReason');
    if (reasonWrap) reasonWrap.classList.toggle('hidden', !(options.reasons && options.reasons.length));
    if (reasonSelect) {
      reasonSelect.innerHTML = '<option value="">Select a reason…</option>' + reasonOptionsHtml_(options.reasons || []);
      reasonSelect.value = '';
    }
    UI.setText('v19DecisionConfirm', options.confirmLabel || 'Continue');
    UI.setText('v19DecisionCancel', options.cancelLabel || 'Cancel');
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    return new Promise(function (resolve) { decisionResolver_ = { resolve: resolve, requireReason: !!(options.reasons && options.reasons.length) }; });
  }

  function closeDecision_(approved) {
    const modal = document.getElementById('v19DecisionModal');
    const reason = document.getElementById('v19DecisionReason')?.value || '';
    if (approved && decisionResolver_?.requireReason && !reason) {
      document.getElementById('v19DecisionReason')?.focus();
      document.getElementById('v19DecisionReasonError')?.classList.remove('hidden');
      return;
    }
    document.getElementById('v19DecisionReasonError')?.classList.add('hidden');
    if (modal) {
      modal.classList.add('hidden');
      modal.setAttribute('aria-hidden', 'true');
    }
    const pending = decisionResolver_;
    decisionResolver_ = null;
    if (pending) pending.resolve({ approved: !!approved, reasonCode: reason });
  }

  global.resolveV19Decision_ = closeDecision_;

  function getClockDriftBlockSeconds_() {
    const configured = (global.categoryConfig || []).map(function (row) { return Number(row.clockDriftBlockSeconds); })
      .find(function (value) { return Number.isFinite(value) && value > 0; });
    return configured || Number(localStorage.getItem('clockDriftBlockSeconds_v19')) || RC.defaultClockDriftBlockSeconds;
  }

  function clockDriftState_() {
    const thresholdSeconds = getClockDriftBlockSeconds_();
    const blocked = Number(global.clockSampleCount_ || 0) >= RC.clockDriftMinimumSamples
      && Math.abs(Number(global.clockOffsetMs_ || 0)) > thresholdSeconds * 1000
      && Number(global.clockConfidenceMs_ || Infinity) <= RC.clockDriftMaximumConfidenceMs;
    return {
      blocked: blocked,
      thresholdSeconds: thresholdSeconds,
      offsetMs: Number(global.clockOffsetMs_ || 0),
      confidenceMs: Number(global.clockConfidenceMs_ || 0),
      samples: Number(global.clockSampleCount_ || 0)
    };
  }

  function renderClockDriftBlocker_(state) {
    const modal = document.getElementById('clockDriftBlocker');
    if (!modal) return;
    const sign = state.offsetMs >= 0 ? 'ahead' : 'behind';
    UI.setText('clockDriftBlockerValue', Math.round(Math.abs(state.offsetMs) / 1000) + ' seconds ' + sign);
    UI.setText('clockDriftBlockerThreshold', state.thresholdSeconds + ' seconds');
    modal.classList.toggle('hidden', !state.blocked);
    global.RaceState.setState({ clockBlocked: state.blocked });
  }

  global.retestClockDrift_ = async function () {
    const button = document.getElementById('clockDriftRetestBtn');
    if (button) { button.disabled = true; button.textContent = 'Testing…'; }
    try {
      if (!global.syncUrl) throw Object.assign(new Error('No sync URL is configured.'), { code: RC.errorCodes.CONFIG_STALE });
      const started = Date.now();
      const response = await fetch(global.syncUrl + (global.syncUrl.includes('?') ? '&' : '?') + 'action=config_health&nocache=' + Date.now(), { cache: 'no-store' });
      const data = await response.json();
      if (data.status !== 'success') throw new Error(data.message || 'Connection test failed.');
      if (data.serverTime && typeof global.updateClockDriftSample_ === 'function') global.updateClockDriftSample_(data.serverTime, started, Date.now());
      renderClockDriftBlocker_(clockDriftState_());
    } catch (error) {
      const normalized = ERR.report(error, RC.errorCodes.NETWORK_UNAVAILABLE);
      alert(normalized.userMessage + '\n\n' + normalized.recovery);
    } finally {
      if (button) { button.disabled = false; button.textContent = 'Retest connection'; }
    }
  };

  function duplicateBodyHtml_(bib, previous, currentCheckpoint) {
    const previousTime = typeof global.parseCustomOrIsoDate === 'function' ? global.parseCustomOrIsoDate(previous.time).getTime() : Date.parse(previous.time);
    const elapsed = Number.isFinite(previousTime) ? formatElapsed_(Date.now() - previousTime) : 'time unavailable';
    const device = typeof global.getDeviceLabel === 'function' ? global.getDeviceLabel(previous.device) : (previous.device || 'Unknown device');
    return '<div class="v19-warning-hero"><strong>BIB ' + UI.escapeHtml(bib) + ' was already recorded</strong><span>Review the previous passage before submitting another.</span></div>' +
      '<dl class="v19-detail-grid">' +
      '<div><dt>Previous checkpoint</dt><dd>' + UI.escapeHtml(previous.checkpoint || 'Unknown') + '</dd></div>' +
      '<div><dt>Current checkpoint</dt><dd>' + UI.escapeHtml(currentCheckpoint || 'Unknown') + '</dd></div>' +
      '<div><dt>Device</dt><dd>' + UI.escapeHtml(device) + '</dd></div>' +
      '<div><dt>Volunteer</dt><dd>' + UI.escapeHtml(previous.volunteer || 'Unknown') + '</dd></div>' +
      '<div><dt>Elapsed</dt><dd>' + UI.escapeHtml(elapsed) + '</dd></div>' +
      '<div><dt>Recorded time</dt><dd>' + UI.escapeHtml(typeof global.formatLogTime === 'function' ? global.formatLogTime(previous.time) : previous.time) + '</dd></div>' +
      '</dl>';
  }

  async function checkDuplicateAndLogV19_() {
    if (global.bibLogSubmissionInFlight_) return;
    const bibInput = document.getElementById('bibInput');
    const bib = global.normalizeBibOriginal_(bibInput?.value || '');
    if (!bib) {
      if (global.minimalBibModeActive_) global.setMinimalBibStatus_('Enter a BIB label first.', true);
      else bibInput?.focus();
      return;
    }
    let checkpoint = (document.getElementById('checkpoint')?.value || '').trim();
    const volunteer = (document.getElementById('volunteer')?.value || '').trim();
    if (!checkpoint || !volunteer) {
      alert('⚠️ Complete 1. Setup before entering a bib.');
      global.focusIncompleteSetup_();
      return;
    }

    const drift = clockDriftState_();
    if (drift.blocked) {
      renderClockDriftBlocker_(drift);
      global.finishBibSubmission_();
      global.announceToScreenReader_('Logging blocked because the device clock differs too much from server time.');
      return;
    }

    global.setBibSubmitBusy_(true);
    let gpsResult;
    try { gpsResult = await global.resolveGpsBeforeLog_(checkpoint); }
    catch (_) { gpsResult = { checkpoint: global.checkpointToken_(checkpoint), status: 'unverified', acknowledged: false }; }
    if (gpsResult?.cancelled) {
      global.finishBibSubmission_();
      global.evaluateGpsCheckpointAdvisor_();
      return;
    }
    checkpoint = gpsResult?.checkpoint || global.checkpointToken_(checkpoint);

    let runnerLogs;
    try {
      runnerLogs = await new Promise(function (resolve, reject) {
        const request = global.requestLogsForBib_(bib);
        request.onsuccess = function (event) { resolve(event.target.result || []); };
        request.onerror = function () { reject(request.error || new Error('Local BIB lookup failed.')); };
      });
    } catch (error) {
      global.finishBibSubmission_();
      const normalized = ERR.report(error, RC.errorCodes.DB_READ_FAILED);
      alert(normalized.userMessage + '\n\n' + normalized.recovery);
      return;
    }

    const reasonCodes = [];
    const flags = [];
    const recentDuplicate = runnerLogs.filter(function (log) { return global.isRecentSamePassage_(log, bib, checkpoint); })
      .sort(function (a, b) { return global.parseCustomOrIsoDate(b.time) - global.parseCustomOrIsoDate(a.time); })[0];
    if (recentDuplicate) {
      const decision = await openDecision_({
        title: 'Duplicate passage warning',
        bodyHtml: duplicateBodyHtml_(bib, recentDuplicate, checkpoint),
        reasons: RC.reasonCodes.duplicate,
        confirmLabel: 'Log anyway',
        cancelLabel: 'Cancel'
      });
      if (!decision.approved) {
        global.finishBibSubmission_();
        global.announceToScreenReader_('Duplicate entry cancelled.');
        return;
      }
      reasonCodes.push(decision.reasonCode);
      flags.push('duplicate-override');
    }

    const categoryResolution = global.resolveBibCategory_(bib, runnerLogs, checkpoint);
    const configuredRunner = global.findCategoryConfigForBib_(bib, global.categoryConfig || []);
    const unknownBib = !configuredRunner;
    if (unknownBib) {
      // Preserve the passage without interrupting race-day entry. Reconciliation
      // can resolve Setup/configuration gaps later.
      reasonCodes.push('UNKNOWN_NOT_IN_SETUP');
      flags.push('unknown-bib');
    }

    const routeWarning = global.routeWarningForCandidate_(bib, checkpoint, runnerLogs);
    let routeExceptionReason = '';
    if (routeWarning) {
      const decision = await openDecision_({
        title: 'Checkpoint sequence exception',
        bodyHtml: '<div class="v19-warning-hero"><strong>Route check for BIB ' + UI.escapeHtml(bib) + '</strong><span>' + UI.escapeHtml(routeWarning.message) + '</span></div><p class="v19-modal-note">An approved exception reason is required before this passage can be logged.</p>',
        reasons: RC.reasonCodes.route,
        confirmLabel: 'Log with exception',
        cancelLabel: 'Cancel'
      });
      if (!decision.approved) {
        global.finishBibSubmission_();
        global.announceToScreenReader_('Route exception entry cancelled. ' + routeWarning.message);
        return;
      }
      routeExceptionReason = decision.reasonCode;
      reasonCodes.push(decision.reasonCode);
      flags.push('route-exception');
    }

    if (gpsResult?.status === 'spam') flags.push('location-spam');
    global.triggerInlineAnimationFlag = true;
    global.logEntry(bib, {
      routeWarning: routeWarning ? routeWarning.message : '',
      routeWarningAcknowledged: !!routeWarning,
      routeExceptionReason: routeExceptionReason,
      reasonCode: reasonCodes.filter(Boolean).join('|'),
      reconciliationFlags: flags.join(','),
      unknownBib: unknownBib,
      categoryResolution: categoryResolution,
      locationStatus: gpsResult?.status || 'unverified',
      locationAcknowledged: !!gpsResult?.acknowledged,
      locationDecision: gpsResult?.decision || null,
      onLogged: function () { global.finishBibSubmission_(); refreshQueueSummary_(); },
      onError: function (error) {
        global.finishBibSubmission_();
        const normalized = ERR.report(error, RC.errorCodes.DB_WRITE_FAILED);
        alert(normalized.userMessage + '\n\n' + normalized.recovery);
      }
    });
  }

  function getAllFromStore_(storeName) {
    return new Promise(function (resolve) {
      if (!global.db || !global.db.objectStoreNames.contains(storeName)) { resolve([]); return; }
      try {
        const request = global.db.transaction([storeName], 'readonly').objectStore(storeName).getAll();
        request.onsuccess = function (event) { resolve(event.target.result || []); };
        request.onerror = function () { resolve([]); };
      } catch (_) { resolve([]); }
    });
  }

  async function getQueueSummary_() {
    const results = await Promise.all([
      getAllFromStore_('logs'), getAllFromStore_('incidents'), getAllFromStore_('safetyNotes'), getAllFromStore_('cotAlerts')
    ]);
    const logs = results[0].filter(function (item) { return item && !item.synced; }).length;
    const incidents = results[1].filter(function (item) { return item && item.synced === false; }).length;
    const safetyNotes = results[2].filter(function (item) { return item && item.synced === false; }).length;
    const acknowledgements = results[3].filter(function (item) { return item && item.synced === false; }).length;
    const checkpointStatuses = Object.values(localCheckpointStatuses_ || {}).filter(function (item) { return item && item.synced === false; }).length;
    return { logs: logs, incidents: incidents, safetyNotes: safetyNotes, acknowledgements: acknowledgements, checkpointStatuses: checkpointStatuses, total: logs + incidents + safetyNotes + acknowledgements + checkpointStatuses };
  }

  function queueSummarySentence_(summary) {
    const parts = [];
    if (summary.logs) parts.push(summary.logs + ' BIB log' + (summary.logs === 1 ? '' : 's'));
    if (summary.incidents) parts.push(summary.incidents + ' incident' + (summary.incidents === 1 ? '' : 's'));
    if (summary.safetyNotes) parts.push(summary.safetyNotes + ' safety note' + (summary.safetyNotes === 1 ? '' : 's'));
    if (summary.acknowledgements) parts.push(summary.acknowledgements + ' acknowledgement' + (summary.acknowledgements === 1 ? '' : 's'));
    if (summary.checkpointStatuses) parts.push(summary.checkpointStatuses + ' checkpoint status update' + (summary.checkpointStatuses === 1 ? '' : 's'));
    return parts.length ? parts.join(', ') + ' waiting' : 'All operational records are synchronized';
  }

  async function refreshQueueSummary_() {
    const summary = await getQueueSummary_();
    lastQueueSummary_ = summary;
    global.RaceState.setState({ queueSummary: summary });
    const badge = document.getElementById('queueBadge');
    const count = document.getElementById('queueCount');
    const text = document.getElementById('queueSummaryText');
    const detail = document.getElementById('queueExactSummary');
    const exactSentence = queueSummarySentence_(summary);
    const bibQueueSentence = summary.logs
      ? summary.logs + ' BIB log' + (summary.logs === 1 ? '' : 's') + ' pending'
      : 'BIB logs synchronized';
    if (count) count.textContent = summary.logs ? String(summary.logs) : '';
    if (text) text.textContent = summary.logs ? bibQueueSentence : 'Synced';
    // Keep the full operational breakdown inside the queue inspector only.
    if (detail) detail.textContent = exactSentence;
    if (badge) {
      badge.classList.toggle('hidden', summary.logs === 0);
      badge.setAttribute('aria-label', bibQueueSentence);
      badge.title = bibQueueSentence;
    }
    return summary;
  }

  global.refreshQueueSummary_ = refreshQueueSummary_;

  function canonicalActiveLocal_(logs) {
    return (logs || []).filter(function (log) {
      if (!log || log.pendingDelete) return false;
      const status = String(log.status || '').trim().toLowerCase();
      return status !== 'deleted' && status !== 'auto duplicate removed';
    });
  }

  async function fetchServerReconciliation_() {
    if (!global.syncUrl) return null;
    const creatorId = global.getOrCreateDeviceId();
    const url = global.syncUrl + (global.syncUrl.includes('?') ? '&' : '?') + 'action=reconciliation_count&creatorId=' + encodeURIComponent(creatorId) + '&nocache=' + Date.now();
    try {
      const response = await fetch(url, { cache: 'no-store' });
      const data = await response.json();
      if (data.status !== 'success') throw new Error(data.message || 'Reconciliation count failed.');
      const logs = await getAllFromStore_('logs');
      const local = canonicalActiveLocal_(logs).filter(function (log) { return String(log.creatorId || '') === creatorId; });
      const snapshot = {
        localCount: local.length,
        localSyncedCount: local.filter(function (log) { return log.synced; }).length,
        serverCount: Number(data.confirmedCount) || 0,
        serverUidChecksum: data.uidChecksum || '',
        mismatch: local.filter(function (log) { return log.synced; }).length !== (Number(data.confirmedCount) || 0),
        checkedAt: new Date().toISOString()
      };
      saveJson_(RC.serverReconciliationKey, snapshot);
      global.RaceState.setState({ serverReconciliation: snapshot });
      renderReconciliationBadge_(snapshot);
      return snapshot;
    } catch (error) {
      ERR.report(error, RC.errorCodes.NETWORK_UNAVAILABLE);
      return null;
    }
  }

  function renderReconciliationBadge_(snapshot) {
    const badge = document.getElementById('reconciliationCountBadge');
    if (!badge || !snapshot) return;
    badge.classList.remove('hidden');
    badge.classList.toggle('v19-mismatch', !!snapshot.mismatch);
    badge.textContent = snapshot.mismatch
      ? '⚠ Local ' + snapshot.localSyncedCount + ' / Server ' + snapshot.serverCount
      : '✓ Local = Server ' + snapshot.serverCount;
  }

  function flagsForLog_(log) {
    return String(log.reconciliationFlags || '').split(',').map(function (value) { return value.trim(); }).filter(Boolean);
  }

  function reconciliationRow_(log, badge) {
    const reason = log.reasonCode ? '<span>Reason: ' + UI.escapeHtml(log.reasonCode) + '</span>' : '';
    return '<article class="v19-recon-row"><div><strong>BIB ' + UI.escapeHtml(log.bib || '—') + ' · ' + UI.escapeHtml(log.checkpoint || '—') + '</strong><span>' + UI.escapeHtml(typeof global.formatLogTime === 'function' ? global.formatLogTime(log.time) : log.time || '') + ' · ' + UI.escapeHtml(log.volunteer || 'Unknown volunteer') + '</span>' + reason + '</div>' + UI.statusBadge(badge, badge === 'Unsynced' ? 'warn' : 'bad') + '</article>';
  }

  async function renderReconciliation_() {
    const logs = (await getAllFromStore_('logs')).slice().sort(function (a, b) {
      return global.parseCustomOrIsoDate(b.time) - global.parseCustomOrIsoDate(a.time);
    });
    const groups = {
      unknown: logs.filter(function (log) { return log.unknownBib || flagsForLog_(log).includes('unknown-bib'); }),
      duplicates: logs.filter(function (log) { return (typeof global.isDuplicateLog_ === 'function' && global.isDuplicateLog_(log)) || flagsForLog_(log).includes('duplicate-override'); }),
      location: logs.filter(function (log) { return (typeof global.isLocationSpamLog_ === 'function' && global.isLocationSpamLog_(log)) || flagsForLog_(log).includes('location-spam'); }),
      edited: logs.filter(function (log) { return !!log.editedAt || flagsForLog_(log).includes('edited'); }),
      unsynced: logs.filter(function (log) { return !log.synced; })
    };
    const labels = { unknown: 'Unknown BIB', duplicates: 'Duplicate', location: 'Location spam', edited: 'Edited', unsynced: 'Unsynced' };
    Object.keys(groups).forEach(function (key) {
      UI.setText('reconCount-' + key, groups[key].length);
      UI.setHtml('reconList-' + key, groups[key].length
        ? groups[key].slice(0, 100).map(function (log) { return reconciliationRow_(log, labels[key]); }).join('')
        : UI.emptyState('No ' + labels[key].toLowerCase() + ' records', 'This reconciliation group is clear.'));
    });
    const snapshot = await fetchServerReconciliation_();
    const hero = document.getElementById('reconciliationServerHero');
    if (hero && snapshot) {
      hero.className = 'v19-reconciliation-hero ' + (snapshot.mismatch ? 'is-mismatch' : 'is-match');
      hero.innerHTML = snapshot.mismatch
        ? '<strong>Count mismatch requires review</strong><span>' + snapshot.localSyncedCount + ' locally confirmed vs ' + snapshot.serverCount + ' on the server.</span>'
        : '<strong>Server reconciliation matches</strong><span>' + snapshot.serverCount + ' records from this device are confirmed on both sides.</span>';
    }
  }

  global.openReconciliationScreen_ = function () {
    document.getElementById('reconciliationView')?.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
    renderReconciliation_();
  };
  global.closeReconciliationScreen_ = function () {
    document.getElementById('reconciliationView')?.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
  };
  global.syncAndRefreshReconciliation_ = function () {
    global.attemptSync();
    global.syncPendingOperationalRecords_();
    setTimeout(renderReconciliation_, 1200);
  };

  function updateRecoveryStep_(id, status, detail) {
    const row = document.getElementById(id);
    if (!row) return;
    row.dataset.status = status;
    row.querySelector('[data-recovery-status]').textContent = status === 'pass' ? 'PASS' : status === 'fail' ? 'FAIL' : status === 'running' ? 'TESTING' : 'WAITING';
    row.querySelector('[data-recovery-detail]').textContent = detail || '';
  }

  async function recoveryTestIdentity_() {
    const checkpoint = (document.getElementById('checkpoint')?.value || '').trim();
    const volunteer = (document.getElementById('volunteer')?.value || '').trim();
    const deviceId = global.getOrCreateDeviceId();
    const pass = !!checkpoint && !!volunteer && !!deviceId;
    updateRecoveryStep_('recoveryStepIdentity', pass ? 'pass' : 'fail', pass ? checkpoint.toUpperCase() + ' · ' + volunteer.toUpperCase() + ' · ' + deviceId.slice(-8) : 'Checkpoint and volunteer identity must be set.');
    return pass;
  }

  async function recoveryInspectQueue_() {
    const summary = await refreshQueueSummary_();
    updateRecoveryStep_('recoveryStepQueue', 'pass', queueSummarySentence_(summary));
    return summary;
  }

  async function recoveryTestConnection_() {
    updateRecoveryStep_('recoveryStepConnection', 'running', 'Contacting server…');
    if (!global.syncUrl) { updateRecoveryStep_('recoveryStepConnection', 'fail', 'No Apps Script URL configured.'); return false; }
    try {
      const started = Date.now();
      const response = await fetch(global.syncUrl + (global.syncUrl.includes('?') ? '&' : '?') + 'action=config_health&nocache=' + Date.now(), { cache: 'no-store' });
      const data = await response.json();
      if (data.status !== 'success') throw new Error(data.message || 'Server rejected the test.');
      if (data.serverTime && typeof global.updateClockDriftSample_ === 'function') global.updateClockDriftSample_(data.serverTime, started, Date.now());
      const drift = clockDriftState_();
      updateRecoveryStep_('recoveryStepConnection', drift.blocked ? 'fail' : 'pass', drift.blocked ? 'Connected, but clock drift is blocked.' : 'Connected to app version ' + (data.appVersion || 'unknown') + '.');
      renderClockDriftBlocker_(drift);
      return !drift.blocked;
    } catch (error) {
      updateRecoveryStep_('recoveryStepConnection', 'fail', error.message || 'Network test failed.');
      return false;
    }
  }

  async function recoveryTestGps_() {
    updateRecoveryStep_('recoveryStepGps', 'running', 'Requesting a location fix…');
    if (!navigator.geolocation) { updateRecoveryStep_('recoveryStepGps', 'fail', 'Geolocation is not supported on this device.'); return false; }
    return new Promise(function (resolve) {
      navigator.geolocation.getCurrentPosition(function (position) {
        const accuracy = Math.round(position.coords.accuracy || 0);
        updateRecoveryStep_('recoveryStepGps', accuracy <= 100 ? 'pass' : 'fail', 'Accuracy ±' + accuracy + ' m. ' + (accuracy <= 100 ? 'Usable fix.' : 'Move outdoors for a stronger fix.'));
        resolve(accuracy <= 100);
      }, function (error) {
        updateRecoveryStep_('recoveryStepGps', 'fail', error.message || 'Location permission denied.');
        resolve(false);
      }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
    });
  }

  async function recoverySampleLog_() {
    updateRecoveryStep_('recoveryStepSample', 'running', 'Writing and removing a diagnostic sample…');
    if (!global.db) { updateRecoveryStep_('recoveryStepSample', 'fail', 'IndexedDB is not ready.'); return false; }
    const uid = 'recovery-test-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    const sample = {
      uid: uid, bib: 'RECOVERY-TEST', bibKey: 'RECOVERY-TEST', bibNumber: '', bibNumberKey: '',
      time: global.getFormattedTimestamp(new Date()), originalDeviceTime: global.getFormattedTimestamp(new Date()),
      checkpoint: 'DIAGNOSTIC', volunteer: 'RECOVERY WIZARD', remark: 'Temporary local write test',
      device: global.buildDeviceString(), creatorId: global.getOrCreateDeviceId(), status: 'Diagnostic Test',
      synced: true, diagnostic: true, syncAttempts: 0, clientTimeMs: Date.now(), originalDeviceTimeMs: Date.now()
    };
    try {
      const id = await new Promise(function (resolve, reject) {
        const tx = global.db.transaction(['logs'], 'readwrite');
        const request = tx.objectStore('logs').add(sample);
        request.onsuccess = function (event) { resolve(event.target.result); };
        request.onerror = function () { reject(request.error || new Error('Diagnostic write failed.')); };
      });
      await new Promise(function (resolve, reject) {
        const tx = global.db.transaction(['logs'], 'readwrite');
        tx.objectStore('logs').delete(id);
        tx.oncomplete = resolve;
        tx.onerror = function () { reject(tx.error || new Error('Diagnostic cleanup failed.')); };
      });
      updateRecoveryStep_('recoveryStepSample', 'pass', 'Local add/read/delete path passed without creating a race record.');
      return true;
    } catch (error) {
      updateRecoveryStep_('recoveryStepSample', 'fail', error.message || 'Local sample test failed.');
      return false;
    }
  }

  global.openRecoveryWizard_ = function () {
    document.getElementById('recoveryWizard')?.classList.remove('hidden');
    recoveryTestIdentity_();
    recoveryInspectQueue_();
  };
  global.closeRecoveryWizard_ = function () { document.getElementById('recoveryWizard')?.classList.add('hidden'); };
  global.runRecoveryConnectionTest_ = recoveryTestConnection_;
  global.runRecoveryGpsTest_ = recoveryTestGps_;
  global.runRecoverySampleLog_ = recoverySampleLog_;
  global.runAllRecoveryChecks_ = async function () {
    const report = {
      identity: await recoveryTestIdentity_(),
      queue: await recoveryInspectQueue_(),
      connection: await recoveryTestConnection_(),
      gps: await recoveryTestGps_(),
      sample: await recoverySampleLog_(),
      completedAt: new Date().toISOString()
    };
    saveJson_(RC.recoveryReportKey, report);
    global.RaceState.setState({ recovery: report });
    UI.setText('recoveryCompletedAt', 'Completed ' + new Date(report.completedAt).toLocaleString());
    return report;
  };

  async function prepareSyncBatch_(records) {
    const prepared = records.slice();
    for (const record of prepared) {
      const result = await INTEGRITY.checksumRecord(record);
      record.recordChecksum = result.checksum;
    }
    const batchDigest = await INTEGRITY.checksumBatch(prepared);
    return { records: prepared, checksum: batchDigest.checksum, algorithm: batchDigest.algorithm };
  }

  function retryDelay_() {
    const streak = Math.max(0, Number(global.syncFailureStreak || 0));
    const base = Math.min(RC.retryBaseMs * Math.pow(2, Math.min(streak, 6)), RC.retryMaxMs);
    const jitter = base * RC.retryJitterRatio * (Math.random() * 2 - 1);
    return Math.max(1000, Math.round(base + jitter));
  }

  async function processBatchSyncResponse_(batch, data, syncStartedAt) {
    const confirmedIds = new Set(data.confirmedIds || []);
    const remakeIds = new Set(data.remakeIds || []);
    const deletedIds = new Set(data.deletedUids || []);
    const duplicateUpdatesByUid = new Map((data.duplicateUpdates || []).filter(Boolean).map(function (update) { return [update.uid, update]; }));
    const locationUpdatesByUid = new Map((data.locationUpdates || []).filter(Boolean).map(function (update) { return [update.uid, update]; }));
    await new Promise(function (resolve, reject) {
      const tx = global.db.transaction(['logs'], 'readwrite');
      const store = tx.objectStore('logs');
      batch.forEach(function (log) {
        if (deletedIds.has(log.uid)) {
          store.delete(log.id);
        } else if (log.pendingDelete) {
          if (confirmedIds.has(log.uid)) store.delete(log.id);
          else { log.syncAttempts = (log.syncAttempts || 0) + 1; store.put(log); }
        } else if (remakeIds.has(log.uid)) {
          log.synced = false; log.remake = true; log.syncAttempts = 0; store.put(log);
        } else if (confirmedIds.has(log.uid)) {
          log.synced = true; log.remake = false; log.syncAttempts = 0;
          const duplicateUpdate = duplicateUpdatesByUid.get(log.uid);
          if (duplicateUpdate) {
            log.status = duplicateUpdate.status || 'Duplicate';
            log.duplicateOfUid = duplicateUpdate.duplicateOfUid || '';
            log.duplicateDeviceCount = Number(duplicateUpdate.duplicateDeviceCount) || 2;
            log.reconciliationFlags = Array.from(new Set(flagsForLog_(log).concat(['duplicate']))).join(',');
          }
          const locationUpdate = locationUpdatesByUid.get(log.uid);
          if (locationUpdate) {
            log.status = locationUpdate.status || 'Location Spam';
            log.gpsValidationStatus = locationUpdate.gpsValidationStatus || 'spam';
            log.gpsNearestCheckpoint = locationUpdate.nearestCheckpoint || log.gpsNearestCheckpoint || '';
            log.gpsDistanceToNearestM = Number(locationUpdate.distanceM) || log.gpsDistanceToNearestM || null;
            log.reconciliationFlags = Array.from(new Set(flagsForLog_(log).concat(['location-spam']))).join(',');
          }
          store.put(log);
        } else {
          log.syncAttempts = (log.syncAttempts || 0) + 1;
          store.put(log);
        }
      });
      tx.oncomplete = resolve;
      tx.onerror = function () { reject(tx.error || new Error('Could not update local sync state.')); };
    });
    global.scheduleAggregateRebuild_();
    global.recordSyncSuccess(data.serverTime, syncStartedAt);
    global.loadHistory();
    if (data.summary) global.renderSummaryDashboard(data.summary, data.configMeta);
    global.applyRouteModelsFromPayload_(data);
    global.handleDataRevisionFromServer_(data.dataRevision, false);
    if (data.appRefreshEpoch && global.handleAppRefreshEpochFromServer_(data.appRefreshEpoch)) return;
    if (data.eventEpoch) global.handleEventEpochFromServer_(data.eventEpoch);
    if (data.bulkDeleteEpoch && (!data.eventEpoch || localStorage.getItem(global.LOCAL_EVENT_EPOCH_KEY_) === String(data.eventEpoch))) {
      global.handleBulkDeleteEpochFromServer_(data.bulkDeleteEpoch);
    }
  }

  async function attemptSyncV19_() {
    if (!global.syncUrl || global.isSyncing || !global.db) return;
    global.isSyncing = true;
    if (global.syncRetryTimeoutId) { clearTimeout(global.syncRetryTimeoutId); global.syncRetryTimeoutId = null; }
    try {
      const all = await getAllFromStore_('logs');
      const unsynced = all.filter(function (log) { return log && !log.synced; });
      if (!unsynced.length) {
        global.isSyncing = false;
        await global.syncPendingOperationalRecords_();
        refreshQueueSummary_();
        return;
      }
      unsynced.sort(function (a, b) {
        const ap = a.pendingDelete ? 0 : 1;
        const bp = b.pendingDelete ? 0 : 1;
        if (ap !== bp) return ap - bp;
        return (Number(a.originalDeviceTimeMs) || global.parseCustomOrIsoDate(a.time).getTime()) - (Number(b.originalDeviceTimeMs) || global.parseCustomOrIsoDate(b.time).getTime());
      });
      const batch = unsynced.slice(0, RC.queueBatchSize);
      const prepared = await prepareSyncBatch_(batch);
      const syncStartedAt = Date.now();
      const url = global.syncUrl + (global.syncUrl.includes('?') ? '&' : '?') + 'nocache=' + Date.now();
      const response = await global.fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        redirect: 'follow',
        body: JSON.stringify({
          action: 'batch_sync', data: prepared.records,
          checksum: prepared.checksum, checksumAlgorithm: prepared.algorithm,
          batchId: 'batch-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
        })
      }, 25005);
      const data = JSON.parse(await response.text());
      if (data.status !== 'success') throw new Error(data.message || 'Sync rejected.');
      const hasChecksumAcknowledgement =
        Object.prototype.hasOwnProperty.call(data, 'checksumVerified') ||
        Object.prototype.hasOwnProperty.call(data, 'recordChecksumsVerified') ||
        Object.prototype.hasOwnProperty.call(data, 'ackChecksum');
      // New servers return explicit checksum acknowledgement. Older deployed
      // Apps Script versions can still be accepted when the write succeeded and
      // confirmed record IDs are returned, avoiding a false permanent Sync Issue.
      if (hasChecksumAcknowledgement &&
          (data.checksumVerified !== true ||
           data.recordChecksumsVerified !== true ||
           data.ackChecksum !== prepared.checksum)) {
        const mismatch = new Error('Batch or record checksum acknowledgement did not match.');
        mismatch.code = RC.errorCodes.SYNC_CHECKSUM_MISMATCH;
        throw mismatch;
      }
      await processBatchSyncResponse_(batch, data, syncStartedAt);
      await refreshQueueSummary_();
      await global.syncPendingOperationalRecords_();
      if (unsynced.length > batch.length) global.syncRerunQueued = true;
      setTimeout(fetchServerReconciliation_, 500);
    } catch (error) {
      const normalized = ERR.report(error, error.code || RC.errorCodes.SYNC_TIMEOUT);
      global.recordSyncFailure(normalized.code + ': ' + normalized.message);
      const current = await getAllFromStore_('logs');
      const pending = current.filter(function (log) { return log && !log.synced; }).slice(0, RC.queueBatchSize);
      if (pending.length) {
        await new Promise(function (resolve) {
          const tx = global.db.transaction(['logs'], 'readwrite');
          const store = tx.objectStore('logs');
          pending.forEach(function (log) { log.syncAttempts = (log.syncAttempts || 0) + 1; store.put(log); });
          tx.oncomplete = resolve;
          tx.onerror = resolve;
        });
      }
      global.syncRetryTimeoutId = setTimeout(function () { if (!global.isSyncing) global.attemptSync(); }, retryDelay_());
      global.requestBackgroundSync_();
    } finally {
      global.isSyncing = false;
      if (global.syncRerunQueued) { global.syncRerunQueued = false; setTimeout(global.attemptSync, 50); }
    }
  }

  async function postOperationalBatch_(payload) {
    const url = global.syncUrl + (global.syncUrl.includes('?') ? '&' : '?') + 'nocache=' + Date.now();
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
    const data = await response.json();
    if (data.status !== 'success') throw new Error(data.message || 'Operational sync rejected.');
    return data;
  }

  async function syncPendingOperationalV19_() {
    if (global.operationalSyncInFlight_ || !global.syncUrl || !global.db) return;
    const pendingLogs = (await getAllFromStore_('logs')).some(function (log) { return log && !log.synced; });
    if (pendingLogs) { if (!global.isSyncing) global.attemptSync(); return; }
    const incidents = Object.values(global.localIncidents_ || {}).filter(function (item) { return item && item.synced === false; }).slice(0, RC.operationalBatchSize);
    const safetyNotes = Object.values(global.localSafetyNotes_ || {}).filter(function (item) { return item && item.synced === false; }).slice(0, RC.operationalBatchSize);
    const alerts = Object.values(global.localCotAlerts_ || {}).filter(function (item) { return item && item.synced === false; }).slice(0, RC.operationalBatchSize);
    const checkpointStatuses = Object.values(localCheckpointStatuses_).filter(function (item) { return item && item.synced === false; }).slice(0, RC.operationalBatchSize);
    if (!incidents.length && !safetyNotes.length && !alerts.length && !checkpointStatuses.length) { refreshQueueSummary_(); return; }
    global.operationalSyncInFlight_ = true;
    try {
      const data = await postOperationalBatch_({ action: 'operational_batch', incidents: incidents, safetyNotes: safetyNotes, cotAlerts: alerts, checkpointStatuses: checkpointStatuses });
      (data.incidents || []).forEach(function (saved) {
        saved.synced = true; global.localIncidents_[saved.id] = saved;
        global.db.transaction(['incidents'], 'readwrite').objectStore('incidents').put(saved);
      });
      (data.safetyNotes || []).forEach(function (saved) {
        saved.synced = true; global.localSafetyNotes_[saved.bib] = saved;
        global.db.transaction(['safetyNotes'], 'readwrite').objectStore('safetyNotes').put(saved);
      });
      (data.cotAlerts || []).forEach(function (saved) {
        saved.synced = true; global.localCotAlerts_[saved.key] = saved;
        global.db.transaction(['cotAlerts'], 'readwrite').objectStore('cotAlerts').put(saved);
      });
      (data.checkpointStatuses || []).forEach(function (saved) { saved.synced = true; localCheckpointStatuses_[saved.checkpoint] = saved; });
      saveJson_('checkpointStatuses_v19', localCheckpointStatuses_);
      global.renderIncidentWidget_();
      global.renderSafetyCotAlerts_();
      renderCheckpointHealth_();
      await refreshQueueSummary_();
      if (operationalRetryTimeout_) { clearTimeout(operationalRetryTimeout_); operationalRetryTimeout_ = null; }
    } catch (error) {
      ERR.report(error, RC.errorCodes.NETWORK_UNAVAILABLE);
      if (!operationalRetryTimeout_) {
        operationalRetryTimeout_ = setTimeout(function () {
          operationalRetryTimeout_ = null;
          global.syncPendingOperationalRecords_();
        }, retryDelay_());
      }
    } finally {
      global.operationalSyncInFlight_ = false;
    }
  }

  function pushIncidentQueued_(incident) { if (incident) { incident.synced = false; global.syncPendingOperationalRecords_(); refreshQueueSummary_(); } }
  function pushSafetyQueued_(note) { if (note) { note.synced = false; global.syncPendingOperationalRecords_(); refreshQueueSummary_(); } }

  function evaluateCotAlertsV19_(logs) {
    if (!global.cotAlertsEnabled_ || !global.db || !global.db.objectStoreNames.contains('cotAlerts')) return;
    const roster = global.buildSafetyRosterFromLogs_(logs || []);
    const now = global.getCorrectedNowMs_();
    const updates = [];
    roster.forEach(function (runner) {
      if (global.isCompletionCheckpoint_(runner.checkpoint)) return;
      const cfg = global.findCategoryConfigForBib_(runner.bib, global.categoryConfig);
      if (!cfg || !cfg.cotTime) return;
      const cot = global.parseCustomOrIsoDate(cfg.cotTime).getTime();
      if (!Number.isFinite(cot)) return;
      const remain = (cot - now) / 60000;
      const warning = cfg.cotWarningMinutes ?? global.cotWarningMinutes_;
      const escalation = cfg.cotEscalationMinutes ?? global.cotEscalationMinutes_;
      let level = '';
      if (remain <= 0) level = 'overdue';
      else if (remain <= escalation) level = 'critical';
      else if (remain <= warning) level = 'warning';
      if (!level) return;
      const key = global.cotAlertKey_(runner.bib, cfg.cotTime);
      const existing = global.localCotAlerts_[key] || {};
      const reasonCode = 'COT_' + level.toUpperCase();
      const acknowledgedAtMs = new Date(existing.acknowledgedAt || existing.updatedAt || 0).getTime();
      const recurrenceDue = !!existing.acknowledged && Number.isFinite(acknowledgedAtMs) && (now - acknowledgedAtMs) >= 5 * 60 * 1000;
      const severityChanged = !!existing.key && existing.level !== level;
      const changed = !existing.key || severityChanged || existing.reasonCode !== reasonCode || recurrenceDue;
      const previousCount = Math.max(0, Number(existing.occurrenceCount) || 0);
      const occurrenceCount = Math.max(1, previousCount + (changed ? 1 : 0));
      const reopen = !!existing.acknowledged && (recurrenceDue || severityChanged);
      const alert = Object.assign({}, existing, {
        key: key, bib: runner.bib, category: cfg.category || runner.category || '', cotTime: cfg.cotTime,
        level: level, reasonCode: reasonCode, occurrenceCount: occurrenceCount,
        firstSeenAt: existing.firstSeenAt || new Date(now).toISOString(), lastSeenAt: new Date(now).toISOString(),
        acknowledged: reopen ? false : !!existing.acknowledged,
        acknowledgedBy: reopen ? '' : (existing.acknowledgedBy || ''),
        acknowledgedAt: reopen ? '' : (existing.acknowledgedAt || ''),
        escalated: level === 'critical' || level === 'overdue', updatedAt: new Date().toISOString(),
        synced: changed ? false : existing.synced !== false
      });
      global.localCotAlerts_[key] = alert;
      if (changed || !existing.key) updates.push(alert);
    });
    const completed = new Set(roster.filter(function (runner) { return global.isCompletionCheckpoint_(runner.checkpoint); }).map(global.bibIdentityKey_).filter(Boolean));
    Object.values(global.localCotAlerts_).forEach(function (alert) {
      if (!alert.acknowledged && completed.has(global.bibIdentityKey_(alert.bib))) {
        alert.acknowledged = true; alert.acknowledgedBy = 'SYSTEM-FINISH'; alert.acknowledgedAt = new Date(now).toISOString(); alert.updatedAt = alert.acknowledgedAt; alert.synced = false; updates.push(alert);
      }
    });
    if (!updates.length) return;
    const dedup = Array.from(new Map(updates.map(function (alert) { return [alert.key, alert]; })).values());
    const tx = global.db.transaction(['cotAlerts'], 'readwrite');
    const store = tx.objectStore('cotAlerts');
    dedup.forEach(function (alert) { store.put(alert); });
    tx.oncomplete = function () { global.renderSafetyCotAlerts_(); global.syncPendingOperationalRecords_(); refreshQueueSummary_(); };
  }

  function acknowledgeCotAlertV19_(encodedKey) {
    const key = decodeURIComponent(encodedKey);
    const alert = global.localCotAlerts_[key] || global.localCotAlerts_[encodedKey];
    if (!alert) return;
    alert.acknowledged = true;
    alert.acknowledgedBy = (document.getElementById('volunteer')?.value || '').trim().toUpperCase();
    alert.acknowledgedAt = new Date().toISOString();
    alert.updatedAt = alert.acknowledgedAt;
    alert.synced = false;
    global.db?.transaction(['cotAlerts'], 'readwrite').objectStore('cotAlerts').put(alert);
    global.renderSafetyCotAlerts_();
    global.syncPendingOperationalRecords_();
    refreshQueueSummary_();
  }

  function renderSafetyCotAlertsV19_() {
    const panel = document.getElementById('safetyCotAlertsPanel');
    if (!panel) return;
    const rank = { overdue: 0, critical: 1, warning: 2 };
    const alerts = Object.values(global.localCotAlerts_ || {}).filter(function (alert) { return !alert.acknowledged; }).sort(function (a, b) {
      return (rank[String(a.level || '').toLowerCase()] ?? 9) - (rank[String(b.level || '').toLowerCase()] ?? 9) || new Date(a.cotTime) - new Date(b.cotTime);
    });
    panel.classList.toggle('hidden', !alerts.length);
    panel.classList.toggle('critical', alerts.some(function (alert) { return alert.level === 'critical' || alert.level === 'overdue'; }));
    if (!alerts.length) { panel.innerHTML = ''; global.safetyCotAlertsExpanded_ = false; return; }
    if (alerts.length <= 3) global.safetyCotAlertsExpanded_ = false;
    const visible = global.safetyCotAlertsExpanded_ ? alerts : alerts.slice(0, 3);
    const hiddenCount = Math.max(0, alerts.length - visible.length);
    const detail = global.safetyCotAlertsExpanded_ ? 'All alerts shown' : hiddenCount ? 'Showing 3 highest-priority alerts · ' + hiddenCount + ' more collapsed' : 'All alerts shown';
    const toggle = alerts.length > 3 ? '<button type="button" class="cot-alert-expand-btn" onclick="toggleSafetyCotAlertsExpanded_()" aria-expanded="' + (global.safetyCotAlertsExpanded_ ? 'true' : 'false') + '">' + (global.safetyCotAlertsExpanded_ ? 'Collapse all' : 'Expand all (' + alerts.length + ')') + '</button>' : '';
    panel.innerHTML = '<div class="cot-alert-banner-header"><div class="cot-alert-banner-heading"><strong>⏱️ ' + alerts.length + ' COT alert' + (alerts.length === 1 ? '' : 's') + ' require acknowledgement</strong><span>' + detail + '</span></div>' + toggle + '</div>' + visible.map(function (alert) {
      return '<div class="cot-alert-row"><strong>Bib ' + UI.escapeHtml(alert.bib) + ' · ' + UI.escapeHtml(alert.level) + ' <small>×' + Math.max(1, Number(alert.occurrenceCount) || 1) + '</small></strong><span>' + UI.escapeHtml(alert.category || '') + ' · ' + UI.escapeHtml(global.formatLogTime(alert.cotTime)) + ' · ' + UI.escapeHtml(alert.reasonCode || '') + '</span><button class="theme-input border rounded px-2 py-1 font-black" onclick="acknowledgeCotAlert_(\'' + encodeURIComponent(alert.key) + '\')">Acknowledge</button></div>';
    }).join('');
  }

  async function fetchSafetyActionCard_() {
    const cached = loadJson_(RC.safetyCardStorageKey, null);
    if (cached) renderSafetyActionCard_(cached);
    if (!global.syncUrl) return cached;
    try {
      const response = await fetch(global.syncUrl + (global.syncUrl.includes('?') ? '&' : '?') + 'action=safety_action&nocache=' + Date.now(), { cache: 'no-store' });
      const data = await response.json();
      if (data.status === 'success' && data.safetyActionCard) {
        saveJson_(RC.safetyCardStorageKey, data.safetyActionCard);
        renderSafetyActionCard_(data.safetyActionCard);
        return data.safetyActionCard;
      }
    } catch (_) {}
    return cached;
  }

  function renderSafetyActionCard_(card) {
    const panel = document.getElementById('offlineSafetyActionCard');
    if (!panel) return;
    const checkpoint = (document.getElementById('checkpoint')?.value || '').trim().toUpperCase();
    const instructions = card?.checkpointInstructions?.[checkpoint] || card?.checkpointInstructions?.DEFAULT || card?.checkpointInstructionsText || '';
    panel.classList.remove('hidden');
    panel.innerHTML = '<div class="v19-safety-card-header"><div><strong>🆘 Offline safety-action card</strong><span>Saved on this device · available without connectivity</span></div><span class="v19-offline-pill">OFFLINE READY</span></div>' +
      '<div class="v19-safety-card-grid"><section><h4>Emergency procedures</h4><p>' + UI.escapeHtml(card?.emergencyProcedures || 'Not configured. Add procedures in the SafetyAction sheet.') + '</p></section>' +
      '<section><h4>Escalation contacts</h4><p>' + UI.escapeHtml(card?.escalationContacts || 'Not configured.') + '</p></section>' +
      '<section><h4>' + UI.escapeHtml(checkpoint || 'Checkpoint') + ' instructions</h4><p>' + UI.escapeHtml(instructions || 'No checkpoint-specific instruction configured.') + '</p></section></div>' +
      '<div class="v19-safety-card-updated">Updated ' + UI.escapeHtml(card?.updatedAt ? new Date(card.updatedAt).toLocaleString() : 'unknown') + '</div>';
  }

  function timelineEvents_(logs) {
    const events = [];
    (logs || []).forEach(function (log) {
      events.push({ at: log.time, type: 'passage', title: 'BIB ' + log.bib + ' passed ' + log.checkpoint, detail: log.volunteer + (log.remark ? ' · ' + log.remark : '') });
      if (log.editedAt) events.push({ at: log.editedAt, type: 'edit', title: 'BIB ' + log.bib + ' record edited', detail: (log.editedBy || log.volunteer || 'Unknown') + ' · ' + (log.reasonCode || 'EDITED_ENTRY') });
    });
    Object.values(global.localIncidents_ || {}).forEach(function (incident) { events.push({ at: incident.updatedAt || incident.createdAt, type: 'incident', title: (incident.bib ? 'BIB ' + incident.bib + ' · ' : '') + (incident.type || 'Incident'), detail: (incident.status || 'open') + ' · ' + (incident.owner || 'unassigned') + (incident.notes ? ' · ' + incident.notes : '') }); });
    Object.values(global.localSafetyNotes_ || {}).forEach(function (note) { if (note.updatedAt) events.push({ at: note.updatedAt, type: 'safety', title: 'BIB ' + note.bib + ' safety note', detail: (note.status || 'No status') + (note.remark ? ' · ' + note.remark : '') }); });
    Object.values(global.localCotAlerts_ || {}).forEach(function (alert) {
      events.push({ at: alert.firstSeenAt || alert.lastSeenAt || alert.updatedAt, type: 'alert', title: 'BIB ' + alert.bib + ' COT ' + alert.level, detail: 'Alert raised · ' + (alert.reasonCode || 'COT_ALERT') + ' · ×' + Math.max(1, Number(alert.occurrenceCount) || 1) });
      if (alert.acknowledgedAt) {
        events.push({ at: alert.acknowledgedAt, type: 'acknowledgement', title: 'BIB ' + alert.bib + ' COT acknowledged', detail: 'Acknowledged by ' + (alert.acknowledgedBy || 'unknown') });
      }
    });
    return events.filter(function (event) { return event.at; }).sort(function (a, b) { return new Date(b.at) - new Date(a.at); });
  }

  function renderIncidentTimeline_(logs) {
    const body = document.getElementById('directorTimelineBody');
    if (!body) return;
    const events = timelineEvents_(logs).slice(0, 80);
    body.innerHTML = events.length ? events.map(function (event) {
      return '<div class="v19-timeline-row v19-timeline-' + UI.escapeHtml(event.type) + '"><span class="v19-timeline-dot"></span><div><strong>' + UI.escapeHtml(event.title) + '</strong><span>' + UI.escapeHtml(event.detail || '') + '</span></div><time>' + UI.escapeHtml(global.formatLogTime(event.at)) + '</time></div>';
    }).join('') : UI.emptyState('No command timeline events', 'Passages, alerts, incidents, safety notes, acknowledgements, and edits will appear here.');
    if (typeof global.setDirectorWidgetEmptyState_ === 'function') global.setDirectorWidgetEmptyState_('timeline', !events.length);
  }

  async function pullCheckpointStatuses_() {
    if (!global.syncUrl) return;
    try {
      const response = await fetch(global.syncUrl + (global.syncUrl.includes('?') ? '&' : '?') + 'action=checkpoint_status&nocache=' + Date.now(), { cache: 'no-store' });
      const data = await response.json();
      if (data.status === 'success') {
        (data.checkpointStatuses || []).forEach(function (item) {
          const local = localCheckpointStatuses_[item.checkpoint];
          if (!local || local.synced !== false) localCheckpointStatuses_[item.checkpoint] = Object.assign({}, item, { synced: true });
        });
        saveJson_('checkpointStatuses_v19', localCheckpointStatuses_);
        renderCheckpointHealth_();
      }
    } catch (_) {}
  }

  function derivedCheckpointStatus_(checkpoint, devices) {
    const manual = localCheckpointStatuses_[checkpoint];
    if (manual && ['Closing', 'Closed'].includes(manual.status)) return manual.status;
    const now = Date.now();
    const active = devices.filter(function (device) { return String(device.checkpoint || '').trim().toUpperCase() === checkpoint; });
    if (!active.length) return manual?.status || 'Offline';
    const newest = Math.max.apply(null, active.map(function (device) { return new Date(device.lastSeen || 0).getTime(); }));
    if (!Number.isFinite(newest) || now - newest > 5 * 60 * 1000) return 'Offline';
    if (active.some(function (device) { return Number(device.oldestQueueAgeMinutes) >= 10 || Number(device.queueCount) >= 20 || Math.abs(Number(device.clockOffsetMs)) > getClockDriftBlockSeconds_() * 1000; })) return 'Degraded';
    if (active.some(function (device) { return Number(device.queueCount) >= 5; })) return 'Busy';
    return manual?.status || 'Operational';
  }

  function renderCheckpointHealth_() {
    const body = document.getElementById('directorCheckpointHealthBody');
    if (!body) return;
    const devices = global.serverOperationsSummary_?.devices || [];
    const checkpointSet = new Set(devices.map(function (device) { return String(device.checkpoint || '').trim().toUpperCase(); }).filter(Boolean));
    Object.keys(localCheckpointStatuses_).forEach(function (checkpoint) { checkpointSet.add(checkpoint); });
    const checkpoints = Array.from(checkpointSet).sort();
    body.innerHTML = checkpoints.length ? checkpoints.map(function (checkpoint) {
      const status = derivedCheckpointStatus_(checkpoint, devices);
      const checkpointDevices = devices.filter(function (device) { return String(device.checkpoint || '').trim().toUpperCase() === checkpoint; });
      const queue = checkpointDevices.reduce(function (sum, device) { return sum + (Number(device.queueCount) || 0); }, 0);
      const statusClass = status.toLowerCase().replace(/\s+/g, '-');
      return '<div class="v19-checkpoint-health-row"><div><strong>' + UI.escapeHtml(checkpoint) + '</strong><span>' + checkpointDevices.length + ' device' + (checkpointDevices.length === 1 ? '' : 's') + ' · ' + queue + ' queued</span></div><select class="v19-checkpoint-status v19-cp-' + statusClass + '" onchange="setCheckpointHealthStatus_(\'' + encodeURIComponent(checkpoint) + '\', this.value)">' + ['Operational', 'Busy', 'Degraded', 'Offline', 'Closing', 'Closed'].map(function (option) { return '<option value="' + option + '"' + (option === status ? ' selected' : '') + '>' + option + '</option>'; }).join('') + '</select></div>';
    }).join('') : UI.emptyState('No checkpoint health reports', 'Device-health reports and manual checkpoint statuses will appear here.');
    if (typeof global.setDirectorWidgetEmptyState_ === 'function') global.setDirectorWidgetEmptyState_('checkpoint-health', !checkpoints.length);
  }

  global.setCheckpointHealthStatus_ = function (encodedCheckpoint, status) {
    const checkpoint = decodeURIComponent(encodedCheckpoint);
    const item = {
      checkpoint: checkpoint, status: status, note: '',
      updatedBy: (document.getElementById('volunteer')?.value || '').trim().toUpperCase(),
      updatedAt: new Date().toISOString(), synced: false
    };
    localCheckpointStatuses_[checkpoint] = item;
    saveJson_('checkpointStatuses_v19', localCheckpointStatuses_);
    renderCheckpointHealth_();
    global.syncPendingOperationalRecords_();
  };

  function installDirectorWidgets_() {
    if (Array.isArray(global.DIRECTOR_WIDGET_DEFS)) {
      if (!global.DIRECTOR_WIDGET_DEFS.some(function (item) { return item.id === 'timeline'; })) global.DIRECTOR_WIDGET_DEFS.push({ id: 'timeline', label: '🧾 Command Timeline', explain: 'COT alerts, incidents, safety notes, acknowledgements, checkpoint passages, and edits in time order.' });
      if (!global.DIRECTOR_WIDGET_DEFS.some(function (item) { return item.id === 'checkpoint-health'; })) global.DIRECTOR_WIDGET_DEFS.push({ id: 'checkpoint-health', label: '🚦 Checkpoint Health', explain: 'Operational, Busy, Degraded, Offline, Closing, and Closed checkpoint status.' });
    }
  }

  function installOverrides_() {
    global.checkDuplicateAndLog = checkDuplicateAndLogV19_;
    global.attemptSync = attemptSyncV19_;
    global.syncPendingOperationalRecords_ = syncPendingOperationalV19_;
    global.pushIncidentToServer_ = pushIncidentQueued_;
    global.pushSafetyNoteToServer_ = pushSafetyQueued_;
    global.evaluateCotAlerts_ = evaluateCotAlertsV19_;
    global.acknowledgeCotAlert_ = acknowledgeCotAlertV19_;
    global.renderSafetyCotAlerts_ = renderSafetyCotAlertsV19_;

    originalUpdateQueueStatus_ = global.updateQueueStatus;
    global.updateQueueStatus = function () {
      if (typeof originalUpdateQueueStatus_ === 'function') originalUpdateQueueStatus_();
      refreshQueueSummary_();
    };

    originalOpenSafetyLog_ = global.openSafetyLog;
    global.openSafetyLog = function () {
      if (typeof originalOpenSafetyLog_ === 'function') originalOpenSafetyLog_();
      fetchSafetyActionCard_();
    };

    originalOpenDirectorMode_ = global.openDirectorMode;
    global.openDirectorMode = function () {
      if (typeof originalOpenDirectorMode_ === 'function') originalOpenDirectorMode_();
      pullCheckpointStatuses_();
      fetchSafetyActionCard_();
    };

    originalRenderDirectorModeContent_ = global.renderDirectorModeContent_;
    global.renderDirectorModeContent_ = function (logs) {
      if (typeof originalRenderDirectorModeContent_ === 'function') originalRenderDirectorModeContent_(logs);
      renderIncidentTimeline_(logs || []);
      renderCheckpointHealth_();
    };

    originalRenderDirectorOperations_ = global.renderDirectorOperations_;
    global.renderDirectorOperations_ = function (logs) {
      if (typeof originalRenderDirectorOperations_ === 'function') originalRenderDirectorOperations_(logs);
      renderIncidentTimeline_(logs || []);
      renderCheckpointHealth_();
    };

    originalReportDeviceHealth_ = global.reportDeviceHealth_;
    global.reportDeviceHealth_ = async function () {
      const summary = await getQueueSummary_();
      if (summary.total > 0) return; // Operational traffic is drained first.
      if (typeof originalReportDeviceHealth_ === 'function') return originalReportDeviceHealth_();
    };
  }

  function initialise_() {
    installDirectorWidgets_();
    installOverrides_();
    refreshQueueSummary_();
    fetchSafetyActionCard_();
    const cachedReconciliation = loadJson_(RC.serverReconciliationKey, null);
    if (cachedReconciliation) renderReconciliationBadge_(cachedReconciliation);
    renderClockDriftBlocker_(clockDriftState_());
    clearInterval(queueRefreshTimer_);
    queueRefreshTimer_ = setInterval(refreshQueueSummary_, 5000);
    clearInterval(reconciliationTimer_);
    reconciliationTimer_ = setInterval(function () { if (!document.hidden && global.syncUrl) fetchServerReconciliation_(); }, RC.reconciliationRefreshMs);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) { refreshQueueSummary_(); renderClockDriftBlocker_(clockDriftState_()); } });
    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      if (!document.getElementById('v19DecisionModal')?.classList.contains('hidden')) closeDecision_(false);
      else if (!document.getElementById('reconciliationView')?.classList.contains('hidden')) global.closeReconciliationScreen_();
      else if (!document.getElementById('recoveryWizard')?.classList.contains('hidden')) global.closeRecoveryWizard_();
    });
  }

  global.RaceV19 = Object.freeze({
    getQueueSummary: getQueueSummary_,
    refreshQueueSummary: refreshQueueSummary_,
    fetchServerReconciliation: fetchServerReconciliation_,
    renderTimeline: renderIncidentTimeline_,
    renderCheckpointHealth: renderCheckpointHealth_,
    fetchSafetyActionCard: fetchSafetyActionCard_,
    clockDriftState: clockDriftState_
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialise_, { once: true });
  else initialise_();
})(window);
