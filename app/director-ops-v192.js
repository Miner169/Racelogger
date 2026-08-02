/* Race Bib Logger v19.3.4 director analytics suite.
 * Keeps high-value forecasting, safety analysis and reporting while removing
 * the operational boards requested for a cleaner command view.
 */
(function (global) {
  'use strict';

  const VERSION = '19.3.4';
  const STORE_KEY = 'raceCommandOps_v19_2';
  const HEATMAP_WINDOW_KEY = 'directorHeatmapWindow_v19_2';
  const OPS_EPOCH_KEY = 'raceCommandOpsEventEpoch_v19_2';
  const UI = global.RaceComponents || {};
  let commandOps_ = loadJson_(STORE_KEY, {});
  let lastLogs_ = [];
  let syncTimer_ = null;
  let pullInFlight_ = null;
  let activeOpId_ = '';
  let heatmapWindowMinutes_ = Number(localStorage.getItem(HEATMAP_WINDOW_KEY) || 60) || 60;

  const WIDGETS = [
    ['heatmap', '🔥 Checkpoint Load Heatmap', 'Scans per minute by checkpoint and rolling time block.'],
    ['cot-funnel', '⏳ COT Risk Funnel', 'Safe, approaching, critical, overdue, acknowledged, and resolved runners.'],
    ['route-anomalies', '🧭 Route Anomaly Diagram', 'Skipped checkpoints, reverse movement, impossible travel, and approved exceptions.'],
    ['finish-projection', '🏁 Finish Projection', 'Estimated finish windows and runner counts by KM and category.'],
    ['outcomes', '📋 DNS / DNF / Withdrawal / Medical', 'Operational totals and unresolved runner outcomes.']
  ];
  const REMOVED_WIDGET_IDS = Object.freeze([
    'incidents', 'timeline', 'missing-runners', 'medical-capacity',
    'transport-sweep', 'weather-risk', 'supplies', 'handover', 'post-race-report'
  ]);

  const TYPE_CONFIG = {
    missing_runner: {
      label: 'Missing runner', icon: '🔎', statuses: ['open', 'searching', 'contacted', 'sighted', 'resolved'],
      fields: [
        ['calls', 'Contact attempts', 'number'], ['searches', 'Search actions', 'number'],
        ['lastSighting', 'Last sighting / source', 'text'], ['resolution', 'Resolution', 'text']
      ]
    },
    medical_resource: {
      label: 'Medical team / resource', icon: '🚑', statuses: ['available', 'busy', 'responding', 'transporting', 'offline'],
      fields: [
        ['vehicle', 'Vehicle / call sign', 'text'], ['activeCases', 'Active cases', 'number'],
        ['capacity', 'Capacity', 'number'], ['destination', 'Destination', 'text'], ['notes', 'Operational notes', 'text']
      ]
    },
    transport_resource: {
      label: 'Sweep / transport resource', icon: '🚌', statuses: ['available', 'requested', 'dispatching', 'pickup', 'transporting', 'complete', 'offline'],
      fields: [
        ['resourceKind', 'Resource type', 'text'], ['capacity', 'Capacity', 'number'],
        ['passengers', 'Passengers', 'number'], ['pickupRequests', 'Open pickup requests', 'number'],
        ['destination', 'Destination / route', 'text'], ['notes', 'Operational notes', 'text']
      ]
    },
    checkpoint_supply: {
      label: 'Checkpoint supplies', icon: '📦', statuses: ['good', 'watch', 'low', 'critical', 'resupply_requested', 'resupply_enroute'],
      fields: [
        ['water', 'Water', 'text'], ['food', 'Food', 'text'], ['ice', 'Ice', 'text'],
        ['lighting', 'Lighting', 'text'], ['radios', 'Radios', 'text'], ['medicalStock', 'Medical stock', 'text'],
        ['resupply', 'Resupply request / ETA', 'text']
      ]
    }
  };

  function loadJson_(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || '') || fallback; } catch (_) { return fallback; }
  }
  function saveJson_(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* storage may be full */ }
  }
  function adoptOpsEpoch_(serverEpoch) {
    const epoch = String(serverEpoch || '').trim();
    if (!epoch) return false;
    const stored = String(localStorage.getItem(OPS_EPOCH_KEY) || '').trim();
    if (stored && stored !== epoch) {
      commandOps_ = {};
      saveJson_(STORE_KEY, commandOps_);
    }
    localStorage.setItem(OPS_EPOCH_KEY, epoch);
    return stored !== epoch;
  }
  function localEventEpoch_() {
    const key = global.LOCAL_EVENT_EPOCH_KEY_ || 'localEventEpoch';
    return String(localStorage.getItem(key) || localStorage.getItem(OPS_EPOCH_KEY) || '').trim();
  }
  function esc_(value) {
    if (UI.escapeHtml) return UI.escapeHtml(value == null ? '' : String(value));
    return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }
  function attr_(value) { return esc_(value).replace(/`/g, '&#96;'); }
  function nowIso_() { return new Date().toISOString(); }
  function uid_() {
    if (typeof global.generateUID === 'function') return global.generateUID();
    return 'op-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
  }
  function parseMs_(value) {
    if (!value) return NaN;
    try {
      const d = typeof global.parseCustomOrIsoDate === 'function' ? global.parseCustomOrIsoDate(value) : new Date(value);
      return d instanceof Date ? d.getTime() : Number(d);
    } catch (_) { return Date.parse(value); }
  }
  function ageLabel_(value) {
    const ms = typeof value === 'number' ? value : parseMs_(value);
    if (!Number.isFinite(ms)) return 'unknown';
    const seconds = Math.max(0, Math.floor((Date.now() - ms) / 1000));
    if (seconds < 60) return seconds + 's ago';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + 'm ago';
    const hours = Math.floor(minutes / 60);
    if (hours < 48) return hours + 'h ' + (minutes % 60) + 'm ago';
    return Math.floor(hours / 24) + 'd ago';
  }
  function durationLabel_(start, end) {
    const a = parseMs_(start), b = parseMs_(end || Date.now());
    if (!Number.isFinite(a) || !Number.isFinite(b)) return '—';
    const minutes = Math.max(0, Math.floor((b - a) / 60000));
    if (minutes < 60) return minutes + 'm';
    return Math.floor(minutes / 60) + 'h ' + (minutes % 60) + 'm';
  }
  function formatTime_(value) {
    if (typeof global.formatLogTime === 'function') return global.formatLogTime(value);
    const ms = parseMs_(value); return Number.isFinite(ms) ? new Date(ms).toLocaleString() : '—';
  }
  function countable_(log) { return typeof global.isCountableLog_ === 'function' ? global.isCountableLog_(log) : !!log && !log.pendingDelete; }
  function bibKey_(log) { return typeof global.bibIdentityKey_ === 'function' ? global.bibIdentityKey_(log) : String(log?.bib || '').trim().toUpperCase(); }
  function completion_(checkpoint) { return typeof global.isCompletionCheckpoint_ === 'function' ? global.isCompletionCheckpoint_(checkpoint) : /FINISH/i.test(String(checkpoint || '')); }
  function currentVolunteer_() { return (document.getElementById('volunteer')?.value || '').trim().toUpperCase(); }
  function currentDevice_() { return typeof global.getOrCreateDeviceId === 'function' ? global.getOrCreateDeviceId() : ''; }
  function currentGps_() {
    const health = (global.serverOperationsSummary_?.devices || []).find(d => d.deviceId === currentDevice_());
    return { latitude: health?.latitude ?? null, longitude: health?.longitude ?? null };
  }
  function opArray_(type) {
    return Object.values(commandOps_).filter(item => item && (!type || item.type === type));
  }
  function saveOps_() { saveJson_(STORE_KEY, commandOps_); }
  function statusClass_(status) { return 'v192-status-' + String(status || 'open').toLowerCase().replace(/[^a-z0-9]+/g, '-'); }
  function openStatus_(status) { return !['resolved', 'closed', 'complete'].includes(String(status || '').toLowerCase()); }
  function setEmpty_(id, empty) { if (typeof global.setDirectorWidgetEmptyState_ === 'function') global.setDirectorWidgetEmptyState_(id, !!empty); }

  function injectStyles_() {
    if (document.getElementById('v192Styles')) return;
    const style = document.createElement('style');
    style.id = 'v192Styles';
    style.textContent = `
      .v192-widget-body{display:flex;flex-direction:column;gap:.55rem;padding:.75rem;overflow:auto}
      .v192-toolbar{display:flex;align-items:center;justify-content:space-between;gap:.5rem;flex-wrap:wrap}
      .v192-btn{border:1px solid var(--border-color,#444);border-radius:.55rem;padding:.42rem .65rem;font-size:.68rem;font-weight:900;background:var(--input-bg);color:var(--text-color);min-height:34px}
      .v192-btn-primary{background:#2563eb;color:#fff;border-color:#2563eb}.v192-btn-danger{background:#b91c1c;color:#fff;border-color:#b91c1c}.v192-btn-good{background:#047857;color:#fff;border-color:#047857}
      .v192-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:.5rem}.v192-stat{border:1px solid var(--border-color);border-radius:.75rem;padding:.65rem;background:color-mix(in srgb,var(--panel-bg,#171717) 88%,transparent)}
      .v192-stat strong{display:block;font-size:1.45rem;line-height:1;font-weight:950}.v192-stat span{display:block;font-size:.62rem;text-transform:uppercase;letter-spacing:.06em;font-weight:900;opacity:.72;margin-top:.3rem}.v192-stat small{display:block;font-size:.62rem;opacity:.7;margin-top:.25rem}
      .v192-row{border:1px solid var(--border-color);border-radius:.7rem;padding:.6rem;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:.45rem;align-items:center}.v192-row-main{min-width:0}.v192-row-main strong{display:block;font-size:.78rem}.v192-row-main span{display:block;font-size:.65rem;opacity:.72;white-space:normal}.v192-row-actions{display:flex;gap:.3rem;flex-wrap:wrap;justify-content:flex-end}
      .v192-pill{display:inline-flex;align-items:center;gap:.25rem;border:1px solid currentColor;border-radius:999px;padding:.2rem .45rem;font-size:.58rem;font-weight:950;text-transform:uppercase;letter-spacing:.04em}
      .v192-status-resolved,.v192-status-complete,.v192-status-available,.v192-status-good{color:#10b981}.v192-status-critical,.v192-status-overdue,.v192-status-missing,.v192-status-offline{color:#ef4444}.v192-status-warning,.v192-status-searching,.v192-status-low,.v192-status-watch,.v192-status-busy,.v192-status-resupply-requested{color:#f59e0b}.v192-status-responding,.v192-status-dispatching,.v192-status-transporting,.v192-status-resupply-enroute{color:#60a5fa}
      .v192-heatmap-wrap{overflow:auto;border:1px solid var(--border-color);border-radius:.65rem}.v192-heatmap{border-collapse:separate;border-spacing:2px;width:100%;min-width:680px;font-size:.6rem}.v192-heatmap th{position:sticky;top:0;background:var(--panel-bg);z-index:2;padding:.3rem;white-space:nowrap}.v192-heatmap th:first-child,.v192-heatmap td:first-child{position:sticky;left:0;background:var(--panel-bg);z-index:3;font-weight:900;text-align:left;min-width:115px}.v192-heatmap td{height:30px;min-width:38px;text-align:center;border-radius:.28rem;font-weight:900}.v192-h0{background:rgba(120,120,120,.08)}.v192-h1{background:rgba(34,197,94,.24)}.v192-h2{background:rgba(250,204,21,.34)}.v192-h3{background:rgba(249,115,22,.48)}.v192-h4{background:rgba(239,68,68,.62);color:#fff}
      .v192-funnel{display:flex;flex-direction:column;gap:.35rem}.v192-funnel-row{display:grid;grid-template-columns:105px 1fr 44px;gap:.45rem;align-items:center;font-size:.65rem;font-weight:900}.v192-funnel-track{height:18px;border-radius:999px;background:rgba(120,120,120,.12);overflow:hidden}.v192-funnel-fill{height:100%;min-width:2px;border-radius:inherit;background:currentColor;opacity:.8}
      .v192-route-flow{display:flex;align-items:center;gap:.3rem;overflow:auto;padding:.45rem 0}.v192-route-node{border:1px solid var(--border-color);border-radius:.55rem;padding:.35rem .5rem;font-size:.62rem;font-weight:900;white-space:nowrap}.v192-route-arrow{opacity:.55}.v192-route-bad{border-color:#ef4444;color:#ef4444}.v192-route-approved{border-color:#10b981;color:#10b981}
      .v192-projection-table{width:100%;border-collapse:collapse;font-size:.63rem}.v192-projection-table th,.v192-projection-table td{padding:.45rem;border-bottom:1px solid var(--border-color);text-align:left}.v192-projection-table th{font-size:.57rem;text-transform:uppercase;letter-spacing:.05em;opacity:.7}.v192-projection-table td:nth-child(n+2),.v192-projection-table th:nth-child(n+2){text-align:right}
      .v192-device-layer{margin-top:.55rem;border-top:1px solid var(--border-color);padding-top:.55rem;display:flex;flex-direction:column;gap:.35rem}.v192-device-row{display:grid;grid-template-columns:minmax(115px,1fr) repeat(5,minmax(68px,auto));gap:.35rem;align-items:center;font-size:.6rem;border:1px solid var(--border-color);border-radius:.55rem;padding:.45rem}.v192-device-row strong{font-size:.65rem}.v192-device-row span{white-space:nowrap}.v192-device-head{font-weight:950;text-transform:uppercase;opacity:.62}
      .v192-risk-critical{border-color:#ef4444;background:rgba(239,68,68,.09)}.v192-risk-warning{border-color:#f59e0b;background:rgba(245,158,11,.09)}.v192-risk-normal{border-color:#10b981;background:rgba(16,185,129,.07)}
      .v192-pre{white-space:pre-wrap;font-size:.67rem;line-height:1.55;border:1px solid var(--border-color);border-radius:.65rem;padding:.75rem;max-height:360px;overflow:auto;background:rgba(0,0,0,.08)}
      .v192-modal{position:fixed;inset:0;z-index:180;background:rgba(0,0,0,.86);display:flex;align-items:center;justify-content:center;padding:1rem}.v192-modal.hidden{display:none}.v192-modal-card{width:min(680px,100%);max-height:92vh;overflow:auto;border:1px solid var(--border-color);border-radius:1rem;background:var(--panel-bg,#171717);padding:1rem;display:flex;flex-direction:column;gap:.75rem}.v192-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.65rem}.v192-field{display:flex;flex-direction:column;gap:.25rem}.v192-field label{font-size:.58rem;text-transform:uppercase;letter-spacing:.06em;font-weight:950;opacity:.7}.v192-field input,.v192-field select,.v192-field textarea{width:100%;border:1px solid var(--border-color);border-radius:.55rem;padding:.65rem;background:var(--input-bg);color:var(--text-color);font-size:.75rem}.v192-span-2{grid-column:span 2}
      @media(max-width:700px){.v192-device-row{grid-template-columns:1fr 1fr}.v192-device-head{display:none}.v192-form-grid{grid-template-columns:1fr}.v192-span-2{grid-column:auto}}
    `;
    document.head.appendChild(style);
  }

  function sectionHtml_(id, title, explain) {
    return `<section id="widget-${id}" data-widget="${id}" class="theme-panel rounded-2xl border shadow overflow-hidden flex flex-col">
      <div class="px-4 py-3 border-b theme-border bg-neutral-200/50 dark:bg-neutral-900/10 flex items-start gap-2">
        <span class="widget-drag-handle icon-tap-target text-neutral-400 text-sm mt-0.5" onpointerdown="startWidgetDrag_(event, '${id}')" title="Drag to rearrange">⠿</span>
        <div class="min-w-0 flex-1"><h2 class="text-xs sm:text-sm font-black theme-text-muted uppercase tracking-wider">${title}</h2><p class="text-[10px] theme-text-muted mt-0.5">${explain}</p></div>
        <div class="widget-width-controls flex gap-1 shrink-0" data-widget-controls="${id}"></div>
      </div><div id="director-${id}-body" class="v192-widget-body"><div class="text-center theme-text-muted text-xs p-4">Waiting for command data.</div></div>
    </section>`;
  }

  function injectWidgets_() {
    REMOVED_WIDGET_IDS.forEach(id => {
      document.getElementById('widget-' + id)?.remove();
    });
    const grid = document.getElementById('directorWidgetsGrid');
    if (!grid) return;
    WIDGETS.forEach(([id, title, explain]) => {
      if (document.getElementById('widget-' + id)) return;
      grid.insertAdjacentHTML('beforeend', sectionHtml_(id, title, explain));
    });
    if (typeof global.populateDirectorWidthControls_ === 'function') global.populateDirectorWidthControls_();
    if (typeof global.restoreDirectorWidgetLayout_ === 'function') global.restoreDirectorWidgetLayout_();
  }

  function injectModal_() {
    if (document.getElementById('v192CommandOpModal')) return;
    document.body.insertAdjacentHTML('beforeend', `<div id="v192CommandOpModal" class="v192-modal hidden" role="dialog" aria-modal="true">
      <div class="v192-modal-card theme-panel">
        <div class="v192-toolbar"><div><h3 id="v192OpTitle" class="text-lg font-black theme-text">Command operation</h3><p class="text-[10px] theme-text-muted">Changes save locally first and synchronize when connectivity is available.</p></div><button type="button" class="v192-btn" onclick="closeV192CommandOp_()">✕</button></div>
        <div class="v192-form-grid">
          <div class="v192-field"><label>Record type</label><select id="v192OpType" onchange="renderV192OpFields_()"></select></div>
          <div class="v192-field"><label>Status</label><select id="v192OpStatus"></select></div>
          <div class="v192-field"><label>Name / team / resource</label><input id="v192OpName" maxlength="100"></div>
          <div class="v192-field"><label>BIB</label><input id="v192OpBib" maxlength="64" autocapitalize="characters"></div>
          <div class="v192-field"><label>Checkpoint / location</label><input id="v192OpCheckpoint" maxlength="100" autocapitalize="characters"></div>
          <div class="v192-field"><label>Owner</label><input id="v192OpOwner" maxlength="100"></div>
          <div id="v192OpDetailFields" class="contents"></div>
        </div>
        <div class="grid grid-cols-2 gap-2"><button type="button" class="v192-btn" onclick="closeV192CommandOp_()">Cancel</button><button type="button" class="v192-btn v192-btn-primary" onclick="saveV192CommandOp_()">Save operation</button></div>
      </div></div>`);
  }

  function typeOptions_() {
    return Object.entries(TYPE_CONFIG).map(([value, cfg]) => `<option value="${attr_(value)}">${cfg.icon} ${esc_(cfg.label)}</option>`).join('');
  }
  function renderOpFields_() {
    const type = document.getElementById('v192OpType')?.value || 'missing_runner';
    const cfg = TYPE_CONFIG[type] || TYPE_CONFIG.missing_runner;
    const status = document.getElementById('v192OpStatus');
    const current = status?.value || '';
    if (status) {
      status.innerHTML = cfg.statuses.map(value => `<option value="${attr_(value)}">${esc_(value.replace(/_/g, ' '))}</option>`).join('');
      status.value = cfg.statuses.includes(current) ? current : cfg.statuses[0];
    }
    const fields = document.getElementById('v192OpDetailFields');
    if (!fields) return;
    const item = activeOpId_ ? commandOps_[activeOpId_] : null;
    fields.innerHTML = cfg.fields.map(([key, label, inputType]) => {
      const value = item?.details?.[key] ?? '';
      return `<div class="v192-field ${key === 'notes' || key === 'resolution' || key === 'resupply' ? 'v192-span-2' : ''}"><label>${esc_(label)}</label>${inputType === 'number' ? `<input data-v192-detail="${attr_(key)}" type="number" min="0" value="${attr_(value)}">` : `<input data-v192-detail="${attr_(key)}" type="text" value="${attr_(value)}" maxlength="500">`}</div>`;
    }).join('');
  }

  global.renderV192OpFields_ = renderOpFields_;
  global.closeV192CommandOp_ = function () { document.getElementById('v192CommandOpModal')?.classList.add('hidden'); activeOpId_ = ''; };
  global.openV192CommandOp_ = function (type, encodedId) {
    injectModal_();
    activeOpId_ = encodedId ? decodeURIComponent(encodedId) : '';
    const item = activeOpId_ ? commandOps_[activeOpId_] : null;
    const typeSelect = document.getElementById('v192OpType');
    typeSelect.innerHTML = typeOptions_();
    typeSelect.value = item?.type || type || 'missing_runner';
    document.getElementById('v192OpName').value = item?.name || '';
    document.getElementById('v192OpBib').value = item?.bib || '';
    document.getElementById('v192OpCheckpoint').value = item?.checkpoint || (document.getElementById('checkpoint')?.value || '');
    document.getElementById('v192OpOwner').value = item?.owner || currentVolunteer_();
    document.getElementById('v192OpTitle').textContent = (TYPE_CONFIG[typeSelect.value]?.icon || '🧭') + ' ' + (item ? 'Edit ' : 'Add ') + (TYPE_CONFIG[typeSelect.value]?.label || 'operation');
    renderOpFields_();
    if (item) document.getElementById('v192OpStatus').value = item.status || TYPE_CONFIG[typeSelect.value].statuses[0];
    document.getElementById('v192CommandOpModal').classList.remove('hidden');
  };

  global.saveV192CommandOp_ = function () {
    const type = document.getElementById('v192OpType')?.value || 'missing_runner';
    const cfg = TYPE_CONFIG[type];
    if (!cfg) return;
    const existing = activeOpId_ ? commandOps_[activeOpId_] : null;
    const gps = currentGps_();
    const details = Object.assign({}, existing?.details || {});
    document.querySelectorAll('[data-v192-detail]').forEach(input => {
      const key = input.dataset.v192Detail;
      details[key] = input.type === 'number' ? Math.max(0, Number(input.value) || 0) : input.value.trim();
    });
    const now = nowIso_();
    const item = {
      id: existing?.id || uid_(), type,
      name: (document.getElementById('v192OpName')?.value || '').trim(),
      bib: (document.getElementById('v192OpBib')?.value || '').trim().toUpperCase(),
      checkpoint: (document.getElementById('v192OpCheckpoint')?.value || '').trim().toUpperCase(),
      status: document.getElementById('v192OpStatus')?.value || cfg.statuses[0],
      owner: (document.getElementById('v192OpOwner')?.value || '').trim(), details,
      createdAt: existing?.createdAt || now, updatedAt: now, updatedBy: currentVolunteer_(), deviceId: currentDevice_(),
      latitude: gps.latitude, longitude: gps.longitude, synced: false
    };
    commandOps_[item.id] = item;
    saveOps_();
    global.closeV192CommandOp_();
    renderAll_();
    syncPendingOps_();
  };

  async function postCommandOp_(item) {
    if (!global.syncUrl || !navigator.onLine) return null;
    const response = await fetch(global.syncUrl + (global.syncUrl.includes('?') ? '&' : '?') + 'nocache=' + Date.now(), {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'command_op_upsert', commandOp: item })
    });
    const data = await response.json();
    if (data.status !== 'success' || !data.commandOp) throw new Error(data.message || 'Command operation sync failed.');
    return data.commandOp;
  }

  async function syncPendingOps_() {
    if (!global.syncUrl || !navigator.onLine) return;
    const pending = opArray_().filter(item => item.synced === false)
      .sort((a, b) => parseMs_(a.updatedAt) - parseMs_(b.updatedAt)).slice(0, 50);
    if (!pending.length) return;
    try {
      const response = await fetch(global.syncUrl + (global.syncUrl.includes('?') ? '&' : '?') + 'nocache=' + Date.now(), {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'operational_batch', commandOps: pending, eventEpoch: localEventEpoch_() })
      });
      const data = await response.json();
      if (data.eventEpoch) adoptOpsEpoch_(data.eventEpoch);
      if (data.status !== 'success') throw new Error(data.message || 'Command operation batch sync failed.');
      const confirmed = new Set();
      (data.commandOps || []).forEach(saved => {
        if (!saved?.id) return;
        confirmed.add(saved.id);
        commandOps_[saved.id] = Object.assign({}, saved, { synced: true });
      });
      // Records omitted by the server remain queued and will retry with backoff from
      // the main operational synchronizer or on the next foreground sync cycle.
      pending.forEach(item => {
        if (!confirmed.has(item.id) && commandOps_[item.id]) commandOps_[item.id].synced = false;
      });
      saveOps_(); renderAll_();
    } catch (_) { /* retain the exact offline queue */ }
  }

  async function pullCommandOps_() {
    if (!global.syncUrl || pullInFlight_) return pullInFlight_;
    pullInFlight_ = (async () => {
      try {
        const response = await fetch(global.syncUrl + (global.syncUrl.includes('?') ? '&' : '?') + 'action=command_ops&nocache=' + Date.now(), { cache: 'no-store' });
        const data = await response.json();
        if (data.eventEpoch) adoptOpsEpoch_(data.eventEpoch);
        if (data.status !== 'success') throw new Error(data.message || 'Command operations unavailable.');
        (data.commandOps || []).forEach(item => {
          const local = commandOps_[item.id];
          if (!local || local.synced !== false) commandOps_[item.id] = Object.assign({}, item, { synced: true });
        });
        if (data.weatherRisk) {
          global.serverOperationsSummary_ = Object.assign({}, global.serverOperationsSummary_ || {}, { weatherRisk: data.weatherRisk });
        }
        saveOps_(); renderAll_();
      } catch (_) { /* retain offline board */ }
      finally { pullInFlight_ = null; }
    })();
    return pullInFlight_;
  }

  global.v192QuickOpAction_ = function (encodedId, action) {
    const id = decodeURIComponent(encodedId); const item = commandOps_[id]; if (!item) return;
    const now = nowIso_();
    if (action === 'call') item.details.calls = Math.max(0, Number(item.details.calls) || 0) + 1;
    if (action === 'search') item.details.searches = Math.max(0, Number(item.details.searches) || 0) + 1;
    if (action === 'sighting') {
      const value = prompt('Record the sighting, location, source, or time:', item.details.lastSighting || '');
      if (value === null) return; item.details.lastSighting = value.trim(); item.status = 'sighted';
    }
    if (action === 'resolve') {
      const value = prompt('Resolution details:', item.details.resolution || '');
      if (value === null || !value.trim()) return; item.details.resolution = value.trim(); item.status = 'resolved'; item.details.resolvedAt = now;
    }
    item.updatedAt = now; item.updatedBy = currentVolunteer_(); item.synced = false;
    saveOps_(); renderAll_(); syncPendingOps_();
  };

  function renderHeatmap_(logs) {
    const el = document.getElementById('director-heatmap-body'); if (!el) return;
    const windowMinutes = [60, 120, 240].includes(heatmapWindowMinutes_) ? heatmapWindowMinutes_ : 60;
    const bucketCount = 12, bucketMinutes = windowMinutes / bucketCount, now = Date.now();
    const counts = new Map();
    (logs || []).filter(countable_).forEach(log => {
      const ts = parseMs_(log.time), age = now - ts;
      if (!Number.isFinite(ts) || age < 0 || age >= windowMinutes * 60000) return;
      const cp = String(log.checkpoint || 'Unspecified').trim() || 'Unspecified';
      const bucket = bucketCount - 1 - Math.floor(age / (bucketMinutes * 60000));
      if (!counts.has(cp)) counts.set(cp, new Array(bucketCount).fill(0));
      counts.get(cp)[Math.max(0, Math.min(bucketCount - 1, bucket))]++;
    });
    const rows = Array.from(counts.entries()).sort((a, b) => b[1].reduce((x,y)=>x+y,0) - a[1].reduce((x,y)=>x+y,0));
    const max = Math.max(1, ...rows.flatMap(row => row[1]));
    const level = count => count === 0 ? 0 : count / max <= .25 ? 1 : count / max <= .5 ? 2 : count / max <= .75 ? 3 : 4;
    const headers = new Array(bucketCount).fill(0).map((_, i) => {
      const end = windowMinutes - (i + 1) * bucketMinutes;
      return `<th>${end <= 0 ? 'Now' : '-' + Math.round(end) + 'm'}</th>`;
    }).join('');
    el.innerHTML = `<div class="v192-toolbar"><span class="text-[10px] theme-text-muted">Each cell is ${bucketMinutes} minutes; colour scales to the busiest cell.</span><select class="v192-btn" onchange="setV192HeatmapWindow_(this.value)">${[60,120,240].map(v=>`<option value="${v}"${v===windowMinutes?' selected':''}>Last ${v} min</option>`).join('')}</select></div>` +
      (rows.length ? `<div class="v192-heatmap-wrap"><table class="v192-heatmap"><thead><tr><th>Checkpoint</th>${headers}<th>Total</th></tr></thead><tbody>${rows.map(([cp, values]) => `<tr><td>${esc_(cp)}</td>${values.map(count => `<td class="v192-h${level(count)}" title="${count} scans">${count}</td>`).join('')}<td>${values.reduce((a,b)=>a+b,0)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="text-center theme-text-muted text-xs p-4">No scans in the selected time window.</div>');
    setEmpty_('heatmap', !rows.length);
  }
  global.setV192HeatmapWindow_ = function (value) { heatmapWindowMinutes_ = Number(value) || 60; localStorage.setItem(HEATMAP_WINDOW_KEY, String(heatmapWindowMinutes_)); renderHeatmap_(lastLogs_); };

  function buildCotFunnel_(logs) {
    const alerts = Object.values(global.localCotAlerts_ || {});
    const byBib = new Map();
    alerts.forEach(alert => {
      const bib = String(alert.bib || '').trim().toUpperCase();
      if (!bib) return;
      const prior = byBib.get(bib);
      const rank = { overdue: 4, critical: 3, warning: 2 };
      if (!prior || (rank[alert.level] || 0) >= (rank[prior.level] || 0)) byBib.set(bib, alert);
    });
    const uniqueBibs = new Set((logs || []).filter(countable_).map(bibKey_).filter(Boolean));
    const counts = { safe: 0, approaching: 0, critical: 0, overdue: 0, acknowledged: 0, resolved: 0 };
    uniqueBibs.forEach(bib => {
      const alert = byBib.get(bib);
      if (!alert) { counts.safe++; return; }
      if (alert.resolved || String(alert.acknowledgedBy || '').startsWith('SYSTEM-FINISH')) counts.resolved++;
      else if (alert.acknowledged) counts.acknowledged++;
      else if (alert.level === 'overdue') counts.overdue++;
      else if (alert.level === 'critical') counts.critical++;
      else counts.approaching++;
    });
    alerts.forEach(alert => {
      const bib = String(alert.bib || '').trim().toUpperCase();
      if (uniqueBibs.has(bib)) return;
      if (alert.resolved) counts.resolved++; else if (alert.acknowledged) counts.acknowledged++; else if (alert.level === 'overdue') counts.overdue++; else if (alert.level === 'critical') counts.critical++; else counts.approaching++;
    });
    return counts;
  }

  function renderCotFunnel_(logs) {
    const el = document.getElementById('director-cot-funnel-body'); if (!el) return;
    const counts = buildCotFunnel_(logs), max = Math.max(1, ...Object.values(counts));
    const rows = [
      ['Safe', 'safe', '#10b981'], ['Approaching', 'approaching', '#fbbf24'], ['Critical', 'critical', '#f97316'],
      ['Overdue', 'overdue', '#ef4444'], ['Acknowledged', 'acknowledged', '#60a5fa'], ['Resolved', 'resolved', '#a78bfa']
    ];
    const awaitingResolution = Object.values(global.localCotAlerts_ || {}).filter(a => a?.acknowledged && !a?.resolved)
      .sort((a,b) => parseMs_(a.cotTime) - parseMs_(b.cotTime)).slice(0, 8);
    el.innerHTML = `<div class="v192-funnel">${rows.map(([label,key,color]) => `<div class="v192-funnel-row" style="color:${color}"><span>${label}</span><div class="v192-funnel-track"><div class="v192-funnel-fill" style="width:${Math.max(1,counts[key]/max*100)}%"></div></div><strong>${counts[key]}</strong></div>`).join('')}</div><p class="text-[9px] theme-text-muted">Approaching = warning window. Acknowledged remains open until a command user records resolution or a confirmed finish closes it.</p>${awaitingResolution.length ? `<div class="mt-2 border-t theme-border pt-2"><div class="text-[9px] font-black uppercase theme-text-muted mb-1">Acknowledged — awaiting resolution</div>${awaitingResolution.map(a => `<div class="v192-row"><div class="v192-row-main"><strong>BIB ${esc_(a.bib)} · ${esc_(a.level || 'alert')}</strong><span>${esc_(a.category || 'Uncategorized')} · acknowledged by ${esc_(a.acknowledgedBy || 'unknown')} ${ageLabel_(a.acknowledgedAt)}</span></div><div class="v192-row-actions"><button class="v192-btn v192-btn-good" onclick="resolveV192CotAlert_('${encodeURIComponent(a.key)}')">Resolve</button></div></div>`).join('')}</div>` : ''}`;
    setEmpty_('cot-funnel', Object.values(counts).reduce((a,b)=>a+b,0) === 0);
  }

  global.resolveV192CotAlert_ = async function (encodedKey) {
    const key = decodeURIComponent(encodedKey || '');
    const alert = global.localCotAlerts_?.[key];
    if (!alert) return;
    const resolution = prompt('Resolution details for BIB ' + (alert.bib || '') + ':', alert.resolution || '');
    if (resolution === null || !resolution.trim()) return;
    const now = nowIso_();
    alert.resolved = true;
    alert.resolvedBy = currentVolunteer_() || 'COMMAND';
    alert.resolvedAt = now;
    alert.resolution = resolution.trim();
    alert.updatedAt = now;
    alert.synced = false;
    try { global.db?.transaction(['cotAlerts'], 'readwrite').objectStore('cotAlerts').put(alert); } catch (_) { /* IndexedDB may be unavailable */ }
    renderCotFunnel_(lastLogs_);
    if (!global.syncUrl || !navigator.onLine) return;
    try {
      const response = await fetch(global.syncUrl + (global.syncUrl.includes('?') ? '&' : '?') + 'nocache=' + Date.now(), {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'cot_alert_upsert', alert })
      });
      const data = await response.json();
      if (data.status === 'success' && data.alert) {
        Object.assign(alert, data.alert, { synced: true });
        try { global.db?.transaction(['cotAlerts'], 'readwrite').objectStore('cotAlerts').put(alert); } catch (_) { /* optional */ }
      }
    } catch (_) { /* queued by the existing operational sync path */ }
    renderCotFunnel_(lastLogs_);
  };

  function renderMissingRunners_() {
    const el = document.getElementById('director-missing-runners-body'); if (!el) return;
    const items = opArray_('missing_runner').filter(item => openStatus_(item.status)).sort((a,b)=>parseMs_(b.updatedAt)-parseMs_(a.updatedAt));
    el.innerHTML = `<div class="v192-toolbar"><span class="text-[10px] theme-text-muted">${items.length} active missing-runner case${items.length===1?'':'s'}</span><button class="v192-btn v192-btn-primary" onclick="openV192CommandOp_('missing_runner')">＋ Add missing runner</button></div>` + (items.length ? items.map(item => `<div class="v192-row"><div class="v192-row-main"><strong>BIB ${esc_(item.bib || 'UNKNOWN')} · ${esc_(item.name || 'Runner')}</strong><span><span class="v192-pill ${statusClass_(item.status)}">${esc_(item.status)}</span> Owner: ${esc_(item.owner || 'unassigned')} · ${esc_(item.checkpoint || 'location unknown')} · open ${durationLabel_(item.createdAt)}</span><span>${Number(item.details?.calls)||0} calls · ${Number(item.details?.searches)||0} searches${item.details?.lastSighting?' · Last sighting: '+esc_(item.details.lastSighting):''}${item.synced===false?' · QUEUED':''}</span></div><div class="v192-row-actions"><button class="v192-btn" onclick="v192QuickOpAction_('${encodeURIComponent(item.id)}','call')">☎ +Call</button><button class="v192-btn" onclick="v192QuickOpAction_('${encodeURIComponent(item.id)}','search')">🔎 +Search</button><button class="v192-btn" onclick="v192QuickOpAction_('${encodeURIComponent(item.id)}','sighting')">👁 Sighting</button><button class="v192-btn v192-btn-good" onclick="v192QuickOpAction_('${encodeURIComponent(item.id)}','resolve')">✓ Resolve</button><button class="v192-btn" onclick="openV192CommandOp_('missing_runner','${encodeURIComponent(item.id)}')">Edit</button></div></div>`).join('') : '<div class="text-center theme-text-muted text-xs p-4">No active missing-runner cases.</div>');
    setEmpty_('missing-runners', !items.length);
  }

  function routeAnomalies_(logs) {
    const countable = (logs || []).filter(countable_);
    const approved = countable.filter(log => String(log.routeExceptionReason || '').trim()).map(log => ({ type:'approved', bib:bibKey_(log), from:'', to:log.checkpoint, message:log.routeExceptionReason, at:log.time }));
    const issues = [];
    if (typeof global.buildRouteValidation_ === 'function') {
      try { (global.buildRouteValidation_(countable) || []).forEach(issue => issues.push(Object.assign({ at:'' }, issue))); } catch (_) {}
    }
    const byBib = new Map();
    countable.forEach(log => { const bib = bibKey_(log); if (!bib) return; if (!byBib.has(bib)) byBib.set(bib, []); byBib.get(bib).push(log); });
    byBib.forEach((rows, bib) => {
      rows.sort((a,b)=>parseMs_(a.time)-parseMs_(b.time));
      for (let i=1;i<rows.length;i++) {
        const prev=rows[i-1], cur=rows[i], a=Number(prev.checkpointKm), b=Number(cur.checkpointKm), dt=(parseMs_(cur.time)-parseMs_(prev.time))/3600000;
        const hasException = String(cur.routeExceptionReason || '').trim();
        if (Number.isFinite(a)&&Number.isFinite(b)&&b<a-.2&&!hasException) issues.push({ type:'reverse',bib,from:prev.checkpoint,to:cur.checkpoint,message:`Reverse movement ${a} km → ${b} km`,at:cur.time });
        if (Number.isFinite(a)&&Number.isFinite(b)&&dt>0&&Math.abs(b-a)/dt>35&&!hasException) issues.push({ type:'impossible',bib,from:prev.checkpoint,to:cur.checkpoint,message:`${(Math.abs(b-a)/dt).toFixed(1)} km/h between scans`,at:cur.time });
      }
    });
    const seen = new Set();
    return { issues: issues.filter(i=>{const k=[i.type,i.bib,i.from,i.to,i.message].join('|');if(seen.has(k))return false;seen.add(k);return true;}), approved };
  }

  function renderRouteAnomalies_(logs) {
    const el = document.getElementById('director-route-anomalies-body'); if (!el) return;
    const data = routeAnomalies_(logs);
    const counts = { skip:0, reverse:0, impossible:0, abnormal:0 };
    data.issues.forEach(i=>counts[i.type]=(counts[i.type]||0)+1);
    const samples = data.issues.slice(0,20).concat(data.approved.slice(0,10));
    el.innerHTML = `<div class="v192-grid">${[['Skipped',counts.skip],['Reverse',counts.reverse],['Impossible',counts.impossible],['Other',counts.abnormal],['Approved',data.approved.length]].map(([label,value])=>`<div class="v192-stat"><strong>${value||0}</strong><span>${label}</span></div>`).join('')}</div>` + (samples.length ? samples.map(item => `<div class="v192-row"><div class="v192-row-main"><strong>BIB ${esc_(item.bib||'—')} · ${esc_(item.type)}</strong><div class="v192-route-flow"><span class="v192-route-node">${esc_(item.from||'START')}</span><span class="v192-route-arrow">→</span><span class="v192-route-node ${item.type==='approved'?'v192-route-approved':'v192-route-bad'}">${esc_(item.to||'UNKNOWN')}</span></div><span>${esc_(item.message||'Route exception')}${item.at?' · '+esc_(formatTime_(item.at)):''}</span></div></div>`).join('') : '<div class="text-center theme-text-muted text-xs p-4">No route anomalies detected.</div>');
    setEmpty_('route-anomalies', !samples.length);
  }

  function categoryKey_(log) {
    if (typeof global.resolveDirectorDistanceCategory_ === 'function') {
      const d = global.resolveDirectorDistanceCategory_(log); return { key:d.key,label:d.label,km:d.km,category:d.category };
    }
    const km = log.km || 'Unspecified', category = log.category || 'Uncategorized';
    return { key:String(km)+'|'+category,label:`${km} KM · ${category}`,km,category };
  }

  function renderFinishProjection_(logs) {
    const el = document.getElementById('director-finish-projection-body'); if (!el) return;
    const latest = new Map();
    (logs || []).filter(countable_).forEach(log => { const bib=bibKey_(log); if(!bib)return; const prior=latest.get(bib); if(!prior||parseMs_(log.time)>parseMs_(prior.time))latest.set(bib,log); });
    const groups = new Map(), now=Date.now();
    latest.forEach(log => {
      const c=categoryKey_(log); if(!groups.has(c.key))groups.set(c.key,{...c,total:0,finished:0,next30:0,next60:0,times:[]});
      const g=groups.get(c.key); g.total++;
      if(completion_(log.checkpoint)){g.finished++;return;}
      const t=parseMs_(log.projectedFinish); if(Number.isFinite(t)){g.times.push(t);if(t>=now&&t<=now+30*60000)g.next30++;if(t>=now&&t<=now+60*60000)g.next60++;}
    });
    const rows=Array.from(groups.values()).sort((a,b)=>String(b.km).localeCompare(String(a.km),undefined,{numeric:true})||a.category.localeCompare(b.category));
    el.innerHTML = rows.length ? `<div class="overflow-auto"><table class="v192-projection-table"><thead><tr><th>KM · Category</th><th>Seen</th><th>Finished</th><th>Next 30m</th><th>Next 60m</th><th>Window</th></tr></thead><tbody>${rows.map(g=>{g.times.sort((a,b)=>a-b);const window=g.times.length?`${formatTime_(g.times[0])} – ${formatTime_(g.times[g.times.length-1])}`:'—';return `<tr><td><strong>${esc_(g.label)}</strong></td><td>${g.total}</td><td>${g.finished}</td><td>${g.next30}</td><td>${g.next60}</td><td>${esc_(window)}</td></tr>`;}).join('')}</tbody></table></div><p class="text-[9px] theme-text-muted">Projection uses each runner's latest locally calculated pace and projected finish. Runners without sufficient pace data remain counted under Seen but not in a finish window.</p>` : '<div class="text-center theme-text-muted text-xs p-4">No runner projections available.</div>';
    setEmpty_('finish-projection', !rows.length);
  }

  function renderOutcomes_() {
    const el = document.getElementById('director-outcomes-body'); if (!el) return;
    const notes = Object.values(global.localSafetyNotes_ || {});
    const count = status => notes.filter(n=>String(n.status||'').toLowerCase()===status).length;
    const incidents = Object.values(global.localIncidents_ || {});
    const openMedical = incidents.filter(i=>String(i.type||'').toLowerCase()==='medical'&&openStatus_(i.status)).length;
    const unresolved = notes.filter(n=>['medical','missing'].includes(String(n.status||'').toLowerCase())).length + incidents.filter(i=>openStatus_(i.status)).length;
    const cards=[['DNS',count('dns'),'Not started / marked DNS'],['DNF',count('dnf'),'Did not finish'],['Withdrawn',count('withdrawn'),'Withdrawn from event'],['Medical',count('medical'),`${openMedical} open medical incidents`],['Unresolved',unresolved,'Safety notes + open incidents']];
    el.innerHTML=`<div class="v192-grid">${cards.map(([label,value,sub])=>`<div class="v192-stat"><strong>${value}</strong><span>${esc_(label)}</span><small>${esc_(sub)}</small></div>`).join('')}</div><p class="text-[9px] theme-text-muted">DNS and DNF are explicit Safety Log statuses. They are not inferred from absence, preventing premature classification while the race is active.</p>`;
    setEmpty_('outcomes', false);
  }

  function renderResourceBoard_(type, bodyId, widgetId) {
    const el=document.getElementById(bodyId);if(!el)return;
    const cfg=TYPE_CONFIG[type],items=opArray_(type).sort((a,b)=>openStatus_(b.status)-openStatus_(a.status)||parseMs_(b.updatedAt)-parseMs_(a.updatedAt));
    const addLabel=type==='medical_resource'?'Add medical team':type==='transport_resource'?'Add transport / sweep':'Add checkpoint stock';
    el.innerHTML=`<div class="v192-toolbar"><span class="text-[10px] theme-text-muted">${items.length} resource record${items.length===1?'':'s'}</span><button class="v192-btn v192-btn-primary" onclick="openV192CommandOp_('${type}')">＋ ${addLabel}</button></div>`+(items.length?items.map(item=>{
      const d=item.details||{};
      const detail=type==='medical_resource'?`${d.vehicle||'No vehicle'} · ${Number(d.activeCases)||0} active case(s) · ${d.destination||'No destination'}`:type==='transport_resource'?`${d.resourceKind||'Transport'} · ${Number(d.passengers)||0}/${Number(d.capacity)||0} passengers · ${Number(d.pickupRequests)||0} pickups · ${d.destination||'No destination'}`:`Water ${d.water||'—'} · Food ${d.food||'—'} · Ice ${d.ice||'—'} · Radios ${d.radios||'—'} · Medical ${d.medicalStock||'—'}${d.resupply?' · '+d.resupply:''}`;
      return `<button type="button" onclick="openV192CommandOp_('${type}','${encodeURIComponent(item.id)}')" class="v192-row text-left"><div class="v192-row-main"><strong>${cfg.icon} ${esc_(item.name||item.checkpoint||cfg.label)}</strong><span><span class="v192-pill ${statusClass_(item.status)}">${esc_(item.status)}</span> ${esc_(item.checkpoint||'location pending')} · owner ${esc_(item.owner||'unassigned')} · ${ageLabel_(item.updatedAt)}${item.synced===false?' · QUEUED':''}</span><span>${esc_(detail)}</span></div><span>›</span></button>`;
    }).join(''):'<div class="text-center theme-text-muted text-xs p-4">No records yet.</div>');
    setEmpty_(widgetId,!items.length);
  }

  function renderWeather_() {
    const el=document.getElementById('director-weather-risk-body');if(!el)return;
    const w=global.serverOperationsSummary_?.weatherRisk;
    if(!w){el.innerHTML='<div class="v192-toolbar"><span class="text-xs theme-text-muted">Weather feed not loaded.</span><button class="v192-btn" onclick="refreshV192Weather_()">↻ Refresh</button></div>';setEmpty_('weather-risk',true);return;}
    const riskClass='v192-risk-'+(w.level||'normal');
    const value=(n,suffix)=>Number.isFinite(Number(n))?`${Number(n).toFixed(1)}${suffix}`:'—';
    el.innerHTML=`<div class="v192-toolbar"><div><strong class="text-sm theme-text">${esc_(w.source||'Weather source')}</strong><div class="text-[9px] theme-text-muted">Observed ${esc_(formatTime_(w.observedAt))} · refreshed ${ageLabel_(w.updatedAt)}</div></div><button class="v192-btn" onclick="refreshV192Weather_()">↻ Refresh</button></div><div class="v192-grid"><div class="v192-stat ${riskClass}"><strong>${value(w.temperatureC,'°C')}</strong><span>Temperature</span></div><div class="v192-stat ${riskClass}"><strong>${value(w.rainMmPerHour,' mm/h')}</strong><span>Rain</span></div><div class="v192-stat ${riskClass}"><strong>${value(w.windKph,' km/h')}</strong><span>Wind</span></div><div class="v192-stat ${riskClass}"><strong>${value(w.lightningDistanceKm,' km')}</strong><span>Nearest lightning</span></div></div>${(w.risks||[]).length?`<div class="v192-row ${riskClass}"><div class="v192-row-main"><strong>${w.level==='critical'?'⛔ Critical weather action':'⚠️ Weather threshold exceeded'}</strong><span>${(w.risks||[]).map(r=>esc_(r.message)).join(' · ')}</span></div></div>`:`<div class="v192-row v192-risk-normal"><div class="v192-row-main"><strong>✅ No configured threshold exceeded</strong><span>${w.alert?esc_(w.alert):'Continue normal monitoring.'}</span></div></div>`}<p class="text-[9px] theme-text-muted">Configure the WeatherRisk sheet for manual values or set WEATHER_PROVIDER_URL in Apps Script Properties to an authorised JSON weather/lightning endpoint. Always follow the event's official emergency plan.</p>`;
    setEmpty_('weather-risk',false);
  }
  global.refreshV192Weather_=async function(){if(typeof global.fetchOperationsSummary_==='function')await global.fetchOperationsSummary_();else await pullCommandOps_();renderWeather_();};

  function appendEnhancedDeviceLayer_(logs) {
    const map=document.querySelector('#directorMapBody .director-gps-map-shell');if(!map)return;
    map.querySelector('.v192-device-layer')?.remove();
    const devices=(global.serverOperationsSummary_?.devices||[]).slice().sort((a,b)=>parseMs_(b.lastSeen)-parseMs_(a.lastSeen));
    if(!devices.length)return;
    const layer=document.createElement('div');layer.className='v192-device-layer';
    layer.innerHTML=`<div class="v192-device-row v192-device-head"><strong>PWA / checkpoint</strong><span>Battery</span><span>Connection</span><span>Queue</span><span>GPS age</span><span>Last sync</span></div>`+devices.map(d=>{
      const battery=d.batteryPercent==null?'—':Math.round(Number(d.batteryPercent)*100)+'%';
      const gpsAge=d.gpsCapturedAt?ageLabel_(d.gpsCapturedAt):'—';
      const connection=d.connectivity||((Date.now()-parseMs_(d.lastSeen)<3*60000)?'online':'stale');
      const label=typeof global.getDeviceLabel==='function'?global.getDeviceLabel(d.device||d.deviceId):(d.device||d.deviceId||'Device');
      return `<div class="v192-device-row"><strong>${esc_(label)}<small class="block opacity-60">${esc_(d.checkpoint||'No checkpoint')} · ${esc_(d.volunteer||'')}</small></strong><span>🔋 ${battery}${d.charging?' ⚡':''}</span><span>${esc_(connection)}${d.effectiveType?' · '+esc_(d.effectiveType):''}</span><span>${Number(d.queueCount)||0} · oldest ${Number(d.oldestQueueAgeMinutes)||0}m</span><span>${esc_(gpsAge)}${d.gpsAccuracyM?' · ±'+Math.round(d.gpsAccuracyM)+'m':''}</span><span>${d.lastSync?esc_(ageLabel_(d.lastSync)):'never'}</span></div>`;
    }).join('');
    map.appendChild(layer);
  }

  function redrawMapWithHealth_(logs) {
    if (typeof global.renderDirectorGpsMap_ !== 'function') return;
    const synthetic = (global.serverOperationsSummary_?.devices || [])
      .filter(d => Number.isFinite(Number(d.latitude)) && Number.isFinite(Number(d.longitude)))
      .map(d => ({
        uid: 'health-' + d.deviceId,
        device: d.device || d.deviceId,
        creatorId: d.deviceId,
        checkpoint: d.checkpoint || 'Unspecified',
        volunteer: d.volunteer || '',
        latitude: d.latitude,
        longitude: d.longitude,
        gpsAccuracyM: d.gpsAccuracyM,
        time: d.gpsCapturedAt || d.lastSeen || new Date().toISOString(),
        status: 'Active',
        synced: true
      }));
    Promise.resolve(global.renderDirectorGpsMap_((logs || []).concat(synthetic)))
      .catch(() => { /* the map renderer displays its own actionable error */ })
      .finally(() => appendEnhancedDeviceLayer_(logs));
  }

  function renderEnhancedIncidents_() {
    const el=document.getElementById('directorIncidentsBody');if(!el)return;
    const items=Object.values(global.localIncidents_||{}).filter(i=>openStatus_(i.status)).sort((a,b)=>parseMs_(b.updatedAt)-parseMs_(a.updatedAt));
    el.innerHTML=`<div class="v192-toolbar"><span class="text-[10px] theme-text-muted">${items.length} open incident${items.length===1?'':'s'}</span><button class="v192-btn v192-btn-primary" onclick="openIncidentModal_()">＋ Add incident</button></div>`+(items.length?items.slice(0,50).map(i=>{
      const ack=i.acknowledgedAt?`Ack ${durationLabel_(i.createdAt,i.acknowledgedAt)}`:`Unacknowledged ${durationLabel_(i.createdAt)}`;
      const active=i.acknowledgedAt?`Active ${durationLabel_(i.acknowledgedAt)}`:'';
      return `<div class="v192-row"><div class="v192-row-main"><strong>${esc_(i.bib||'No BIB')} · ${esc_(i.type||'incident')} · ${esc_(i.severity||'medium')}</strong><span><span class="v192-pill ${statusClass_(i.status)}">${esc_(i.status||'open')}</span> ${esc_(i.checkpoint||'location pending')} · owner ${esc_(i.owner||'unassigned')}</span><span>${esc_(ack)}${active?' · '+esc_(active):''}${i.destination?' · destination '+esc_(i.destination):''}</span></div><div class="v192-row-actions">${!i.acknowledgedAt?`<button class="v192-btn" onclick="v192AcknowledgeIncident_('${encodeURIComponent(i.id)}')">Acknowledge</button>`:''}<button class="v192-btn v192-btn-good" onclick="v192ResolveIncident_('${encodeURIComponent(i.id)}')">Resolve</button><button class="v192-btn" onclick="openIncidentModal_('${encodeURIComponent(i.id)}')">Edit</button></div></div>`;
    }).join(''):'<div class="text-center theme-text-muted text-xs p-4">No open incidents.</div>');
    setEmpty_('incidents',!items.length);
  }

  function persistIncident_(incident) {
    const db=global.db;if(!db||!db.objectStoreNames.contains('incidents'))return;
    global.localIncidents_[incident.id]=incident;
    const tx=db.transaction(['incidents'],'readwrite');tx.objectStore('incidents').put(incident);tx.oncomplete=()=>{renderEnhancedIncidents_();if(typeof global.pushIncidentToServer_==='function')global.pushIncidentToServer_(incident);};
  }
  global.v192AcknowledgeIncident_=function(encodedId){const id=decodeURIComponent(encodedId),i=global.localIncidents_?.[id];if(!i)return;i.acknowledgedAt=i.acknowledgedAt||nowIso_();i.status=i.status==='open'?'responding':i.status;i.updatedAt=nowIso_();i.updatedBy=currentVolunteer_();i.synced=false;persistIncident_(i);};
  global.v192ResolveIncident_=function(encodedId){const id=decodeURIComponent(encodedId),i=global.localIncidents_?.[id];if(!i)return;const resolution=prompt('Resolution / handover note:',i.resolution||'');if(resolution===null||!resolution.trim())return;i.resolution=resolution.trim();i.resolvedAt=nowIso_();i.status='resolved';i.updatedAt=i.resolvedAt;i.updatedBy=currentVolunteer_();i.synced=false;persistIncident_(i);};

  function renderAll_(logs) {
    if (Array.isArray(logs)) lastLogs_ = logs;
    renderHeatmap_(lastLogs_);
    renderCotFunnel_(lastLogs_);
    renderRouteAnomalies_(lastLogs_);
    renderFinishProjection_(lastLogs_);
    renderOutcomes_();
    redrawMapWithHealth_(lastLogs_);
  }

  function mergeServerSummaryOps_() {
    const items=global.serverOperationsSummary_?.commandOps||[];
    items.forEach(item=>{const local=commandOps_[item.id];if(!local||local.synced!==false)commandOps_[item.id]=Object.assign({},item,{synced:true});});
    if(items.length)saveOps_();
  }

  function installOverrides_() {
    const oldRender = global.renderDirectorModeContent_;
    global.renderDirectorModeContent_ = function (logs) {
      if (typeof oldRender === 'function') oldRender(logs);
      renderAll_(logs || []);
    };
    const oldOperations = global.renderDirectorOperations_;
    global.renderDirectorOperations_ = function (logs) {
      if (typeof oldOperations === 'function') oldOperations(logs);
      renderAll_(logs || lastLogs_);
    };
    const oldOpen = global.openDirectorMode;
    global.openDirectorMode = function () {
      if (typeof oldOpen === 'function') oldOpen();
      setTimeout(() => renderAll_(lastLogs_), 50);
    };
    const oldFetch = global.fetchOperationsSummary_;
    if (typeof oldFetch === 'function') {
      global.fetchOperationsSummary_ = async function () {
        const result = await oldFetch();
        renderAll_(lastLogs_);
        return result;
      };
    }
  }

  function initialise_() {
    injectStyles_();
    injectWidgets_();
    installOverrides_();
    renderAll_([]);
  }

  global.RaceDirectorOpsV192 = Object.freeze({ render: renderAll_ });
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialise_,{once:true});else initialise_();
})(window);
