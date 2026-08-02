        const APP_VERSION = "19.3.5";
        const DEFAULT_SYNC_URL = "https://script.google.com/macros/s/AKfycbzQQE7TLzm1muiHhBDrtenUZye0I8Yb2U3tNwq_3PsmtmvoddbeL11Kzm4P2RXqbCF_Ig/exec";
        let db;
        let dbReady_ = false;
        let dbOpenFailed_ = false;
        const SCAN_HISTORY_MAX_ROWS = 20;
        const RECENT_SYNC_LIMIT = 20;
        const RACE_DB_VERSION = 7;
        let recentCloudWindowUids_ = new Set();
        let bibInputToolsHideTimer_ = null;
        let minimalBibModeActive_ = false;
        let minimalBibKeyboardPage_ = 'numbers';
        let minimalEntryTarget_ = 'bib';
        let minimalNativeKeyboardActive_ = false;
        let minimalReopenKeyboardAfterSubmit_ = false;
        let minimalKeyboardSubmitAt_ = 0;
        let bibSpaceFeedbackTimer_ = null;
        let minimalSpaceFeedbackTimer_ = null;
        let minimalDuplicateLookupTimer_ = null;
        let minimalDuplicateLookupToken_ = 0;
        let safetyCotAlertsExpanded_ = false;
        let monitorSyncPromise_ = null;
        let lastFullMonitorSyncAt_ = parseInt(localStorage.getItem('lastFullMonitorSyncAt_v1') || '0', 10);
        let fullMonitorDatasetResident_ = false;
        let isSetupLocked = false;
        let successToastTimeout;
        let remarkDebounceTimeout = null; // retained for backward compatibility; remark typing is now a next-entry draft only
        let lastCreatedUid = null; 
        let triggerScanHistorySlideFlag = false;

        // Scanner state is declared before IndexedDB startup callbacks can fire. In the
        // previous build these `let` bindings lived thousands of lines later, so a very
        // fast DB-open/camera tap could enter the temporal dead zone and throw
        // "Cannot access 'lastPersonBox_' before initialization". The live OCR
        // button is available as soon as Setup is complete, so this state must be
        // initialized before any fast camera tap can reach the scanner pipeline.
        let lastPersonBox_ = null;
        let detectionTickCounter_ = 0;
        let cocoSsdModel_ = null;
        let cocoSsdLoadPromise_ = null;
        
        let lastGeoposition = { latitude: null, longitude: null, accuracy: null, timestamp: 0 };
        const CHECKPOINT_GPS_STORAGE_KEY_ = 'checkpointGpsBundle_v18_0_5';
        let checkpointGpsBundle_ = (() => {
            try { return JSON.parse(localStorage.getItem(CHECKPOINT_GPS_STORAGE_KEY_) || '{}') || {}; }
            catch (_) { return {}; }
        })();
        let checkpointGpsPollTimer_ = null;
        let checkpointGpsWatchId_ = null;
        let gpsAdvisorCandidate_ = null;
        let gpsAdvisorDismissedUntil_ = 0;
        let gpsPositionPromise_ = null;
        let editingRowId = null; 

        // Safety Log state also lives above the async IndexedDB startup callback.
        // renderSummaryDashboard() can run as soon as the DB opens and now refreshes
        // the KM/category matrix, so these bindings must exist before that callback.
        let localSafetyNotes_ = {};
        let safetyQuickFilter_ = 'all';
        let safetySortAscending_ = true;
        let safetyMatrixSelection_ = null;
        let lastSafetyRosterForCounts_ = [];
        let lastVisibleSafetyRoster_ = [];
        let safetyVirtualRoster_ = [];
        let safetyVirtualRenderToken_ = 0;
        const SAFETY_VIRTUAL_ROW_HEIGHT_ = 58;
        const SAFETY_VIRTUAL_OVERSCAN_ = 10;
        const SAFETY_VIRTUAL_THRESHOLD_ = 600;
        let localIncidents_ = {};
        let localCotAlerts_ = {};
        let serverOperationsSummary_ = null;
        let aggregateRebuildTimer_ = null;
        let aggregateConfigFingerprint_ = '';
        let operationalSyncInFlight_ = false;
        let deviceHealthTimer_ = null;
        let latestBatteryState_ = { level: null, charging: null };
        let clockOffsetMs_ = Number(localStorage.getItem('clockOffsetMs_v1') || '0') || 0;
        let clockConfidenceMs_ = Number(localStorage.getItem('clockConfidenceMs_v1') || '0') || 0;
        let clockSampleCount_ = Number(localStorage.getItem('clockSampleCount_v1') || '0') || 0;
        let cotWarningMinutes_ = Number(localStorage.getItem('cotWarningMinutes_v1') || '45') || 45;
        let cotEscalationMinutes_ = Number(localStorage.getItem('cotEscalationMinutes_v1') || '15') || 15;
        let cotAlertsEnabled_ = localStorage.getItem('cotAlertsEnabled_v1') !== 'false';
        const directorToolbarLabelTimers_ = new Map();
        let directorExitArmedUntil_ = 0;
        let appTextScale_ = localStorage.getItem('appTextScale_v1') || 'normal';
        let screenReaderAnnouncements_ = localStorage.getItem('screenReaderAnnouncements_v1') !== 'false';
        const ROUTE_MODELS_STORAGE_KEY_ = 'routeModels_v18_0_5';
        let routeModelsByKey_ = (() => { try { return JSON.parse(localStorage.getItem(ROUTE_MODELS_STORAGE_KEY_) || '{}'); } catch (_) { return {}; } })();

        const LOCAL_APP_REFRESH_EPOCH_KEY_ = 'appRefreshEpoch_v1';
        const LOCAL_DATA_REVISION_KEY_ = 'racelogDataRevision_v1';
        let hardRefreshInProgress_ = false;
        let dataRevisionReconcileTimer_ = null;

        // Incremental sinceRow polling is fast for newly appended logs but cannot see
        // edits to older rows. The backend bumps dataRevision only for those in-place
        // mutations; when another device sees it change, schedule one debounced full
        // reconciliation instead of repeatedly downloading the whole sheet.
        function handleDataRevisionFromServer_(revision, shouldReconcile) {
            if (revision === undefined || revision === null || revision === '') return false;
            const next = String(revision);
            const previous = localStorage.getItem(LOCAL_DATA_REVISION_KEY_);
            localStorage.setItem(LOCAL_DATA_REVISION_KEY_, next);
            if (previous === null || previous === next) return false;
            if (shouldReconcile && syncUrl && db) {
                if (dataRevisionReconcileTimer_) clearTimeout(dataRevisionReconcileTimer_);
                dataRevisionReconcileTimer_ = setTimeout(() => {
                    dataRevisionReconcileTimer_ = null;
                    performFullReconciliation_();
                }, 1200);
            }
            return true;
        }
        
        let syncIntervalMs = 15000; 
        let syncTimerId = null;
        let reconciliationTimerId = null;
        let lowBatteryThresholdActive = false;

        let isSyncing = false;      
        let syncRerunQueued = false; 

        // Auto-Sync header pill: starts expanded (full "Auto-Sync" text) so its meaning
        // is clear, then collapses to a small icon after SYNC_BADGE_COLLAPSE_DELAY_MS --
        // see initSyncBadgeCollapseTimer_() and updateSyncStatusLabel().
        const SYNC_BADGE_COLLAPSE_DELAY_MS = 5000;
        let syncBadgeCollapsed_ = false;
        let syncBadgeCollapseTimeoutId_ = null;
        let syncBadgeExpandTimeoutId_ = null; // re-collapse timer after a tap-to-peek

        let gpsWarmupTimeout = null;
        let isGpsHardwareRunning = false;

        let vibrateEnabled = true;
        let soundEnabled = true;
        let gpsQuality = 'low';
        let dupWindowSeconds = 20;
        let checkpointKm = '';
        let checkpointKmByRace_ = (() => {
            try { return JSON.parse(localStorage.getItem('checkpointKmByRace_v1') || '{}') || {}; }
            catch (e) { return {}; }
        })();
        let bibLogSubmissionInFlight_ = false;
        let batterySaverManual = false;
        let globalHistoryLimit = '20';
        let currentCpHistoryLimit = '20';
        let layoutOrientation = 'auto';
        let activeScopeFilter = 'current'; 
        let currentLastSyncedRowMarker = parseInt(localStorage.getItem("lastDataRowMarker") || "1", 10);

        let syncFailureStreak = 0;
        let lastSyncError = null;
        let lastSyncSuccessAt = parseInt(localStorage.getItem("lastSyncSuccessAt") || "0", 10);
        let syncRetryTimeoutId = null;
        const SYNC_STUCK_ATTEMPTS_THRESHOLD = 5; 

        let dynamicHardwareMaxCap = 150; 
        let currentAdaptiveViewClamp = 150; 
        let performanceStutterStreak = 0;
        let lastFrameRenderTimestamp = performance.now();
        let isHighEndSoc = false; 
        let triggerInlineAnimationFlag = false;

        let isDirectorModeOpen = false;
        let lastKnownSummaryRows = [];
        let directorKmExpanded_ = (() => {
            try { return new Set(JSON.parse(localStorage.getItem('directorKmExpanded_v1') || '[]')); }
            catch (e) { return new Set(); }
        })();
        // PWA-side metric config — fed from every sync response (Setup sheet data).
        // Seeded from localStorage so metrics work immediately after a page reload.
        let categoryConfig = (() => { try { return JSON.parse(localStorage.getItem('lastCachedSummaryRows') || '[]'); } catch(e) { return []; } })();
        const EVENT_CONFIG_META_STORAGE_KEY_ = 'eventConfigMeta_v1';
        const CHECKPOINT_MAP_CONFIG_FINGERPRINT_KEY_ = 'checkpointKmConfigFingerprint_v1';
        let eventConfigMeta_ = (() => { try { return JSON.parse(localStorage.getItem(EVENT_CONFIG_META_STORAGE_KEY_) || 'null'); } catch(e) { return null; } })();
        let directorClockIntervalId = null;
        let directorCotIntervalId = null;
        
        let syncUrl = localStorage.getItem("syncUrl");
        if (!syncUrl || syncUrl.trim() === "") {
            syncUrl = DEFAULT_SYNC_URL;
            localStorage.setItem("syncUrl", DEFAULT_SYNC_URL);
        }

        // v19.3.5 uses a built-in, dependency-free OpenStreetMap slippy map.
        // It requires no deployment key or race-day device configuration.
        let directorSlippyMapInstance_ = null;

        const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
        if (!isStandalone) {
            let touchStart;
            document.addEventListener('touchstart', function (e) {
                if (e.touches.length === 1) touchStart = e.touches[0].clientY;
            }, { passive: false });
            document.addEventListener('touchmove', function (e) {
                const touchMove = e.touches[0].clientY;
                if (window.scrollY === 0 && touchMove > touchStart) e.preventDefault();
            }, { passive: false });
        }

        function profileDevicePerformanceCapabilities() {
            // Capability hints are effectively free. The previous startup CPU benchmark
            // performed hundreds of thousands of calculations and could freeze the first
            // interaction on entry-level phones. The logging screen is now capped at 20
            // rows, so a coarse tier is sufficient for OCR resolution choices.
            const cores = navigator.hardwareConcurrency || 2;
            const memory = Number(navigator.deviceMemory || 0);
            if (cores >= 8 && (!memory || memory >= 6)) {
                isHighEndSoc = true;
                dynamicHardwareMaxCap = 800;
            } else if (cores >= 4 && (!memory || memory >= 3)) {
                dynamicHardwareMaxCap = 350;
            } else {
                dynamicHardwareMaxCap = 75;
            }
            currentAdaptiveViewClamp = SCAN_HISTORY_MAX_ROWS;
        }

        // Kept as a compatibility no-op for older hooks. Continuous requestAnimationFrame
        // monitoring consumed battery even while the user was only entering bibs; a fixed
        // 20-row history makes that adaptive loop unnecessary.
        function monitorFrameRenderLatency() {}

        function handleViewportResize() {
            const isTouchDevice = window.matchMedia("(pointer: coarse)").matches;
            const btn = document.getElementById("logActionButton");
            const grid = document.querySelector('.bib-entry-submit-grid');
            if (!btn) return;
            if (!isTouchDevice) {
                grid?.classList.remove('keyboard-open');
                return;
            }
            const inputHasFocus = (document.activeElement && (document.activeElement.id === 'bibInput' || document.activeElement.id === 'remarkInput'));
            if (inputHasFocus && window.visualViewport) {
                const viewportHeight = window.visualViewport.height;
                const windowHeight = window.innerHeight;
                if (viewportHeight < windowHeight * 0.9) {
                    grid?.classList.add('keyboard-open');
                    btn.classList.add("keyboard-docked-btn");
                    btn.style.height = "5rem";
                    btn.style.fontSize = "1.5rem";
                    btn.style.top = `${window.visualViewport.offsetTop + viewportHeight - btn.offsetHeight}px`;
                    return;
                }
            }
            grid?.classList.remove('keyboard-open');
            btn.classList.remove("keyboard-docked-btn");
            btn.style.position = "";
            btn.style.top = "";
            btn.style.height = "";
            btn.style.fontSize = "";
            btn.style.width = "";
        }

        if (window.visualViewport) {
            window.visualViewport.addEventListener("resize", handleViewportResize);
            window.visualViewport.addEventListener("scroll", handleViewportResize);
        }
        document.getElementById('bibInput').addEventListener('focus', handleViewportResize);
        document.getElementById('bibInput').addEventListener('blur', () => setTimeout(handleViewportResize, 100));
        document.getElementById('remarkInput').addEventListener('focus', handleViewportResize);
        document.getElementById('remarkInput').addEventListener('blur', () => setTimeout(handleViewportResize, 100));

        function restoreHardRefreshDrafts_() {
            const bibDraft = localStorage.getItem('hardRefreshBibDraft_v1');
            const remarkDraft = localStorage.getItem('hardRefreshRemarkDraft_v1');
            const bibInput = document.getElementById('bibInput');
            const remarkInput = document.getElementById('remarkInput');
            if (bibDraft !== null && bibInput && !bibInput.value) bibInput.value = bibDraft;
            if (remarkDraft !== null && remarkInput && !remarkInput.value) remarkInput.value = remarkDraft;
            localStorage.removeItem('hardRefreshBibDraft_v1');
            localStorage.removeItem('hardRefreshRemarkDraft_v1');
            if (bibInput) autoScaleBibFontSize_();
        }

        async function performHardRefreshThisDevice_(reason) {
            if (hardRefreshInProgress_) return;
            hardRefreshInProgress_ = true;
            const bibDraft = document.getElementById('bibInput')?.value || '';
            const remarkDraft = document.getElementById('remarkInput')?.value || '';
            localStorage.setItem('hardRefreshBibDraft_v1', bibDraft);
            localStorage.setItem('hardRefreshRemarkDraft_v1', remarkDraft);
            try {
                if ('caches' in window) {
                    const keys = await caches.keys();
                    await Promise.all(keys.filter(key => key.startsWith('race-logger-')).map(key => caches.delete(key)));
                }
                if (navigator.serviceWorker && typeof navigator.serviceWorker.getRegistrations === 'function') {
                    const registrations = await navigator.serviceWorker.getRegistrations();
                    for (const registration of registrations) {
                        try {
                            await registration.update();
                            if (registration.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
                        } catch (_) {}
                    }
                }
            } catch (err) {
                console.warn('Hard refresh preparation failed; reloading anyway.', err);
            }
            const url = new URL(window.location.href);
            url.searchParams.set('_pwa_refresh', String(Date.now()));
            url.hash = '';
            window.location.replace(url.toString());
        }

        async function forceClearAppCache() {
            const ok = confirm(
                "Hard refresh this device now?\n\n" +
                "The latest app shell will be loaded. Local race logs, queued entries, settings, and safety notes will be kept."
            );
            if (!ok) return;
            await performHardRefreshThisDevice_('manual');
        }

        function handleAppRefreshEpochFromServer_(serverEpoch, forceNow = false) {
            if (!serverEpoch) return false;
            const epoch = String(serverEpoch);
            const localEpoch = localStorage.getItem(LOCAL_APP_REFRESH_EPOCH_KEY_);
            if (!localEpoch && !forceNow) {
                localStorage.setItem(LOCAL_APP_REFRESH_EPOCH_KEY_, epoch);
                return false;
            }
            if (localEpoch === epoch && !forceNow) return false;
            localStorage.setItem(LOCAL_APP_REFRESH_EPOCH_KEY_, epoch);
            setTimeout(() => performHardRefreshThisDevice_('server-epoch'), 120);
            return true;
        }

        async function forceHardRefreshAllDevices_() {
            const adminToken = (document.getElementById('adminTokenInput')?.value || '').trim();
            if (!adminToken) { alert('⚠️ Enter the admin token first.'); return; }
            if (!syncUrl) { alert('⚠️ No sync URL configured.'); return; }
            if (!confirm('Force every connected PWA device to clear its app-shell cache and reload on its next sync? Local race data will be preserved.')) return;

            const btn = document.getElementById('forceAllPwaRefreshBtn');
            if (btn) { btn.disabled = true; btn.textContent = 'Publishing refresh…'; }
            try {
                const res = await fetch(`${syncUrl}${syncUrl.includes('?') ? '&' : '?'}nocache=${Date.now()}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                    body: JSON.stringify({ action: 'force_pwa_refresh', adminToken })
                });
                const data = JSON.parse(await res.text());
                if (data.status !== 'success' || !data.appRefreshEpoch) throw new Error(data.message || 'Server did not publish a refresh epoch.');
                handleAppRefreshEpochFromServer_(data.appRefreshEpoch, true);
            } catch (err) {
                alert('❌ Could not publish the PWA refresh: ' + (err.message || String(err)));
                if (btn) { btn.disabled = false; btn.textContent = '♻️ Force Hard Refresh on All PWA Devices'; }
            }
        }

        function detectBrowserLayout() {
            const ua = navigator.userAgent.toLowerCase();
            const guide = document.getElementById("dynamicBrowserGuide");
            if (!guide) return;
            if (/iphone|ipad|ipod/.test(ua)) {
                if (/crios/.test(ua)) {
                    guide.innerHTML = `<strong class="block mb-1 text-blue-700 dark:text-blue-400">🌐 iOS Chrome Layout:</strong>1. Tap <strong>Share</strong>.<br>2. Choose <strong>Add to Home Screen</strong>.`;
                } else if (/fxios/.test(ua)) {
                    guide.innerHTML = `<strong class="block mb-1 text-orange-700 dark:text-orange-400">🌐 iOS Firefox Layout:</strong>1. Tap <strong>Menu (3 lines)</strong>.<br>2. Select <strong>Share</strong>, then <strong>Add to Home Screen</strong>.`;
                } else {
                    guide.innerHTML = `<strong class="block mb-1 text-sky-700 dark:text-sky-400">🌐 Safari Mobile Layout:</strong>1. Tap <strong>Share Button (📤)</strong>.<br>2. Choose <strong>Add to Home Screen</strong>.`;
                }
            } else if (/android/.test(ua)) {
                if (/samsungbrowser/.test(ua)) {
                    guide.innerHTML = `<strong class="block mb-1 text-purple-700 dark:text-purple-400">🌐 Samsung Internet:</strong>1. Tap <strong>Menu (☰)</strong>.<br>2. Tap <strong>+ Add page to</strong>.<br>3. Choose <strong>Home screen</strong>.`;
                } else {
                    guide.innerHTML = `<strong class="block mb-1 text-emerald-700 dark:text-emerald-400">🌐 Mobile Chrome Layout:</strong>1. Tap <strong>Options Menu (⋮)</strong>.<br>2. Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.`;
                }
            } else {
                guide.innerHTML = `🌐 Click the install icon inside the browser address navigation bar.`;
            }
        }

        function setBibInputToolsVisible_(visible) {
            const shell = document.querySelector('.bib-input-shell');
            const tools = document.getElementById('bibInputTools');
            const bibInput = document.getElementById('bibInput');
            const focusInside = !!shell && shell.contains(document.activeElement);
            const active = document.activeElement;
            const actuallyVisible = !!visible && focusInside && (active === bibInput || tools?.contains(active)) && !minimalBibModeActive_;
            shell?.classList.toggle('tools-visible', actuallyVisible);
            tools?.setAttribute('aria-hidden', actuallyVisible ? 'false' : 'true');
        }

        function showBibInputTools_() {
            if (bibInputToolsHideTimer_) clearTimeout(bibInputToolsHideTimer_);
            requestAnimationFrame(() => setBibInputToolsVisible_(true));
        }

        function scheduleHideBibInputTools_() {
            if (bibInputToolsHideTimer_) clearTimeout(bibInputToolsHideTimer_);
            bibInputToolsHideTimer_ = setTimeout(() => setBibInputToolsVisible_(false), 90);
        }

        function applyBibKeyboardMode_(mode, focusAfter = false) {
            const bI = document.getElementById('bibInput');
            const btn = document.getElementById('bibEntryModeBtn');
            const icon = document.getElementById('bibEntryModeIcon');
            const label = document.getElementById('bibEntryModeLabel');
            if (!bI) return;
            const normalized = mode === 'text' ? 'text' : 'numeric';
            bI.setAttribute('inputmode', normalized);
            localStorage.setItem('bibKeyboardMode', normalized);
            if (icon) icon.textContent = normalized === 'numeric' ? '🔢' : '🔤';
            if (label) label.textContent = normalized === 'numeric' ? 'Numbers' : 'Letters';
            if (btn) {
                btn.setAttribute('aria-pressed', normalized === 'text' ? 'true' : 'false');
                btn.title = normalized === 'numeric'
                    ? 'Number keyboard active — tap to switch to letters'
                    : 'Letter keyboard active — tap to switch to numbers';
            }
            if (focusAfter) showBibInputTools_();
            if (focusAfter) {
                bI.blur();
                setTimeout(() => bI.focus({ preventScroll: true }), 60);
            }
        }

        function toggleKeyboardMode() {
            const bI = document.getElementById('bibInput');
            if (!bI) return;
            applyBibKeyboardMode_(bI.getAttribute('inputmode') === 'numeric' ? 'text' : 'numeric', true);
        }


        const MINIMAL_BIB_NUMBERS_ = ['1','2','3','4','5','6','7','8','9','0'];

        function setMinimalBibStatus_(message, isError = false) {
            const el = document.getElementById('minimalBibStatus');
            if (!el) return;
            el.textContent = message || '';
            el.style.color = isError ? '#fca5a5' : '#9ca3af';
        }

        function showBibSpaceBlockedFeedback_(surface = '') {
            const useMinimal = surface === 'minimal' || minimalBibModeActive_;
            const id = useMinimal ? 'minimalSpaceFeedback' : 'bibSpaceFeedback';
            const el = document.getElementById(id);
            const timerName = useMinimal ? 'minimal' : 'normal';
            if (el) {
                el.classList.remove('hidden');
                el.classList.add('is-visible');
                if (timerName === 'minimal' && minimalSpaceFeedbackTimer_) clearTimeout(minimalSpaceFeedbackTimer_);
                if (timerName === 'normal' && bibSpaceFeedbackTimer_) clearTimeout(bibSpaceFeedbackTimer_);
                const timer = setTimeout(() => {
                    el.classList.remove('is-visible');
                    el.classList.add('hidden');
                }, 2300);
                if (timerName === 'minimal') minimalSpaceFeedbackTimer_ = timer;
                else bibSpaceFeedbackTimer_ = timer;
            }
            document.getElementById('bibInput')?.classList.add('bib-space-rejected');
            setTimeout(() => document.getElementById('bibInput')?.classList.remove('bib-space-rejected'), 420);
            if (useMinimal) setMinimalBibStatus_('Spaces are not allowed in BIB numbers.', true);
            try { if (navigator.vibrate) navigator.vibrate([18, 35, 18]); } catch (_) {}
        }

        function setMinimalBibRepeatedState_(isRepeated, count = 0) {
            const display = document.getElementById('minimalBibDisplay');
            const wrap = document.getElementById('minimalBibDisplayWrap');
            const hint = document.getElementById('minimalBibRepeatHint');
            const input = document.getElementById('bibInput');
            display?.classList.toggle('is-repeated-bib', !!isRepeated);
            wrap?.classList.toggle('is-repeated-bib', !!isRepeated);
            input?.classList.toggle('bib-input-repeated', !!isRepeated);
            if (hint) {
                hint.classList.toggle('is-visible', !!isRepeated);
                hint.textContent = count > 1 ? `Previously recorded · ${count} records` : 'Previously recorded';
            }
            if (wrap) {
                wrap.title = isRepeated
                    ? `This BIB already has ${Math.max(1, count)} record${count === 1 ? '' : 's'}. Submission will show the duplicate review.`
                    : '';
            }
        }

        function scheduleMinimalBibRepeatedLookup_(bibValue) {
            if (minimalDuplicateLookupTimer_) clearTimeout(minimalDuplicateLookupTimer_);
            const normalized = normalizeBibOriginal_(bibValue || '');
            const token = ++minimalDuplicateLookupToken_;
            if (!normalized || !dbReady_ || !db) {
                setMinimalBibRepeatedState_(false, 0);
                return;
            }
            minimalDuplicateLookupTimer_ = setTimeout(() => {
                minimalDuplicateLookupTimer_ = null;
                let request;
                try { request = requestLogsForBib_(normalized); }
                catch (_) { setMinimalBibRepeatedState_(false, 0); return; }
                request.onsuccess = function(event) {
                    if (token !== minimalDuplicateLookupToken_) return;
                    const current = normalizeBibOriginal_(document.getElementById('bibInput')?.value || '');
                    if (current !== normalized) return;
                    const rows = (event.target.result || []).filter(row => row && !row.pendingDelete && !isAutoRemovedDuplicate_(row));
                    setMinimalBibRepeatedState_(rows.length > 0, rows.length);
                };
                request.onerror = function() {
                    if (token === minimalDuplicateLookupToken_) setMinimalBibRepeatedState_(false, 0);
                };
            }, 120);
        }

        function syncMinimalBibInput_() {
            const input = document.getElementById('bibInput');
            const display = document.getElementById('minimalBibDisplay');
            const wrap = document.getElementById('minimalBibDisplayWrap');
            const logButton = document.getElementById('minimalBibLogButton');
            const keyboardLogButton = document.getElementById('minimalKeyboardLogButton');
            const value = String(input?.value || '');
            const normalized = normalizeBibOriginal_(value);
            if (display) {
                const length = Array.from(value).length;
                display.textContent = value || 'Tap the keypad';
                display.classList.toggle('is-placeholder', !value);
                display.classList.toggle('minimal-bib-short', !!value && length <= 4);
                display.classList.toggle('minimal-bib-medium', length >= 5 && length <= 8);
                display.classList.toggle('minimal-bib-long', length >= 9 && length <= 16);
                display.classList.toggle('minimal-bib-xlong', length > 16);
            }
            wrap?.classList.toggle('has-value', !!value);
            const submitDisabled = bibLogSubmissionInFlight_ || !isSetupComplete_() || !normalized;
            if (logButton) logButton.disabled = submitDisabled;
            if (keyboardLogButton) {
                keyboardLogButton.disabled = submitDisabled;
                keyboardLogButton.textContent = bibLogSubmissionInFlight_ ? '…' : 'LOG';
            }
            scheduleMinimalBibRepeatedLookup_(normalized);
        }

        function syncMinimalRemarkInput_(source = 'normal') {
            const normal = document.getElementById('remarkInput');
            const minimal = document.getElementById('minimalRemarkInput');
            if (!normal || !minimal) return;
            if (source === 'minimal') {
                normal.value = String(minimal.value || '').slice(0, 500);
                handleRemarkTyping();
            } else {
                minimal.value = String(normal.value || '').slice(0, 500);
            }
        }

        function activateMinimalEntryTarget_(target) {
            minimalEntryTarget_ = target === 'remark' ? 'remark' : 'bib';
            document.getElementById('minimalBibDisplayWrap')?.classList.toggle('is-active', minimalEntryTarget_ === 'bib');
            document.getElementById('minimalRemarkShell')?.classList.toggle('is-active', minimalEntryTarget_ === 'remark');
            const clearButton = document.getElementById('minimalClearButton');
            if (clearButton) clearButton.setAttribute('aria-label', minimalEntryTarget_ === 'remark' ? 'Clear remark' : 'Clear BIB');
            if (minimalNativeKeyboardActive_) {
                setTimeout(() => openMinimalNativeKeyboard_(), 0);
            } else {
                activateMinimalNumericKeypad_(false);
                setMinimalBibStatus_(minimalEntryTarget_ === 'remark'
                    ? '123 keypad active for numbers. Press ABC to type the remark with the phone keyboard.'
                    : 'Large 123 keypad active. Press ABC only when letters are needed.');
            }
        }

        function renderMinimalLastFour_(logs, frequencyMap) {
            const root = document.getElementById('minimalLastFour');
            if (!root) return;
            const list = Array.isArray(logs) ? logs.slice(0, 4) : [];
            if (!list.length) {
                root.innerHTML = '<div class="minimal-last4-empty">No local entries yet</div>';
                return;
            }
            root.innerHTML = list.map((item, index) => {
                const bib = String(item?.bib || '').trim() || '—';
                const key = bibIdentityKey_(item);
                const count = Math.max(1, Number(frequencyMap?.get?.(key)) || 1);
                const time = parseCustomOrIsoDate(item?.time);
                const timeLabel = Number.isNaN(time.getTime()) ? '' : time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const colourBucket = Math.min(20, count);
                return `<div class="minimal-last4-card last4-repeat-${colourBucket}" title="${escapeHtmlAttr_(bib)} · ${count} local record${count === 1 ? '' : 's'}">`+
                    `<strong>${escapeHtml_(bib)}</strong><small>${index === 0 ? 'LATEST' : timeLabel}</small></div>`;
            }).join('');
        }

        function updateMinimalBibContext_() {
            const checkpoint = String(document.getElementById('checkpoint')?.value || '').trim() || 'checkpoint not set';
            const volunteer = String(document.getElementById('volunteer')?.value || '').trim() || 'volunteer not set';
            const device = getDeviceLabel(buildDeviceString()) || 'This device';
            const context = document.getElementById('minimalBibContext');
            const deviceEl = document.getElementById('minimalLastFourDevice');
            if (context) context.textContent = `${checkpoint.toUpperCase()} · ${volunteer.toUpperCase()} · ${device}`;
            if (deviceEl) deviceEl.textContent = device;
        }

        function renderMinimalBibKeyboard_() {
            minimalBibKeyboardPage_ = 'numbers';
            localStorage.setItem('minimalBibKeyboardPage_v1', 'numbers');
            const numbersTab = document.getElementById('minimalTabNumbers');
            const lettersTab = document.getElementById('minimalTabLetters');
            numbersTab?.classList.toggle('active', !minimalNativeKeyboardActive_);
            lettersTab?.classList.toggle('active', minimalNativeKeyboardActive_);
            numbersTab?.setAttribute('aria-selected', minimalNativeKeyboardActive_ ? 'false' : 'true');
            lettersTab?.setAttribute('aria-selected', minimalNativeKeyboardActive_ ? 'true' : 'false');
            const root = document.getElementById('minimalBibKeyboard');
            const hint = document.getElementById('minimalNativeKeyboardHint');
            const bibWrap = document.getElementById('minimalBibDisplayWrap');
            bibWrap?.classList.toggle('native-keyboard-active', minimalNativeKeyboardActive_ && minimalEntryTarget_ === 'bib');
            if (!root) return;
            root.classList.add('numbers-layout');
            root.classList.toggle('hidden', minimalNativeKeyboardActive_);
            hint?.classList.toggle('hidden', !minimalNativeKeyboardActive_);
            if (root.childElementCount) return;
            const addKey = (char) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'minimal-key';
                button.textContent = char;
                button.setAttribute('aria-label', `Enter ${char}`);
                button.addEventListener('click', () => appendMinimalBibText_(char));
                root.appendChild(button);
            };
            const addUtility = (label, text, handler, extraClass = 'utility') => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = `minimal-key ${extraClass}`;
                button.textContent = text;
                button.setAttribute('aria-label', label);
                button.addEventListener('click', handler);
                root.appendChild(button);
            };
            MINIMAL_BIB_NUMBERS_.slice(0, 9).forEach(addKey);
            addUtility('Paste from clipboard', 'PASTE', pasteMinimalBibFromClipboard_);
            addKey('0');
            addUtility('Delete last character', '⌫', () => minimalBibBackspace_(), 'danger');
        }

        function closeMinimalNativeKeyboard_(returnToNumbers = true) {
            minimalNativeKeyboardActive_ = false;
            const nativeBib = document.getElementById('minimalNativeBibInput');
            const remark = document.getElementById('minimalRemarkInput');
            if (nativeBib) {
                nativeBib.classList.remove('is-active');
                if (document.activeElement === nativeBib) nativeBib.blur();
            }
            if (remark) {
                remark.readOnly = true;
                remark.setAttribute('inputmode', 'none');
                if (document.activeElement === remark) remark.blur();
            }
            if (returnToNumbers) renderMinimalBibKeyboard_();
        }

        function activateMinimalNumericKeypad_(announce = true) {
            closeMinimalNativeKeyboard_(false);
            minimalBibKeyboardPage_ = 'numbers';
            renderMinimalBibKeyboard_();
            if (announce) setMinimalBibStatus_(minimalEntryTarget_ === 'remark'
                ? 'Large 123 keypad active. Press ABC to type the remark.'
                : 'Large 123 keypad active. Press ABC only when letters are needed.');
        }

        function openMinimalNativeKeyboard_() {
            if (!minimalBibModeActive_) return;
            minimalNativeKeyboardActive_ = true;
            renderMinimalBibKeyboard_();
            if (minimalEntryTarget_ === 'remark') {
                const remark = document.getElementById('minimalRemarkInput');
                if (!remark) return;
                remark.readOnly = false;
                remark.setAttribute('inputmode', 'text');
                setMinimalBibStatus_('Phone keyboard active for the remark. Spaces are allowed here.');
                // iOS only opens the software keyboard when focus happens inside the
                // original tap/click gesture. Do not defer this focus with setTimeout.
                try { remark.focus({ preventScroll: true }); } catch (_) { remark.focus(); }
                if (document.activeElement !== remark) {
                    requestAnimationFrame(() => { try { remark.focus({ preventScroll: true }); } catch (_) {} });
                }
                return;
            }
            const source = document.getElementById('bibInput');
            const nativeBib = document.getElementById('minimalNativeBibInput');
            if (!source || !nativeBib) return;
            nativeBib.value = source.value;
            nativeBib.classList.add('is-active');
            setMinimalBibStatus_('Phone keyboard active for BIB letters. Spaces remain blocked.');
            // Focus synchronously so one ABC tap opens the keyboard on iPhone/iPad PWAs.
            try { nativeBib.focus({ preventScroll: true }); } catch (_) { nativeBib.focus(); }
            try { nativeBib.setSelectionRange(nativeBib.value.length, nativeBib.value.length); } catch (_) {}
            if (document.activeElement !== nativeBib) {
                requestAnimationFrame(() => {
                    try { nativeBib.focus({ preventScroll: true }); } catch (_) {}
                    try { nativeBib.setSelectionRange(nativeBib.value.length, nativeBib.value.length); } catch (_) {}
                });
            }
        }

        function setMinimalBibKeyboardPage_(page) {
            if (page === 'numbers') activateMinimalNumericKeypad_();
            else openMinimalNativeKeyboard_();
        }

        function handleMinimalNativeBibInput_(el) {
            const source = document.getElementById('bibInput');
            if (!source || !el) return;
            source.value = String(el.value || '');
            sanitizeBibTyping_(source);
            el.value = source.value;
            autoScaleBibFontSize_();
            syncMinimalBibInput_();
        }

        function handleMinimalNativeBibKeydown_(event) {
            if (event.key === ' ') {
                event.preventDefault();
                showBibSpaceBlockedFeedback_('minimal');
                return;
            }
            if (event.key === 'Enter') {
                event.preventDefault();
                document.getElementById('minimalNativeBibInput')?.blur();
                submitMinimalBib_();
            } else if (event.key === 'Escape') {
                event.preventDefault();
                activateMinimalNumericKeypad_();
            }
        }

        function handleMinimalRemarkNativeKeydown_(event) {
            if (event.key === 'Enter') {
                event.preventDefault();
                document.getElementById('minimalRemarkInput')?.blur();
                submitMinimalBib_();
            } else if (event.key === 'Escape') {
                event.preventDefault();
                activateMinimalNumericKeypad_();
            }
        }

        function handleMinimalNativeKeyboardBlur_() {
            setTimeout(() => {
                const nativeBib = document.getElementById('minimalNativeBibInput');
                const remark = document.getElementById('minimalRemarkInput');
                if (document.activeElement !== nativeBib && document.activeElement !== remark && minimalNativeKeyboardActive_) {
                    activateMinimalNumericKeypad_(false);
                }
            }, 100);
        }

        function appendMinimalBibText_(text) {
            const incoming = String(text || '');
            if (minimalEntryTarget_ === 'remark') {
                const normal = document.getElementById('remarkInput');
                const minimal = document.getElementById('minimalRemarkInput');
                if (!normal || !minimal) return;
                const current = String(normal.value || '');
                const available = Math.max(0, 500 - current.length);
                if (!available) { setMinimalBibStatus_('Maximum 500 remark characters reached.', true); return; }
                normal.value = (current + incoming.slice(0, available)).replace(/[\u0000-\u001F\u007F]/g, '');
                syncMinimalRemarkInput_('normal');
                handleRemarkTyping();
                setMinimalBibStatus_('Remark updated. LOG records it with this BIB.');
                return;
            }
            const input = document.getElementById('bibInput');
            if (!input) return;
            const hadSpace = /\s/.test(incoming);
            const withoutSpaces = incoming.replace(/\s+/g, '');
            if (hadSpace) showBibSpaceBlockedFeedback_('minimal');
            if (!withoutSpaces) return;
            const available = Math.max(0, MAX_BIB_LABEL_LENGTH_ - input.value.length);
            if (!available) {
                setMinimalBibStatus_(`Maximum ${MAX_BIB_LABEL_LENGTH_} characters reached.`, true);
                return;
            }
            input.value += withoutSpaces.slice(0, available);
            sanitizeBibTyping_(input);
            autoScaleBibFontSize_();
            syncMinimalBibInput_();
            setMinimalBibStatus_('Large 123 keypad active. Press ABC only when letters are needed.');
        }

        function minimalBibBackspace_(targetOverride = '') {
            const target = targetOverride || minimalEntryTarget_;
            if (target === 'remark') {
                const normal = document.getElementById('remarkInput');
                if (!normal || !normal.value) return;
                normal.value = Array.from(normal.value).slice(0, -1).join('');
                syncMinimalRemarkInput_('normal');
                handleRemarkTyping();
                return;
            }
            const input = document.getElementById('bibInput');
            if (!input || !input.value) return;
            input.value = Array.from(input.value).slice(0, -1).join('');
            autoScaleBibFontSize_();
            syncMinimalBibInput_();
        }

        function clearMinimalBib_() {
            if (minimalEntryTarget_ === 'remark') {
                const normal = document.getElementById('remarkInput');
                if (normal) normal.value = '';
                syncMinimalRemarkInput_('normal');
                handleRemarkTyping();
                setMinimalBibStatus_('Remark cleared.');
                return;
            }
            const input = document.getElementById('bibInput');
            if (input) input.value = '';
            autoScaleBibFontSize_();
            syncMinimalBibInput_();
            setMinimalBibStatus_('BIB cleared.');
        }

        async function pasteMinimalBibFromClipboard_() {
            try {
                if (!navigator.clipboard?.readText) throw new Error('Clipboard access is unavailable');
                const text = await navigator.clipboard.readText();
                if (!text) throw new Error('Clipboard is empty');
                appendMinimalBibText_(text);
                setMinimalBibStatus_('Pasted from clipboard.');
            } catch (error) {
                setMinimalBibStatus_('Clipboard permission unavailable. Use the regular entry field for uncommon characters.', true);
            }
        }

        function openMinimalBibMode_(event) {
            event?.preventDefault?.();
            event?.stopPropagation?.();
            if (!isSetupComplete_()) {
                alert('⚠️ Complete Checkpoint Name and Volunteer Initials before opening quick entry.');
                focusIncompleteSetup_();
                return;
            }
            const view = document.getElementById('minimalBibModeView');
            const input = document.getElementById('bibInput');
            if (!view || !input) return;
            document.activeElement?.blur?.();
            minimalBibModeActive_ = true;
            minimalNativeKeyboardActive_ = false;
            setBibInputToolsVisible_(false);
            input.dataset.previousInputmode = input.getAttribute('inputmode') || 'text';
            input.setAttribute('inputmode', 'none');
            input.readOnly = true;
            view.classList.remove('hidden');
            document.body.classList.add('minimal-bib-open');
            const toggle = document.getElementById('minimalBibModeToggle');
            toggle?.setAttribute('aria-pressed', 'true');
            updateMinimalBibContext_();
            minimalBibKeyboardPage_ = 'numbers';
            renderMinimalBibKeyboard_();
            syncMinimalBibInput_();
            syncMinimalRemarkInput_('normal');
            activateMinimalEntryTarget_('bib');
            loadHistory();
        }

        function closeMinimalBibMode_(event) {
            event?.preventDefault?.();
            event?.stopPropagation?.();
            if (!minimalBibModeActive_) return;
            minimalBibModeActive_ = false;
            closeMinimalNativeKeyboard_(false);
            const view = document.getElementById('minimalBibModeView');
            const input = document.getElementById('bibInput');
            view?.classList.add('hidden');
            document.body.classList.remove('minimal-bib-open');
            if (input) {
                input.readOnly = false;
                applyBibKeyboardMode_(localStorage.getItem('bibKeyboardMode') || input.dataset.previousInputmode || 'text', false);
                delete input.dataset.previousInputmode;
            }
            document.getElementById('minimalBibModeToggle')?.setAttribute('aria-pressed', 'false');
            setBibInputToolsVisible_(false);
        }

        function toggleMinimalBibMode_(event) {
            if (minimalBibModeActive_) closeMinimalBibMode_(event);
            else openMinimalBibMode_(event);
        }

        function submitMinimalBib_() {
            if (!normalizeBibOriginal_(document.getElementById('bibInput')?.value || '')) {
                setMinimalBibStatus_('Enter a BIB label first.', true);
                return;
            }
            checkDuplicateAndLog();
        }

        function submitMinimalBibFromKeyboard_(event) {
            event?.preventDefault?.();
            event?.stopPropagation?.();
            const now = Date.now();
            // touchstart/mousedown/click can all be emitted for one physical tap.
            if (now - minimalKeyboardSubmitAt_ < 650) return;
            minimalKeyboardSubmitAt_ = now;

            const nativeBib = document.getElementById('minimalNativeBibInput');
            const source = document.getElementById('bibInput');
            if (nativeBib && source) {
                source.value = String(nativeBib.value || source.value || '');
                sanitizeBibTyping_(source);
                nativeBib.value = source.value;
                autoScaleBibFontSize_();
                syncMinimalBibInput_();
            }
            if (!normalizeBibOriginal_(source?.value || '')) {
                setMinimalBibStatus_('Enter a BIB label first.', true);
                return;
            }

            // iOS may suppress modal/async actions while the keyboard owns the visual
            // viewport. The volunteer still performs one tap: we close it ourselves,
            // submit immediately, then reopen it after the result/cancel path completes.
            minimalReopenKeyboardAfterSubmit_ = true;
            try { nativeBib?.blur(); } catch (_) {}
            try { document.getElementById('minimalRemarkInput')?.blur(); } catch (_) {}
            setMinimalBibStatus_('Logging BIB…');
            submitMinimalBib_();
        }

        function handleMinimalBibPhysicalKey_(event) {
            if (!minimalBibModeActive_ || event.defaultPrevented) return;
            if (event.target?.id === 'minimalNativeBibInput' || event.target?.id === 'minimalRemarkInput') return;
            if (event.key === 'Escape') { event.preventDefault(); closeMinimalBibMode_(event); return; }
            if (event.key === 'Enter') { event.preventDefault(); submitMinimalBib_(); return; }
            if (event.key === 'Backspace') { event.preventDefault(); minimalBibBackspace_(); return; }
            if (event.ctrlKey || event.metaKey || event.altKey) return;
            if (event.key && event.key.length === 1) {
                event.preventDefault();
                if (minimalEntryTarget_ === 'bib' && /\s/.test(event.key)) {
                    showBibSpaceBlockedFeedback_('minimal');
                    return;
                }
                appendMinimalBibText_(event.key);
            }
        }

        function initMinimalBibMode_() {
            renderMinimalBibKeyboard_();
            syncMinimalBibInput_();
            syncMinimalRemarkInput_('normal');
            activateMinimalEntryTarget_('bib');
            document.addEventListener('keydown', handleMinimalBibPhysicalKey_, true);
        }

        function initBatteryMonitoring() {
            if ('getBattery' in navigator) {
                navigator.getBattery().then(battery => {
                    function updateBatteryStatus() {
                        latestBatteryState_ = { level: Number.isFinite(battery.level) ? battery.level : null, charging: !!battery.charging };
                        if (battery.level <= 0.15 && !battery.charging) {
                            if (!lowBatteryThresholdActive) activateBatterySafeMode(false);
                        } else {
                            if (lowBatteryThresholdActive) deactivateBatterySafeMode();
                        }
                    }
                    updateBatteryStatus();
                    battery.addEventListener('levelchange', updateBatteryStatus);
                    battery.addEventListener('chargingchange', updateBatteryStatus);
                });
            }
        }

        function activateBatterySafeMode(forcedByFlag = false) {
            if (!forcedByFlag) lowBatteryThresholdActive = true;
            shutOffGPSHardware();
            resetSyncTimer();
            currentAdaptiveViewClamp = Math.min(dynamicHardwareMaxCap, 40);
            loadHistory();
        }

        function deactivateBatterySafeMode() {
            lowBatteryThresholdActive = false;
            if (batterySaverManual) return; 
            resetSyncTimer();
            profileDevicePerformanceCapabilities(); 
            loadHistory();
        }

        /**
         * A random-but-stable per-device offset (0-4s), so many devices at the same
         * event don't all poll the server in the exact same instant every interval --
         * that synchronized "thundering herd" is what's most likely to trip Apps
         * Script's simultaneous-execution/quota ceilings, and it tends to happen right
         * at the busiest, worst-possible moment (e.g. a finish-line rush).
         */
        function getDeviceJitterMs_() {
            let jitter = parseInt(localStorage.getItem("deviceJitterMs") || "", 10);
            if (isNaN(jitter)) {
                jitter = Math.floor(Math.random() * 4000);
                localStorage.setItem("deviceJitterMs", String(jitter));
            }
            return jitter;
        }

        /**
         * Scales the effective polling interval up as the race's total logged rows
         * grow -- a bigger race almost always means more devices polling concurrently,
         * so easing off frequency a bit as volume grows keeps total request load roughly
         * in check without anyone having to manually retune the sync interval setting
         * mid-event. Purely additive on top of whatever interval the user picked in
         * Settings; never used to go faster than what they chose.
         */
        function getVolumeAdjustedIntervalMs_(baseIntervalMs) {
            const totalRecords = (lastKnownSummaryRows || []).reduce((sum, r) => {
                const n = parseInt(r.runners, 10);
                return sum + (isNaN(n) ? 0 : n);
            }, 0);
            let multiplier = 1;
            if (totalRecords > 5000) multiplier = 2;
            else if (totalRecords > 1500) multiplier = 1.5;
            else if (totalRecords > 500) multiplier = 1.2;
            return Math.round(baseIntervalMs * multiplier);
        }

        function resetSyncTimer() {
            if (syncTimerId) clearInterval(syncTimerId);
            if (reconciliationTimerId) clearInterval(reconciliationTimerId);
            if (syncIntervalMs === 0) return; 
            let actualTimerLoop = (lowBatteryThresholdActive || batterySaverManual) ? Math.max(syncIntervalMs, 60000) : syncIntervalMs;
            actualTimerLoop = getVolumeAdjustedIntervalMs_(actualTimerLoop) + getDeviceJitterMs_();
            syncTimerId = setInterval(function() {
                if (syncUrl) {
                    attemptSync();
                    pullServerRecords();
                }
            }, actualTimerLoop);

            // Do not page the complete event in the background on every logging phone.
            // Complete reconciliation is intentionally on-demand for Safety/Director and
            // revision repair; the regular logger only performs small incremental pulls.
        }

        // BIB length is event-defined, not hard-coded. One-, two-, three-, four-digit
        // and longer alphanumeric BIBs all use the same field. The font is measured
        // against the actual available input width instead of assuming a fixed digit count.
        const BIB_FONT_BASE_REM = 2.25;
        const BIB_FONT_MIN_REM = 1.0;

        function computeBibFontSizeRem_(charCount) {
            if (charCount <= 4) return BIB_FONT_BASE_REM;
            return Math.max(BIB_FONT_MIN_REM, BIB_FONT_BASE_REM - (charCount - 4) * 0.18);
        }

        function autoScaleBibFontSize_() {
            const el = document.getElementById('bibInput');
            if (!el) return;
            let size = computeBibFontSizeRem_(el.value.length);
            el.style.fontSize = size + 'rem';
            const available = Math.max(80, el.clientWidth - 36);
            let guard = 0;
            while (el.scrollWidth > available && size > BIB_FONT_MIN_REM && guard++ < 16) {
                size = Math.max(BIB_FONT_MIN_REM, size - 0.08);
                el.style.fontSize = size + 'rem';
            }
        }

        /** Manual BIB entry accepts printable labels and punctuation, but never
         * whitespace. This avoids visually identical BIBs differing only by spaces. */
        function sanitizeBibTyping_(el) {
            if (!el) return;
            const before = String(el.value || '');
            const pos = Number.isFinite(el.selectionStart) ? el.selectionStart : before.length;
            let cleaned = before;
            try { cleaned = cleaned.normalize('NFKC'); } catch (_) { /* old WebView */ }
            const hadWhitespace = /\s/.test(cleaned);
            const whitespaceBeforeCursor = (cleaned.slice(0, pos).match(/\s/g) || []).length;
            cleaned = cleaned.replace(/[\u0000-\u001F\u007F]/g, '').replace(/\s+/g, '').slice(0, MAX_BIB_LABEL_LENGTH_);
            if (hadWhitespace) showBibSpaceBlockedFeedback_(minimalBibModeActive_ ? 'minimal' : 'normal');
            if (cleaned !== before) {
                el.value = cleaned;
                const newPos = Math.max(0, Math.min(cleaned.length, pos - whitespaceBeforeCursor));
                try { el.setSelectionRange(newPos, newPos); } catch (_) { /* unsupported */ }
            }
        }

        function checkpointToken_(value) {
            return String(value || '').trim().toUpperCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
        }

        function checkpointGpsProfiles_() {
            return Array.isArray(checkpointGpsBundle_ && checkpointGpsBundle_.profiles)
                ? checkpointGpsBundle_.profiles.filter(profile => profile && Number.isFinite(Number(profile.latitude)) && Number.isFinite(Number(profile.longitude)))
                : [];
        }

        function checkpointGpsProfileNames_(profile) {
            return [profile && profile.checkpoint].concat(Array.isArray(profile && profile.aliases) ? profile.aliases : [])
                .map(checkpointToken_).filter(Boolean);
        }

        function checkpointGpsProfileMatches_(profile, checkpoint) {
            const token = checkpointToken_(checkpoint);
            return !!token && checkpointGpsProfileNames_(profile).includes(token);
        }

        function haversineMeters_(lat1, lon1, lat2, lon2) {
            const values = [lat1, lon1, lat2, lon2].map(Number);
            if (!values.every(Number.isFinite)) return Infinity;
            const toRad = value => value * Math.PI / 180;
            const dLat = toRad(values[2] - values[0]);
            const dLon = toRad(values[3] - values[1]);
            const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(values[0])) * Math.cos(toRad(values[2])) * Math.sin(dLon / 2) ** 2;
            return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
        }

        function checkpointProfilePriority_(profile, routeConfig) {
            let score = String(profile && profile.source || '').toLowerCase() === 'configured' ? 100 : 0;
            const routeKm = canonicalRaceKmKey_(routeConfig && routeConfig.km);
            const profileKm = canonicalRaceKmKey_(profile && profile.raceKm);
            const routeCategory = String(routeConfig && routeConfig.category || '').trim().toUpperCase();
            const profileCategory = String(profile && profile.category || '').trim().toUpperCase();
            if (routeKm && profileKm === routeKm) score += 30;
            else if (!profileKm) score += 8;
            else if (routeKm) score -= 20;
            if (routeCategory && profileCategory === routeCategory) score += 20;
            else if (!profileCategory) score += 5;
            else if (routeCategory) score -= 10;
            if (Number.isFinite(Number(profile && profile.checkpointKm))) score += 2;
            return score;
        }

        function checkpointGpsProfileFor_(checkpoint, routeConfig) {
            const matches = checkpointGpsProfiles_().filter(profile => checkpointGpsProfileMatches_(profile, checkpoint));
            matches.sort((a, b) => checkpointProfilePriority_(b, routeConfig) - checkpointProfilePriority_(a, routeConfig));
            return matches[0] || null;
        }

        function checkpointGpsKmFor_(checkpoint, routeConfig) {
            const matches = checkpointGpsProfiles_().filter(profile => checkpointGpsProfileMatches_(profile, checkpoint) && Number.isFinite(Number(profile.checkpointKm)));
            matches.sort((a, b) => checkpointProfilePriority_(b, routeConfig) - checkpointProfilePriority_(a, routeConfig));
            const profile = matches[0];
            if (!profile) return null;
            const km = Number(profile.checkpointKm);
            const total = parseRaceDistanceNumber_(routeConfig && routeConfig.km);
            if (!(km >= 0) || (Number.isFinite(total) && km > total + .01)) return null;
            return { km, source: `gps-profile:${profile.source || 'configured'}`, profile };
        }

        function nearestCheckpointGpsProfile_(position, profiles) {
            const source = Array.isArray(profiles) ? profiles : checkpointGpsProfiles_();
            const candidates = source.map(profile => ({
                profile,
                distanceM: haversineMeters_(position.latitude, position.longitude, profile.latitude, profile.longitude)
            })).filter(item => Number.isFinite(item.distanceM));
            candidates.sort((a, b) => a.distanceM - b.distanceM || checkpointProfilePriority_(b.profile, null) - checkpointProfilePriority_(a.profile, null));
            return candidates[0] || null;
        }

        function gpsToleranceMeters_(profile, position) {
            const radius = Math.max(25, Number(profile && profile.radiusM) || 250);
            const accuracy = Math.max(0, Number(position && position.accuracy) || 0);
            return Math.max(radius, accuracy * 2, 100);
        }

        function formatGpsDistance_(meters) {
            if (!Number.isFinite(Number(meters))) return 'unknown distance';
            const value = Number(meters);
            return value < 1000 ? `${Math.round(value)} m` : `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)} km`;
        }

        function applyCheckpointGpsFromPayload_(payload) {
            const bundle = payload && payload.checkpointGps;
            if (!bundle || typeof bundle !== 'object' || !Array.isArray(bundle.profiles)) return;
            checkpointGpsBundle_ = bundle;
            try { localStorage.setItem(CHECKPOINT_GPS_STORAGE_KEY_, JSON.stringify(bundle)); } catch (_) { /* optional */ }
            evaluateGpsCheckpointAdvisor_();
        }

        function gpsCheckpointDecision_(checkpoint, position, routeConfig) {
            const profiles = checkpointGpsProfiles_();
            if (!position || !Number.isFinite(Number(position.latitude)) || !Number.isFinite(Number(position.longitude)) || !profiles.length) {
                return { status: 'unverified', checkpoint: checkpointToken_(checkpoint) };
            }
            const currentProfiles = profiles.filter(profile => checkpointGpsProfileMatches_(profile, checkpoint));
            const currentNearest = nearestCheckpointGpsProfile_(position, currentProfiles);
            const nearest = nearestCheckpointGpsProfile_(position, profiles);
            const configuredProfiles = profiles.filter(profile => String(profile.source || '').toLowerCase() === 'configured');
            const nearestConfigured = nearestCheckpointGpsProfile_(position, configuredProfiles);
            const accuracy = Math.max(0, Number(position.accuracy) || 0);
            const spamDistanceM = Math.max(5000, Number(checkpointGpsBundle_ && checkpointGpsBundle_.spamDistanceM) || 25000);
            const hardSpam = !!(nearestConfigured && accuracy <= 250 && nearestConfigured.distanceM > spamDistanceM);
            if (hardSpam) {
                return { status: 'spam', checkpoint: checkpointToken_(checkpoint), nearest, nearestConfigured, distanceM: nearestConfigured.distanceM, accuracy };
            }
            if (nearest) {
                const nearestTolerance = gpsToleranceMeters_(nearest.profile, position);
                const nearDetected = nearest.distanceM <= nearestTolerance;
                const detectedMatches = checkpointGpsProfileMatches_(nearest.profile, checkpoint);
                if (nearDetected && !detectedMatches) {
                    return { status: 'switch', checkpoint: checkpointToken_(checkpoint), nearest, currentNearest, distanceM: nearest.distanceM, accuracy };
                }
            }
            if (currentNearest) {
                const currentTolerance = gpsToleranceMeters_(currentNearest.profile, position);
                if (currentNearest.distanceM <= currentTolerance) {
                    return { status: 'good', checkpoint: checkpointToken_(checkpoint), currentNearest, distanceM: currentNearest.distanceM, accuracy };
                }
                if (currentNearest.distanceM > Math.max(2000, currentTolerance * 3)) {
                    return { status: 'mismatch', checkpoint: checkpointToken_(checkpoint), nearest, currentNearest, distanceM: currentNearest.distanceM, accuracy };
                }
            }
            return { status: 'unverified', checkpoint: checkpointToken_(checkpoint), nearest, currentNearest, accuracy };
        }

        function hideGpsCheckpointAdvisor_() {
            const advisor = document.getElementById('gpsCheckpointAdvisor');
            if (advisor) advisor.classList.add('hidden');
        }

        function evaluateGpsCheckpointAdvisor_() {
            const advisor = document.getElementById('gpsCheckpointAdvisor');
            if (!advisor) return;
            const checkpoint = (document.getElementById('checkpoint')?.value || '').trim();
            if (!checkpoint || !checkpointGpsProfiles_().length || lastGeoposition.latitude === null) {
                hideGpsCheckpointAdvisor_();
                return;
            }
            const decision = gpsCheckpointDecision_(checkpoint, lastGeoposition, null);
            gpsAdvisorCandidate_ = decision;
            const title = document.getElementById('gpsCheckpointAdvisorTitle');
            const text = document.getElementById('gpsCheckpointAdvisorText');
            const switchBtn = document.getElementById('gpsSwitchCheckpointBtn');
            const keepBtn = document.getElementById('gpsKeepCheckpointBtn');
            advisor.classList.remove('hidden', 'good', 'warn', 'spam');
            switchBtn?.classList.add('hidden');
            keepBtn?.classList.add('hidden');
            if (decision.status === 'good') {
                advisor.classList.add('good');
                if (title) title.textContent = `📍 GPS matches ${checkpointToken_(checkpoint)}`;
                if (text) text.textContent = `${formatGpsDistance_(decision.distanceM)} from the checkpoint profile${decision.accuracy ? ` • GPS accuracy ±${Math.round(decision.accuracy)} m` : ''}.`;
                return;
            }
            if (decision.status === 'switch') {
                advisor.classList.add('warn');
                const detected = checkpointToken_(decision.nearest.profile.checkpoint);
                if (title) title.textContent = `📍 Device appears to be at ${detected}`;
                if (text) text.textContent = `Detected ${formatGpsDistance_(decision.nearest.distanceM)} away. Current Setup is ${checkpointToken_(checkpoint)}. Change Setup before logging at the new location.`;
                if (switchBtn) { switchBtn.textContent = `Use ${detected}`; switchBtn.classList.remove('hidden'); }
                keepBtn?.classList.remove('hidden');
                return;
            }
            if (decision.status === 'spam') {
                advisor.classList.add('spam');
                if (title) title.textContent = '🚫 GPS is far outside the configured event area';
                if (text) text.textContent = `${formatGpsDistance_(decision.distanceM)} from the nearest configured checkpoint. New scans are treated as Location Spam and excluded from counts unless the location configuration is corrected.`;
                keepBtn?.classList.remove('hidden');
                return;
            }
            if (decision.status === 'mismatch') {
                advisor.classList.add('warn');
                if (title) title.textContent = `⚠️ GPS no longer matches ${checkpointToken_(checkpoint)}`;
                if (text) text.textContent = `${formatGpsDistance_(decision.distanceM)} from the selected checkpoint. The volunteer may have moved; confirm or change Checkpoint Name.`;
                if (decision.nearest && decision.nearest.distanceM <= gpsToleranceMeters_(decision.nearest.profile, lastGeoposition)) {
                    const detected = checkpointToken_(decision.nearest.profile.checkpoint);
                    if (switchBtn) { switchBtn.textContent = `Use ${detected}`; switchBtn.classList.remove('hidden'); }
                }
                keepBtn?.classList.remove('hidden');
                return;
            }
            if (Date.now() < gpsAdvisorDismissedUntil_) { hideGpsCheckpointAdvisor_(); return; }
            advisor.classList.add('warn');
            if (title) title.textContent = '📍 GPS checkpoint could not be confirmed';
            if (text) text.textContent = checkpointGpsBundle_ && checkpointGpsBundle_.configuredCount
                ? 'The location is not close enough to a configured checkpoint. Check GPS accuracy and the selected checkpoint.'
                : 'Checkpoint locations are still being learned. Add rows to the CheckpointGPS sheet for immediate and reliable detection.';
            keepBtn?.classList.remove('hidden');
        }

        function useGpsDetectedCheckpoint_() {
            const decision = gpsAdvisorCandidate_;
            const detected = decision && decision.nearest && checkpointToken_(decision.nearest.profile.checkpoint);
            const input = document.getElementById('checkpoint');
            if (!detected || !input) return;
            input.value = detected;
            gpsAdvisorDismissedUntil_ = 0;
            onCheckpointInput_();
            updateCheckpointKmHelp_();
            announceToScreenReader_(`Checkpoint changed to ${detected} from GPS location.`);
        }

        function keepCurrentCheckpointFromGps_() {
            gpsAdvisorDismissedUntil_ = Date.now() + 5 * 60 * 1000;
            hideGpsCheckpointAdvisor_();
        }

        function updateLastGpsPosition_(pos) {
            if (!pos || !pos.coords) return;
            lastGeoposition.latitude = Number(pos.coords.latitude);
            lastGeoposition.longitude = Number(pos.coords.longitude);
            lastGeoposition.accuracy = Number(pos.coords.accuracy) || null;
            lastGeoposition.timestamp = Number(pos.timestamp) || Date.now();
            evaluateGpsCheckpointAdvisor_();
        }

        function requestGpsPosition_(forceFresh) {
            if (!navigator.geolocation) return Promise.resolve(null);
            const freshEnough = lastGeoposition.latitude !== null && (Date.now() - lastGeoposition.timestamp) < (forceFresh ? 45000 : 180000);
            if (freshEnough) return Promise.resolve(lastGeoposition);
            if (gpsPositionPromise_) return gpsPositionPromise_;
            isGpsHardwareRunning = true;
            gpsPositionPromise_ = new Promise(resolve => {
                navigator.geolocation.getCurrentPosition(
                    pos => { updateLastGpsPosition_(pos); resolve(lastGeoposition); },
                    () => resolve(lastGeoposition.latitude === null ? null : lastGeoposition),
                    { enableHighAccuracy: gpsQuality === 'high', timeout: forceFresh ? 6000 : 9000, maximumAge: forceFresh ? 15000 : 120000 }
                );
            }).finally(() => { gpsPositionPromise_ = null; isGpsHardwareRunning = false; });
            return gpsPositionPromise_;
        }

        function warmUpGPS() {
            if (lowBatteryThresholdActive || batterySaverManual) return;
            if (gpsWarmupTimeout) clearTimeout(gpsWarmupTimeout);
            requestGpsPosition_(false);
            gpsWarmupTimeout = setTimeout(shutOffGPSHardware, 10000);
        }

        function startCheckpointGpsMonitoring_() {
            stopCheckpointGpsMonitoring_();
            if (!navigator.geolocation || document.hidden || lowBatteryThresholdActive || batterySaverManual) return;
            if (gpsQuality === 'high' && typeof navigator.geolocation.watchPosition === 'function') {
                checkpointGpsWatchId_ = navigator.geolocation.watchPosition(
                    updateLastGpsPosition_,
                    () => {},
                    { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
                );
            } else {
                requestGpsPosition_(false);
                checkpointGpsPollTimer_ = setInterval(() => requestGpsPosition_(true), 60000);
            }
        }

        function stopCheckpointGpsMonitoring_() {
            if (checkpointGpsPollTimer_) { clearInterval(checkpointGpsPollTimer_); checkpointGpsPollTimer_ = null; }
            if (checkpointGpsWatchId_ !== null && navigator.geolocation && typeof navigator.geolocation.clearWatch === 'function') {
                try { navigator.geolocation.clearWatch(checkpointGpsWatchId_); } catch (_) { /* no-op */ }
            }
            checkpointGpsWatchId_ = null;
        }

        async function resolveGpsBeforeLog_(checkpoint) {
            const position = await requestGpsPosition_(true);
            const decision = gpsCheckpointDecision_(checkpoint, position, null);
            if (decision.status === 'switch') {
                const detected = checkpointToken_(decision.nearest.profile.checkpoint);
                const change = confirm(`📍 GPS indicates ${detected} (${formatGpsDistance_(decision.nearest.distanceM)} away), but Setup is ${checkpointToken_(checkpoint)}.\n\nPress OK to change the checkpoint to ${detected}. Press Cancel to keep ${checkpointToken_(checkpoint)} and record a GPS mismatch acknowledgement.`);
                if (change) {
                    const input = document.getElementById('checkpoint');
                    if (input) { input.value = detected; onCheckpointInput_(); }
                    return { checkpoint: detected, status: 'verified', decision, acknowledged: true };
                }
                return { checkpoint: checkpointToken_(checkpoint), status: 'mismatch', decision, acknowledged: true };
            }
            if (decision.status === 'mismatch') {
                const proceed = confirm(`⚠️ GPS is ${formatGpsDistance_(decision.distanceM)} from ${checkpointToken_(checkpoint)}. The volunteer may have moved.\n\nPress OK to log anyway with a location-mismatch audit flag, or Cancel to change Setup first.`);
                return proceed
                    ? { checkpoint: checkpointToken_(checkpoint), status: 'mismatch', decision, acknowledged: true }
                    : { cancelled: true, decision };
            }
            if (decision.status === 'spam') {
                const proceed = confirm(`🚫 This device is ${formatGpsDistance_(decision.distanceM)} from the nearest configured event checkpoint. This looks outside the event area.\n\nPress OK only to preserve the scan as LOCATION SPAM for audit. It will be excluded from runner counts, pace, standings and safety calculations. Press Cancel to stop.`);
                return proceed
                    ? { checkpoint: checkpointToken_(checkpoint), status: 'spam', decision, acknowledged: true }
                    : { cancelled: true, decision };
            }
            return { checkpoint: checkpointToken_(checkpoint), status: decision.status === 'good' ? 'verified' : 'unverified', decision, acknowledged: false };
        }

        function shutOffGPSHardware() {
            isGpsHardwareRunning = false;
            if (gpsWarmupTimeout) clearTimeout(gpsWarmupTimeout);
        }

        let sharedAudioContext_ = null;
        let sharedAudioSuspendTimer_ = null;

        function playTone_(volume) {
            try {
                const AudioCtor = window.AudioContext || window.webkitAudioContext;
                if (!AudioCtor) return false;
                if (!sharedAudioContext_ || sharedAudioContext_.state === 'closed') sharedAudioContext_ = new AudioCtor();
                if (sharedAudioContext_.state === 'suspended') sharedAudioContext_.resume().catch(() => {});
                const oscillator = sharedAudioContext_.createOscillator();
                const gainNode = sharedAudioContext_.createGain();
                oscillator.connect(gainNode);
                gainNode.connect(sharedAudioContext_.destination);
                oscillator.type = 'sine';
                oscillator.frequency.setValueAtTime(880, sharedAudioContext_.currentTime);
                gainNode.gain.setValueAtTime(volume, sharedAudioContext_.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.001, sharedAudioContext_.currentTime + 0.12);
                oscillator.start();
                oscillator.stop(sharedAudioContext_.currentTime + 0.12);
                clearTimeout(sharedAudioSuspendTimer_);
                sharedAudioSuspendTimer_ = setTimeout(() => {
                    if (sharedAudioContext_ && sharedAudioContext_.state === 'running') sharedAudioContext_.suspend().catch(() => {});
                }, 4000);
                return true;
            } catch (e) {
                console.warn('Audio unavailable:', e);
                return false;
            }
        }

        function playSuccessSound() {
            if (soundEnabled) playTone_(0.12);
        }

        function triggerHardwareAudioBleepTest() {
            if (!playTone_(0.15)) alert("Audio test blocked or unsupported by this browser.");
        }

        function triggerHardwareHapticPulseTest() {
            if (navigator.vibrate) {
                navigator.vibrate([60, 40, 60]);
            } else {
                alert("Haptic feedback unsupported on this device.");
            }
        }

        function checkPwaDisplay() {
            if (isStandalone) return;
            document.getElementById("pwaHelpBtn").classList.remove("hidden");
        }

        function togglePwaInstructions() {
            const block = document.getElementById("pwaTutorialBlock");
            const btn = document.getElementById("pwaHelpBtn");
            if (block.classList.contains("hidden")) {
                detectBrowserLayout(); 
                block.classList.remove("hidden");
                btn.textContent = "✕ Close";
                btn.className = "text-[9px] bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-400 border border-red-300 dark:border-red-800 px-1.5 py-0.5 rounded font-bold tracking-wide";
            } else {
                block.classList.add("hidden");
                btn.textContent = "ℹ️ Install App";
                btn.className = "text-[9px] bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-400 border border-blue-300 dark:border-blue-800 px-1.5 py-0.5 rounded font-bold";
            }
        }

        function applyTheme() {
            const currentTheme = localStorage.getItem("theme") || "dark";
            const themeColorMeta = document.getElementById("themeColorMeta");
            if (currentTheme === "light") {
                document.body.classList.add("light-theme");
                document.documentElement.classList.remove("dark");
                document.getElementById("themeBtn").textContent = "🌙";
                if (themeColorMeta) themeColorMeta.setAttribute("content", "#eef0f4");
            } else {
                document.body.classList.remove("light-theme");
                document.documentElement.classList.add("dark");
                document.getElementById("themeBtn").textContent = "☀️";
                if (themeColorMeta) themeColorMeta.setAttribute("content", "#0a0a0c");
            }
        }

        function toggleTheme() {
            localStorage.setItem("theme", document.body.classList.contains("light-theme") ? "dark" : "light");
            applyTheme();
            loadHistory();
            const lastSummary = localStorage.getItem("lastCachedSummaryRows");
            if (lastSummary) renderSummaryDashboard(JSON.parse(lastSummary), eventConfigMeta_);
        }

        function getDeviceType() {
            const ua = navigator.userAgent;
            const containerMode = isStandalone ? "PWA" : "APP";
            let device = "PC";
            if (/tablet|ipad|playbook|silk/i.test(ua)) {
                device = "Tablet";
            } else if (/Mobile|Android|IP(hone|od)|IEMobile|BlackBerry|Kindle/i.test(ua)) {
                device = /iPhone|iPod/i.test(ua) ? "iPhone" : "Android Mobile";
            }
            return `${device} ${containerMode}`;
        }

        function getOrCreateDeviceId() {
            let id = localStorage.getItem("deviceId");
            if (!id) {
                id = generateUID().slice(0, 8);
                localStorage.setItem("deviceId", id);
            }
            return id;
        }

        function buildDeviceString() {
            return `${getDeviceType()}::${getOrCreateDeviceId()}`;
        }

        function getDeviceLabel(deviceString) {
            if (!deviceString) return '';
            return deviceString.split('::')[0];
        }

        function parseCreatorId(deviceString) {
            if (!deviceString || deviceString.indexOf('::') === -1) return null;
            return deviceString.split('::')[1];
        }

        function isThisDeviceEntry_(log) {
            if (!log) return false;
            const myId = getOrCreateDeviceId();
            if (log.creatorId) return String(log.creatorId) === myId;
            const parsedId = parseCreatorId(log.device);
            if (parsedId) return parsedId === myId;
            // A legacy record without any creator marker cannot safely be attributed
            // to this phone after a global sync. Only an unsynced local legacy record
            // is treated as this device's own entry.
            return log.synced === false && !log.serverReceivedAt;
        }

        function isOwnEntry(log) {
            return isThisDeviceEntry_(log);
        }

        function updateSearchBoxPlaceholder() {
            const searchBar = document.getElementById("searchBar");
            if (!searchBar) return;
            const currentCP = (document.getElementById('checkpoint').value || '').trim().toUpperCase();
            if (activeScopeFilter === 'current') {
                searchBar.placeholder = currentCP
                    ? `🔍 Search Bib, Remark, or Vol in ${currentCP}...`
                    : '🔍 Complete Setup to search this checkpoint...';
            } else {
                searchBar.placeholder = "🔍 Search Bib, Remark, Vol, or CP Globally...";
            }
        }

        /** Splits/cleans the admin's "CP1, CP2, WS1" style Settings field into an array. */
        /**
         * Rotating placeholder examples for the Setup checkpoint name field — cycles
         * through a few realistic station names (CP1, WS1, Start/Finish, ...) so a
         * volunteer sees what format to type before they've entered anything, without
         * needing an admin to pre-configure a fixed checkpoint list (the old "Known
         * Checkpoints" setting this replaces).
         */
        const CHECKPOINT_PLACEHOLDER_EXAMPLES_ = ['e.g. CP1', 'e.g. WS1', 'e.g. Start/Finish'];
        (function setCheckpointPlaceholder_() {
            const el = document.getElementById('checkpoint');
            if (el && !el.getAttribute('placeholder')) el.setAttribute('placeholder', 'e.g. CP1, WS1 or Start/Finish');
        })();

        /** Shared debounce for anything that re-renders the (potentially long) history
         * list on every keystroke -- typing "CP12" used to trigger 4 full re-renders,
         * this collapses that into 1 shortly after the person stops typing. Cheap win
         * for both perceived smoothness and battery on longer/busier races. */
        let historyRenderDebounceId_ = null;
        function debouncedLoadHistory_() {
            if (historyRenderDebounceId_) clearTimeout(historyRenderDebounceId_);
            historyRenderDebounceId_ = setTimeout(() => { historyRenderDebounceId_ = null; loadHistory(); }, 180);
        }

        function persistSetupDraft_() {
            const cp = (document.getElementById('checkpoint')?.value || '').trim().toUpperCase();
            const vol = (document.getElementById('volunteer')?.value || '').trim().toUpperCase();
            if (cp && cp !== 'N/A') localStorage.setItem('checkpointVal', cp); else localStorage.removeItem('checkpointVal');
            if (vol && vol !== 'N/A') localStorage.setItem('volunteerVal', vol); else localStorage.removeItem('volunteerVal');
            if (!cp || !vol) {
                isSetupLocked = false;
                localStorage.setItem('settingsLocked', 'false');
            }
        }

        function onCheckpointInput_() {
            persistSetupDraft_();
            updateSearchBoxPlaceholder();
            updateSetupGate_();
            debouncedLoadHistory_();
            evaluateGpsCheckpointAdvisor_();
        }

        function applyLayoutOrientation() {
            document.body.classList.remove('forced-portrait', 'forced-landscape');
            if (layoutOrientation === 'portrait') {
                document.body.classList.add('forced-portrait');
            } else if (layoutOrientation === 'landscape') {
                document.body.classList.add('forced-landscape');
            }
            loadHistory();
            requestAnimationFrame(() => {
                applyDirectorWidgetSizes_();
                renderAllWidgetWidthControls_();
                scheduleDirectorMasonry_();
            });
        }

        function formatDashboardDateStr(dateInput) {
            if (!dateInput) return "-";
            try {
                let parsedDate = parseCustomOrIsoDate(dateInput);
                if (isNaN(parsedDate.getTime())) return String(dateInput);
                return getFormattedTimestamp(parsedDate);
            } catch (e) {
                return String(dateInput);
            }
        }

        function parseRaceDistanceNumber_(value) {
            if (value === '' || value === null || value === undefined) return null;
            const match = String(value).replace(',', '.').match(/\d+(?:\.\d+)?/);
            if (!match) return null;
            const n = Number(match[0]);
            return Number.isFinite(n) && n > 0 && n <= 10000 ? n : null;
        }

        function stableClientConfigFingerprint_(rows) {
            const canonical = (rows || []).map(row => [
                String(row.km || '').trim(),
                String(row.category || '').trim().toUpperCase(),
                String(row.bibRule || '').trim().toUpperCase(),
                String(row.flagoff || '').trim(),
                String(row.cotTime || '').trim(),
                String(row.runners || '').trim(),
                String(row.sortOrder ?? '')
            ].join('|')).join('\n');
            let hash = 2166136261;
            for (let i = 0; i < canonical.length; i++) {
                hash ^= canonical.charCodeAt(i);
                hash = Math.imul(hash, 16777619);
            }
            return `local-${(hash >>> 0).toString(16).padStart(8, '0')}`;
        }

        function parseBibRuleParts_(rule) {
            return String(rule || '').toUpperCase().replace(/[–—]/g, '-').split(/[;,]+/)
                .map(part => part.trim().replace(/\s+/g, '')).filter(Boolean).map(part => {
                    let m = part.match(/^([A-Z]*)(\d+)-([A-Z]*)(\d+)$/);
                    if (m) {
                        const prefixA = m[1], prefixB = m[3] || prefixA;
                        if (prefixA !== prefixB) return null;
                        const a = Number(m[2]), b = Number(m[4]);
                        return { prefix: prefixA, lo: Math.min(a, b), hi: Math.max(a, b), raw: part };
                    }
                    m = part.match(/^([A-Z]*)(\d+)$/);
                    if (m) {
                        const n = Number(m[2]);
                        return { prefix: m[1], lo: n, hi: n, raw: part };
                    }
                    m = part.match(/^([A-Z]*)([0-9X]+)$/);
                    if (m && m[2].includes('X')) {
                        return {
                            prefix: m[1],
                            lo: Number(m[2].replace(/X/g, '0')),
                            hi: Number(m[2].replace(/X/g, '9')),
                            raw: part
                        };
                    }
                    return null;
                }).filter(Boolean);
        }

        const MAX_BIB_LABEL_LENGTH_ = 64;

        function cleanBibText_(value) {
            let text = String(value === null || value === undefined ? '' : value);
            try { text = text.normalize('NFKC'); } catch (_) { /* old WebView */ }
            return text
                .replace(/[\u0000-\u001F\u007F]/g, '')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, MAX_BIB_LABEL_LENGTH_);
        }

        function normalizeBibOriginal_(value) {
            return cleanBibText_(value).toLocaleUpperCase();
        }

        function extractBibNumber_(value) {
            return normalizeBibOriginal_(value).replace(/[^0-9]/g, '');
        }

        function normalizeBibNumberKey_(value) {
            const digits = extractBibNumber_(value);
            if (!digits) return '';
            return digits.replace(/^0+(?=\d)/, '') || '0';
        }

        function bibNumberKey_(value) {
            if (value && typeof value === 'object') {
                const stored = normalizeBibNumberKey_(value.bibNumberKey || '');
                if (stored) return stored;
                value = value.bibNumber || value.bib || value.bibKey || '';
            }
            return normalizeBibNumberKey_(value);
        }

        function bibIdentityKey_(value) {
            if (value && typeof value === 'object') {
                // Original normalized BIB is the runner identity. MO1234 and F1234B
                // remain separate runners even though both use numeric group 1234.
                const original = normalizeBibOriginal_(value.bib || value.originalBib || '');
                if (original) return original;
                const stored = normalizeBibOriginal_(value.bibKey || '');
                if (stored) return stored;
                value = value.bibNumber || '';
            }
            return normalizeBibOriginal_(value);
        }

        function decorateBibIdentity_(record) {
            if (!record || typeof record !== 'object') return record;
            const original = normalizeBibOriginal_(record.bib || record.bibKey);
            const number = extractBibNumber_(record.bibNumber || original);
            record.bib = original;
            record.bibNumber = number;
            record.bibNumberKey = normalizeBibNumberKey_(record.bibNumberKey || number);
            record.bibKey = original;
            if (!record.category) record.category = findCategoryConfigForBib_(original, categoryConfig)?.category || 'Uncategorized';
            return record;
        }

        function buildBibCollisionRegistry_(logs) {
            const groups = new Map();
            (logs || []).forEach(log => {
                const original = bibIdentityKey_(log);
                const numeric = bibNumberKey_(log);
                if (!original || !numeric) return;
                if (!groups.has(numeric)) groups.set(numeric, new Map());
                const group = groups.get(numeric);
                const serverMs = Date.parse(log.serverReceivedAt || '');
                const scanMs = Number(log.clientTimeMs) || parseCustomOrIsoDate(log.time).getTime();
                const firstSeen = Number.isFinite(serverMs) ? serverMs : (Number.isFinite(scanMs) ? scanMs : Number.MAX_SAFE_INTEGER);
                group.set(original, Math.min(group.get(original) ?? Number.MAX_SAFE_INTEGER, firstSeen));
            });
            const registry = new Map();
            groups.forEach((originals, numeric) => {
                const ordered = Array.from(originals.entries())
                    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0], undefined, { numeric: true, sensitivity: 'base' }))
                    .map(entry => entry[0]);
                ordered.forEach((original, index) => {
                    registry.set(original, {
                        numeric,
                        index: index + 1,
                        total: ordered.length,
                        indicator: ordered.length > 1 ? `${numeric} ${index + 1}` : numeric
                    });
                });
            });
            return registry;
        }

        function applyBibCollisionIndicators_(logs) {
            const registry = buildBibCollisionRegistry_(logs);
            (logs || []).forEach(log => {
                const meta = registry.get(bibIdentityKey_(log)) || {
                    numeric: bibNumberKey_(log),
                    index: 1,
                    total: 1,
                    indicator: bibNumberKey_(log) || bibIdentityKey_(log)
                };
                log.bibNumberKey = meta.numeric || '';
                log.bibCollisionIndex = meta.index;
                log.bibCollisionTotal = meta.total;
                log.bibIndicator = meta.indicator;
            });
            return logs;
        }

        function bibCollisionBadgeHtml_(log) {
            if (!log || Number(log.bibCollisionTotal) <= 1) return '';
            const title = `Numeric BIB ${log.bibNumberKey} is shared by ${log.bibCollisionTotal} different original BIBs. ${log.bib} is runner ${log.bibCollisionIndex} in this numeric group.`;
            return `<span class="bib-collision-badge" title="${escapeHtmlAttr_(title)}">${escapeHtml_(log.bibIndicator)}</span>`;
        }

        function compareBibNumericThenIdentity_(a, b) {
            const aNum = bibNumberKey_(a);
            const bNum = bibNumberKey_(b);
            if (aNum.length !== bNum.length) return aNum.length - bNum.length;
            const numericOrder = aNum.localeCompare(bNum);
            if (numericOrder) return numericOrder;
            const variantOrder = (Number(a && a.bibCollisionIndex) || 1) - (Number(b && b.bibCollisionIndex) || 1);
            if (variantOrder) return variantOrder;
            return bibIdentityKey_(a).localeCompare(bibIdentityKey_(b), undefined, { numeric: true, sensitivity: 'base' });
        }

        function bibLeadingPrefix_(value) {
            const match = normalizeBibOriginal_(value).match(/^([A-Z]+)/);
            return match ? match[1] : '';
        }

        function findExactOrNumericConfigForBib_(bib, configs) {
            if (!bib || !Array.isArray(configs) || !configs.length) return null;
            const original = normalizeBibOriginal_(bib);
            const digits = extractBibNumber_(original);
            if (!digits) return null;
            const number = parseInt(digits, 10);
            const leadingPrefix = bibLeadingPrefix_(original);
            for (const config of configs) {
                const ranges = parseBibRuleParts_(config.bibRule);
                if (ranges.some(range => range.prefix === leadingPrefix && number >= range.lo && number <= range.hi)) return config;
            }
            // Last-minute and alphanumeric BIB fallback: ignore letters only after an
            // exact-prefix lookup failed. First matching Setup row wins deterministically.
            for (const config of configs) {
                const ranges = parseBibRuleParts_(config.bibRule);
                if (ranges.some(range => number >= range.lo && number <= range.hi)) return config;
            }
            return null;
        }

        function buildEventConfigMetaClient_(rows, serverMeta) {
            const configs = Array.isArray(rows) ? rows : [];
            const issues = [];
            const groups = new Map();
            const seenIdentity = new Map();
            const ranges = [];

            configs.forEach((row, index) => {
                const sourceRow = Number(row.sourceRow) || index + 2;
                const km = parseRaceDistanceNumber_(row.km);
                const category = String(row.category || '').trim();
                const key = km ? String(Math.round(km * 100) / 100) : 'UNSPECIFIED';
                if (!groups.has(key)) groups.set(key, { km: key, categories: [] });
                if (category && !groups.get(key).categories.includes(category)) groups.get(key).categories.push(category);

                if (!category) issues.push({ level: 'error', code: 'missing-category', row: sourceRow, message: `Setup row ${sourceRow} has no category name.` });
                if (!km) issues.push({ level: 'error', code: 'invalid-km', row: sourceRow, message: `Setup row ${sourceRow} has an invalid or missing race distance.` });
                if (!String(row.bibRule || '').trim()) issues.push({ level: 'error', code: 'missing-bib-rule', row: sourceRow, message: `Setup row ${sourceRow} has no BIB rule.` });

                const identity = `${key}|${category.toUpperCase()}`;
                if (category && seenIdentity.has(identity)) {
                    issues.push({ level: 'warning', code: 'duplicate-category', row: sourceRow, message: `Rows ${seenIdentity.get(identity)} and ${sourceRow} repeat the same KM/category.` });
                } else if (category) {
                    seenIdentity.set(identity, sourceRow);
                }

                const parsed = parseBibRuleParts_(row.bibRule);
                if (row.bibRule && !parsed.length) issues.push({ level: 'error', code: 'invalid-bib-rule', row: sourceRow, message: `Setup row ${sourceRow} has an unsupported BIB rule: ${row.bibRule}.` });
                parsed.forEach(range => ranges.push({ ...range, sourceRow, category, km: key }));
            });

            for (let i = 0; i < ranges.length; i++) {
                for (let j = i + 1; j < ranges.length; j++) {
                    const a = ranges[i], b = ranges[j];
                    if (a.prefix !== b.prefix) continue;
                    if (Math.max(a.lo, b.lo) <= Math.min(a.hi, b.hi)) {
                        issues.push({
                            level: 'info',
                            code: 'overlap-bib-rule',
                            row: b.sourceRow,
                            message: `Setup rows ${a.sourceRow} and ${b.sourceRow} accept some of the same BIB numbers. This is allowed, but an overlapping BIB can match more than one category; automatic category assignment uses the first matching Setup row. Use unique ranges only when the overlap is not intentional.`
                        });
                    }
                }
            }

            const serverIssues = Array.isArray(serverMeta?.issues) ? serverMeta.issues : [];
            const mergedIssues = serverIssues.length ? serverIssues : issues;
            const distances = Array.from(groups.values())
                .filter(group => group.km !== 'UNSPECIFIED')
                .sort((a, b) => Number(b.km) - Number(a.km));
            const meta = {
                schemaVersion: Number(serverMeta?.schemaVersion) || 1,
                eventName: String(serverMeta?.eventName || 'Current Event'),
                fingerprint: String(serverMeta?.fingerprint || stableClientConfigFingerprint_(configs)),
                generatedAt: serverMeta?.generatedAt || new Date().toISOString(),
                distanceCount: Number(serverMeta?.distanceCount ?? distances.length),
                categoryCount: Number(serverMeta?.categoryCount ?? configs.length),
                distances: Array.isArray(serverMeta?.distances) && serverMeta.distances.length ? serverMeta.distances : distances,
                issues: mergedIssues,
                issueCount: Number(serverMeta?.issueCount ?? mergedIssues.length),
                errorCount: Number(serverMeta?.errorCount ?? mergedIssues.filter(i => i.level === 'error').length),
                warningCount: Number(serverMeta?.warningCount ?? mergedIssues.filter(i => i.level === 'warning').length)
            };
            return meta;
        }

        function getEventConfigHealthClass_(meta) {
            if (!meta || !meta.categoryCount) return 'warning';
            if (meta.errorCount) return 'error';
            if (meta.warningCount) return 'warning';
            return 'ready';
        }

        function getEventConfigHealthLabel_(meta) {
            if (!meta || !meta.categoryCount) return 'Waiting';
            if (meta.errorCount) return `${meta.errorCount} error${meta.errorCount === 1 ? '' : 's'}`;
            if (meta.warningCount) return `${meta.warningCount} warning${meta.warningCount === 1 ? '' : 's'}`;
            return 'Ready';
        }

        function isCheckpointMapStale_() {
            const savedFingerprint = localStorage.getItem(CHECKPOINT_MAP_CONFIG_FINGERPRINT_KEY_);
            const hasMappings = Object.keys(checkpointKmByRace_ || {}).some(k => normalizeCheckpointKmValue_(checkpointKmByRace_[k]));
            return !!(hasMappings && eventConfigMeta_?.fingerprint && savedFingerprint !== eventConfigMeta_.fingerprint);
        }

        function renderEventConfigSurfaces_() {
            const meta = eventConfigMeta_;
            const healthClass = getEventConfigHealthClass_(meta);
            const healthLabel = getEventConfigHealthLabel_(meta);
            const distanceLabel = meta?.distanceCount === 1 ? 'distance' : 'distances';
            const categoryLabel = meta?.categoryCount === 1 ? 'category' : 'categories';
            const gpsConfigured = Number(meta?.configuredGpsCount ?? checkpointGpsBundle_?.configuredCount) || 0;
            const gpsLearned = Number(checkpointGpsBundle_?.learnedCount) || 0;
            const gpsSummary = gpsConfigured || gpsLearned ? ` • GPS ${gpsConfigured} configured${gpsLearned ? ` + ${gpsLearned} learned` : ''}` : '';
            const summary = meta?.categoryCount
                ? `${meta.distanceCount} ${distanceLabel} • ${meta.categoryCount} ${categoryLabel}${gpsSummary} • schema v${meta.schemaVersion}`
                : 'No active category rows received from the Setup sheet.';

            const title = document.getElementById('eventConfigStripTitle');
            const sub = document.getElementById('eventConfigStripSub');
            const stripHealth = document.getElementById('eventConfigStripHealth');
            if (title) title.textContent = meta?.categoryCount ? `${meta.eventName}: ${meta.distanceCount} ${distanceLabel}` : 'Event setup: waiting for categories';
            if (sub) sub.textContent = meta?.categoryCount
                ? `${meta.categoryCount} category row${meta.categoryCount === 1 ? '' : 's'} synced dynamically from Setup${gpsSummary}`
                : 'Open Settings to verify the Google Apps Script connection.';
            [stripHealth, document.getElementById('eventProfileSettingsHealth')].forEach(el => {
                if (!el) return;
                el.className = `event-config-health ${healthClass}`;
                el.textContent = healthLabel;
            });
            const directorConfigBadge = document.getElementById('directorEventProfileBadge');
            if (directorConfigBadge) {
                directorConfigBadge.className = `director-event-profile-badge event-config-health ${healthClass}`;
                directorConfigBadge.textContent = meta?.categoryCount ? `${meta.distanceCount} KM groups` : 'Event setup';
            }
            const settingsSummary = document.getElementById('eventProfileSettingsSummary');
            if (settingsSummary) settingsSummary.textContent = summary;

            const stats = document.getElementById('eventProfileModalStats');
            if (stats) {
                stats.innerHTML = [
                    [meta?.distanceCount || 0, 'Race distances'],
                    [meta?.categoryCount || 0, 'Category rows'],
                    [meta?.errorCount || 0, 'Errors'],
                    [meta?.warningCount || 0, 'Warnings']
                ].map(([value, label]) => `<div class="event-profile-stat"><strong>${value}</strong><span>${label}</span></div>`).join('');
            }
            const fp = document.getElementById('eventProfileFingerprint');
            if (fp) fp.textContent = meta?.fingerprint ? `Config ${meta.fingerprint}` : '';

            const distanceList = document.getElementById('eventProfileDistanceList');
            if (distanceList) {
                const groups = Array.isArray(meta?.distances) ? meta.distances : [];
                distanceList.innerHTML = groups.length ? groups.map(group => {
                    const categories = Array.from(new Set((group.categories || []).filter(Boolean)));
                    return `<div class="event-profile-km-card">
                        <div class="event-profile-km-title">${escapeHtml_(formatKmLabel_(group.km))}</div>
                        <div class="event-profile-category-list">${categories.map(cat => `<span class="event-profile-category-chip">${escapeHtml_(cat)}</span>`).join('')}</div>
                    </div>`;
                }).join('') : '<div class="text-[10px] theme-text-muted p-3 border theme-border rounded-lg">No configured race distances yet.</div>';
            }

            const issueList = document.getElementById('eventProfileIssueList');
            if (issueList) {
                const issues = Array.isArray(meta?.issues) ? meta.issues : [];
                issueList.innerHTML = issues.length ? issues.map(issue => {
                    const level = issue.level === 'error' ? 'error' : (issue.level === 'warning' ? 'warning' : 'info');
                    const icon = level === 'error' ? '❌' : (level === 'warning' ? '⚠️' : 'ℹ️');
                    return `<div class="event-profile-issue ${level}"><span>${icon}</span><span>${escapeHtml_(issue.message || 'Configuration note')}</span></div>`;
                }).join('') : '<div class="event-profile-issue"><span>✅</span><span>No missing or invalid required Setup fields were detected.</span></div>';
            }

            const stale = isCheckpointMapStale_();
            const staleText = 'The event category/KM configuration changed after this checkpoint map was saved. Review the mapped checkpoint distances before logging runners.';
            ['eventProfileMappingWarning', 'checkpointKmMapStaleWarning'].forEach(id => {
                const el = document.getElementById(id);
                if (!el) return;
                el.innerHTML = `${escapeHtml_(staleText)} <button type="button" class="checkpoint-map-confirm" onclick="confirmCheckpointMapForCurrentConfig_()">Mappings reviewed ✓</button>`;
                el.classList.toggle('hidden', !stale);
            });
        }

        function confirmCheckpointMapForCurrentConfig_() {
            if (!eventConfigMeta_?.fingerprint) return;
            localStorage.setItem(CHECKPOINT_MAP_CONFIG_FINGERPRINT_KEY_, eventConfigMeta_.fingerprint);
            renderEventConfigSurfaces_();
        }

        function applyEventConfigMeta_(rows, serverMeta) {
            eventConfigMeta_ = buildEventConfigMetaClient_(rows, serverMeta);
            try { localStorage.setItem(EVENT_CONFIG_META_STORAGE_KEY_, JSON.stringify(eventConfigMeta_)); } catch (e) { /* storage optional */ }
            renderEventConfigSurfaces_();
        }

        function openEventProfile_() {
            renderEventConfigSurfaces_();
            document.getElementById('eventProfileModal')?.classList.remove('hidden');
        }

        function closeEventProfile_() {
            document.getElementById('eventProfileModal')?.classList.add('hidden');
        }

        async function refreshEventConfig_(button) {
            if (!syncUrl) {
                alert('⚠️ Configure the Google Apps Script Web App URL first.');
                return;
            }
            const original = button?.textContent;
            if (button) { button.disabled = true; button.textContent = 'Refreshing…'; }
            try {
                const url = `${syncUrl}${syncUrl.includes('?') ? '&' : '?'}action=config&nocache=${Date.now()}`;
                const response = await fetchWithTimeout(url, { cache: 'no-store' }, 12000);
                const data = await response.json();
                if (data.status !== 'success') throw new Error(data.message || 'Configuration request failed.');
                renderSummaryDashboard(data.config || data.summary || [], data.configMeta);
                applyRouteModelsFromPayload_(data);
                if (button) { button.textContent = 'Updated ✓'; await new Promise(resolve => setTimeout(resolve, 650)); }
            } catch (err) {
                alert(`❌ Could not refresh the event configuration: ${err.message || err}`);
            } finally {
                if (button) { button.disabled = false; button.textContent = original || 'Refresh configuration'; }
            }
        }

        function downloadTextFile_(filename, content, mimeType) {
            const blob = new Blob([content], { type: mimeType || 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }

        function csvCell_(value) {
            return `"${String(value ?? '').replace(/"/g, '""')}"`;
        }

        function downloadCurrentEventConfigCsv_() {
            const rows = categoryConfig || [];
            if (!rows.length) { alert('No event configuration is available to export.'); return; }
            const header = ['COT','KM','Category','BIB Rule','Colour','Registered Runner','Flagoff','COT Time','Active','Sort Order','Checkpoint Sequence','Max Checkpoint Jump','COT Warning Minutes','COT Escalation Minutes'];
            const lines = [header.map(csvCell_).join(',')].concat(rows.map(row => [
                row.cot, row.km, row.category, row.bibRule, row.color, row.runners, row.flagoff, row.cotTime, 'TRUE', row.sortOrder ?? '',
                (row.checkpointSequence || []).join(' > '), row.maxCheckpointJump ?? 2, row.cotWarningMinutes ?? '', row.cotEscalationMinutes ?? ''
            ].map(csvCell_).join(',')));
            downloadTextFile_(`race-event-config-${new Date().toISOString().slice(0,10)}.csv`, '\uFEFF' + lines.join('\r\n'), 'text/csv;charset=utf-8');
        }

        function downloadFutureEventTemplate_() {
            const nextYear = new Date().getFullYear() + 1;
            const lines = [
                ['COT','KM','Category','BIB Rule','Colour','Runner','Registered Runner','Flagoff','COT Time','Active','Sort Order','Checkpoint Sequence','Max Checkpoint Jump','COT Warning Minutes','COT Escalation Minutes'],
                ['24H','100','Men Open','1001-1199','#3b82f6','','120',`${nextYear}-01-01 05:00`,'05:00','TRUE','10','START > CP1 > CP2 > FINISH','2','45','15'],
                ['24H','100','Women Open','1200-1299','#ec4899','','80',`${nextYear}-01-01 05:00`,'05:00','TRUE','20','START > CP1 > CP2 > FINISH','2','45','15'],
                ['16H','50','Open','5XXX','#10b981','','150',`${nextYear}-01-01 06:00`,'22:00','TRUE','30','START > CP1 > FINISH','1','30','10']
            ].map(row => row.map(csvCell_).join(','));
            downloadTextFile_('race-setup-next-event-template.csv', '\uFEFF' + lines.join('\r\n'), 'text/csv;charset=utf-8');
        }

        /** Counts unique scanned bibs per Setup row, matching each log's bib against that
         * row's own bib range (not by category name -- the same category name can appear
         * at several distance tiers, e.g. "Men Open" at both 100km and 6km, so matching by
         * name alone would merge tiers together). bibRule is unique per Setup row, so it
         * doubles as a reliable per-row key here. */
        function countScannedBibsByRow_(summaryRows, allLogs) {
            const scannedSets = new Map(); // bibRule -> Set of unique bibs seen
            summaryRows.forEach(row => { if (row.bibRule) scannedSets.set(row.bibRule, new Set()); });
            (allLogs || []).forEach(l => {
                if (!isCountableLog_(l)) return;
                const cfg = findCategoryConfigForBib_(l.bib, summaryRows);
                if (cfg && cfg.bibRule && scannedSets.has(cfg.bibRule)) scannedSets.get(cfg.bibRule).add(bibIdentityKey_(l));
            });
            return scannedSets;
        }

        function renderSummaryDashboard(summaryRows, serverConfigMeta) {
            const tbody = document.getElementById("summaryTableBody");
            if (!tbody) return;

            lastKnownSummaryRows = summaryRows || [];
            categoryConfig = lastKnownSummaryRows; // keep PWA metric calculator in sync
            const nextAggregateConfigFingerprint = JSON.stringify((categoryConfig || []).map(r => [r.category, r.bibRule]));
            if (aggregateConfigFingerprint_ && aggregateConfigFingerprint_ !== nextAggregateConfigFingerprint) scheduleAggregateRebuild_();
            aggregateConfigFingerprint_ = nextAggregateConfigFingerprint;
            applyEventConfigMeta_(lastKnownSummaryRows, serverConfigMeta);
            renderCheckpointKmByRaceInputs_();
            renderSafetyMatrix_();
            if (isDirectorModeOpen) renderDirectorSummaryTable_(lastKnownSummaryRows);

            if (!summaryRows || summaryRows.length === 0) {
                tbody.innerHTML = `<tr><td colspan="5" class="p-3 text-center theme-text-muted text-[10px]">No category configs found on server range.</td></tr>`;
                return;
            }
            
            localStorage.setItem("lastCachedSummaryRows", JSON.stringify(summaryRows));

            getEnrichedLogsFromDb_(function(allLogs) {
                const scannedByRow = countScannedBibsByRow_(summaryRows, allLogs);
                let totalScanned = 0, totalRegistered = 0;

                let htmlBuilder = "";
                // Code.gs now forward-fills km/cot/cotTime/color across every row of
                // a merged-cell Setup group server-side (see getCategorySummaryData_),
                // so every row already carries its group's values directly. The
                // group-key carry-forward below is kept only as a defensive fallback
                // for a stale cached summary (localStorage lastCachedSummaryRows) saved
                // by an older version of this backend, before that fix existed.
                let lastGroupColor = null;
                let lastGroupKey = null;
                let lastGroupKm = '', lastGroupCot = '', lastGroupCotTime = '';
                summaryRows.forEach(row => {
                    if (!row.category && !row.runners && !row.bibRule) return;

                    const displayCategory = row.category || row.bibRule || "";
                    const isTotalRow = displayCategory.toLowerCase().includes("total");
                    if (isTotalRow) return; // superseded by the always-computed totals row appended below

                    const rowBg = "hover:bg-neutral-200/50 dark:hover:bg-neutral-500/10 transition-colors duration-100";
                    let colorHex = (row.color && row.color.toLowerCase() !== 'sample') ? row.color.toLowerCase() : null;
                    let km = row.km || '';
                    let cot = row.cot || '';
                    let cotTime = row.cotTime || '';
                    // A row starts a new group whenever it actually carries its own
                    // km/cot (already-forward-filled server data means this is almost
                    // always true; only a legacy blank cached row falls through below).
                    if (km || cot) {
                        lastGroupKm = km; lastGroupCot = cot; lastGroupCotTime = cotTime;
                        if (colorHex) lastGroupColor = colorHex;
                        lastGroupKey = `${km}|${cot}`;
                    } else {
                        km = lastGroupKm; cot = lastGroupCot; cotTime = cotTime || lastGroupCotTime;
                        if (!colorHex) colorHex = lastGroupColor;
                    }
                    const textClass = 'text-neutral-900 dark:text-white font-extrabold text-outlined-contrast';

                    const registered = parseInt(row.runners, 10) || 0;
                    const scanned = row.bibRule && scannedByRow.has(row.bibRule) ? scannedByRow.get(row.bibRule).size : 0;
                    totalScanned += scanned;
                    totalRegistered += registered;

                    htmlBuilder += `
                        <tr class="${rowBg} border-b theme-border text-neutral-900 dark:text-white">
                            <td class="p-2 pl-2.5 font-bold" ${colorHex ? `style="box-shadow: inset 5px 0 0 0 ${colorHex};"` : ''}>
                                <div class="flex items-center gap-2">
                                    ${colorHex ? `<span class="inline-block w-2.5 h-2.5 rounded-sm border border-neutral-400/50 dark:border-neutral-700/50 shrink-0" style="background-color: ${colorHex}"></span>` : ''}
                                    <span class="${textClass}">${displayCategory}</span>
                                </div>
                            </td>
                            <td class="p-2 text-center font-bold text-outlined-contrast">${km || '-'}</td>
                            <td class="p-2 text-center font-mono font-bold text-indigo-700 dark:text-indigo-400 text-outlined-contrast">${row.bibRule || '-'}</td>
                            <td class="p-2 text-center font-mono font-bold text-amber-700 dark:text-amber-400 text-outlined-contrast">${cot || '-'}</td>
                            <td class="p-2 text-center font-black font-mono pr-2.5 text-blue-700 dark:text-cyan-400 text-outlined-contrast text-sm">${scanned}/${registered}</td>
                        </tr>
                    `;
                });

                htmlBuilder += `
                    <tr class="bg-neutral-300/80 dark:bg-neutral-900/80 font-black border-t-2 border-neutral-400 dark:border-neutral-600 shadow-sm text-neutral-900 dark:text-white">
                        <td class="p-2 pl-2.5 font-black uppercase text-amber-700 dark:text-amber-400 text-outlined-contrast" colspan="3">Total runner</td>
                        <td class="p-2 text-center">-</td>
                        <td class="p-2 text-center font-black font-mono pr-2.5 text-blue-800 dark:text-cyan-400 text-outlined-contrast text-xs">${totalScanned}/${totalRegistered}</td>
                    </tr>
                `;

                tbody.innerHTML = htmlBuilder;
            });
        }

        function toggleDashboardCollapse() {
            const content = document.getElementById("dashboardCollapseContent");
            const arrow = document.getElementById("dashboardCollapseArrow");
            if (!content || !arrow) return;
            
            const isCurrentlyHidden = content.classList.toggle("hidden");
            if (isCurrentlyHidden) {
                arrow.textContent = "▲";
                localStorage.setItem("dashboardCollapsedState", "true");
            } else {
                arrow.textContent = "▼";
                localStorage.setItem("dashboardCollapsedState", "false");
            }
        }

        (function dynamicCollapseInitializer() {
            setTimeout(() => {
                if (localStorage.getItem("dashboardCollapsedState") === "true") {
                    const content = document.getElementById("dashboardCollapseContent");
                    const arrow = document.getElementById("dashboardCollapseArrow");
                    if (content && arrow) {
                        content.classList.add("hidden");
                        arrow.textContent = "▲";
                    }
                }
            }, 150);
        })();

        // Version 7 separates runner identity from the stripped numeric group.
        // Original BIBs such as MO1234 and F1234B remain distinct runners while both
        // can still use numeric group 1234 for Setup matching, sorting and indicators.
        bootstrapFirstUseUi_();
        let dbRequest = null;
        try {
            if (!window.indexedDB) throw new Error('IndexedDB is not supported by this browser.');
            dbRequest = indexedDB.open("RaceLoggerDB", RACE_DB_VERSION);
        } catch (openError) {
            console.error('IndexedDB could not be started:', openError);
            dbOpenFailed_ = true;
            dbReady_ = false;
            setTimeout(() => updateSetupGate_(), 0);
        }
        if (dbRequest) {
        dbRequest.onupgradeneeded = function(e) {
            db = e.target.result;
            const upgradeTx = e.target.transaction;
            const logStore = db.objectStoreNames.contains("logs")
                ? upgradeTx.objectStore("logs")
                : db.createObjectStore("logs", { keyPath: "id", autoIncrement: true });
            const indexes = [
                ['byUid', 'uid', false],
                ['byBib', 'bib', false],
                ['byBibKey', 'bibKey', false],
                ['byBibNumberKey', 'bibNumberKey', false],
                ['byCheckpoint', 'checkpoint', false],
                ['byClientTime', 'clientTimeMs', false],
                ['byCategory', 'category', false],
                ['byStatus', 'status', false]
            ];
            indexes.forEach(([name, keyPath, unique]) => {
                if (!logStore.indexNames.contains(name)) logStore.createIndex(name, keyPath, { unique });
            });

            // Backfill the numeric time key during upgrades so newest-first
            // cursor reads work for records created by older app versions.
            const cursorRequest = logStore.openCursor();
            cursorRequest.onsuccess = function(event) {
                const cursor = event.target.result;
                if (!cursor) return;
                const value = cursor.value;
                let changed = false;
                if (!Number.isFinite(Number(value.clientTimeMs))) {
                    value.clientTimeMs = parseCustomOrIsoDate(value.time).getTime();
                    changed = true;
                }
                const original = normalizeBibOriginal_(value.bib || value.bibKey);
                const number = extractBibNumber_(value.bibNumber || original);
                const numberKey = normalizeBibNumberKey_(value.bibNumberKey || number);
                const identityKey = original;
                if (value.bib !== original) { value.bib = original; changed = true; }
                if (value.bibNumber !== number) { value.bibNumber = number; changed = true; }
                if (value.bibNumberKey !== numberKey) { value.bibNumberKey = numberKey; changed = true; }
                if (value.bibKey !== identityKey) { value.bibKey = identityKey; changed = true; }
                if (!value.category) { value.category = findCategoryConfigForBib_(original, categoryConfig)?.category || 'Uncategorized'; changed = true; }
                if (changed) cursor.update(value);
                cursor.continue();
            };

            if (!db.objectStoreNames.contains("meta")) {
                db.createObjectStore("meta", { keyPath: "key" });
            }
            if (!db.objectStoreNames.contains("safetyNotes")) {
                db.createObjectStore("safetyNotes", { keyPath: "bib" });
            }
            if (!db.objectStoreNames.contains("aggregates")) {
                db.createObjectStore("aggregates", { keyPath: "key" });
            }
            if (!db.objectStoreNames.contains("incidents")) {
                db.createObjectStore("incidents", { keyPath: "id" });
            }
            if (!db.objectStoreNames.contains("cotAlerts")) {
                db.createObjectStore("cotAlerts", { keyPath: "key" });
            }
            if (!db.objectStoreNames.contains("deviceHealth")) {
                db.createObjectStore("deviceHealth", { keyPath: "deviceId" });
            }
        };
        // Worst case without this: another open tab/window of this same app holding an
        // older DB connection can make this tab's open() request hang indefinitely
        // (IndexedDB blocks a version-upgrade open until every other connection closes),
        // and the app would just look stuck loading with zero explanation.
        dbRequest.onblocked = function() {
            dbReady_ = false;
            const notice = document.getElementById('storageReadinessNotice');
            if (notice) {
                notice.classList.add('visible');
                notice.textContent = 'Local storage is waiting for another open Race Log tab to close. Setup remains editable; close the other tab and reload to enable logging.';
            }
            updateSetupGate_();
        };
        dbRequest.onerror = function(e) {
            console.error("IndexedDB open failed:", e.target.error);
            dbOpenFailed_ = true;
            dbReady_ = false;
            updateSetupGate_();
        };
        dbRequest.onsuccess = function(e) {
            db = e.target.result;
            db.onversionchange = () => {
                db.close();
                dbReady_ = false;
                updateSetupGate_();
            };
            dbReady_ = true;
            dbOpenFailed_ = false;
            applyTheme(); 
            profileDevicePerformanceCapabilities(); 
            updateSyncStatusLabel();
            initSyncBadgeCollapseTimer_();
            loadSettingsState();
            updateSetupGate_();
            applyBibKeyboardMode_(localStorage.getItem('bibKeyboardMode') || 'text');
            initMinimalBibMode_();
            restoreHardRefreshDrafts_();
            updateSearchBoxPlaceholder();
            loadHistory();
            scheduleAggregateRebuild_(true);
            loadLocalIncidents_();
            loadLocalCotAlerts_();
            setTimeout(syncPendingOperationalRecords_, 2000);
            applyAppTextScale_();
            initBatteryMonitoring();
            startDeviceHealthReporting_();
            startCheckpointGpsMonitoring_();
            checkPwaDisplay(); 
            resetSyncTimer();
            registerServiceWorkerAndBackgroundSync();
            syncMetaToDb_();
            checkStaleQueueWarning();
            
            const localCache = localStorage.getItem("lastCachedSummaryRows");
            if (localCache) renderSummaryDashboard(JSON.parse(localCache), eventConfigMeta_);
            else renderEventConfigSurfaces_();

            if (syncUrl && syncIntervalMs > 0) {
                attemptSync();
                pullServerRecords(); 
                // Keep the logging screen lightweight: normal startup uses the
                // incremental feed only. The complete paged event download runs on demand
                // when Runner Safety Log or Director Mode is opened, or when a server data
                // revision explicitly says an older row changed.
            }
            ['bibInput', 'remarkInput'].forEach(id => {
                const el = document.getElementById(id);
                if (el) {
                    el.addEventListener('focus', forceNetworkSyncCheck);
                    el.addEventListener('input', forceNetworkSyncCheck);
                }
            });

            document.addEventListener('visibilitychange', handleVisibilityChange_);
        };
        }

        /**
         * Battery pass: a backgrounded/screen-off tab still burns CPU + radio on every
         * setInterval tick even though nobody's looking at it. Rather than adding a
         * second parallel timer system, this just stops the existing ones while hidden
         * and restarts them (plus does one immediate refresh) the moment the app is
         * looked at again -- so nothing feels stale when you come back to it.
         */
        function handleVisibilityChange_() {
            if (document.hidden) {
                if (syncTimerId) { clearInterval(syncTimerId); syncTimerId = null; }
                if (reconciliationTimerId) { clearInterval(reconciliationTimerId); reconciliationTimerId = null; }
                if (deviceHealthTimer_) { clearInterval(deviceHealthTimer_); deviceHealthTimer_ = null; }
                stopCheckpointGpsMonitoring_();
                if (isDirectorModeOpen) {
                    if (directorClockIntervalId) { clearInterval(directorClockIntervalId); directorClockIntervalId = null; }
                    if (directorCotIntervalId) { clearInterval(directorCotIntervalId); directorCotIntervalId = null; }
                }
                if (!document.getElementById('bibScannerModal')?.classList.contains('hidden')) closeBibScanner();
                if (sharedAudioContext_ && sharedAudioContext_.state === 'running') sharedAudioContext_.suspend().catch(() => {});
            } else {
                resetSyncTimer();
                startDeviceHealthReporting_();
                startCheckpointGpsMonitoring_();
                syncPendingOperationalRecords_();
                if (syncUrl) { attemptSync(); pullServerRecords(); }
                if (isDirectorModeOpen) {
                    tickDirectorClock_();
                    directorClockIntervalId = setInterval(tickDirectorClock_, 30000);
                    renderDirectorCotCountdown_(lastKnownSummaryRows);
                    directorCotIntervalId = setInterval(() => renderDirectorCotCountdown_(lastKnownSummaryRows), 30000);
                }
            }
        }


        /** Mirrors the current syncUrl into the "meta" IndexedDB store so the service
         * worker's background-sync handler (which can't see localStorage) can reach the
         * server on its own when the app isn't open. Call after any syncUrl change. */
        function syncMetaToDb_() {
            if (!db || !db.objectStoreNames.contains("meta")) return;
            try {
                const tx = db.transaction(["meta"], "readwrite");
                tx.objectStore("meta").put({ key: "syncUrl", value: syncUrl });
            } catch (e) { /* non-fatal — interval-based sync still works */ }
        }

        /** Registers sw.js (offline app-shell caching) and, on browsers that support the
         * Background Sync API, requests a one-shot background sync so queued logs still
         * flush to the server soon after connectivity returns even if the app/tab isn't
         * open. Safari/iOS don't support Background Sync — the existing setInterval-based
         * polling (resetSyncTimer) remains the fallback there, unchanged. */
        function registerServiceWorkerAndBackgroundSync() {
            if (!navigator.serviceWorker || typeof navigator.serviceWorker.register !== 'function') return;
            navigator.serviceWorker.register('sw.js?v=19.3.5', { updateViaCache: 'none' }).then(registration => registration.update()).catch(() => { /* non-fatal */ });
            if (typeof navigator.serviceWorker.addEventListener !== 'function') return;
            navigator.serviceWorker.addEventListener('message', (event) => {
                if (event.data && event.data.type === 'race-log-sync-complete') {
                    handleDataRevisionFromServer_(event.data.dataRevision, true);
                    if (event.data.appRefreshEpoch && handleAppRefreshEpochFromServer_(event.data.appRefreshEpoch)) return;
                    scheduleAggregateRebuild_();
                    scheduleDeviceHealthReport_();
                    loadHistory();
                    if (event.data.summary) renderSummaryDashboard(event.data.summary, event.data.configMeta);
                    applyRouteModelsFromPayload_(event.data);
                }
            });
        }

        function requestBackgroundSync_() {
            if (!navigator.serviceWorker || !('SyncManager' in window) || !navigator.serviceWorker.ready) return;
            navigator.serviceWorker.ready
                .then((reg) => reg.sync.register('race-log-sync'))
                .catch(() => { /* unsupported/blocked — interval polling still covers it */ });
        }
        
        function forceNetworkSyncCheck() {
            if (!syncUrl || isSyncing) return;
            db.transaction(["logs"], "readonly").objectStore("logs").getAll().onsuccess = function(e) {
                const unsynced = e.target.result.filter(log => !log.synced);
                if (unsynced.length > 0) attemptSync();
            };
        }
        
        function openSettings(event) {
            if (event) { event.preventDefault(); event.stopPropagation(); }
            const modal = document.getElementById("settingsModal");
            if (!modal || !modal.classList.contains("hidden")) return;
            modal.classList.remove("hidden");
            modal.setAttribute('aria-hidden', 'false');
            document.body.classList.add('overflow-hidden');
            document.getElementById("syncUrlInput").value = syncUrl;
            updateGoogleMapsSettingsState_();
            document.getElementById("testConnectionStatusFeedback").className = "hidden";
            const saveBtn = document.getElementById('settingsSaveBtn');
            if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save Settings'; }
            updateSettingsWipeCounterFootprint();
            renderEventConfigSurfaces_();
        }

        function closeSettings(event) {
            if (event) { event.preventDefault(); event.stopPropagation(); }
            const modal = document.getElementById("settingsModal");
            if (!modal || modal.classList.contains("hidden")) return;
            modal.classList.add("hidden");
            modal.setAttribute('aria-hidden', 'true');
            if (!isDirectorModeOpen && document.getElementById('safetyLogView')?.classList.contains('hidden')) {
                document.body.classList.remove('overflow-hidden');
            }
            const saveBtn = document.getElementById('settingsSaveBtn');
            if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save Settings'; }
        }

        function toggleSettings(event) {
            const modal = document.getElementById("settingsModal");
            if (!modal) return;
            if (modal.classList.contains("hidden")) openSettings(event);
            else closeSettings(event);
        }

        function updateSettingsWipeCounterFootprint() {
            if (!db) return;
            db.transaction(["logs"], "readonly").objectStore("logs").getAll().onsuccess = function(e) {
                const recordsCount = e.target.result ? e.target.result.length : 0;
                document.getElementById("wipeEntireDatabaseActionBtn").textContent = `Wipe Database (${recordsCount})`;
            };
        }

        function testCloudConnection() {
            const inputUrl = document.getElementById("syncUrlInput").value.trim();
            const feedback = document.getElementById("testConnectionStatusFeedback");
            const btn = document.getElementById("connectionTesterBtn");
            if(!inputUrl) {
                feedback.textContent = "❌ Error: URL Field is empty.";
                feedback.className = "text-[10px] text-red-600 dark:text-red-500 font-bold block leading-tight mt-1";
                return;
            }
            feedback.textContent = "⏳ Testing ping connection request...";
            feedback.className = "text-[10px] text-neutral-600 dark:text-neutral-400 font-bold block leading-tight mt-1";
            btn.disabled = true;

            const testUrl = `${inputUrl}${inputUrl.includes('?') ? '&' : '?'}nocache=${Date.now()}`;

            fetchWithTimeout(testUrl, {
                method: "POST",
                headers: { "Content-Type": "text/plain;charset=utf-8" },
                body: JSON.stringify({ action: "ping" })
            }, 10000)
            .then(async response => {
                const txt = await response.text();
                try {
                    const parsed = JSON.parse(txt);
                    if (parsed.status === "success" || parsed.message.includes("Unknown action")) {
                        const rowInfo = (typeof parsed.rowCount === 'number') ? ` (${parsed.rowCount} logs on server)` : '';
                        feedback.textContent = `✅ Connected Successfully!${rowInfo}`;
                        feedback.className = "text-[10px] text-emerald-600 dark:text-emerald-500 font-bold block leading-tight mt-1";
                        if (parsed.summary) renderSummaryDashboard(parsed.summary, parsed.configMeta);
                        applyRouteModelsFromPayload_(parsed);
                        applyGoogleMapsConfigFromPayload_(parsed);
                    } else {
                        feedback.textContent = `❌ Script error context: ${txt.slice(0, 60)}`;
                        feedback.className = "text-[10px] text-red-600 dark:text-red-500 font-bold block leading-tight mt-1";
                    }
                } catch(e) {
                    feedback.textContent = `❌ Response format issue (Not JSON).`;
                    feedback.className = "text-[10px] text-red-600 dark:text-red-500 font-bold block leading-tight mt-1";
                }
            })
            .catch(err => {
                feedback.textContent = `❌ ${err.message || 'Endpoint Fault'}`;
                feedback.className = "text-[10px] text-red-600 dark:text-red-500 font-bold block leading-tight mt-1";
            })
            .finally(() => {
                btn.disabled = false;
            });
        }

        // NOTE: importBackupJSONDataFile (JSON restore) was removed along with the
        // "Import JSON" button — CSV is now the only export/backup format, so
        // there is no JSON file to import any more.

        function saveSettings(event) { 
            if (event) { event.preventDefault(); event.stopPropagation(); }
            const saveBtn = document.getElementById('settingsSaveBtn');
            if (saveBtn && saveBtn.disabled) return;
            if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
            syncUrl = document.getElementById("syncUrlInput").value.trim() || DEFAULT_SYNC_URL; 
            localStorage.setItem("syncUrl", syncUrl); 
            syncMetaToDb_();
            let requestedDupWindow = parseInt(document.getElementById("dupWindowInput").value, 10) || 20;
            requestedDupWindow = Math.min(120, Math.max(3, requestedDupWindow));
vibrateEnabled = document.getElementById("vibrateToggle").checked;
            soundEnabled = document.getElementById("soundToggle").checked;
            gpsQuality = document.getElementById("gpsQualitySelect").value;
            syncIntervalMs = parseInt(document.getElementById("syncIntervalSelect").value, 10);
            dupWindowSeconds = requestedDupWindow;
            globalHistoryLimit = String(SCAN_HISTORY_MAX_ROWS);
            currentCpHistoryLimit = String(SCAN_HISTORY_MAX_ROWS);
            layoutOrientation = document.getElementById("layoutOrientationSelect").value;
            batterySaverManual = document.getElementById("batterySaverManualToggle").checked;
            cotWarningMinutes_ = Math.max(0, Math.min(240, parseInt(document.getElementById('cotWarningMinutesInput')?.value || '45', 10) || 0));
            cotEscalationMinutes_ = Math.max(0, Math.min(cotWarningMinutes_, parseInt(document.getElementById('cotEscalationMinutesInput')?.value || '15', 10) || 0));
            cotAlertsEnabled_ = !!document.getElementById('cotAlertsEnabledToggle')?.checked;
            appTextScale_ = document.getElementById('appTextScaleSelect')?.value || 'normal';
            screenReaderAnnouncements_ = !!document.getElementById('screenReaderAnnouncementsToggle')?.checked;

            localStorage.setItem("vibrateEnabled", vibrateEnabled);
            localStorage.setItem("soundEnabled", soundEnabled);
            localStorage.setItem("gpsQuality", gpsQuality);
            localStorage.setItem("syncIntervalMs", syncIntervalMs);
            localStorage.setItem("dupWindowSeconds", String(dupWindowSeconds));
            localStorage.removeItem("dupWindow");
            localStorage.setItem("globalHistoryLimit", globalHistoryLimit);
            localStorage.setItem("currentCpHistoryLimit", currentCpHistoryLimit);
            localStorage.setItem("layoutOrientation", layoutOrientation);
            localStorage.setItem("batterySaverManual", batterySaverManual);
            localStorage.setItem('cotWarningMinutes_v1', String(cotWarningMinutes_));
            localStorage.setItem('cotEscalationMinutes_v1', String(cotEscalationMinutes_));
            localStorage.setItem('cotAlertsEnabled_v1', String(cotAlertsEnabled_));
            localStorage.setItem('appTextScale_v1', appTextScale_);
            localStorage.setItem('screenReaderAnnouncements_v1', String(screenReaderAnnouncements_));
            applyAppTextScale_();

            document.getElementById("dupWindowInput").value = dupWindowSeconds;
            if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save Settings'; }
            closeSettings(event); 
            updateSyncStatusLabel(); 
            applyLayoutOrientation();
            
            if (batterySaverManual) {
                activateBatterySafeMode(true);
            } else {
                deactivateBatterySafeMode();
            }
            resetSyncTimer();
            startCheckpointGpsMonitoring_();
            if (syncUrl && syncIntervalMs > 0) {
                attemptSync(); 
                pullServerRecords(); 
            }
        } 

        function loadSettingsState() { 
            isSetupLocked = localStorage.getItem("settingsLocked") === "true"; 
            const storedCheckpoint = localStorage.getItem("checkpointVal") || "";
            const storedVolunteer = localStorage.getItem("volunteerVal") || "";
            document.getElementById("checkpoint").value = storedCheckpoint.trim().toUpperCase() === 'N/A' ? '' : storedCheckpoint;
            document.getElementById("volunteer").value = storedVolunteer.trim().toUpperCase() === 'N/A' ? '' : storedVolunteer;
            if (storedCheckpoint.trim().toUpperCase() === 'N/A') localStorage.removeItem('checkpointVal');
            if (storedVolunteer.trim().toUpperCase() === 'N/A') localStorage.removeItem('volunteerVal');
            checkpointKm = normalizeCheckpointKmValue_(localStorage.getItem('checkpointKmVal'));
            try { checkpointKmByRace_ = JSON.parse(localStorage.getItem('checkpointKmByRace_v1') || '{}') || {}; } catch (e) { checkpointKmByRace_ = {}; }
            const checkpointKmInput = document.getElementById('checkpointKmInput');
            if (checkpointKmInput) checkpointKmInput.value = checkpointKm;
            renderCheckpointKmByRaceInputs_();
            localStorage.removeItem('lapMode');
            vibrateEnabled = localStorage.getItem("vibrateEnabled") !== "false";
            soundEnabled = localStorage.getItem("soundEnabled") !== "false";
            gpsQuality = localStorage.getItem("gpsQuality") || "low";
            syncIntervalMs = parseInt(localStorage.getItem("syncIntervalMs") || "15000", 10);
            dupWindowSeconds = parseInt(localStorage.getItem("dupWindowSeconds") || "20", 10);
            dupWindowSeconds = Math.min(120, Math.max(3, Number.isFinite(dupWindowSeconds) ? dupWindowSeconds : 20));
            localStorage.setItem("dupWindowSeconds", String(dupWindowSeconds));
            localStorage.removeItem("dupWindow");
            globalHistoryLimit = String(SCAN_HISTORY_MAX_ROWS);
            currentCpHistoryLimit = String(SCAN_HISTORY_MAX_ROWS);
            localStorage.setItem("globalHistoryLimit", globalHistoryLimit);
            localStorage.setItem("currentCpHistoryLimit", currentCpHistoryLimit);
            layoutOrientation = localStorage.getItem("layoutOrientation") || "auto";
            batterySaverManual = localStorage.getItem("batterySaverManual") === "true";
            activeScopeFilter = localStorage.getItem("activeScopeFilter") || "current";
            cotWarningMinutes_ = Math.max(0, Math.min(240, Number(localStorage.getItem('cotWarningMinutes_v1') || '45') || 45));
            cotEscalationMinutes_ = Math.max(0, Math.min(cotWarningMinutes_, Number(localStorage.getItem('cotEscalationMinutes_v1') || '15') || 15));
            cotAlertsEnabled_ = localStorage.getItem('cotAlertsEnabled_v1') !== 'false';
            appTextScale_ = localStorage.getItem('appTextScale_v1') || 'normal';
            screenReaderAnnouncements_ = localStorage.getItem('screenReaderAnnouncements_v1') !== 'false';
            localStorage.removeItem('googleMapsApiKey_v1');
            localStorage.removeItem('googleMapsMapId_v1');

            document.getElementById("vibrateToggle").checked = vibrateEnabled;
            document.getElementById("soundToggle").checked = soundEnabled;
            document.getElementById("gpsQualitySelect").value = gpsQuality;
            const cotWarningInput = document.getElementById('cotWarningMinutesInput'); if (cotWarningInput) cotWarningInput.value = cotWarningMinutes_;
            const cotEscInput = document.getElementById('cotEscalationMinutesInput'); if (cotEscInput) cotEscInput.value = cotEscalationMinutes_;
            const cotEnabled = document.getElementById('cotAlertsEnabledToggle'); if (cotEnabled) cotEnabled.checked = cotAlertsEnabled_;
            const scaleSelect = document.getElementById('appTextScaleSelect'); if (scaleSelect) scaleSelect.value = appTextScale_;
            const srToggle = document.getElementById('screenReaderAnnouncementsToggle'); if (srToggle) srToggle.checked = screenReaderAnnouncements_;
            applyAppTextScale_();
            document.getElementById("syncIntervalSelect").value = String(syncIntervalMs);
            document.getElementById("dupWindowInput").value = dupWindowSeconds;
            document.getElementById("globalHistoryLimitSelect").value = globalHistoryLimit;
            document.getElementById("currentCpHistoryLimitSelect").value = currentCpHistoryLimit;
            document.getElementById("layoutOrientationSelect").value = layoutOrientation;
            document.getElementById("batterySaverManualToggle").checked = batterySaverManual;

            applyLockState(); 
            updateScopeUI();
            applyLayoutOrientation();
            if (batterySaverManual) activateBatterySafeMode(true);
        }

        /** Renders the header sync badge. Two independent states:
         *   - "no syncUrl configured" (Offline Mode): always full text, never collapses --
         *     this is a setup problem the person needs to notice and fix, not idle chatter.
         *   - "syncUrl configured" (Auto-Sync): the healthy/idle state. Renders as full text
         *     until syncBadgeCollapsed_ flips true (after SYNC_BADGE_COLLAPSE_DELAY_MS via
         *     initSyncBadgeCollapseTimer_), then renders as a small icon to save header
         *     space. The CSS transition on #syncStatus (width/padding/border-radius) is what
         *     actually animates the shrink; this function just swaps the class + inner content
         *     at the same moment so it reads as one continuous morph.
         */
        function updateSyncStatusLabel() { 
            const s = document.getElementById("syncStatus"); 
            if (!s) return;
            if (!syncUrl) {
                // Offline Mode: always expanded, never collapses -- this needs to stay visible.
                s.onclick = null;
                s.classList.remove('sync-badge-collapsed');
                s.textContent = "Offline Mode";
                s.className = "text-[10px] bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-400 border border-yellow-300 dark:border-yellow-800 px-2 py-0.5 rounded-full font-bold";
                return;
            }
            // Auto-Sync (healthy/idle) state.
            s.onclick = syncBadgeCollapsed_ ? toggleSyncBadgeExpand_ : null;
            if (syncBadgeCollapsed_) {
                s.className = "sync-badge-collapsed bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800 font-bold";
                s.textContent = "🔄";
                s.title = "Auto-Sync — tap to expand";
            } else {
                s.className = "text-[10px] bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800 px-2 py-0.5 rounded-full font-bold";
                s.textContent = "Auto-Sync";
                s.title = "";
            }
        }

        /** Starts (once) the one-shot timer that collapses the Auto-Sync pill down to
         * an icon after SYNC_BADGE_COLLAPSE_DELAY_MS. Called once on startup. Does
         * nothing if a sync URL isn't configured yet (Offline Mode never collapses),
         * but the timer itself still runs so it takes effect immediately once one is set. */
        function initSyncBadgeCollapseTimer_() {
            if (syncBadgeCollapseTimeoutId_) return; // already scheduled
            syncBadgeCollapseTimeoutId_ = setTimeout(() => {
                syncBadgeCollapsed_ = true;
                updateSyncStatusLabel();
            }, SYNC_BADGE_COLLAPSE_DELAY_MS);
        }

        /** Tap-to-peek: expands the collapsed icon back to full "Auto-Sync" text for a
         * few seconds so it's always easy to double check, then re-collapses. */
        function toggleSyncBadgeExpand_() {
            syncBadgeCollapsed_ = false;
            updateSyncStatusLabel();
            clearTimeout(syncBadgeExpandTimeoutId_);
            syncBadgeExpandTimeoutId_ = setTimeout(() => {
                syncBadgeCollapsed_ = true;
                updateSyncStatusLabel();
            }, SYNC_BADGE_COLLAPSE_DELAY_MS);
        }

        function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
            return fetch(url, { ...options, signal: controller.signal })
                .catch(err => {
                    if (err.name === 'AbortError') {
                        throw new Error(`Timeout after ${Math.round(timeoutMs / 1000)}s`);
                    }
                    throw err;
                })
                .finally(() => clearTimeout(timeoutId));
        }

        function recordSyncSuccess(serverTime, requestStartedAt) {
            syncFailureStreak = 0;
            lastSyncError = null;
            lastSyncSuccessAt = Date.now();
            localStorage.setItem("lastSyncSuccessAt", String(lastSyncSuccessAt));
            if (serverTime) updateClockDriftSample_(serverTime, requestStartedAt || lastSyncSuccessAt, Date.now());
            updateSyncHealthUI();
            scheduleDeviceHealthReport_(250);
            syncPendingOperationalRecords_();
        }

        function recordSyncFailure(reason) {
            syncFailureStreak++;
            lastSyncError = reason;
            updateSyncHealthUI();
            if (syncFailureStreak === 3) announceToScreenReader_('Cloud synchronisation has failed three times. Entries remain saved on this device.');
        }

        function updateSyncHealthUI() {
            const badge = document.getElementById("syncErrorBadge");
            if (!badge) return;
            if (syncFailureStreak >= 3) badge.classList.remove("hidden");
            else badge.classList.add("hidden");
        }

        function showSyncErrorDetails() {
            const lastOk = lastSyncSuccessAt ? new Date(lastSyncSuccessAt).toLocaleString() : "Never";
            alert(`⚠️ Sync trouble\n\nError: ${lastSyncError || "Unknown"}\nStreak: ${syncFailureStreak}\nLast Success: ${lastOk}`);
        }
        
        function normalizeCheckpointKmValue_(value) {
            if (value === '' || value === null || value === undefined) return '';
            const num = Number(String(value).replace(',', '.'));
            if (!Number.isFinite(num) || num <= 0 || num > 1000) return '';
            return String(Math.round(num * 100) / 100);
        }

        function canonicalRaceKmKey_(value) {
            const n = parseRaceDistanceNumber_(value);
            if (!n) return '';
            return String(Math.round(n * 100) / 100);
        }

        function getConfiguredRaceDistanceGroups_() {
            const groups = new Map();
            (categoryConfig || []).forEach(cfg => {
                const key = canonicalRaceKmKey_(cfg?.km);
                if (!key) return;
                if (!groups.has(key)) groups.set(key, { km: key, categories: [] });
                const category = String(cfg.category || '').trim();
                if (category && !groups.get(key).categories.includes(category)) groups.get(key).categories.push(category);
            });
            return Array.from(groups.values()).sort((a, b) => Number(b.km) - Number(a.km));
        }

        function getConfiguredRaceDistances_() {
            return getConfiguredRaceDistanceGroups_().map(group => group.km);
        }

        function saveCheckpointKmMap_() {
            const clean = {};
            Object.keys(checkpointKmByRace_ || {}).forEach(key => {
                const raceKey = canonicalRaceKmKey_(key);
                const value = normalizeCheckpointKmValue_(checkpointKmByRace_[key]);
                if (raceKey && value && Number(value) <= Number(raceKey) + 0.01) clean[raceKey] = value;
            });
            checkpointKmByRace_ = clean;
            localStorage.setItem('checkpointKmByRace_v1', JSON.stringify(clean));
            if (eventConfigMeta_?.fingerprint) localStorage.setItem(CHECKPOINT_MAP_CONFIG_FINGERPRINT_KEY_, eventConfigMeta_.fingerprint);
            renderEventConfigSurfaces_();
        }

        function renderCheckpointKmByRaceInputs_() {
            const host = document.getElementById('checkpointKmByRaceRows');
            if (!host) return;
            if (host.contains(document.activeElement)) return;
            const groups = getConfiguredRaceDistanceGroups_();
            if (!groups.length) {
                host.innerHTML = '<div class="text-[9px] theme-text-muted border theme-border rounded-lg p-2">Race distances appear here after the Setup sheet syncs. The default KM below remains available while offline.</div>';
                renderEventConfigSurfaces_();
                return;
            }
            host.innerHTML = groups.map(group => {
                const raceKm = group.km;
                const value = normalizeCheckpointKmValue_(checkpointKmByRace_[raceKm]);
                const progress = value ? Math.min(100, Math.round((Number(value) / Number(raceKm)) * 1000) / 10) : null;
                const categories = group.categories.join(' • ');
                return `<label class="checkpoint-km-row-v13">
                    <span class="checkpoint-km-row-meta">
                        <span class="checkpoint-km-row-top">
                            <span class="checkpoint-km-row-title">${escapeHtml_(raceKm)} KM race</span>
                            <span class="checkpoint-km-progress-pill" data-progress-for="${escapeHtmlAttr_(raceKm)}">${progress === null ? 'Auto estimate' : `${progress}% covered`}</span>
                        </span>
                        <span class="checkpoint-km-categories" title="${escapeHtmlAttr_(categories)}">${escapeHtml_(categories || 'Configured categories')}</span>
                    </span>
                    <span class="checkpoint-km-input-wrap">
                        <input type="number" min="0.01" max="${escapeHtmlAttr_(raceKm)}" step="0.01" inputmode="decimal" value="${escapeHtmlAttr_(value)}" placeholder="Auto" data-race-km="${escapeHtmlAttr_(raceKm)}" oninput="onCheckpointKmByRaceInput_(this)" class="theme-input border rounded-md focus:outline-none focus:ring-1 focus:ring-blue-600 dark:focus:ring-blue-900">
                        <span>KM</span>
                    </span>
                </label>`;
            }).join('');
            if (isSetupLocked) host.querySelectorAll('input').forEach(input => { input.disabled = true; });
            renderEventConfigSurfaces_();
        }

        function updateCheckpointMapProgressPill_(raceKey, mappedValue) {
            const pill = document.querySelector(`[data-progress-for="${CSS.escape(String(raceKey))}"]`);
            if (!pill) return;
            const value = Number(mappedValue);
            const total = Number(raceKey);
            pill.textContent = Number.isFinite(value) && value > 0 && total > 0
                ? `${Math.min(100, Math.round((value / total) * 1000) / 10)}% covered`
                : 'Auto estimate';
        }

        function onCheckpointKmByRaceInput_(input) {
            const raceKey = canonicalRaceKmKey_(input?.dataset?.raceKm);
            if (!raceKey) return;
            const normalized = normalizeCheckpointKmValue_(input.value);
            if (normalized && Number(normalized) <= Number(raceKey) + 0.01) {
                checkpointKmByRace_[raceKey] = normalized;
                input.classList.remove('checkpoint-invalid');
                input.classList.add('checkpoint-valid');
                updateCheckpointMapProgressPill_(raceKey, normalized);
            } else if (!String(input.value || '').trim()) {
                delete checkpointKmByRace_[raceKey];
                input.classList.remove('checkpoint-invalid', 'checkpoint-valid');
                updateCheckpointMapProgressPill_(raceKey, null);
            } else {
                delete checkpointKmByRace_[raceKey];
                input.classList.remove('checkpoint-valid');
                input.classList.add('checkpoint-invalid');
                updateCheckpointMapProgressPill_(raceKey, null);
            }
            saveCheckpointKmMap_();
            updateCheckpointKmHelp_();
        }

        function applyCheckpointProgressPercent_() {
            const input = document.getElementById('checkpointProgressPctInput');
            const pct = Number(String(input?.value || '').replace(',', '.'));
            if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
                alert('Enter a course progress percentage between 1 and 100.');
                input?.focus();
                return;
            }
            getConfiguredRaceDistances_().forEach(raceKm => {
                checkpointKmByRace_[raceKm] = String(Math.round((Number(raceKm) * pct / 100) * 100) / 100);
            });
            saveCheckpointKmMap_();
            renderCheckpointKmByRaceInputs_();
            updateCheckpointKmHelp_();
        }

        function clearCheckpointDistanceMappings_() {
            if (Object.keys(checkpointKmByRace_ || {}).length && !confirm('Clear every category-specific checkpoint KM mapping on this device? The app will use its estimator or the default KM instead.')) return;
            checkpointKmByRace_ = {};
            localStorage.removeItem('checkpointKmByRace_v1');
            localStorage.removeItem(CHECKPOINT_MAP_CONFIG_FINGERPRINT_KEY_);
            renderCheckpointKmByRaceInputs_();
            updateCheckpointKmHelp_();
            renderEventConfigSurfaces_();
        }

        function readCheckpointKm_() {
            const input = document.getElementById('checkpointKmInput');
            const normalized = normalizeCheckpointKmValue_(input ? input.value : checkpointKm);
            return normalized === '' ? null : Number(normalized);
        }

        function isCompletionCheckpoint_(checkpointName) {
            const normalized = String(checkpointName || '')
                .trim().toUpperCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
            return normalized === 'START' || normalized === 'FINISH' || normalized === 'START FINISH' || normalized === 'START/FINISH' || normalized === 'GOAL' || normalized === 'END';
        }

        function parseExplicitKmFromCheckpointName_(checkpointName, totalDistanceKm) {
            const text = String(checkpointName || '').trim().toUpperCase();
            const matches = [text.match(/\bKM\s*(\d+(?:\.\d+)?)\b/), text.match(/\b(\d+(?:\.\d+)?)\s*KM\b/)];
            for (const match of matches) {
                if (!match) continue;
                const value = Number(match[1]);
                if (Number.isFinite(value) && value > 0 && value <= Number(totalDistanceKm) + 0.01) return value;
            }
            return null;
        }

        function configuredCheckpointKmForBib_(bib, checkpointName, routeConfig) {
            const cfg = findCategoryConfigForBib_(bib, categoryConfig) || routeConfig || null;
            const totalDistanceKm = parseRaceDistanceNumber_(cfg && cfg.km);
            if (Number.isFinite(totalDistanceKm) && totalDistanceKm > 0 && isCompletionCheckpoint_(checkpointName)) {
                return { km: totalDistanceKm, source: 'completion-checkpoint' };
            }
            const gpsMapped = checkpointGpsKmFor_(checkpointName, cfg || routeConfig || null);
            if (gpsMapped) return gpsMapped;
            if (Number.isFinite(totalDistanceKm) && totalDistanceKm > 0) {
                const key = canonicalRaceKmKey_(totalDistanceKm);
                const mapped = normalizeCheckpointKmValue_(checkpointKmByRace_[key]);
                if (mapped && Number(mapped) <= totalDistanceKm + 0.01) return { km: Number(mapped), source: `setup-map:${key}` };
                const named = parseExplicitKmFromCheckpointName_(checkpointName, totalDistanceKm);
                if (named) return { km: named, source: 'checkpoint-name' };
            }
            const fallback = readCheckpointKm_();
            if (fallback && (!Number.isFinite(totalDistanceKm) || fallback <= totalDistanceKm + 0.01)) return { km: fallback, source: 'setup-default' };
            return { km: null, source: 'auto-estimate' };
        }

        function updateCheckpointKmHelp_() {
            const input = document.getElementById('checkpointKmInput');
            const help = document.getElementById('checkpointKmHelp');
            if (!input || !help) return;
            const raw = String(input.value || '').trim();
            const normalized = normalizeCheckpointKmValue_(raw);
            const mappedCount = Object.keys(checkpointKmByRace_ || {}).filter(key => normalizeCheckpointKmValue_(checkpointKmByRace_[key])).length;
            help.classList.remove('valid', 'invalid');
            if (!raw) {
                help.textContent = mappedCount
                    ? `${mappedCount} race-distance mapping${mappedCount === 1 ? '' : 's'} saved. Unmapped categories use a data-based estimate.`
                    : 'No KM entered: pace, speed, and finish time use the best available estimate from matching checkpoint history, the runner’s earlier pace, or the category median.';
                if (mappedCount) help.classList.add('valid');
                return;
            }
            if (!normalized) {
                help.textContent = 'Enter a number greater than 0 and no more than 1000 KM.';
                help.classList.add('invalid');
                return;
            }
            help.textContent = `Unlisted categories will use ${normalized} KM; configured race distances keep their own values.`;
            help.classList.add('valid');
        }

        function onCheckpointKmInput_() {
            const input = document.getElementById('checkpointKmInput');
            checkpointKm = normalizeCheckpointKmValue_(input ? input.value : '');
            if (input && input.value && !checkpointKm) {
                localStorage.removeItem('checkpointKmVal');
            } else if (checkpointKm) {
                localStorage.setItem('checkpointKmVal', checkpointKm);
            } else {
                localStorage.removeItem('checkpointKmVal');
            }
            updateCheckpointKmHelp_();
        }

        function isSetupComplete_() {
            const cp = (document.getElementById('checkpoint')?.value || '').trim();
            const vol = (document.getElementById('volunteer')?.value || '').trim();
            return !!cp && !!vol && cp.toUpperCase() !== 'N/A' && vol.toUpperCase() !== 'N/A';
        }

        function focusIncompleteSetup_(event) {
            if (isSetupComplete_()) return;
            if (event) event.preventDefault();
            const cp = document.getElementById('checkpoint');
            const vol = document.getElementById('volunteer');
            const target = !(cp?.value || '').trim() ? cp : vol;
            if (target && !target.disabled) target.focus();
        }

        function updateSetupGate_() {
            const ready = isSetupComplete_();
            const canLog = ready && dbReady_ && !dbOpenFailed_;
            const section = document.getElementById('bibEntrySection');
            const readiness = document.getElementById('setupReadinessBadge');
            const gateMessage = document.getElementById('bibEntryGateMessage');
            const storageNotice = document.getElementById('storageReadinessNotice');
            const controls = ['bibInput', 'remarkInput', 'logActionButton', 'bibEntryModeBtn', 'bibOcrBtn'];
            controls.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.disabled = !canLog || (id === 'logActionButton' && bibLogSubmissionInFlight_);
            });
            if (section) {
                section.classList.toggle('setup-required', !canLog);
                section.setAttribute('aria-disabled', canLog ? 'false' : 'true');
            }
            if (gateMessage) {
                gateMessage.innerHTML = !ready
                    ? 'Complete Checkpoint Name and Volunteer Initials in <strong>1. Setup</strong> before typing or scanning a bib.'
                    : (!dbReady_ ? '<strong>Setup saved.</strong> Local storage is still starting; bib entry unlocks automatically.' : '');
                gateMessage.style.display = canLog ? 'none' : 'block';
            }
            if (storageNotice) {
                storageNotice.classList.toggle('visible', !dbReady_ || dbOpenFailed_);
                storageNotice.textContent = dbOpenFailed_
                    ? 'Local storage could not start. Setup remains editable, but logging is unavailable until the page is reloaded or browser storage is enabled.'
                    : 'Local storage is starting. You can fill Setup now; bib logging unlocks automatically when storage is ready.';
            }
            if (readiness) {
                readiness.textContent = ready ? (dbReady_ ? '● Ready' : '● Setup saved') : '● Required';
                readiness.classList.toggle('ready', ready && dbReady_);
                readiness.classList.toggle('pending', !ready || !dbReady_);
            }
            updateCheckpointKmHelp_();
            return canLog;
        }

        function bootstrapFirstUseUi_() {
            const cp = document.getElementById('checkpoint');
            const vol = document.getElementById('volunteer');
            if (!cp || !vol) return;
            const storedCp = String(localStorage.getItem('checkpointVal') || '').trim();
            const storedVol = String(localStorage.getItem('volunteerVal') || '').trim();
            cp.value = storedCp.toUpperCase() === 'N/A' ? '' : storedCp;
            vol.value = storedVol.toUpperCase() === 'N/A' ? '' : storedVol;
            if (!cp.value) localStorage.removeItem('checkpointVal');
            if (!vol.value) localStorage.removeItem('volunteerVal');
            const complete = !!cp.value.trim() && !!vol.value.trim();
            isSetupLocked = complete && localStorage.getItem('settingsLocked') === 'true';
            cp.disabled = isSetupLocked;
            vol.disabled = isSetupLocked;
            updateSetupGate_();
        }

        function handleSetupEnter_(event, nextId) {
            if (!event || event.key !== 'Enter') return;
            event.preventDefault();
            persistSetupDraft_();
            updateSetupGate_();
            const target = document.getElementById(nextId);
            if (target && !target.disabled) target.focus();
        }

        function onVolunteerInput_() {
            persistSetupDraft_();
            updateSetupGate_();
        }

        function getPassageModeLabel_() {
            return 'AUTOMATIC';
        }

        function isRecentSamePassage_(log, bib, checkpoint) {
            if (!isCountableLog_(log)) return false;
            if (bibIdentityKey_(log) !== bibIdentityKey_(bib)) return false;
            if (String(log.checkpoint || '').toUpperCase() !== String(checkpoint || '').toUpperCase()) return false;
            const ageMs = Date.now() - parseCustomOrIsoDate(log.time).getTime();
            return ageMs >= 0 && ageMs < (dupWindowSeconds * 1000);
        }

        function toggleLock() {
            if (!isSetupLocked && !isSetupComplete_()) {
                alert('⚠️ Complete Checkpoint Name and Volunteer Initials before locking Setup.');
                focusIncompleteSetup_();
                return;
            }
            isSetupLocked = !isSetupLocked;
            localStorage.setItem("settingsLocked", isSetupLocked);
            applyLockState();
        }

        function applyLockState() {
            const cp = document.getElementById("checkpoint");
            const vol = document.getElementById("volunteer");
            const kmInput = document.getElementById('checkpointKmInput');
            const lockBtn = document.getElementById("lockBtn");
            const fields = document.getElementById("setupFields");
            const summary = document.getElementById("setupSummary");
            const row = document.getElementById("setupHeaderRow");
            const cpV = cp.value.toUpperCase().trim();
            const volV = vol.value.toUpperCase().trim();
            if (isSetupLocked && (!cpV || !volV || cpV === 'N/A' || volV === 'N/A')) {
                isSetupLocked = false;
                localStorage.setItem('settingsLocked', 'false');
            }
            cp.disabled = isSetupLocked;
            vol.disabled = isSetupLocked;
            if (kmInput) kmInput.disabled = isSetupLocked;
            document.querySelectorAll('#checkpointKmByRaceRows input').forEach(input => { input.disabled = isSetupLocked; });
            checkpointKm = normalizeCheckpointKmValue_(kmInput ? kmInput.value : checkpointKm);
            if (isSetupLocked) {
                lockBtn.textContent = "✏️ Edit Setup";
                lockBtn.className = "setup-lock-button is-edit bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800 font-bold transition flex items-center gap-0.5";
                localStorage.setItem("checkpointVal", cpV);
                localStorage.setItem("volunteerVal", volV);
                if (checkpointKm) localStorage.setItem('checkpointKmVal', checkpointKm); else localStorage.removeItem('checkpointKmVal');
                saveCheckpointKmMap_();
                fields.classList.add("hidden");
                row.classList.replace("mb-1", "mb-0");
                const mappedCount = Object.keys(checkpointKmByRace_ || {}).length;
                const kmSummary = mappedCount ? ` • ${mappedCount} KM map${mappedCount === 1 ? '' : 's'}` : (checkpointKm ? ` • ${checkpointKm} KM default` : ' • Auto KM estimate');
                summary.textContent = `${cpV} • ${volV}${kmSummary}`;
                summary.classList.remove("hidden");
            } else {
                lockBtn.textContent = "🔒 Lock Setup";
                lockBtn.className = "setup-lock-button is-lock theme-btn-lock border font-bold transition flex items-center gap-0.5";
                fields.classList.remove("hidden");
                row.classList.replace("mb-0", "mb-1");
                summary.classList.add("hidden");
            }
            updateSetupGate_();
        }

        function setScopeFilter(scope) {
            activeScopeFilter = scope;
            localStorage.setItem("activeScopeFilter", scope);
            updateScopeUI();
            updateSearchBoxPlaceholder();
            loadHistory();
        }

        function updateScopeUI() {
            const currentBtn = document.getElementById("scopeBtn-current");
            const globalBtn = document.getElementById("scopeBtn-global");
            if (activeScopeFilter === 'current') {
                currentBtn.className = "px-2 py-0.5 rounded bg-blue-600 dark:bg-blue-900 text-white transition-colors duration-150";
                globalBtn.className = "px-2 py-0.5 rounded text-neutral-600 dark:text-neutral-400 transition-colors duration-150";
            } else {
                globalBtn.className = "px-2 py-0.5 rounded bg-blue-600 dark:bg-blue-900 text-white transition-colors duration-150";
                currentBtn.className = "px-2 py-0.5 rounded text-neutral-600 dark:text-neutral-400 transition-colors duration-150";
            }
        }

        function triggerSuccessToast(bib = '', checkpoint = '') {
            const toast = document.getElementById("successToast");
            if (!toast) return;
            const bibLabel = document.getElementById('successToastBib');
            const detail = document.getElementById('successToastDetail');
            if (bibLabel) bibLabel.textContent = bib ? `BIB ${bib} logged` : 'BIB logged';
            if (detail) detail.textContent = checkpoint ? `${checkpoint} • saved on this device` : 'Saved on this device';
            clearTimeout(successToastTimeout);
            toast.classList.remove("animate-pop-scale", "hidden");
            void toast.offsetWidth;
            toast.classList.add("animate-pop-scale");
            successToastTimeout = setTimeout(() => { hideSuccessToast(); }, 1400);
        }

        function hideSuccessToast() {
            const toast = document.getElementById("successToast");
            if (toast) {
                toast.classList.remove("animate-pop-scale");
                toast.classList.add("hidden");
            }
            clearTimeout(successToastTimeout);
        }

        function keepBibInputFocused_(event) {
            // On touch devices, submit on pointer-down and cancel the focus-changing
            // default action. This makes the large LOG button a true one-tap action while
            // keeping the software keyboard open for the next bib. The later synthetic
            // click is harmless because the in-flight guard blocks a duplicate submit.
            if (event && event.pointerType !== 'mouse') {
                event.preventDefault();
                checkDuplicateAndLog();
            }
        }

        function setBibSubmitBusy_(busy) {
            bibLogSubmissionInFlight_ = !!busy;
            const button = document.getElementById('logActionButton');
            const label = document.getElementById('logActionButtonLabel');
            if (button) {
                button.disabled = bibLogSubmissionInFlight_ || !isSetupComplete_();
                button.classList.toggle('log-submit-busy', bibLogSubmissionInFlight_);
            }
            if (label) label.textContent = bibLogSubmissionInFlight_ ? 'LOGGING…' : 'LOG';
            const minimalDisabled = bibLogSubmissionInFlight_ || !isSetupComplete_() || !normalizeBibOriginal_(document.getElementById('bibInput')?.value || '');
            const minimalButton = document.getElementById('minimalBibLogButton');
            if (minimalButton) {
                minimalButton.disabled = minimalDisabled;
                minimalButton.textContent = bibLogSubmissionInFlight_ ? 'LOGGING…' : 'LOG';
            }
            const keyboardLogButton = document.getElementById('minimalKeyboardLogButton');
            if (keyboardLogButton) {
                keyboardLogButton.disabled = minimalDisabled;
                keyboardLogButton.textContent = bibLogSubmissionInFlight_ ? '…' : 'LOG';
            }
        }

        function handleBibEntrySubmit_(event) {
            if (event) event.preventDefault();
            checkDuplicateAndLog();
            return false;
        }

        function handleBibInputKeydown_(event) {
            if (event.key === ' ') {
                event.preventDefault();
                showBibSpaceBlockedFeedback_('normal');
                return;
            }
            if (event.key === 'Enter') {
                event.preventDefault();
                handleBibEntrySubmit_(event);
            }
        }

        function finishBibSubmission_(focusInput) {
            setBibSubmitBusy_(false);
            if (minimalBibModeActive_) {
                syncMinimalBibInput_();
                const nativeBib = document.getElementById('minimalNativeBibInput');
                const source = document.getElementById('bibInput');
                if (nativeBib && source) nativeBib.value = source.value;
                if (minimalReopenKeyboardAfterSubmit_) {
                    minimalReopenKeyboardAfterSubmit_ = false;
                    window.setTimeout(() => {
                        if (minimalBibModeActive_ && minimalEntryTarget_ === 'bib') openMinimalNativeKeyboard_();
                    }, 180);
                }
                return;
            }
            if (focusInput !== false) {
                const input = document.getElementById('bibInput');
                setTimeout(() => { if (input && !input.disabled) input.focus({ preventScroll: true }); }, 0);
            }
        }

        function normalizeRouteKmKey_(value) {
            const n = parseFloat(String(value ?? '').replace(/[^0-9.]/g, ''));
            return Number.isFinite(n) ? String(Number(n.toFixed(3))) : 'UNSPECIFIED';
        }

        function routeCategoryKeyForConfig_(cfg) {
            if (!cfg) return '';
            return `${normalizeRouteKmKey_(cfg.km)}|${String(cfg.category || 'UNCATEGORISED').trim().toUpperCase()}`;
        }

        function applyRouteModelsFromPayload_(payload) {
            const models = payload && payload.routeModels;
            if (models && typeof models === 'object' && !Array.isArray(models)) {
                routeModelsByKey_ = models;
                try { localStorage.setItem(ROUTE_MODELS_STORAGE_KEY_, JSON.stringify(routeModelsByKey_)); } catch (_) { /* storage optional */ }
            }
            applyCheckpointGpsFromPayload_(payload);
        }

        function checkpointHistoryForRoute_(runnerLogs, currentCheckpoint) {
            const checkpoints = [];
            (runnerLogs || []).filter(isCountableLog_).slice().sort((a,b) => parseCustomOrIsoDate(a.time) - parseCustomOrIsoDate(b.time)).forEach(log => {
                const cp = String(log.checkpoint || '').trim().toUpperCase();
                if (cp && checkpoints[checkpoints.length - 1] !== cp) checkpoints.push(cp);
            });
            const current = String(currentCheckpoint || '').trim().toUpperCase();
            if (current && checkpoints[checkpoints.length - 1] !== current) checkpoints.push(current);
            return checkpoints;
        }

        function inferRouteConfigFromHistory_(runnerLogs, currentCheckpoint) {
            const observed = checkpointHistoryForRoute_(runnerLogs, currentCheckpoint);
            if (!observed.length) return null;
            const candidates = (categoryConfig || []).map((cfg, order) => {
                const sequence = Array.isArray(cfg.checkpointSequence) ? cfg.checkpointSequence : [];
                if (!sequence.length) return null;
                const aligned = alignObservedRouteToSequence_(observed, sequence);
                if (!aligned) return null;
                return { cfg, order, cost: aligned.cost, matched: aligned.path.length, span: aligned.idx - aligned.path[0] };
            }).filter(Boolean).sort((a,b) => a.cost - b.cost || b.matched - a.matched || a.span - b.span || a.order - b.order);
            if (!candidates.length) return null;
            if (candidates.length > 1 && observed.length < 2 && candidates[0].cost === candidates[1].cost) return null;
            return candidates[0].cfg;
        }

        function resolveBibCategory_(bib, runnerLogs, currentCheckpoint) {
            const cfg = findCategoryConfigForBib_(bib, categoryConfig);
            if (cfg) return { category: cfg.category || 'Uncategorized', config: cfg, routeConfig: cfg, source: 'setup' };
            const routeConfig = inferRouteConfigFromHistory_(runnerLogs, currentCheckpoint);
            return { category: 'Uncategorized', config: null, routeConfig, source: routeConfig ? 'route-inferred' : 'unmatched' };
        }

        function routeModelForBib_(bib, runnerLogs, currentCheckpoint) {
            const resolved = resolveBibCategory_(bib, runnerLogs, currentCheckpoint);
            return routeModelsByKey_[routeCategoryKeyForConfig_(resolved.routeConfig)] || null;
        }

        function routeTransitionOptions_(model, checkpoint) {
            const transitions = model && model.transitions;
            const list = transitions && transitions[String(checkpoint || '').trim().toUpperCase()];
            return Array.isArray(list) ? list : [];
        }

        function findRoutePath_(model, from, to, maxHops = 7) {
            const start = String(from || '').trim().toUpperCase();
            const target = String(to || '').trim().toUpperCase();
            if (!start || !target) return null;
            const queue = [[start]];
            const bestDepth = new Map([[start, 0]]);
            while (queue.length) {
                const path = queue.shift();
                const node = path[path.length - 1];
                if (node === target) return path;
                if (path.length - 1 >= maxHops) continue;
                for (const edge of routeTransitionOptions_(model, node)) {
                    const next = String(edge.to || '').trim().toUpperCase();
                    if (!next) continue;
                    const depth = path.length;
                    if (bestDepth.has(next) && bestDepth.get(next) <= depth) continue;
                    bestDepth.set(next, depth);
                    queue.push(path.concat(next));
                }
            }
            return null;
        }

        function alignObservedRouteToSequence_(observed, sequence) {
            const obs = (observed || []).map(v => String(v || '').trim().toUpperCase()).filter(Boolean);
            const seq = (sequence || []).map(v => String(v || '').trim().toUpperCase()).filter(Boolean);
            if (!obs.length || !seq.length) return null;
            let states = [];
            seq.forEach((cp, idx) => { if (cp === obs[0]) states.push({ idx, cost: 0, path: [idx] }); });
            if (!states.length) return null;
            for (let oi = 1; oi < obs.length; oi++) {
                const nextStatesByIndex = new Map();
                for (const state of states) {
                    for (let idx = state.idx + 1; idx < seq.length; idx++) {
                        if (seq[idx] !== obs[oi]) continue;
                        const candidate = { idx, cost: state.cost + Math.max(0, idx - state.idx - 1), path: state.path.concat(idx) };
                        const prior = nextStatesByIndex.get(idx);
                        if (!prior || candidate.cost < prior.cost || (candidate.cost === prior.cost && candidate.path[0] > prior.path[0])) nextStatesByIndex.set(idx, candidate);
                    }
                }
                states = Array.from(nextStatesByIndex.values());
                if (!states.length) return null;
            }
            states.sort((a,b) => a.cost - b.cost || b.path[0] - a.path[0] || b.idx - a.idx);
            return states[0];
        }

        function routeWarningForCandidate_(bib, currentCheckpoint, runnerLogs) {
            const model = routeModelForBib_(bib, runnerLogs, currentCheckpoint);
            if (!model || !model.ready) return null;
            const bibUpper = String(bib || '').trim().toUpperCase();
            if ((model.pioneers || []).map(v => bibIdentityKey_(v)).includes(bibIdentityKey_(bibUpper))) return null;
            const current = String(currentCheckpoint || '').trim().toUpperCase();
            const ordered = (runnerLogs || []).filter(isCountableLog_).slice().sort((a,b) => parseCustomOrIsoDate(a.time) - parseCustomOrIsoDate(b.time));
            const checkpoints = [];
            ordered.forEach(log => {
                const cp = String(log.checkpoint || '').trim().toUpperCase();
                if (cp && checkpoints[checkpoints.length - 1] !== cp) checkpoints.push(cp);
            });
            const previous = checkpoints[checkpoints.length - 1];
            if (!previous || previous === current) return null;

            if (Array.isArray(model.sequence) && model.sequence.length) {
                const before = alignObservedRouteToSequence_(checkpoints, model.sequence);
                const after = alignObservedRouteToSequence_(checkpoints.concat(current), model.sequence);
                if (!after) {
                    return { type: 'abnormal', message: `Last seen ${previous}; ${current} is outside the expected route.` };
                }
                if (!before || after.path.length < 2) return null;
                const fromIndex = after.path[after.path.length - 2];
                const toIndex = after.path[after.path.length - 1];
                const jump = toIndex - fromIndex;
                const maxJump = Math.max(1, Number(model.maxJump) || 1);
                if (jump > maxJump) {
                    const missing = model.sequence.slice(fromIndex + 1, toIndex);
                    return { type: 'skip', missing, message: `Expected ${missing.slice(0,4).join(' → ')} before ${current}.` };
                }
                return null;
            }

            const direct = routeTransitionOptions_(model, previous);
            if (!direct.length || direct.some(edge => String(edge.to || '').toUpperCase() === current)) return null;
            const path = findRoutePath_(model, previous, current);
            if (path && path.length > 2) {
                const missing = path.slice(1, -1);
                return { type: 'skip', missing, message: `Expected ${missing.slice(0,4).join(' → ')} before ${current}.` };
            }
            const expected = direct.slice(0, 3).map(edge => edge.to).filter(Boolean);
            return { type: 'abnormal', message: `Last seen ${previous}; expected ${expected.join(' or ')} next.` };
        }

        function requestLogsForBib_(bib) {
            const store = db.transaction(["logs"], "readonly").objectStore("logs");
            const key = bibIdentityKey_(bib);
            if (key && store.indexNames && store.indexNames.contains('byBibKey')) {
                return store.index('byBibKey').getAll(key);
            }
            if (store.indexNames && store.indexNames.contains('byBib')) {
                return store.index('byBib').getAll(normalizeBibOriginal_(bib));
            }
            return store.getAll();
        }

        async function checkDuplicateAndLog() {
            if (bibLogSubmissionInFlight_) return;
            const bI = document.getElementById('bibInput');
            const bib = normalizeBibOriginal_(bI.value);
            if (!bib) {
                if (minimalBibModeActive_) setMinimalBibStatus_('Enter a BIB label first.', true);
                else bI.focus();
                return;
            }
            // Any non-empty printable BIB label is a valid identity.
            let cpV = (document.getElementById('checkpoint')?.value || '').trim();
            const volV = (document.getElementById('volunteer')?.value || '').trim();
            if (!cpV || !volV) {
                alert("⚠️ Complete 1. Setup before entering a bib.");
                focusIncompleteSetup_();
                return;
            }
            setBibSubmitBusy_(true);
            let gpsResult;
            try {
                gpsResult = await resolveGpsBeforeLog_(cpV);
            } catch (_) {
                gpsResult = { checkpoint: checkpointToken_(cpV), status: 'unverified', acknowledged: false };
            }
            if (gpsResult && gpsResult.cancelled) {
                finishBibSubmission_();
                evaluateGpsCheckpointAdvisor_();
                return;
            }
            cpV = (gpsResult && gpsResult.checkpoint) || checkpointToken_(cpV);
            const request = requestLogsForBib_(bib);
            request.onerror = function() {
                finishBibSubmission_();
                alert('⚠️ Could not read the local runner log. Please try again.');
            };
            request.onsuccess = function(e) {
                const runnerLogs = e.target.result || [];
                const duplicate = runnerLogs.find(log => isRecentSamePassage_(log, bib, cpV));
                if (duplicate && !confirm(`⚠️ Bib ${bib} was recorded at ${cpV.toUpperCase()} within the last ${dupWindowSeconds} seconds. Record another passage anyway?`)) {
                    bI.value = '';
                    autoScaleBibFontSize_();
                    finishBibSubmission_();
                    setTimeout(() => handleViewportResize(), 80);
                    return;
                }
                const categoryResolution = resolveBibCategory_(bib, runnerLogs, cpV);
                const routeWarning = routeWarningForCandidate_(bib, cpV, runnerLogs);
                if (routeWarning && !confirm(`⚠️ Route check for Bib ${bib}: ${routeWarning.message}

Clarify the previous checkpoint check-in. Log anyway?`)) {
                    finishBibSubmission_();
                    announceToScreenReader_(`Route check for bib ${bib}. ${routeWarning.message}`);
                    return;
                }
                triggerInlineAnimationFlag = true;
                logEntry(bib, {
                    routeWarning: routeWarning ? routeWarning.message : '',
                    routeWarningAcknowledged: !!routeWarning,
                    categoryResolution,
                    locationStatus: gpsResult && gpsResult.status || 'unverified',
                    locationAcknowledged: !!(gpsResult && gpsResult.acknowledged),
                    locationDecision: gpsResult && gpsResult.decision || null,
                    onLogged: () => finishBibSubmission_(),
                    onError: () => {
                        finishBibSubmission_();
                        alert('⚠️ The bib could not be saved locally. Please try again.');
                    }
                });
            };
        }

        function generateUID() { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'uid-' + Date.now() + '-' + Math.random().toString(36).slice(2, 11); }

        function getFormattedTimestamp(date = new Date()) {
            const pad = (num) => String(num).padStart(2, '0');
            let hours = date.getHours();
            const ampm = hours >= 12 ? 'PM' : 'AM';
            hours = hours % 12;
            hours = hours ? hours : 12; 
            return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(hours)}:${pad(date.getMinutes())}:${pad(date.getSeconds())} ${ampm}`;
        }

        function escapeHtml_(value) {
            return String(value === null || value === undefined ? '' : value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        function escapeHtmlAttr_(value) {
            return escapeHtml_(value).replace(/`/g, '&#96;');
        }

        function encodeInlineArg_(value) {
            return encodeURIComponent(String(value === null || value === undefined ? '' : value)).replace(/'/g, '%27');
        }

        function logEntry(bib, options) {
            const logOptions = options || {};
            if (remarkDebounceTimeout) { clearTimeout(remarkDebounceTimeout); remarkDebounceTimeout = null; }
            const checkpoint = document.getElementById('checkpoint').value.trim();
            const volunteer = document.getElementById('volunteer').value.trim();
            const remarkInput = document.getElementById('remarkInput');
            const bibInput = document.getElementById('bibInput');
            
            const bibUpper = normalizeBibOriginal_(bib);
            const bibNumber = extractBibNumber_(bibUpper);
            const bibNumberKey = normalizeBibNumberKey_(bibNumber);
            const bibKey = bibUpper;
            const categoryResolution = logOptions.categoryResolution || resolveBibCategory_(bibUpper, [], checkpoint);
            const checkpointDistance = configuredCheckpointKmForBib_(bibUpper, checkpoint, categoryResolution.routeConfig);
            const originalDeviceNowMs = Date.now();
            const correctedNowMs = getCorrectedNowMs_();
            const entry = {
                bib: bibUpper,
                bibNumber,
                bibNumberKey,
                bibKey,
                time: getFormattedTimestamp(new Date(correctedNowMs)),
                originalDeviceTime: getFormattedTimestamp(new Date(originalDeviceNowMs)),
                clockOffsetMs: Math.round(clockOffsetMs_),
                clockConfidenceMs: Math.round(clockConfidenceMs_),
                appVersion: APP_VERSION, 
                checkpoint: checkpoint.toUpperCase(),
                volunteer: volunteer.toUpperCase(),
                remark: remarkInput.value.trim(),
                device: buildDeviceString(),
                creatorId: getOrCreateDeviceId(),
                lapMode: 'multiple',
                passageMode: 'automatic',
                clientTimeMs: correctedNowMs,
                originalDeviceTimeMs: originalDeviceNowMs,
                checkpointKm: checkpointDistance.km,
                checkpointKmSource: checkpointDistance.source,
                status: logOptions.locationStatus === 'spam' ? 'Location Spam' : 'Active',
                gpsValidationStatus: logOptions.locationStatus || 'unverified',
                gpsAccuracyM: Number(lastGeoposition.accuracy) || null,
                gpsNearestCheckpoint: checkpointToken_(logOptions.locationDecision?.nearest?.profile?.checkpoint || logOptions.locationDecision?.nearestConfigured?.profile?.checkpoint || ''),
                gpsDistanceToNearestM: Number(logOptions.locationDecision?.nearest?.distanceM ?? logOptions.locationDecision?.nearestConfigured?.distanceM) || null,
                locationMismatchAcknowledged: !!logOptions.locationAcknowledged,
                duplicateOfUid: '',
                duplicateDeviceCount: 1,
                latitude: lastGeoposition.latitude,
                longitude: lastGeoposition.longitude,
                uid: generateUID(),
                synced: false,
                remake: false,
                syncAttempts: 0,
                speed: "",     
                pace: "",      
                category: categoryResolution.category || 'Uncategorized',
                categorySource: categoryResolution.source || 'unmatched',
                routeKm: categoryResolution.routeConfig?.km || '',
                routeCategory: categoryResolution.routeConfig?.category || '',
                routeWarning: String(logOptions.routeWarning || ''),
                routeWarningAcknowledged: !!logOptions.routeWarningAcknowledged,
                reasonCode: String(logOptions.reasonCode || ''),
                reconciliationFlags: String(logOptions.reconciliationFlags || ''),
                routeExceptionReason: String(logOptions.routeExceptionReason || ''),
                unknownBib: !!logOptions.unknownBib,
                recordChecksum: '',
                editedAt: '',
                editedBy: ''
            };

            lastCreatedUid = entry.uid;
            triggerScanHistorySlideFlag = true;
            const tx = db.transaction(["logs"], "readwrite");
            const addRequest = tx.objectStore("logs").add(entry);
            addRequest.onsuccess = function() {
                document.getElementById('searchBar').value = '';
                loadHistory();
                if (vibrateEnabled && navigator.vibrate) navigator.vibrate(50);
                playSuccessSound();
                triggerSuccessToast(entry.bib, entry.checkpoint);
                if (syncIntervalMs > 0) attemptSync();
                requestBackgroundSync_();
                announceToScreenReader_(entry.status === 'Location Spam'
                    ? `Bib ${entry.bib} saved as location spam at ${entry.checkpoint}; excluded from race calculations.`
                    : `Bib ${entry.bib} logged at ${entry.checkpoint}.`);
                updateAggregateForMutation_(null, entry);
                if (typeof logOptions.onLogged === 'function') logOptions.onLogged(entry);
            };
            addRequest.onerror = function() {
                if (typeof logOptions.onError === 'function') logOptions.onError(addRequest.error);
            };
            bibInput.value = '';
            autoScaleBibFontSize_();
            syncMinimalBibInput_();
            remarkInput.value = '';
            syncMinimalRemarkInput_('normal');
            if (minimalBibModeActive_) {
                activateMinimalNumericKeypad_(false);
                activateMinimalEntryTarget_('bib');
            }
            shutOffGPSHardware();
            if (!logOptions.keepScannerActive && !minimalBibModeActive_) bibInput.focus();
            setTimeout(() => handleViewportResize(), 80);
        }

        function handleRemarkTyping() {
            // The main Remark field belongs to the NEXT bib that will be logged.
            // Older builds silently wrote this text into `lastCreatedUid` after a
            // debounce. If another bib/edit happened in between, a remark could land
            // on the previous runner. Existing rows are now changed only through their
            // explicit Edit button, so a remark can never jump between bibs.
            remarkDebounceTimeout = null;
        }

        const STALE_QUEUE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

        /**
         * Non-installed PWAs on iOS Safari can have their IndexedDB storage evicted
         * after about 7 days of disuse, and any device set aside mid-multi-day-event
         * risks the same kind of silent data loss well before that. This surfaces a
         * visible nudge, rather than letting old queued entries sit invisibly at risk
         * with no signal to anyone that a backup would be a good idea.
         */
        function checkStaleQueueWarning() {
            if (!db) return;
            db.transaction(["logs"], "readonly").objectStore("logs").getAll().onsuccess = function(e) {
                const unsynced = e.target.result.filter(log => !log.synced);
                const now = Date.now();
                const hasStale = unsynced.some(log => (now - parseCustomOrIsoDate(log.time).getTime()) > STALE_QUEUE_THRESHOLD_MS);
                const badge = document.getElementById("staleQueueBadge");
                if (badge) badge.classList.toggle("hidden", !hasStale);
            };
        }

        function handleStaleQueueBannerClick_() {
            exportCSV('global'); // automated safety backup — always everything, no prompt
            alert("📥 Backup downloaded. Once these entries finally sync (or once you've saved this backup somewhere safe), this warning will go away on its own.");
        }

        const toggleQueueInspector = () => document.getElementById("queueInspectorSection").classList.toggle("hidden");

        function updateQueueStatus() {
            db.transaction(["logs"], "readonly").objectStore("logs").getAll().onsuccess = function(e) {
                const unsynced = e.target.result.filter(log => !log.synced);
                const stuckCount = unsynced.filter(log => (log.syncAttempts || 0) >= SYNC_STUCK_ATTEMPTS_THRESHOLD).length;
                const badge = document.getElementById("queueBadge"), countText = document.getElementById("queueCount"), inspectorCount = document.getElementById("inspectorCount");
                if (unsynced.length > 0) {
                    badge.classList.remove("hidden");
                    countText.textContent = unsynced.length;
                    inspectorCount.textContent = stuckCount > 0 ? `${unsynced.length} (${stuckCount} stuck)` : unsynced.length;
                    badge.classList.toggle("animate-pulse", stuckCount > 0);
                    renderQueueInspectorList(unsynced);
                } else {
                    badge.classList.remove("animate-pulse");
                    badge.classList.add("hidden"); document.getElementById("queueInspectorSection").classList.add("hidden");
                }
                const now = Date.now();
                const hasStale = unsynced.some(log => (now - parseCustomOrIsoDate(log.time).getTime()) > STALE_QUEUE_THRESHOLD_MS);
                const staleBadge = document.getElementById("staleQueueBadge");
                if (staleBadge) staleBadge.classList.toggle("hidden", !hasStale);
            };
        }

        function renderQueueInspectorList(pendingLogs) {
            const list = document.getElementById("inspectorList"); list.innerHTML = '';
            pendingLogs.forEach(log => {
                const item = document.createElement("div");
                item.className = "py-2.5 flex justify-between items-center text-xs theme-text-muted";
                const titleText = log.pendingDelete
                    ? `<strong class="text-sm font-black text-red-600 dark:text-red-500">🗑️ Deleting Bib ${log.bib}...</strong>`
                    : (log.remake ? `<strong class="text-sm font-black text-red-600 dark:text-red-500 animate-pulse">REMAKE REQUIRED</strong>` : `<strong class="text-sm font-black text-yellow-700 dark:text-yellow-500">Bib ${log.bib}</strong>`);
                const stuckBadge = (log.syncAttempts || 0) >= SYNC_STUCK_ATTEMPTS_THRESHOLD ? `<div class="text-[9px] text-red-600 dark:text-red-500 font-bold mt-0.5">⚠️ Failed ${log.syncAttempts}x</div>` : '';
                const actionButtons = log.pendingDelete
                    ? `<span class="text-[10px] italic">waiting for connection</span>`
                    : `<button onclick='syncSingleRow(${JSON.stringify(log)})' class="text-[10px] bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800 px-2 py-0.5 rounded font-bold hover:bg-emerald-200 dark:hover:bg-emerald-800">Sync</button>
                        <button onclick="deleteRow(${log.id}, '${log.bib}', '${log.time}')" class="icon-tap-target text-red-600 dark:text-red-500 text-base">🗑️</button>`;
                item.innerHTML = `
                    <div class="flex flex-col">
                        <div>${titleText} at <span class="font-bold">${log.checkpoint}</span></div>
                        <div class="text-[10px] mt-0.5">${formatLogTime(log.time)} ${log.remark ? `• 💬 ${log.remark}` : ''}</div>
                        ${stuckBadge}
                    </div>
                    <div class="flex items-center gap-2">
                        ${actionButtons}
                    </div>`;
                list.appendChild(item);
            });
        }

        function syncSingleRow(row) {
            if (!syncUrl) return;
            const targetUrl = `${syncUrl}${syncUrl.includes('?') ? '&' : '?'}nocache=${Date.now()}`;
            
            const singleSyncStartedAt = Date.now();
            fetchWithTimeout(targetUrl, {
                method: "POST",
                headers: { "Content-Type": "text/plain;charset=utf-8" },
                body: JSON.stringify({ action: "batch_sync", data: [row] })
            }, 20000)
            .then(async res => {
                const data = JSON.parse(await res.text());
                if (data.status !== "success") throw new Error(data.message || "Rejected");
                const confirmedIds = new Set(data.confirmedIds || []);
                const remakeIds   = new Set(data.remakeIds    || []);
                const deletedIds  = new Set(data.deletedUids  || []);
                const duplicateUpdate = (data.duplicateUpdates || []).find(update => update && update.uid === row.uid);
                const locationUpdate = (data.locationUpdates || []).find(update => update && update.uid === row.uid);
                const tx = db.transaction(["logs"], "readwrite");
                if (deletedIds.has(row.uid)) {
                    // Server rejected this bib (previously deleted by admin) — remove locally
                    tx.objectStore("logs").delete(row.id);
                } else if (row.pendingDelete) {
                    if (confirmedIds.has(row.uid)) {
                        tx.objectStore("logs").delete(row.id);
                    } else {
                        row.syncAttempts = (row.syncAttempts || 0) + 1;
                        tx.objectStore("logs").put(row);
                    }
                } else {
                    if (remakeIds.has(row.uid)) {
                        row.synced = false; row.remake = true; row.syncAttempts = 0;
                    } else if (confirmedIds.has(row.uid)) {
                        row.synced = true; row.remake = false; row.syncAttempts = 0;
                    }
                    if (duplicateUpdate) {
                        row.status = duplicateUpdate.status || 'Duplicate';
                        row.duplicateOfUid = duplicateUpdate.duplicateOfUid || '';
                        row.duplicateDeviceCount = Number(duplicateUpdate.duplicateDeviceCount) || 2;
                    }
                    if (locationUpdate) {
                        row.status = locationUpdate.status || 'Location Spam';
                        row.gpsValidationStatus = locationUpdate.gpsValidationStatus || 'spam';
                        row.gpsNearestCheckpoint = locationUpdate.nearestCheckpoint || row.gpsNearestCheckpoint || '';
                        row.gpsDistanceToNearestM = Number(locationUpdate.distanceM) || row.gpsDistanceToNearestM || null;
                    }
                    tx.objectStore("logs").put(row);
                }
                tx.oncomplete = function() { 
                    scheduleAggregateRebuild_();
                    recordSyncSuccess(data.serverTime, singleSyncStartedAt); 
                    loadHistory(); 
                    if (data.summary) renderSummaryDashboard(data.summary, data.configMeta);
                    applyRouteModelsFromPayload_(data);
                    handleDataRevisionFromServer_(data.dataRevision, false);
                    if (data.appRefreshEpoch) handleAppRefreshEpochFromServer_(data.appRefreshEpoch);
                };
            }).catch(err => {
                recordSyncFailure(err.message || String(err));
                const tx = db.transaction(["logs"], "readwrite");
                row.syncAttempts = (row.syncAttempts || 0) + 1;
                tx.objectStore("logs").put(row);
                tx.oncomplete = function() { loadHistory(); };
            });
        }

        function attemptSync() {
            if (!syncUrl || isSyncing) return;
            isSyncing = true;
            if (syncRetryTimeoutId) { clearTimeout(syncRetryTimeoutId); syncRetryTimeoutId = null; }
            db.transaction(["logs"], "readonly").objectStore("logs").getAll().onsuccess = function(e) {
                const unsynced = e.target.result.filter(log => !log.synced);
                if (unsynced.length === 0) { isSyncing = false; return; }
                
                const liveSyncUrl = `${syncUrl}${syncUrl.includes('?') ? '&' : '?'}nocache=${Date.now()}`;
                const syncRequestStartedAt = Date.now();

                fetchWithTimeout(liveSyncUrl, {
                    method: "POST",
                    headers: { "Content-Type": "text/plain;charset=utf-8" },
                    redirect: "follow", 
                    body: JSON.stringify({ action: "batch_sync", data: unsynced })
                }, 25005)
                .then(async res => {
                    const data = JSON.parse(await res.text());
                    if (data.status !== "success") throw new Error(data.message || "Rejected");
                    const confirmedIds = new Set(data.confirmedIds || []);
                    const remakeIds   = new Set(data.remakeIds    || []);
                    const deletedIds  = new Set(data.deletedUids  || []);
                    const duplicateUpdatesByUid = new Map((data.duplicateUpdates || []).filter(Boolean).map(update => [update.uid, update]));
                    const locationUpdatesByUid = new Map((data.locationUpdates || []).filter(Boolean).map(update => [update.uid, update]));
                    const tx = db.transaction(["logs"], "readwrite");
                    const store = tx.objectStore("logs");
                    unsynced.forEach(log => {
                        if (deletedIds.has(log.uid)) {
                            store.delete(log.id); // server rejected this bib
                        } else if (log.pendingDelete) {
                            // This row was a queued delete (offline/failed at delete time).
                            // confirmedIds here means "server tombstoned it" -- remove it
                            // locally now that it's actually gone everywhere; otherwise keep
                            // retrying on the next sync pass.
                            if (confirmedIds.has(log.uid)) {
                                store.delete(log.id);
                            } else {
                                log.syncAttempts = (log.syncAttempts || 0) + 1; store.put(log);
                            }
                        } else if (remakeIds.has(log.uid)) {
                            log.synced = false; log.remake = true; log.syncAttempts = 0; store.put(log);
                        } else if (confirmedIds.has(log.uid)) {
                            log.synced = true; log.remake = false; log.syncAttempts = 0;
                            const duplicateUpdate = duplicateUpdatesByUid.get(log.uid);
                            if (duplicateUpdate) {
                                log.status = duplicateUpdate.status || 'Duplicate';
                                log.duplicateOfUid = duplicateUpdate.duplicateOfUid || '';
                                log.duplicateDeviceCount = Number(duplicateUpdate.duplicateDeviceCount) || 2;
                            }
                            const locationUpdate = locationUpdatesByUid.get(log.uid);
                            if (locationUpdate) {
                                log.status = locationUpdate.status || 'Location Spam';
                                log.gpsValidationStatus = locationUpdate.gpsValidationStatus || 'spam';
                                log.gpsNearestCheckpoint = locationUpdate.nearestCheckpoint || log.gpsNearestCheckpoint || '';
                                log.gpsDistanceToNearestM = Number(locationUpdate.distanceM) || log.gpsDistanceToNearestM || null;
                            }
                            store.put(log); 
                        } else {
                            log.syncAttempts = (log.syncAttempts || 0) + 1; store.put(log);
                        }
                    });
                    tx.oncomplete = function() {
                        scheduleAggregateRebuild_();
                        recordSyncSuccess(data.serverTime, syncRequestStartedAt);
                        loadHistory();
                        if (data.summary) renderSummaryDashboard(data.summary, data.configMeta);
                        applyRouteModelsFromPayload_(data);
                        handleDataRevisionFromServer_(data.dataRevision, false);
                        if (data.appRefreshEpoch && handleAppRefreshEpochFromServer_(data.appRefreshEpoch)) return;
                        if (data.eventEpoch) handleEventEpochFromServer_(data.eventEpoch);
                        if (data.bulkDeleteEpoch && (!data.eventEpoch || localStorage.getItem(LOCAL_EVENT_EPOCH_KEY_) === String(data.eventEpoch))) {
                            handleBulkDeleteEpochFromServer_(data.bulkDeleteEpoch);
                        }
                    };
                })
                .catch(err => {
                    recordSyncFailure(err.message || String(err));
                    const tx = db.transaction(["logs"], "readwrite");
                    const store = tx.objectStore("logs");
                    unsynced.forEach(log => { log.syncAttempts = (log.syncAttempts || 0) + 1; store.put(log); });
                    tx.oncomplete = function() { loadHistory(); };
                    const backoffMs = Math.min(5000 * Math.pow(2, Math.min(syncFailureStreak, 5)), 60000);
                    syncRetryTimeoutId = setTimeout(() => { if (!isSyncing) attemptSync(); }, backoffMs);
                    requestBackgroundSync_();
                })
                .finally(() => {
                    isSyncing = false;
                    if (syncRerunQueued) { syncRerunQueued = false; attemptSync(); }
                });
            };
        }

        function isFullMonitorViewOpen_() {
            const safetyOpen = !document.getElementById('safetyLogView')?.classList.contains('hidden');
            return isDirectorModeOpen || safetyOpen;
        }

        function normalizeIncomingServerRecord_(serverRecord, existing) {
            const status = serverRecord.status || existing?.status || 'Active';
            const km = normalizeCheckpointKmValue_(serverRecord.checkpointKm);
            return {
                bib: normalizeBibOriginal_(serverRecord.bib),
                bibNumber: extractBibNumber_(serverRecord.bibNumber || serverRecord.bib),
                bibNumberKey: bibNumberKey_(serverRecord),
                bibKey: bibIdentityKey_(serverRecord),
                category: findCategoryConfigForBib_(serverRecord.bib, categoryConfig)?.category || 'Uncategorized',
                time: serverRecord.time,
                clientTimeMs: parseCustomOrIsoDate(serverRecord.time).getTime(),
                checkpoint: serverRecord.checkpoint,
                volunteer: serverRecord.volunteer,
                remark: serverRecord.remark || '',
                device: serverRecord.device || existing?.device || '',
                creatorId: serverRecord.creatorId || existing?.creatorId || parseCreatorId(serverRecord.device),
                latitude: serverRecord.latitude,
                longitude: serverRecord.longitude,
                status,
                duplicateOfUid: serverRecord.duplicateOfUid || '',
                duplicateDeviceCount: Number(serverRecord.duplicateDeviceCount) || (String(status).toLowerCase() === 'duplicate' ? 2 : 1),
                lapMode: 'multiple',
                passageMode: 'automatic',
                checkpointKm: km === '' ? null : Number(km),
                checkpointKmSource: serverRecord.checkpointKmSource || existing?.checkpointKmSource || '',
                originalDeviceTime: serverRecord.originalDeviceTime || existing?.originalDeviceTime || serverRecord.time,
                originalDeviceTimeMs: parseCustomOrIsoDate(serverRecord.originalDeviceTime || serverRecord.time).getTime(),
                clockOffsetMs: Number(serverRecord.clockOffsetMs) || 0,
                clockConfidenceMs: Number(serverRecord.clockConfidenceMs) || 0,
                appVersion: serverRecord.appVersion || existing?.appVersion || '',
                synced: true,
                remake: false,
                syncAttempts: 0
            };
        }

        function normalizedRecentRecordDiffers_(existing, normalized) {
            if (!existing) return true;
            return Object.keys(normalized).some(key => existing[key] !== normalized[key]);
        }

        async function pullServerRecords() {
            if (!syncUrl || !db) return;
            try {
                const checkpoint = (document.getElementById('checkpoint')?.value || '').trim().toUpperCase();
                const sep = syncUrl.includes('?') ? '&' : '?';
                const targetRequestUrl = `${syncUrl}${sep}action=recent&limit=${RECENT_SYNC_LIMIT}&checkpoint=${encodeURIComponent(checkpoint)}&nocache=${Date.now()}`;
                const recentRequestStartedAt = Date.now();
                const response = await fetchWithTimeout(targetRequestUrl, {}, 15000);
                const result = await response.json();
                if (result.serverTime) updateClockDriftSample_(result.serverTime, recentRequestStartedAt, Date.now());
                if (result.status !== "success") {
                    recordSyncFailure(result.message || "Recent history request rejected.");
                    return;
                }

                if (result.summary) renderSummaryDashboard(result.summary, result.configMeta);
                applyRouteModelsFromPayload_(result);
                // Ordinary recording mode intentionally does not run a whole-event
                // reconciliation. Complete reconciliation is reserved for Safety Log
                // and Director Mode.
                handleDataRevisionFromServer_(result.dataRevision, false);
                if (result.appRefreshEpoch && handleAppRefreshEpochFromServer_(result.appRefreshEpoch)) return;
                if (result.eventEpoch) handleEventEpochFromServer_(result.eventEpoch);
                if (result.bulkDeleteEpoch && (!result.eventEpoch || localStorage.getItem(LOCAL_EVENT_EPOCH_KEY_) === String(result.eventEpoch))) {
                    if (handleBulkDeleteEpochFromServer_(result.bulkDeleteEpoch)) return;
                }

                const serverRecords = Array.isArray(result.data) ? result.data : [];
                const serverDeletedUids = new Set(result.deletedUids || []);
                const serverDuplicateUpdates = result.duplicateUpdates || [];
                const serverLocationUpdates = result.locationUpdates || [];
                const hasRecentWindowMetadata = Array.isArray(result.recentGlobalUids) || Array.isArray(result.recentCheckpointUids);
                if (hasRecentWindowMetadata) {
                    recentCloudWindowUids_ = new Set([...(result.recentGlobalUids || []), ...(result.recentCheckpointUids || [])]);
                }
                if (result.lastRow) {
                    currentLastSyncedRowMarker = Number(result.lastRow) || currentLastSyncedRowMarker;
                    localStorage.setItem("lastDataRowMarker", String(currentLastSyncedRowMarker));
                }

                const outcome = await new Promise((resolve, reject) => {
                    const tx = db.transaction(["logs"], "readwrite");
                    const store = tx.objectStore("logs");
                    const getAll = store.getAll();
                    let changed = false;
                    let prunedRemote = false;
                    getAll.onerror = () => reject(getAll.error || new Error('Could not read local history.'));
                    getAll.onsuccess = function(e) {
                        const localLogs = e.target.result || [];
                        const localByUid = new Map(localLogs.filter(l => l.uid).map(l => [l.uid, l]));

                        localLogs.forEach(log => {
                            if (serverDeletedUids.has(log.uid)) {
                                store.delete(log.id);
                                changed = true;
                            }
                        });
                        if (applyDuplicateUpdatesToStore_(store, localLogs, serverDuplicateUpdates)) changed = true;
                        if (applyLocationUpdatesToStore_(store, localLogs, serverLocationUpdates)) changed = true;

                        serverRecords.forEach(serverRecord => {
                            if (!serverRecord || !serverRecord.uid) return;
                            const statusLower = String(serverRecord.status || '').toLowerCase();
                            const existing = localByUid.get(serverRecord.uid);

                            if (serverRecord.purge || statusLower === 'deleted' || statusLower === 'auto duplicate removed') {
                                if (existing) {
                                    store.delete(existing.id);
                                    localByUid.delete(serverRecord.uid);
                                    changed = true;
                                }
                                return;
                            }

                            const normalized = normalizeIncomingServerRecord_(serverRecord, existing);
                            if (existing) {
                                if (normalizedRecentRecordDiffers_(existing, normalized)) {
                                    Object.assign(existing, normalized);
                                    store.put(existing);
                                    changed = true;
                                }
                            } else {
                                const addedRecord = Object.assign({ uid: serverRecord.uid }, normalized);
                                store.add(addedRecord);
                                localByUid.set(serverRecord.uid, addedRecord);
                                changed = true;
                            }
                        });

                        // In recording mode retain this device's own audit trail and
                        // unsynced queue, but keep remote cloud mirrors to the two
                        // newest-20 windows only. Full monitor views repopulate every
                        // non-deleted record when opened.
                        if (hasRecentWindowMetadata && !isFullMonitorViewOpen_()) {
                            localLogs.forEach(log => {
                                if (!log.uid || recentCloudWindowUids_.has(log.uid)) return;
                                if (!log.synced || log.pendingDelete || log.remake || isOwnEntry(log)) return;
                                store.delete(log.id);
                                changed = true;
                                prunedRemote = true;
                            });
                        }
                    };
                    tx.oncomplete = () => resolve({ changed, prunedRemote });
                    tx.onerror = () => reject(tx.error || new Error('Recent history merge failed.'));
                    tx.onabort = () => reject(tx.error || new Error('Recent history merge aborted.'));
                });

                recordSyncSuccess();
                if (outcome.prunedRemote) fullMonitorDatasetResident_ = false;
                if (outcome.changed) { scheduleAggregateRebuild_(); loadHistory(); }
            } catch (err) {
                recordSyncFailure(err.message || String(err));
            }
        }

        /**
         * The real "did the server lose this entry?" check, done properly: pages through
         * EVERY row on the server (not just the incremental delta) before comparing, so a
         * local entry is only ever flagged REMAKE REQUIRED if it's genuinely absent from
         * the complete dataset -- e.g. an admin deleted/cleared it directly in the Sheet.
         * Runs far less often than the regular poll (base 5 minutes, backed off further
         * on a bigger race via the same volume scaling used for regular sync) since it
         * has to read the whole dataset rather than a small delta.
         */
        async function performFullReconciliation_() {
            if (!syncUrl || !db) return { success: false, reason: 'offline' };
            try {
                let allServerRecords = [];
                const allDeletedUids = new Set();
                const allDuplicateUpdates = new Map();
                const allLocationUpdates = new Map();
                let sinceRow = 0;
                let useReset = true;
                let guardIterations = 0;
                let lastResult = null;
                let fullReconcileLastRequestStartedAt_ = Date.now();

                while (guardIterations < 200) {
                    guardIterations++;
                    const params = useReset ? `reset=true` : `sinceRow=${sinceRow}`;
                    const url = `${syncUrl}${syncUrl.includes('?') ? '&' : '?'}${params}&nocache=${Date.now()}`;
                    fullReconcileLastRequestStartedAt_ = Date.now();
                    const response = await fetchWithTimeout(url, {}, 25000);
                    const result = await response.json();
                    lastResult = result;
                    if (result.status !== 'success') throw new Error(result.message || 'Reconciliation pull rejected.');
                    handleDataRevisionFromServer_(result.dataRevision, false);
                    const batch = result.data || [];
                    allServerRecords = allServerRecords.concat(batch);
                    (result.deletedUids || []).forEach(uid => allDeletedUids.add(uid));
                    (result.duplicateUpdates || []).forEach(update => { if (update && update.uid) allDuplicateUpdates.set(update.uid, update); });
                    (result.locationUpdates || []).forEach(update => { if (update && update.uid) allLocationUpdates.set(update.uid, update); });
                    useReset = false;
                    const pageLastRow = Number(result.lastRow) || 0;
                    const serverLastRow = Number(result.syncToken) || pageLastRow;
                    if (!pageLastRow || pageLastRow <= sinceRow) break;
                    sinceRow = pageLastRow;
                    if (sinceRow >= serverLastRow) break;
                }

                if (sinceRow > currentLastSyncedRowMarker) {
                    currentLastSyncedRowMarker = sinceRow;
                    localStorage.setItem('lastDataRowMarker', String(currentLastSyncedRowMarker));
                }

                if (lastResult) {
                    if (lastResult.summary) renderSummaryDashboard(lastResult.summary, lastResult.configMeta);
                    applyRouteModelsFromPayload_(lastResult);
                    if (lastResult.appRefreshEpoch && handleAppRefreshEpochFromServer_(lastResult.appRefreshEpoch)) return { success: true, refreshed: true };
                    if (lastResult.eventEpoch) handleEventEpochFromServer_(lastResult.eventEpoch);
                    if (lastResult.bulkDeleteEpoch && (!lastResult.eventEpoch || localStorage.getItem(LOCAL_EVENT_EPOCH_KEY_) === String(lastResult.eventEpoch))) {
                        handleBulkDeleteEpochFromServer_(lastResult.bulkDeleteEpoch);
                    }
                }

                const serverMap = new Map(allServerRecords.filter(r => r && r.uid).map(r => [r.uid, r]));
                const activeServerCount = allServerRecords.filter(r => {
                    if (!r || !r.uid || allDeletedUids.has(r.uid) || r.purge) return false;
                    const status = String(r.status || '').toLowerCase();
                    return status !== 'deleted' && status !== 'auto duplicate removed' && status !== 'location spam';
                }).length;
                const outcome = await new Promise((resolve, reject) => {
                    const tx = db.transaction(['logs'], 'readwrite');
                    const store = tx.objectStore('logs');
                    let changed = false;
                    let added = 0;
                    let removed = 0;
                    const getReq = store.getAll();
                    getReq.onerror = () => reject(getReq.error || new Error('Could not read local logs.'));
                    getReq.onsuccess = function(e) {
                        const localLogs = e.target.result || [];
                        const localUids = new Set(localLogs.map(l => l.uid).filter(Boolean));

                        localLogs.forEach(localLog => {
                            if (allDeletedUids.has(localLog.uid)) {
                                store.delete(localLog.id); changed = true; removed++; return;
                            }
                            const duplicateUpdate = allDuplicateUpdates.get(localLog.uid);
                            const locationUpdate = allLocationUpdates.get(localLog.uid);
                            if (duplicateUpdate && String(duplicateUpdate.status || '').toLowerCase() === 'auto duplicate removed') {
                                store.delete(localLog.id); changed = true; removed++; return;
                            }
                            if (localLog.pendingDelete) return;

                            const match = serverMap.get(localLog.uid);
                            if (match && (match.purge || String(match.status || '').toLowerCase() === 'auto duplicate removed' || String(match.status || '').toLowerCase() === 'deleted')) {
                                store.delete(localLog.id); changed = true; removed++; return;
                            }

                            if (match) {
                                const incoming = locationUpdate || duplicateUpdate || match;
                                const incomingStatus = incoming.status || match.status || localLog.status || 'Active';
                                const incomingDuplicateOf = incoming.duplicateOfUid || match.duplicateOfUid || '';
                                const incomingDuplicateCount = Number(incoming.duplicateDeviceCount || match.duplicateDeviceCount) || (String(incomingStatus).toLowerCase() === 'duplicate' ? 2 : 1);
                                const nextCheckpointKm = normalizeCheckpointKmValue_(match.checkpointKm);
                                const nextCheckpointKmSource = match.checkpointKmSource || localLog.checkpointKmSource || '';
                                const fieldsChanged = localLog.bib !== match.bib || localLog.time !== match.time ||
                                    localLog.checkpoint !== match.checkpoint || localLog.volunteer !== match.volunteer ||
                                    (localLog.remark || '') !== (match.remark || '') || localLog.status !== incomingStatus ||
                                    localLog.duplicateOfUid !== incomingDuplicateOf || Number(localLog.duplicateDeviceCount || 0) !== incomingDuplicateCount ||
                                    localLog.lapMode !== (match.lapMode || localLog.lapMode) ||
                                    normalizeCheckpointKmValue_(localLog.checkpointKm) !== nextCheckpointKm ||
                                    (localLog.checkpointKmSource || '') !== nextCheckpointKmSource ||
                                    (localLog.originalDeviceTime || '') !== (match.originalDeviceTime || localLog.originalDeviceTime || match.time) ||
                                    Number(localLog.clockOffsetMs || 0) !== Number(match.clockOffsetMs || 0) ||
                                    Number(localLog.clockConfidenceMs || 0) !== Number(match.clockConfidenceMs || 0) ||
                                    (localLog.appVersion || '') !== (match.appVersion || localLog.appVersion || '');
                                if (fieldsChanged || localLog.remake || !localLog.synced) {
                                    Object.assign(localLog, {
                                        bib: normalizeBibOriginal_(match.bib || localLog.bib),
                                        bibNumber: extractBibNumber_(match.bibNumber || match.bib || localLog.bib),
                                        bibNumberKey: bibNumberKey_(match.bibNumberKey || match.bibNumber || match.bib || localLog),
                                        bibKey: bibIdentityKey_(match.bib ? match : localLog),
                                        category: findCategoryConfigForBib_(match.bib || localLog.bib, categoryConfig)?.category || 'Uncategorized',
                                        time: match.time,
                                        clientTimeMs: parseCustomOrIsoDate(match.time).getTime(),
                                        checkpoint: match.checkpoint,
                                        volunteer: match.volunteer,
                                        remark: match.remark || '',
                                        device: match.device || localLog.device || '',
                                        creatorId: match.creatorId || localLog.creatorId || parseCreatorId(match.device),
                                        latitude: match.latitude,
                                        longitude: match.longitude,
                                        status: incomingStatus,
                                        gpsValidationStatus: locationUpdate?.gpsValidationStatus || localLog.gpsValidationStatus || (String(incomingStatus).toLowerCase() === 'location spam' ? 'spam' : 'unverified'),
                                        gpsNearestCheckpoint: locationUpdate?.nearestCheckpoint || localLog.gpsNearestCheckpoint || '',
                                        gpsDistanceToNearestM: Number(locationUpdate?.distanceM) || localLog.gpsDistanceToNearestM || null,
                                        duplicateOfUid: incomingDuplicateOf,
                                        duplicateDeviceCount: incomingDuplicateCount,
                                        lapMode: match.lapMode || localLog.lapMode || 'multiple',
                                        checkpointKm: nextCheckpointKm === '' ? null : Number(nextCheckpointKm),
                                        checkpointKmSource: nextCheckpointKmSource,
                                        originalDeviceTime: match.originalDeviceTime || localLog.originalDeviceTime || match.time,
                                        originalDeviceTimeMs: parseCustomOrIsoDate(match.originalDeviceTime || localLog.originalDeviceTime || match.time).getTime(),
                                        clockOffsetMs: Number(match.clockOffsetMs ?? localLog.clockOffsetMs) || 0,
                                        clockConfidenceMs: Number(match.clockConfidenceMs ?? localLog.clockConfidenceMs) || 0,
                                        appVersion: match.appVersion || localLog.appVersion || '',
                                        synced: true,
                                        remake: false,
                                        syncAttempts: 0
                                    });
                                    store.put(localLog); changed = true;
                                }
                            } else if (localLog.synced) {
                                localLog.synced = false;
                                localLog.remake = true;
                                store.put(localLog);
                                changed = true;
                            }
                        });

                        // Critical first-device/full-monitor fix: the old reconciliation
                        // compared existing local rows but never inserted server rows that
                        // were not already in IndexedDB. A newly installed PWA therefore
                        // could not see the complete race in Safety Log or Director Mode.
                        allServerRecords.forEach(serverRecord => {
                            if (!serverRecord || !serverRecord.uid || localUids.has(serverRecord.uid)) return;
                            const status = String(serverRecord.status || '').toLowerCase();
                            if (serverRecord.purge || status === 'deleted' || status === 'auto duplicate removed' || allDeletedUids.has(serverRecord.uid)) return;
                            const km = normalizeCheckpointKmValue_(serverRecord.checkpointKm);
                            store.add({
                                bib: normalizeBibOriginal_(serverRecord.bib),
                                bibNumber: extractBibNumber_(serverRecord.bibNumber || serverRecord.bib),
                                bibNumberKey: bibNumberKey_(serverRecord),
                                bibKey: bibIdentityKey_(serverRecord),
                                category: findCategoryConfigForBib_(serverRecord.bib, categoryConfig)?.category || 'Uncategorized',
                                time: serverRecord.time,
                                clientTimeMs: parseCustomOrIsoDate(serverRecord.time).getTime(),
                                checkpoint: serverRecord.checkpoint,
                                volunteer: serverRecord.volunteer,
                                remark: serverRecord.remark || '',
                                device: serverRecord.device || '',
                                creatorId: serverRecord.creatorId || parseCreatorId(serverRecord.device),
                                lapMode: serverRecord.lapMode || 'multiple',
                                checkpointKm: km === '' ? null : Number(km),
                                checkpointKmSource: serverRecord.checkpointKmSource || '',
                                originalDeviceTime: serverRecord.originalDeviceTime || serverRecord.time,
                                originalDeviceTimeMs: parseCustomOrIsoDate(serverRecord.originalDeviceTime || serverRecord.time).getTime(),
                                clockOffsetMs: Number(serverRecord.clockOffsetMs) || 0,
                                clockConfidenceMs: Number(serverRecord.clockConfidenceMs) || 0,
                                appVersion: serverRecord.appVersion || '',
                                status: serverRecord.status || 'Active',
                                duplicateOfUid: serverRecord.duplicateOfUid || '',
                                duplicateDeviceCount: Number(serverRecord.duplicateDeviceCount) || (status === 'duplicate' ? 2 : 1),
                                latitude: serverRecord.latitude,
                                longitude: serverRecord.longitude,
                                uid: serverRecord.uid,
                                synced: true,
                                remake: false,
                                syncAttempts: 0
                            });
                            localUids.add(serverRecord.uid);
                            changed = true;
                            added++;
                        });
                    };
                    tx.oncomplete = () => resolve({ changed, added, removed, totalServer: activeServerCount });
                    tx.onerror = () => reject(tx.error || new Error('Full reconciliation transaction failed.'));
                    tx.onabort = () => reject(tx.error || new Error('Full reconciliation transaction was aborted.'));
                });

                if (lastResult?.serverTime) updateClockDriftSample_(lastResult.serverTime, fullReconcileLastRequestStartedAt_, Date.now());
                recordSyncSuccess();
                if (outcome.changed) { scheduleAggregateRebuild_(); loadHistory(); }
                return Object.assign({ success: true }, outcome);
            } catch (e) {
                recordSyncFailure(e.message || String(e));
                return { success: false, reason: e.message || String(e) };
            }
        }

        function parseCustomOrIsoDate(timeStr) {
            if (!timeStr) return new Date();
            let match = String(timeStr).trim().match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)?$/i);
            if (match) {
                let hr = parseInt(match[4], 10);
                if (match[7]?.toUpperCase() === 'PM' && hr < 12) hr += 12;
                if (match[7]?.toUpperCase() === 'AM' && hr === 12) hr = 0;
                return new Date(parseInt(match[3], 10), parseInt(match[2], 10) - 1, parseInt(match[1], 10), hr, parseInt(match[5], 10), parseInt(match[6], 10));
            }
            let secondaryMatch = String(timeStr).trim().match(/^(\d{2})-(\d{2})-(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)?$/i);
            if (secondaryMatch) {
                let hr = parseInt(secondaryMatch[4], 10);
                if (secondaryMatch[7]?.toUpperCase() === 'PM' && hr < 12) hr += 12;
                if (secondaryMatch[7]?.toUpperCase() === 'AM' && hr === 12) hr = 0;
                return new Date(parseInt(secondaryMatch[3], 10), parseInt(secondaryMatch[2], 10) - 1, parseInt(secondaryMatch[1], 10), hr, parseInt(secondaryMatch[5], 10), parseInt(secondaryMatch[6], 10));
            }
            const d = new Date(timeStr);
            return isNaN(d.getTime()) ? new Date() : d;
        }

        function calculateLiveSplits(logs) {
            const splitLastRunner = document.getElementById("splitLastRunner");
            const gapEl = document.getElementById("splitGapTime");
            const deviceLabelEl = document.getElementById("lastFourDeviceLabel");
            if (deviceLabelEl) deviceLabelEl.textContent = getDeviceLabel(buildDeviceString()) || 'This device';
            const ownLogs = (logs || []).filter(isThisDeviceEntry_);
            if (ownLogs.length < 1) {
                if (splitLastRunner) splitLastRunner.textContent = "-";
                renderMinimalLastFour_([], new Map());
                if (gapEl) gapEl.textContent = "-";
                return;
            }
            const sorted = [...ownLogs].sort((a, b) => parseCustomOrIsoDate(a.time) - parseCustomOrIsoDate(b.time));
            const targetedLastFour = sorted.slice(-4).reverse();
            const bibFrequency = new Map();
            sorted.forEach(log => {
                const bibKey = bibIdentityKey_(log);
                if (bibKey) bibFrequency.set(bibKey, (bibFrequency.get(bibKey) || 0) + 1);
            });
            let HTMLBuilder = "";
            targetedLastFour.forEach((item, index) => {
                const bibText = String(item.bib || '').trim();
                const bibKey = bibIdentityKey_(item);
                const count = Math.max(1, bibFrequency.get(bibKey) || 1);
                const colourBucket = Math.min(20, count);
                const animationClass = index === 0 && triggerInlineAnimationFlag ? ' animate-new-bib-bounce' : '';
                const countLabel = count === 1 ? 'recorded once' : `recorded ${count} times`;
                HTMLBuilder += `<span class="last4-bib last4-repeat-${colourBucket}${animationClass}" title="${escapeHtml_(bibText)} — ${countLabel}" aria-label="Bib ${escapeHtml_(bibText)}, ${countLabel}">${escapeHtml_(bibText)}</span>`;
                if (index < targetedLastFour.length - 1) HTMLBuilder += ` <span class="text-neutral-500 font-bold mx-0.5">,</span> `;
            });
            splitLastRunner.innerHTML = `<span class="last4-line">${HTMLBuilder}</span>`;
            renderMinimalLastFour_(targetedLastFour, bibFrequency);
            if (triggerInlineAnimationFlag) triggerInlineAnimationFlag = false;
            
            if(sorted.length >= 2) {
                const diffSeconds = Math.floor((parseCustomOrIsoDate(sorted[sorted.length - 1].time) - parseCustomOrIsoDate(sorted[sorted.length - 2].time)) / 1000);
                const mins = Math.floor(diffSeconds / 60), secs = diffSeconds % 60;
                if (gapEl) gapEl.textContent = mins > 0 ? `+${mins}m ${secs}s` : `+${secs}s`;
            } else if (gapEl) {
                gapEl.textContent = "-";
            }
        }

        function isEditable(logTimeStr) { return (new Date() - parseCustomOrIsoDate(logTimeStr)) < 300000; }
        function isDeletable(logTimeStr) { return (new Date() - parseCustomOrIsoDate(logTimeStr)) < 1800000; }

        function startEditing(id) {
            db.transaction(["logs"], "readonly").objectStore("logs").get(id).onsuccess = function(e) {
                const log = e.target.result;
                if (!log || !isOwnEntry(log)) {
                    alert("⚠️ You can only edit entries logged from this device.");
                    return;
                }
                editingRowId = id; loadHistory();
            };
        }
        function cancelEditing() { editingRowId = null; loadHistory(); }

        function saveEdit(id) {
            const bibEl = document.getElementById(`edit-bib-${id}`);
            const remarkEl = document.getElementById(`edit-remark-${id}`);
            if (!bibEl || !remarkEl || !db) return;

            const newBib = normalizeBibOriginal_(bibEl.value);
            const newRemark = remarkEl.value.trim();
            if (!newBib) { alert('⚠️ Enter any non-empty BIB label. Letters, numbers, spaces and punctuation are accepted.'); bibEl.focus(); return; }

            // Cancel any legacy timer before touching a row. The transaction reads by
            // IndexedDB primary key and preserves the UID, so only this exact scan can
            // be updated locally or on the server.
            if (remarkDebounceTimeout) { clearTimeout(remarkDebounceTimeout); remarkDebounceTimeout = null; }
            const tx = db.transaction(["logs"], "readwrite");
            const store = tx.objectStore("logs");
            tx.oncomplete = function() {
                editingRowId = null;
                scheduleAggregateRebuild_();
                loadHistory();
                if (syncIntervalMs > 0) attemptSync();
                document.getElementById('bibInput')?.focus();
            };
            tx.onerror = function() {
                alert('⚠️ Edit could not be saved locally. Please try again.');
            };

            const getReq = store.get(id);
            getReq.onsuccess = function(e) {
                const log = e.target.result;
                if (!log || !isOwnEntry(log)) {
                    tx.abort();
                    alert('⚠️ This entry is no longer available for editing on this device.');
                    return;
                }
                const updated = Object.assign({}, log, {
                    bib: newBib,
                    bibNumber: extractBibNumber_(newBib),
                    bibNumberKey: bibNumberKey_(newBib),
                    bibKey: bibIdentityKey_(newBib),
                    category: findCategoryConfigForBib_(newBib, categoryConfig)?.category || 'Uncategorized',
                    remark: newRemark,
                    reasonCode: Array.from(new Set(String(log.reasonCode || '').split('|').filter(Boolean).concat(['EDITED_ENTRY']))).join('|'),
                    reconciliationFlags: Array.from(new Set(String(log.reconciliationFlags || '').split(',').filter(Boolean).concat(['edited']))).join(','),
                    editedAt: new Date().toISOString(),
                    editedBy: (document.getElementById('volunteer')?.value || '').trim().toUpperCase(),
                    recordChecksum: '',
                    synced: false,
                    remake: false,
                    syncAttempts: 0
                });
                store.put(updated);
            };
        }

        // ============================================================
        // Client-side derived metrics (lap / pace / speed / ETA)
        // -----------------------------------------------------------
        // Racelog stores raw scan facts plus checkpoint KM. Category, passage, elapsed time,
        // average pace/speed, and projected finish are derived in the PWA from those raw
        // records and the Setup-sheet category configuration. This keeps the spreadsheet
        // append path fast and gives online/offline devices the same calculation model.
        // ============================================================

        /** Parses a Setup-sheet bib rule like "1001-1378" or "V8301-V8348" into its
         * letter prefix (if any) and numeric lo/hi bounds. Returns null if the rule
         * doesn't match that shape (e.g. blank/malformed rows). */
        function parseBibRange_(rule) {
            const ranges = parseBibRuleParts_(rule);
            return ranges.length ? ranges[0] : null;
        }

        /** Finds which category config row a bib belongs to by checking whether the
         * bib's numeric value (and letter prefix, if any) actually falls within that
         * row's bib range -- e.g. bib 1405 matches "1401-1412", not "1001-1378",
         * even though both ranges start with the same leading digit. Previously this
         * compared a synthesized "1xxx"-style key against the real range string
         * ("1001-1378"), which could never match anything -- every bib silently
         * returned null, so category/pace/speed/lap live-preview metrics never had
         * real data to work with. */
        function findCategoryConfigForBib_(bib, categoryConfig) {
            return findExactOrNumericConfigForBib_(bib, categoryConfig);
        }

        function formatDurationHMS_(totalSeconds) {
            if (!isFinite(totalSeconds) || totalSeconds < 0) return '-';
            const h = Math.floor(totalSeconds / 3600);
            const m = Math.floor((totalSeconds % 3600) / 60);
            const s = Math.floor(totalSeconds % 60);
            const pad = (n) => String(n).padStart(2, '0');
            return `${pad(h)}:${pad(m)}:${pad(s)}`;
        }

        function formatPaceMinSec_(totalSeconds) {
            if (!isFinite(totalSeconds) || totalSeconds < 0) return null;
            const rounded = Math.round(totalSeconds);
            const m = Math.floor(rounded / 60);
            const s = rounded % 60;
            return `${m}:${String(s).padStart(2, '0')}`;
        }

        function medianNumber_(values) {
            const nums = (values || []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
            if (!nums.length) return null;
            const middle = Math.floor(nums.length / 2);
            return nums.length % 2 ? nums[middle] : (nums[middle - 1] + nums[middle]) / 2;
        }

        function metricCheckpointKey_(checkpoint, totalDistanceKm) {
            return `${String(checkpoint || '').trim().toUpperCase()}|${canonicalRaceKmKey_(totalDistanceKm)}`;
        }

        function metricCategoryKey_(cfg) {
            return `${canonicalRaceKmKey_(cfg && cfg.km)}|${String((cfg && cfg.category) || '').trim().toUpperCase()}`;
        }

        function isExplicitDistanceSource_(source) {
            const normalized = String(source || '').toLowerCase();
            return !normalized || normalized.startsWith('setup-') || normalized === 'checkpoint-name' || normalized === 'completion-checkpoint' || normalized === 'recorded';
        }

        function buildMetricEstimationContext_(allLogs, catCfg) {
            const context = {
                checkpointDistances: new Map(),
                categoryPaces: new Map(),
                finishFactors: new Map(),
                bibKnownPaces: new Map()
            };
            const histories = buildBibHistoryMap_(allLogs || []);

            (allLogs || []).forEach(log => {
                if (!isCountableLog_(log)) return;
                const cfg = findCategoryConfigForBib_(log.bib, catCfg);
                if (!cfg) return;
                const totalDistanceKm = parseRaceDistanceNumber_(cfg.km);
                const flagoffDate = new Date(cfg.flagoff);
                const logTime = parseCustomOrIsoDate(log.time);
                const km = Number(log.checkpointKm);
                if (!Number.isFinite(totalDistanceKm) || totalDistanceKm <= 0 || isNaN(flagoffDate.getTime()) || isNaN(logTime.getTime())) return;
                const elapsed = (logTime - flagoffDate) / 1000;
                if (!(elapsed > 0) || !(km > 0) || km > totalDistanceKm + 0.01 || !isExplicitDistanceSource_(log.checkpointKmSource)) return;
                const cpKey = metricCheckpointKey_(log.checkpoint, totalDistanceKm);
                if (!context.checkpointDistances.has(cpKey)) context.checkpointDistances.set(cpKey, []);
                context.checkpointDistances.get(cpKey).push(km);
                const pace = elapsed / km;
                if (Number.isFinite(pace) && pace > 0) {
                    const catKey = metricCategoryKey_(cfg);
                    if (!context.categoryPaces.has(catKey)) context.categoryPaces.set(catKey, []);
                    context.categoryPaces.get(catKey).push(pace);
                    const bibKey = bibIdentityKey_(log);
                    if (!context.bibKnownPaces.has(bibKey)) context.bibKnownPaces.set(bibKey, []);
                    context.bibKnownPaces.get(bibKey).push({ time: logTime.getTime(), distance: km, pace });
                }
            });

            histories.forEach((history, bib) => {
                const cfg = findCategoryConfigForBib_(bib, catCfg);
                if (!cfg) return;
                const totalDistanceKm = parseRaceDistanceNumber_(cfg.km);
                const flagoffDate = new Date(cfg.flagoff);
                if (!Number.isFinite(totalDistanceKm) || totalDistanceKm <= 0 || isNaN(flagoffDate.getTime())) return;
                const completed = history
                    .filter(log => isCompletionCheckpoint_(log.checkpoint))
                    .map(log => ({ log, time: parseCustomOrIsoDate(log.time) }))
                    .filter(item => !isNaN(item.time.getTime()) && item.time > flagoffDate)
                    .sort((a, b) => b.time - a.time)[0];
                if (!completed) return;
                const finishElapsed = (completed.time - flagoffDate) / 1000;
                if (!(finishElapsed > 0)) return;
                history.forEach(log => {
                    const time = parseCustomOrIsoDate(log.time);
                    if (isNaN(time.getTime()) || time >= completed.time) return;
                    const elapsed = (time - flagoffDate) / 1000;
                    if (!(elapsed > 0)) return;
                    const factor = finishElapsed / elapsed;
                    if (!Number.isFinite(factor) || factor < 1 || factor > 20) return;
                    const key = metricCheckpointKey_(log.checkpoint, totalDistanceKm);
                    if (!context.finishFactors.has(key)) context.finishFactors.set(key, []);
                    context.finishFactors.get(key).push(factor);
                });
            });

            return context;
        }

        function resolveDistanceCoveredKm_(log, totalDistanceKm, cfg, bibHistorySorted, metricContext, totalSeconds) {
            const stored = Number(log && log.checkpointKm);
            if (Number.isFinite(stored) && stored > 0 && stored <= totalDistanceKm + 0.01) {
                const source = String(log.checkpointKmSource || 'recorded');
                return { km: stored, estimated: source === 'auto-estimate' || source.startsWith('estimated:'), source, confidence: source === 'auto-estimate' ? 'low' : 'exact' };
            }

            const checkpointName = String((log && log.checkpoint) || '').trim();
            if (isCompletionCheckpoint_(checkpointName)) {
                return { km: totalDistanceKm, estimated: false, source: 'completion-checkpoint', confidence: 'exact' };
            }

            const namedKm = parseExplicitKmFromCheckpointName_(checkpointName, totalDistanceKm);
            if (namedKm) return { km: namedKm, estimated: false, source: 'checkpoint-name', confidence: 'exact' };

            const currentCheckpoint = String(document.getElementById('checkpoint')?.value || '').trim().toUpperCase();
            if (checkpointName.toUpperCase() === currentCheckpoint) {
                const configured = configuredCheckpointKmForBib_(log.bib, checkpointName);
                if (configured.km && configured.km <= totalDistanceKm + 0.01) return { km: configured.km, estimated: false, source: configured.source, confidence: 'exact' };
            }

            const cpKey = metricCheckpointKey_(checkpointName, totalDistanceKm);
            const cpSamples = metricContext && metricContext.checkpointDistances ? (metricContext.checkpointDistances.get(cpKey) || []) : [];
            const cpMedian = medianNumber_(cpSamples);
            if (cpMedian && cpMedian <= totalDistanceKm + 0.01) {
                return { km: cpMedian, estimated: true, source: `estimated:checkpoint-median:${cpSamples.length}`, confidence: cpSamples.length >= 3 ? 'high' : 'medium' };
            }

            const logTimeMs = parseCustomOrIsoDate(log.time).getTime();
            const ownSamples = metricContext && metricContext.bibKnownPaces ? (metricContext.bibKnownPaces.get(bibIdentityKey_(log)) || []).filter(sample => sample.time < logTimeMs) : [];
            if (ownSamples.length && totalSeconds > 0) {
                const latest = ownSamples.sort((a, b) => b.time - a.time)[0];
                const estimatedKm = Math.min(totalDistanceKm, Math.max(latest.distance, totalSeconds / latest.pace));
                if (estimatedKm > 0) return { km: estimatedKm, estimated: true, source: 'estimated:runner-prior-pace', confidence: 'medium' };
            }

            const catKey = metricCategoryKey_(cfg);
            const categorySamples = metricContext && metricContext.categoryPaces ? (metricContext.categoryPaces.get(catKey) || []) : [];
            const categoryPace = medianNumber_(categorySamples);
            if (categoryPace && totalSeconds > 0) {
                const estimatedKm = Math.min(totalDistanceKm, Math.max(0.01, totalSeconds / categoryPace));
                return { km: estimatedKm, estimated: true, source: `estimated:category-median:${categorySamples.length}`, confidence: categorySamples.length >= 5 ? 'medium' : 'low' };
            }

            return { km: null, estimated: true, source: 'estimated:unavailable', confidence: 'none' };
        }

        function describeDistanceSource_(distanceInfo, totalDistanceKm, checkpointName) {
            if (!distanceInfo || !distanceInfo.km) return '';
            const source = String(distanceInfo.source || '');
            const roundedKm = Math.round(distanceInfo.km * 100) / 100;
            if (source.startsWith('estimated:checkpoint-median:')) {
                const n = source.split(':').pop();
                return `${roundedKm} of ${totalDistanceKm} KM • estimated from ${n} matching checkpoint scan${n === '1' ? '' : 's'}`;
            }
            if (source === 'estimated:runner-prior-pace') return `${roundedKm} of ${totalDistanceKm} KM • estimated from this runner's earlier known pace`;
            if (source.startsWith('estimated:category-median:')) {
                const n = source.split(':').pop();
                return `${roundedKm} of ${totalDistanceKm} KM • estimated from ${n} category pace sample${n === '1' ? '' : 's'}`;
            }
            if (source === 'completion-checkpoint') return `${totalDistanceKm} of ${totalDistanceKm} KM • completed at ${String(checkpointName || 'finish').trim() || 'finish'}`;
            return `${roundedKm} of ${totalDistanceKm} KM`;
        }

        function nextCheckpointMetric_(log, bibHistorySorted, cfg, currentDistanceKm) {
            const currentCheckpoint = checkpointToken_(log && log.checkpoint);
            let nextCheckpoint = '';
            let source = '';
            const sequence = Array.isArray(cfg && cfg.checkpointSequence)
                ? cfg.checkpointSequence.map(checkpointToken_).filter(Boolean) : [];
            if (sequence.length) {
                const observed = checkpointHistoryForRoute_(
                    (bibHistorySorted || []).filter(item => parseCustomOrIsoDate(item.time) <= parseCustomOrIsoDate(log.time)),
                    log.checkpoint
                );
                const aligned = alignObservedRouteToSequence_(observed, sequence);
                if (aligned && aligned.idx < sequence.length - 1) {
                    nextCheckpoint = sequence[aligned.idx + 1];
                    source = 'configured-route';
                }
            }
            if (!nextCheckpoint && currentCheckpoint) {
                const model = routeModelsByKey_[routeCategoryKeyForConfig_(cfg)] || null;
                const options = routeTransitionOptions_(model, currentCheckpoint).slice()
                    .sort((a, b) => Number(b.count || 0) - Number(a.count || 0) || Number(b.support || 0) - Number(a.support || 0));
                if (options.length) {
                    nextCheckpoint = checkpointToken_(options[0].to);
                    source = model && model.source || 'learned-route';
                }
            }
            if (!nextCheckpoint) return null;
            const nextKmInfo = checkpointGpsKmFor_(nextCheckpoint, cfg);
            const currentProfile = checkpointGpsProfileFor_(log.checkpoint, cfg);
            const nextProfile = checkpointGpsProfileFor_(nextCheckpoint, cfg);
            const straightLineKm = currentProfile && nextProfile
                ? haversineMeters_(currentProfile.latitude, currentProfile.longitude, nextProfile.latitude, nextProfile.longitude) / 1000
                : null;
            const courseDistanceKm = nextKmInfo && Number.isFinite(Number(currentDistanceKm))
                ? Math.max(0, Number(nextKmInfo.km) - Number(currentDistanceKm)) : null;
            return {
                nextCheckpoint,
                nextCheckpointKm: nextKmInfo ? Number(nextKmInfo.km) : null,
                nextCourseDistanceKm: Number.isFinite(courseDistanceKm) ? Math.round(courseDistanceKm * 100) / 100 : null,
                nextStraightLineKm: Number.isFinite(straightLineKm) ? Math.round(straightLineKm * 100) / 100 : null,
                source
            };
        }

        /**
         * Computes a live preview for one log entry. Exact category-specific checkpoint
         * distances are preferred. When they are unavailable the estimator uses, in
         * order: the median distance recorded at this checkpoint for the same race KM,
         * this runner's own earlier known pace, then the category median pace. Projected
         * finish additionally learns a checkpoint-to-finish factor from completed runners,
         * which accounts for a harder/easier second half better than simple linear pace.
         */
        function computeLivePreviewMetrics_(log, bibHistorySorted, categoryConfig, metricContext) {
            const setupCfg = findCategoryConfigForBib_(log.bib, categoryConfig);
            const cfg = setupCfg || inferRouteConfigFromHistory_(bibHistorySorted, log.checkpoint);
            if (!cfg) return { category: 'Uncategorized', km: '', bibRule: '', lap: String(Math.max(1, bibHistorySorted.findIndex(l => l.uid === log.uid) + 1)), timePerLap: '-', totalTime: '-', pace: '', speed: '', projectedFinish: '-', flagoff: '-' };
            const displayCategory = setupCfg ? (cfg.category || 'Uncategorized') : 'Uncategorized';

            const flagoffDate = new Date(cfg.flagoff);
            const totalDistanceKm = parseRaceDistanceNumber_(cfg.km);
            if (isNaN(flagoffDate.getTime()) || !Number.isFinite(totalDistanceKm) || totalDistanceKm <= 0) return null;

            const logTime = parseCustomOrIsoDate(log.time);
            const idx = bibHistorySorted.findIndex(l => l.uid === log.uid);
            if (idx === -1 || isNaN(logTime.getTime())) return null;

            const lapNum = idx + 1;
            let lapDisplay = String(lapNum);
            let splitSeconds = null;
            if (lapNum > 1) {
                const prevTime = parseCustomOrIsoDate(bibHistorySorted[idx - 1].time);
                splitSeconds = (logTime - prevTime) / 1000;
                if (Number.isFinite(splitSeconds) && splitSeconds >= 0) lapDisplay = `${lapNum} (${formatDurationHMS_(splitSeconds)})`;
            }

            const totalSeconds = (logTime - flagoffDate) / 1000;
            if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return null;

            const distanceInfo = resolveDistanceCoveredKm_(log, totalDistanceKm, cfg, bibHistorySorted, metricContext, totalSeconds);
            const distanceCoveredKm = distanceInfo.km;
            const timePerLapSeconds = lapNum === 1 ? totalSeconds : splitSeconds;
            let paceDisplay = '';
            let speedDisplay = '';
            let projectedFinish = '-';
            let projectionMethod = '';
            let metricWarning = '';

            if (distanceCoveredKm && totalSeconds > 0) {
                const paceSecondsPerKm = totalSeconds / distanceCoveredKm;
                const speedKmh = distanceCoveredKm / (totalSeconds / 3600);
                paceDisplay = formatPaceMinSec_(paceSecondsPerKm) || '';
                speedDisplay = Number.isFinite(speedKmh) ? `${speedKmh.toFixed(1)} km/h` : '';
            }

            if (isCompletionCheckpoint_(log.checkpoint) && totalSeconds >= 0) {
                projectedFinish = getFormattedTimestamp(logTime);
                projectionMethod = 'actual completion time';
            } else if (totalSeconds > 0) {
                const factorSamples = metricContext && metricContext.finishFactors ? (metricContext.finishFactors.get(metricCheckpointKey_(log.checkpoint, totalDistanceKm)) || []) : [];
                const learnedFactor = medianNumber_(factorSamples);
                let projectedRaceSeconds = null;
                if (learnedFactor && factorSamples.length >= 2) {
                    projectedRaceSeconds = totalSeconds * learnedFactor;
                    projectionMethod = `checkpoint finish model (${factorSamples.length} completed runners)`;
                } else if (distanceCoveredKm) {
                    projectedRaceSeconds = (totalSeconds / distanceCoveredKm) * totalDistanceKm;
                    projectionMethod = distanceInfo.estimated ? 'estimated distance × average pace' : 'average pace at configured course distance';
                }
                if (Number.isFinite(projectedRaceSeconds) && projectedRaceSeconds >= totalSeconds) {
                    projectedFinish = getFormattedTimestamp(new Date(flagoffDate.getTime() + projectedRaceSeconds * 1000));
                }
            }

            if (!distanceCoveredKm) {
                metricWarning = 'Checkpoint distance unavailable; set KM in Setup.';
            } else if (distanceInfo.estimated) {
                metricWarning = 'Distance estimated; pace and finish may vary.';
            }

            let flagoffDisplay = '-';
            try { flagoffDisplay = getFormattedTimestamp(flagoffDate); } catch(_) {}
            const nextMetric = nextCheckpointMetric_(log, bibHistorySorted, cfg, distanceCoveredKm);

            return {
                category:      displayCategory,
                km:            cfg.km || '',
                bibRule:       setupCfg ? (cfg.bibRule || '') : '',
                routeCategory: setupCfg ? '' : (cfg.category || ''),
                checkpointKm:  distanceCoveredKm ? Math.round(distanceCoveredKm * 100) / 100 : (log.checkpointKm || null),
                checkpointKmSource: distanceInfo.source || log.checkpointKmSource || '',
                checkpointKmEstimated: !!distanceInfo.estimated,
                metricBasis:   describeDistanceSource_(distanceInfo, totalDistanceKm, log.checkpoint),
                projectionMethod,
                metricWarning,
                lap:           lapDisplay,
                timePerLap:    formatDurationHMS_(timePerLapSeconds),
                totalTime:     formatDurationHMS_(totalSeconds),
                pace:          paceDisplay ? `${paceDisplay} min/km` : '',
                speed:         speedDisplay,
                projectedFinish,
                flagoff:       flagoffDisplay,
                nextCheckpoint: nextMetric?.nextCheckpoint || '',
                nextCheckpointKm: nextMetric?.nextCheckpointKm ?? null,
                nextCourseDistanceKm: nextMetric?.nextCourseDistanceKm ?? null,
                nextStraightLineKm: nextMetric?.nextStraightLineKm ?? null
            };
        }

        function normalizedLogStatus_(log) {
            return String((log && log.status) || 'Active').trim().toLowerCase();
        }

        function isDuplicateLog_(log) {
            const status = normalizedLogStatus_(log);
            return status === 'duplicate' || status === 'auto duplicate removed';
        }

        function isAutoRemovedDuplicate_(log) {
            return normalizedLogStatus_(log) === 'auto duplicate removed';
        }

        function isLocationSpamLog_(log) {
            return normalizedLogStatus_(log) === 'location spam';
        }

        /** Duplicate and GPS-spam audit rows stay visible, but never inflate passages,
         * runner totals, standings, safety rosters, route learning, pace or analytics. */
        function isCountableLog_(log) {
            if (!log || !log.bib || log.remake || log.pendingDelete) return false;
            const status = normalizedLogStatus_(log);
            return status !== 'deleted' && status !== 'duplicate' && status !== 'auto duplicate removed' && status !== 'location spam';
        }

        function applyDuplicateUpdatesToStore_(store, localLogs, updates) {
            if (!Array.isArray(updates) || updates.length === 0) return false;
            const byUid = new Map((localLogs || []).map(log => [log.uid, log]));
            let changed = false;
            updates.forEach(update => {
                if (!update || !update.uid) return;
                const log = byUid.get(update.uid);
                if (!log) return;
                const nextStatus = update.status || 'Duplicate';
                if (String(nextStatus).toLowerCase() === 'auto duplicate removed') {
                    store.delete(log.id);
                    changed = true;
                    return;
                }
                log.status = nextStatus;
                log.duplicateOfUid = update.duplicateOfUid || '';
                log.duplicateDeviceCount = Number(update.duplicateDeviceCount) || 2;
                log.synced = true;
                log.remake = false;
                log.syncAttempts = 0;
                store.put(log);
                changed = true;
            });
            return changed;
        }

        function applyLocationUpdatesToStore_(store, localLogs, updates) {
            if (!Array.isArray(updates) || !updates.length) return false;
            const byUid = new Map((localLogs || []).map(log => [log.uid, log]));
            let changed = false;
            updates.forEach(update => {
                if (!update || !update.uid) return;
                const log = byUid.get(update.uid);
                if (!log) return;
                log.status = update.status || 'Location Spam';
                log.gpsValidationStatus = update.gpsValidationStatus || (String(log.status).toLowerCase() === 'location spam' ? 'spam' : log.gpsValidationStatus || 'unverified');
                log.gpsNearestCheckpoint = update.nearestCheckpoint || log.gpsNearestCheckpoint || '';
                log.gpsDistanceToNearestM = Number(update.distanceM) || log.gpsDistanceToNearestM || null;
                log.synced = true;
                log.remake = false;
                log.syncAttempts = 0;
                store.put(log);
                changed = true;
            });
            return changed;
        }

        /**
         * Builds a bib -> time-sorted-history lookup once per render pass, from the full
         * (unfiltered) log set, mirroring how the backend's lap-count formula counts
         * occurrences across the whole sheet rather than within one checkpoint/scope.
         */
        function buildBibHistoryMap_(allLogs) {
            const map = new Map();
            allLogs.forEach(l => {
                if (!isCountableLog_(l)) return;
                const key = bibIdentityKey_(l);
                if (!key) return;
                if (!map.has(key)) map.set(key, []);
                map.get(key).push(l);
            });
            map.forEach(list => list.sort((a, b) => parseCustomOrIsoDate(a.time) - parseCustomOrIsoDate(b.time)));
            return map;
        }

        /**
         * Returns a display-ready version of `log` with all metric fields (category,
         * lap, pace, speed, projectedFinish) computed locally from the Setup-sheet
         * config.  The server no longer sends metric data — this is the single source
         * of truth for those values regardless of sync state.
         */
        function withLivePreview_(log, bibHistoryMap, catCfg, metricContext) {
            if (!log.bib || log.remake) return log; // nothing useful to compute
            if (isLocationSpamLog_(log)) {
                const cfg = findCategoryConfigForBib_(log.bib, catCfg);
                return Object.assign({}, log, {
                    category: (cfg && cfg.category) || log.category || 'Uncategorized',
                    km: (cfg && cfg.km) || log.km || '',
                    lap: 'Location spam', timePerLap: '-', totalTime: '-', pace: '', speed: '', projectedFinish: '-',
                    metricWarning: 'GPS location is outside the event area; excluded from race calculations.'
                });
            }
            if (isDuplicateLog_(log)) {
                const cfg = findCategoryConfigForBib_(log.bib, catCfg);
                return Object.assign({}, log, {
                    category: (cfg && cfg.category) || log.category || 'Uncategorized',
                    km: (cfg && cfg.km) || log.km || '',
                    lap: 'Duplicate',
                    timePerLap: '-',
                    totalTime: '-',
                    pace: '',
                    speed: '',
                    projectedFinish: '-'
                });
            }
            const history = bibHistoryMap.get(bibIdentityKey_(log)) || [log];
            const preview = computeLivePreviewMetrics_(log, history, catCfg, metricContext);
            return preview ? Object.assign({}, log, preview) : Object.assign({}, log, { category: log.category || 'Uncategorized' });
        }

        /**
         * Single shared source for "give me every log, fully enriched with
         * category/lap/pace/speed/projectedFinish/flagoff" — the same computation
         * loadHistory() does before rendering. Anything that reads the DB directly
         * (analytics, exports, the safety board, etc.) MUST go through this instead
         * of calling objectStore('logs').getAll() on its own, otherwise it only sees
         * the raw stored fields (bib/time/checkpoint/...) and none of the derived
         * metrics — which is why those consumers used to show "no data" even when
         * the log store was full.
         */
        function getEnrichedLogsFromDb_(callback) {
            if (!db) { callback([]); return; }
            db.transaction(["logs"], "readonly").objectStore("logs").getAll().onsuccess = function(e) {
                // pendingDelete entries are queued for server-side deletion (see deleteRow())
                // but haven't been confirmed yet -- hide them everywhere immediately so the
                // UI behaves as if they're already gone, while the record itself sticks
                // around in IndexedDB so the sync loop keeps retrying until the server
                // actually confirms the delete.
                const rawLogs = (e.target.result || []).filter(l => !l.pendingDelete && !isAutoRemovedDuplicate_(l)).map(decorateBibIdentity_);
                const _bibMap = buildBibHistoryMap_(rawLogs);
                const _metricContext = buildMetricEstimationContext_(rawLogs, categoryConfig);
                const logs = rawLogs.map(l => withLivePreview_(l, _bibMap, categoryConfig, _metricContext));
                applyBibCollisionIndicators_(logs);
                callback(logs);
            };
        }

        function compareLogsNewestFirst_(a, b) {
            const aTime = parseCustomOrIsoDate(a && a.time).getTime();
            const bTime = parseCustomOrIsoDate(b && b.time).getTime();
            const safeATime = Number.isFinite(aTime) ? aTime : 0;
            const safeBTime = Number.isFinite(bTime) ? bTime : 0;
            if (safeBTime !== safeATime) return safeBTime - safeATime;
            const aReceived = parseCustomOrIsoDate(a && a.serverReceivedAt).getTime();
            const bReceived = parseCustomOrIsoDate(b && b.serverReceivedAt).getTime();
            const safeAReceived = Number.isFinite(aReceived) ? aReceived : 0;
            const safeBReceived = Number.isFinite(bReceived) ? bReceived : 0;
            if (safeBReceived !== safeAReceived) return safeBReceived - safeAReceived;
            return (Number(b && b.id) || 0) - (Number(a && a.id) || 0);
        }

        function formatLogTime(timeStr) {
            const date = parseCustomOrIsoDate(timeStr);
            const formatted = getFormattedTimestamp(date);
            const diff = Math.floor((new Date() - date) / 1000);
            let ago = diff < 60 ? "Just now" : (diff < 3600 ? Math.floor(diff / 60) + "m ago" : Math.floor(diff / 3600) + "h ago");
            return `${formatted} (${ago})`;
        }

        function switchToDisplayAllLogsFromFooter() {
            // The fast logging screen intentionally never renders more than 20 rows.
            // Complete event monitoring belongs in the dedicated safety/director views.
            if (activeScopeFilter === 'current') openSafetyLog(); else openDirectorMode();
        }

        let activeExpandedUids = window.globalExpandedLogUidsSetRecord || new Set();
        window.globalExpandedLogUidsSetRecord = activeExpandedUids;

        function toggleAllLogAccordionPanels() {
            const panels = document.querySelectorAll('.collapsible-log-panel');
            const chevrons = document.querySelectorAll('.chevron-rotate');
            const shouldExpandAll = panels.length > 0 && Array.from(panels).some(p => !p.classList.contains('expanded'));

            panels.forEach(panel => {
                const uid = panel.getAttribute('data-uid');
                if (shouldExpandAll) {
                    panel.classList.add('expanded');
                    activeExpandedUids.add(uid);
                } else {
                    panel.classList.remove('expanded');
                    activeExpandedUids.delete(uid);
                }
            });
            
            chevrons.forEach(chevron => {
                if (shouldExpandAll) chevron.classList.add('expanded');
                else chevron.classList.remove('expanded');
            });
        }

        /**
         * Tapping a row is now an "exclusive" accordion: opening one collapses whatever
         * else was open, so you're never scrolling past several expanded detail panels
         * by accident. The explicit Expand All / Collapse All button (↔️) is the one
         * deliberate way to have more than one open at once — it bypasses this function
         * entirely and sets every panel's state directly.
         */
        function inlineLogPanelAccordionToggle(uid) {
            const panel = document.getElementById(`accordion-panel-${uid}`);
            const chevron = document.getElementById(`chevron-indicator-${uid}`);
            if (!panel) return;

            const isExpanding = !panel.classList.contains('expanded');

            if (isExpanding) {
                // Collapse every other currently-expanded row first.
                activeExpandedUids.forEach(otherUid => {
                    if (otherUid === uid) return;
                    const otherPanel = document.getElementById(`accordion-panel-${otherUid}`);
                    const otherChevron = document.getElementById(`chevron-indicator-${otherUid}`);
                    if (otherPanel) otherPanel.classList.remove('expanded');
                    if (otherChevron) otherChevron.classList.remove('expanded');
                });
                activeExpandedUids.clear();
                panel.classList.add('expanded');
                if (chevron) chevron.classList.add('expanded');
                activeExpandedUids.add(uid);
            } else {
                panel.classList.remove('expanded');
                if (chevron) chevron.classList.remove('expanded');
                activeExpandedUids.delete(uid);
            }
        }
        
        // ============================================================
        // Director Mode — big-screen report view for tablet/PC/TV.
        // ============================================================

        // ============================================================
        // Race Command View — compact toolbar controls
        // ============================================================
        function revealDirectorToolbarLabel_(elementId, temporaryLabel, durationMs = 5000) {
            const element = document.getElementById(elementId);
            if (!element) return;
            const label = element.querySelector('.director-action-label');
            if (label && temporaryLabel) label.textContent = temporaryLabel;
            element.classList.add('is-expanded');
            if (directorToolbarLabelTimers_.has(elementId)) clearTimeout(directorToolbarLabelTimers_.get(elementId));
            const timer = setTimeout(() => {
                element.classList.remove('is-expanded');
                const currentLabel = element.querySelector('.director-action-label');
                if (currentLabel && element.dataset.fullLabel) currentLabel.textContent = element.dataset.fullLabel;
                directorToolbarLabelTimers_.delete(elementId);
                if (elementId === 'directorExitButton' && Date.now() >= directorExitArmedUntil_) {
                    element.classList.remove('is-armed');
                    element.setAttribute('aria-label', 'Exit Director Mode. Tap once to reveal, tap again to exit.');
                }
            }, Math.max(1000, Number(durationMs) || 5000));
            directorToolbarLabelTimers_.set(elementId, timer);
        }

        function directorCustomizeAction_(event) {
            revealDirectorToolbarLabel_('directorCustomizeButton');
            openDirectorCustomize(event);
        }

        function directorRefreshAction_(event) {
            event?.preventDefault();
            revealDirectorToolbarLabel_('directorRefreshButton', 'Refreshing…');
            pullServerRecords();
            attemptSync();
        }

        function directorExitAction_(event) {
            event?.preventDefault();
            const button = document.getElementById('directorExitButton');
            if (Date.now() < directorExitArmedUntil_) {
                directorExitArmedUntil_ = 0;
                button?.classList.remove('is-armed');
                closeDirectorMode();
                return;
            }
            directorExitArmedUntil_ = Date.now() + 5000;
            button?.classList.add('is-armed');
            button?.setAttribute('aria-label', 'Exit armed. Tap again within five seconds to leave Director Mode.');
            revealDirectorToolbarLabel_('directorExitButton', 'Tap again to exit', 5000);
        }

        function resetDirectorToolbar_() {
            directorExitArmedUntil_ = 0;
            directorToolbarLabelTimers_.forEach(timer => clearTimeout(timer));
            directorToolbarLabelTimers_.clear();
            ['directorExitButton', 'directorSyncBadge', 'directorCustomizeButton', 'directorRefreshButton'].forEach(id => {
                const element = document.getElementById(id);
                if (!element) return;
                element.classList.remove('is-expanded', 'is-armed');
                const label = element.querySelector('.director-action-label');
                if (label && element.dataset.fullLabel) label.textContent = element.dataset.fullLabel;
            });
            document.getElementById('directorExitButton')?.setAttribute('aria-label', 'Exit Director Mode. Tap once to reveal, tap again to exit.');
        }

        // ============================================================
        // Race Command View — customizable widget picker
        // ============================================================
        const DIRECTOR_WIDGET_DEFS = [
            { id: 'glance', label: '📊 At a Glance', explain: 'The headline number from every other widget, consolidated into one summary.' },
            { id: 'chart', label: '🥧 Category Breakdown', explain: 'A donut chart of scans by category, with a legend.' },
            { id: 'ticker', label: '📡 Live Activity Ticker', explain: 'The most recent scans across every checkpoint, newest first.' },
            { id: 'throughput', label: '📶 Checkpoint Throughput', explain: 'Total scans logged per checkpoint, so you can spot a backlog forming.' },
            { id: 'progress', label: '📈 Category Progress', explain: 'Unique bibs seen so far vs. each category\'s registered runner count.' },
            { id: 'flagged', label: '🚩 Flagged Entries', explain: 'Entries with a remark, or marked REMAKE REQUIRED — likely need a decision.' },
            { id: 'devices', label: '📱 Checkpoint Device Activity', explain: 'When each submitting device was last heard from.' },
            { id: 'map', label: '🗺️ GPS Recording Map', explain: 'Interactive OpenStreetMap with checkpoints, PWA positions, trails, pan, pinch, and zoom. No API key required.' },
            { id: 'operations', label: '🧭 Operations Monitor', explain: 'Arrival windows, quiet checkpoints, duplicate rate, safety alerts, and data freshness.' },
            { id: 'cot', label: '⏱️ Cutoff Countdown', explain: 'Time remaining until each category\'s cutoff (COT).' },
            { id: 'forecast', label: '🌊 Arrival Forecast', explain: 'Forecast runner volume expected at each checkpoint over the next 10, 20, and 30 minutes.' },
            { id: 'health', label: '🩺 Device Health', explain: 'Battery, queue age, storage, app version, clock drift, and last contact.' },
            { id: 'integrity', label: '🧪 Data Integrity', explain: 'Malformed times, uncategorized bibs, route jumps, stale devices, and mapping gaps.' },
        ];
        const DIRECTOR_WIDGET_PREFS_KEY = 'directorWidgetPrefs_v1';

        function loadDirectorWidgetPrefs_() {
            try {
                const raw = localStorage.getItem(DIRECTOR_WIDGET_PREFS_KEY);
                if (raw) return JSON.parse(raw);
            } catch (e) { /* fall through to default */ }
            const defaults = {};
            DIRECTOR_WIDGET_DEFS.forEach(w => { defaults[w.id] = true; }); // all shown by default
            return defaults;
        }

        function saveDirectorWidgetPrefs_(prefs) {
            localStorage.setItem(DIRECTOR_WIDGET_PREFS_KEY, JSON.stringify(prefs));
        }

        function applyDirectorWidgetVisibility_() {
            const prefs = loadDirectorWidgetPrefs_();
            DIRECTOR_WIDGET_DEFS.forEach(w => {
                const el = document.getElementById('widget-' + w.id);
                if (el) el.classList.toggle('hidden', prefs[w.id] === false);
            });
            applyDirectorWidgetOrder_(loadDirectorWidgetOrder_());
            applyDirectorWidgetSizes_();
            renderAllWidgetWidthControls_();
        }

        function openDirectorCustomize(event) {
            if (event) { event.preventDefault(); event.stopPropagation(); }
            const modal = document.getElementById('directorCustomizeModal');
            if (!modal || !modal.classList.contains('hidden')) return;
            modal.classList.remove('hidden');
            renderDirectorWidgetCheckboxes_();
            renderDirectorFontScaleButtons_();
        }

        function closeDirectorCustomize(event) {
            if (event) { event.preventDefault(); event.stopPropagation(); }
            const modal = document.getElementById('directorCustomizeModal');
            if (!modal || modal.classList.contains('hidden')) return;
            modal.classList.add('hidden');
            applyDirectorWidgetVisibility_();
            scheduleDirectorMasonry_();
        }

        function toggleDirectorCustomize(event) {
            const modal = document.getElementById('directorCustomizeModal');
            if (!modal) return;
            if (modal.classList.contains('hidden')) openDirectorCustomize(event);
            else closeDirectorCustomize(event);
        }

        function renderDirectorWidgetCheckboxes_() {
            const list = document.getElementById('directorWidgetCheckboxList');
            if (!list) return;
            const prefs = loadDirectorWidgetPrefs_();
            list.innerHTML = DIRECTOR_WIDGET_DEFS.map(w => `
                <label class="flex items-start gap-3 p-2.5 rounded-lg border theme-border hover:bg-neutral-200/40 dark:hover:bg-neutral-800/40 cursor-pointer transition">
                    <input type="checkbox" class="mt-1 w-4 h-4 accent-blue-600" ${prefs[w.id] !== false ? 'checked' : ''} onchange="setDirectorWidgetPref_('${w.id}', this.checked)">
                    <span class="flex flex-col gap-0.5">
                        <span class="text-xs font-bold theme-text">${w.label}</span>
                        <span class="text-[10px] theme-text-muted leading-snug">${w.explain}</span>
                    </span>
                </label>
            `).join('');
        }

        function setDirectorWidgetPref_(id, enabled) {
            const prefs = loadDirectorWidgetPrefs_();
            prefs[id] = enabled;
            saveDirectorWidgetPrefs_(prefs);
            applyDirectorWidgetVisibility_();
            scheduleDirectorMasonry_();
        }

        // ============================================================
        // Race Command View — draggable widget reordering
        // ------------------------------------------------------------
        // Reordering is done with the CSS `order` property (the widgets grid is a plain
        // CSS Grid) rather than physically moving DOM nodes around -- this is simpler and
        // more robust: no node insertion/removal bugs possible, and every browser already
        // handles `order` natively and consistently.
        //
        // Dragging itself uses the Pointer Events API (pointerdown/pointermove/pointerup)
        // rather than the native HTML5 drag-and-drop API, because HTML5 DnD has no real
        // touch support -- it would work with a mouse on a PC but not with a finger on an
        // iPad, and this view is explicitly meant for both.
        // ============================================================
        const DIRECTOR_WIDGET_ORDER_KEY = 'directorWidgetOrder_v1';
        let widgetDragState = null; // { widgetId, orderIds, pointerId } while a drag is active

        function loadDirectorWidgetOrder_() {
            let order;
            try {
                const raw = localStorage.getItem(DIRECTOR_WIDGET_ORDER_KEY);
                order = raw ? JSON.parse(raw) : null;
            } catch (e) { order = null; }
            if (!Array.isArray(order)) order = DIRECTOR_WIDGET_DEFS.map(w => w.id);
            // Merge in any widget ids that exist now but weren't part of a previously
            // saved order (e.g. a widget added in a later update) -- append at the end
            // rather than silently dropping them from view.
            const known = new Set(order);
            DIRECTOR_WIDGET_DEFS.forEach(w => { if (!known.has(w.id)) order.push(w.id); });
            return order.filter(id => DIRECTOR_WIDGET_DEFS.some(w => w.id === id)); // drop stale/unknown ids
        }

        function saveDirectorWidgetOrder_(orderIds) {
            localStorage.setItem(DIRECTOR_WIDGET_ORDER_KEY, JSON.stringify(orderIds));
        }

        function applyDirectorWidgetOrder_(orderIds) {
            orderIds.forEach((id, index) => {
                const el = document.getElementById('widget-' + id);
                if (el) el.style.order = index;
            });
            scheduleDirectorMasonry_();
        }

        function resetDirectorWidgetLayout_() {
            const defaultOrder = DIRECTOR_WIDGET_DEFS.map(w => w.id);
            saveDirectorWidgetOrder_(defaultOrder);
            applyDirectorWidgetOrder_(defaultOrder);
        }

        function startWidgetDrag_(event, widgetId) {
            event.preventDefault();
            const section = document.getElementById('widget-' + widgetId);
            const handle = event.currentTarget;
            if (!section || !handle) return;

            widgetDragState = { widgetId: widgetId, orderIds: loadDirectorWidgetOrder_(), pointerId: event.pointerId };
            section.classList.add('widget-dragging');
            try { handle.setPointerCapture(event.pointerId); } catch (e) { /* non-fatal */ }

            document.addEventListener('pointermove', onWidgetDragMove_);
            document.addEventListener('pointerup', onWidgetDragEnd_, { once: true });
            document.addEventListener('pointercancel', onWidgetDragEnd_, { once: true });
        }

        function onWidgetDragMove_(event) {
            if (!widgetDragState) return;
            const overEl = document.elementFromPoint(event.clientX, event.clientY);
            const targetSection = overEl && overEl.closest('[data-widget]');
            if (!targetSection) return;
            const targetId = targetSection.getAttribute('data-widget');
            if (!targetId || targetId === widgetDragState.widgetId) return;

            const order = widgetDragState.orderIds;
            const fromIdx = order.indexOf(widgetDragState.widgetId);
            const toIdx = order.indexOf(targetId);
            if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;

            order.splice(fromIdx, 1);
            order.splice(toIdx, 0, widgetDragState.widgetId);
            applyDirectorWidgetOrder_(order);
        }

        function onWidgetDragEnd_() {
            if (!widgetDragState) return;
            const section = document.getElementById('widget-' + widgetDragState.widgetId);
            if (section) section.classList.remove('widget-dragging');
            saveDirectorWidgetOrder_(widgetDragState.orderIds);
            document.removeEventListener('pointermove', onWidgetDragMove_);
            widgetDragState = null;
        }

        // ============================================================
        // Race Command View — widget resizing (width via column span, height via drag)
        // ------------------------------------------------------------
        // Width isn't drag-resized: these widgets live in a CSS Grid, and a smooth
        // pixel-drag doesn't map cleanly onto grid TRACKS (you'd just be fighting the
        // grid to snap back into columns anyway) -- so width is instead a clear 1/2/3
        // column-span pick via small pill buttons in each header, which is unambiguous
        // and equally easy to hit on a touchscreen.
        //
        // Height IS a genuine pointer-drag, using the same Pointer Events approach as
        // the reorder handles above, dragging a strip at the bottom of each widget.
        // ============================================================
        const DIRECTOR_WIDGET_SIZES_KEY = 'directorWidgetSizes_v1';
        const DIRECTOR_COMPACT_LAYOUT_MIGRATION_KEY_ = 'directorCompactLayout_v18_0_2';
        const DIRECTOR_WIDGET_BODY_IDS = {
            glance: 'directorGlanceBody',
            chart: 'directorChartBody',
            ticker: 'directorTickerBody',
            throughput: 'directorThroughputBody',
            progress: 'directorProgressBody',
            flagged: 'directorFlaggedBody',
            devices: 'directorDevicesBody',
            map: 'directorMapBody',
            operations: 'directorOperationsBody',
            cot: 'directorCotBody',
            forecast: 'directorForecastBody',
            health: 'directorHealthBody',
            integrity: 'directorIntegrityBody',
            heatmap: 'director-heatmap-body',
            'cot-funnel': 'director-cot-funnel-body',
            'route-anomalies': 'director-route-anomalies-body',
            'finish-projection': 'director-finish-projection-body',
            outcomes: 'director-outcomes-body',
        };
        const WIDGET_MIN_HEIGHT_PX = 100;
        const WIDGET_MAX_HEIGHT_PX = 800;
        let widgetResizeState = null; // { widgetId, bodyEl, handleEl, startY, startHeight }
        let directorMasonryRaf_ = 0;
        let directorMasonryObserver_ = null;

        function getDirectorGridColumnCount_() {
            if (window.innerWidth >= 1280) return 3;
            if (window.innerWidth >= 1024) return 2;
            return 1;
        }

        function scheduleDirectorMasonry_() {
            if (directorMasonryRaf_) cancelAnimationFrame(directorMasonryRaf_);
            directorMasonryRaf_ = requestAnimationFrame(() => {
                directorMasonryRaf_ = 0;
                layoutDirectorMasonry_();
            });
        }

        function layoutDirectorMasonry_() {
            const grid = document.getElementById('directorWidgetsGrid');
            const view = document.getElementById('directorModeView');
            if (!grid || !view || view.classList.contains('hidden')) return;
            const style = getComputedStyle(grid);
            const rowHeight = parseFloat(style.gridAutoRows) || 4;
            const rowGap = parseFloat(style.rowGap) || 16;
            grid.querySelectorAll('[data-widget]').forEach(section => {
                if (getComputedStyle(section).display === 'none') {
                    section.style.gridRowEnd = '';
                    return;
                }
                section.style.gridRowEnd = 'auto';
                const height = Math.ceil(section.getBoundingClientRect().height);
                const span = Math.max(1, Math.ceil((height + rowGap) / (rowHeight + rowGap)));
                section.style.gridRowEnd = `span ${span}`;
            });
        }

        function ensureDirectorMasonryObserver_() {
            if (directorMasonryObserver_ || typeof ResizeObserver === 'undefined') return;
            directorMasonryObserver_ = new ResizeObserver(() => scheduleDirectorMasonry_());
            const grid = document.getElementById('directorWidgetsGrid');
            if (!grid) return;
            directorMasonryObserver_.observe(grid);
            grid.querySelectorAll('[data-widget]').forEach(section => directorMasonryObserver_.observe(section));
        }

        function loadDirectorWidgetSizes_() {
            try {
                const raw = localStorage.getItem(DIRECTOR_WIDGET_SIZES_KEY);
                if (raw) return JSON.parse(raw);
            } catch (e) { /* fall through */ }
            return {};
        }

        function saveDirectorWidgetSizes_(sizes) {
            localStorage.setItem(DIRECTOR_WIDGET_SIZES_KEY, JSON.stringify(sizes));
        }

        function migrateDirectorCompactLayout_() {
            if (localStorage.getItem(DIRECTOR_COMPACT_LAYOUT_MIGRATION_KEY_) === 'done') return;
            const sizes = loadDirectorWidgetSizes_();
            Object.keys(sizes).forEach(id => {
                if (sizes[id] && Object.prototype.hasOwnProperty.call(sizes[id], 'heightPx')) {
                    delete sizes[id].heightPx;
                }
            });
            saveDirectorWidgetSizes_(sizes);
            localStorage.setItem(DIRECTOR_COMPACT_LAYOUT_MIGRATION_KEY_, 'done');
        }

        function setDirectorWidgetEmptyState_(widgetId, isEmpty) {
            const section = document.getElementById('widget-' + widgetId);
            const body = document.getElementById(DIRECTOR_WIDGET_BODY_IDS[widgetId]);
            if (!section || !body) return;
            section.classList.toggle('director-widget-empty', !!isEmpty);
            scheduleDirectorMasonry_();
            if (isEmpty) {
                body.style.height = '';
                body.style.maxHeight = '';
                body.style.overflowY = '';
                return;
            }
            const sizes = loadDirectorWidgetSizes_();
            const saved = sizes[widgetId] || {};
            if (saved.heightPx) {
                body.style.height = saved.heightPx + 'px';
                body.style.maxHeight = saved.heightPx + 'px';
                body.style.overflowY = 'auto';
            } else {
                body.style.height = '';
                body.style.maxHeight = '';
                body.style.overflowY = '';
            }
        }

        function applyDirectorWidgetSizes_() {
            const sizes = loadDirectorWidgetSizes_();
            const availableColumns = getDirectorGridColumnCount_();
            DIRECTOR_WIDGET_DEFS.forEach(w => {
                const section = document.getElementById('widget-' + w.id);
                const body = document.getElementById(DIRECTOR_WIDGET_BODY_IDS[w.id]);
                const size = sizes[w.id] || {};
                const requestedSpan = Math.max(1, Number(size.colSpan) || 1);
                const effectiveSpan = Math.min(requestedSpan, availableColumns);
                if (section) section.style.gridColumn = `span ${effectiveSpan}`;
                if (body) {
                    const isEmpty = !!(section && section.classList.contains('director-widget-empty'));
                    if (size.heightPx && !isEmpty) {
                        body.style.height = size.heightPx + 'px';
                        body.style.maxHeight = size.heightPx + 'px';
                        body.style.overflowY = 'auto';
                    } else {
                        body.style.height = '';
                        body.style.maxHeight = '';
                        body.style.overflowY = '';
                    }
                }
            });
            scheduleDirectorMasonry_();
        }

        function resetDirectorWidgetSizes_() {
            localStorage.removeItem(DIRECTOR_WIDGET_SIZES_KEY);
            applyDirectorWidgetSizes_();
            renderAllWidgetWidthControls_();
        }

        function renderAllWidgetWidthControls_() {
            document.querySelectorAll('[data-widget-controls]').forEach(container => {
                const widgetId = container.getAttribute('data-widget-controls');
                const sizes = loadDirectorWidgetSizes_();
                const currentSpan = (sizes[widgetId] && sizes[widgetId].colSpan) || 1;
                const availableColumns = getDirectorGridColumnCount_();
                container.innerHTML = Array.from({ length: availableColumns }, (_, i) => i + 1).map(span => {
                    const isActive = currentSpan === span;
                    const cls = isActive
                        ? 'bg-blue-600 dark:bg-blue-800 text-white'
                        : 'bg-neutral-200 dark:bg-neutral-900 theme-text-muted hover:bg-neutral-300 dark:hover:bg-neutral-800';
                    return `<button onclick="setWidgetColSpan_('${widgetId}', ${span})" class="${cls} text-[9px] font-bold w-4 h-4 flex items-center justify-center rounded transition" title="${span} column${span > 1 ? 's' : ''} wide">${span}</button>`;
                }).join('');
            });
        }

        function setWidgetColSpan_(widgetId, span) {
            const sizes = loadDirectorWidgetSizes_();
            if (!sizes[widgetId]) sizes[widgetId] = {};
            sizes[widgetId].colSpan = span;
            saveDirectorWidgetSizes_(sizes);
            applyDirectorWidgetSizes_();
            renderAllWidgetWidthControls_();
        }

        function startWidgetResize_(event, widgetId) {
            event.preventDefault();
            const section = document.getElementById('widget-' + widgetId);
            if (section && section.classList.contains('director-widget-empty')) return;
            const body = document.getElementById(DIRECTOR_WIDGET_BODY_IDS[widgetId]);
            const handle = event.currentTarget;
            if (!body || !handle) return;

            widgetResizeState = {
                widgetId: widgetId,
                bodyEl: body,
                handleEl: handle,
                startY: event.clientY,
                startHeight: body.getBoundingClientRect().height,
            };
            handle.classList.add('resizing');
            try { handle.setPointerCapture(event.pointerId); } catch (e) { /* non-fatal */ }

            document.addEventListener('pointermove', onWidgetResizeMove_);
            document.addEventListener('pointerup', onWidgetResizeEnd_, { once: true });
            document.addEventListener('pointercancel', onWidgetResizeEnd_, { once: true });
        }

        function onWidgetResizeMove_(event) {
            if (!widgetResizeState) return;
            const delta = event.clientY - widgetResizeState.startY;
            const newHeight = Math.max(WIDGET_MIN_HEIGHT_PX, Math.min(WIDGET_MAX_HEIGHT_PX, Math.round(widgetResizeState.startHeight + delta)));
            widgetResizeState.bodyEl.style.height = newHeight + 'px';
            widgetResizeState.bodyEl.style.maxHeight = newHeight + 'px';
            widgetResizeState.bodyEl.style.overflowY = 'auto';
            scheduleDirectorMasonry_();
        }

        function onWidgetResizeEnd_() {
            if (!widgetResizeState) return;
            widgetResizeState.handleEl.classList.remove('resizing');
            const finalHeight = parseInt(widgetResizeState.bodyEl.style.height, 10) || WIDGET_MIN_HEIGHT_PX;
            const sizes = loadDirectorWidgetSizes_();
            if (!sizes[widgetResizeState.widgetId]) sizes[widgetResizeState.widgetId] = {};
            sizes[widgetResizeState.widgetId].heightPx = finalHeight;
            saveDirectorWidgetSizes_(sizes);
            document.removeEventListener('pointermove', onWidgetResizeMove_);
            widgetResizeState = null;
            scheduleDirectorMasonry_();
        }
        // Race Command View — text-size scaling (auto by screen size, or fixed)
        // ------------------------------------------------------------
        // Rather than scaling with CSS `zoom` (inconsistent cross-browser layout
        // behavior) or `transform: scale()` (blurry, causes clipping/scrollbar issues),
        // this scales the ROOT font-size while Director Mode is open. Every Tailwind
        // text-size utility (text-xs, text-sm, etc.) is defined in rem, i.e. relative to
        // the root, so one change here consistently scales every widget's text AND
        // layout (padding/gaps that use rem-based Tailwind spacing) together. The
        // original root font-size is restored the moment Director Mode closes, so it
        // never affects the regular logging screen underneath.
        // ============================================================
        const DIRECTOR_FONT_SCALE_KEY = 'directorFontScaleMode_v1';
        const DIRECTOR_FONT_SCALES = { small: 0.85, medium: 1.0, large: 1.25, xlarge: 1.5 };
        let directorOriginalRootFontSizePx = null;
        let directorAutoResizeHandler = null;

        function getDirectorFontScaleMode_() {
            return localStorage.getItem(DIRECTOR_FONT_SCALE_KEY) || 'auto';
        }

        function setDirectorFontScaleMode_(mode) {
            localStorage.setItem(DIRECTOR_FONT_SCALE_KEY, mode);
            applyDirectorFontScale_();
            renderDirectorFontScaleButtons_();
        }

        /**
         * Tiered by viewport width rather than device pixel count -- pixel density
         * varies a lot (a 4K tablet and a 4K TV have wildly different physical sizes),
         * but viewport width in CSS pixels is a much more reliable proxy for "how big is
         * this screen and how far away is someone probably standing/sitting from it."
         */
        function computeAutoFontScale_() {
            const w = window.innerWidth;
            if (w >= 2560) return 1.65;  // 4K monitor/TV
            if (w >= 1920) return 1.42;  // 1080p TV or large monitor
            if (w >= 1280) return 1.22;  // typical laptop/desktop
            if (w >= 900) return 1.08;   // iPad landscape
            return 1.0;                  // iPad portrait / small tablet
        }

        function applyDirectorFontScale_() {
            if (directorOriginalRootFontSizePx === null) {
                directorOriginalRootFontSizePx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
            }
            const mode = getDirectorFontScaleMode_();
            const scale = mode === 'auto' ? computeAutoFontScale_() : (DIRECTOR_FONT_SCALES[mode] || 1.0);
            document.documentElement.style.fontSize = (directorOriginalRootFontSizePx * scale) + 'px';
            scheduleDirectorMasonry_();
        }

        function restoreRootFontSize_() {
            if (directorOriginalRootFontSizePx !== null) {
                document.documentElement.style.fontSize = directorOriginalRootFontSizePx + 'px';
            }
        }

        function renderDirectorFontScaleButtons_() {
            const container = document.getElementById('directorFontScaleButtons');
            if (!container) return;
            const currentMode = getDirectorFontScaleMode_();
            const options = [
                { mode: 'auto', label: '📐 Auto' },
                { mode: 'small', label: 'S' },
                { mode: 'medium', label: 'M' },
                { mode: 'large', label: 'L' },
                { mode: 'xlarge', label: 'XL' },
            ];
            container.innerHTML = options.map(o => {
                const isActive = currentMode === o.mode;
                const cls = isActive
                    ? 'bg-blue-600 dark:bg-blue-800 text-white'
                    : 'bg-neutral-200 dark:bg-neutral-900 theme-text hover:bg-neutral-300 dark:hover:bg-neutral-800';
                return `<button onclick="setDirectorFontScaleMode_('${o.mode}')" class="${cls} px-3 py-1.5 rounded-lg text-xs font-bold transition">${o.label}</button>`;
            }).join('');
        }

        function formatMonitorSyncAge_() {
            if (!lastFullMonitorSyncAt_) return 'Never';
            const seconds = Math.max(0, Math.floor((Date.now() - lastFullMonitorSyncAt_) / 1000));
            if (seconds < 60) return `${seconds}s ago`;
            if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
            return `${Math.floor(seconds / 3600)}h ago`;
        }

        function updateSafetyRosterLoadState_(state, message) {
            const el = document.getElementById('safetyRosterLoadState');
            if (!el) return;
            el.classList.remove('ready', 'syncing', 'error');
            el.classList.add(state || 'ready');
            el.textContent = message || '';
        }

        function updateMonitorSyncLabels_(state, detail) {
            const directorBadge = document.getElementById('directorSyncBadge');
            const safetyBadge = document.getElementById('safetySyncBadge');
            const safetyLast = document.getElementById('safetyLastFullSync');
            const safetyButton = document.getElementById('safetyFullSyncBtn');
            const isBusy = state === 'syncing';
            const isError = state === 'error';
            const icon = isBusy ? '⟳' : isError ? '⚠' : '●';
            const statusText = isBusy ? 'Syncing complete event…'
                : isError ? 'Full sync failed'
                : `All logs · ${formatMonitorSyncAge_()}`;
            const label = `${icon} ${statusText}`;
            if (directorBadge) {
                directorBadge.dataset.state = isBusy ? 'syncing' : isError ? 'error' : 'ready';
                directorBadge.dataset.fullLabel = statusText;
                directorBadge.title = detail || statusText;
                directorBadge.setAttribute('aria-label', `${statusText}. Tap to reveal status.`);
                directorBadge.classList.toggle('animate-pulse', isBusy);
                const iconEl = document.getElementById('directorSyncIcon');
                const textEl = document.getElementById('directorSyncText');
                if (iconEl) iconEl.textContent = icon;
                if (textEl) textEl.textContent = statusText;
                if (isBusy || isError) revealDirectorToolbarLabel_('directorSyncBadge', statusText);
            }
            if (safetyBadge) {
                safetyBadge.dataset.state = isBusy ? 'syncing' : isError ? 'error' : 'ready';
                safetyBadge.dataset.fullLabel = statusText;
                safetyBadge.textContent = icon;
                safetyBadge.title = detail || statusText;
                safetyBadge.setAttribute('aria-label', statusText);
                safetyBadge.classList.toggle('animate-pulse', isBusy);
            }
            if (safetyLast) safetyLast.textContent = formatMonitorSyncAge_();
            if (safetyButton) {
                safetyButton.disabled = isBusy;
                safetyButton.textContent = '↻';
                safetyButton.title = isBusy ? 'Syncing all runners…' : 'Sync all runners';
                safetyButton.setAttribute('aria-label', isBusy ? 'Syncing all runners' : 'Sync all runners');
            }
            if (isBusy) {
                updateSafetyRosterLoadState_('syncing', 'Loading the complete event runner list. Local records remain visible while the download finishes…');
            } else if (isError) {
                updateSafetyRosterLoadState_('error', detail || 'Complete-event sync failed. Showing the runner records already stored on this device; tap Sync all runners to retry.');
            }
        }

        async function syncAllMonitorData_(target, force) {
            if (!syncUrl || !dbReady_ || !db) {
                updateMonitorSyncLabels_('error', 'Cloud connection or local storage is unavailable.');
                return { success: false };
            }
            const freshnessMs = Date.now() - lastFullMonitorSyncAt_;
            if (!force && fullMonitorDatasetResident_ && lastFullMonitorSyncAt_ && freshnessMs < 60000) {
                updateMonitorSyncLabels_('ready', 'Full event data was synced less than one minute ago.');
                if (target === 'safety') renderSafetyLog_();
                if (target === 'director') getEnrichedLogsFromDb_(logs => renderDirectorModeContent_(logs));
                return { success: true, cached: true };
            }
            if (monitorSyncPromise_) return monitorSyncPromise_;

            updateMonitorSyncLabels_('syncing', 'Downloading every Racelog page. The regular Scan History remains capped at 20 rows.');
            attemptSync();
            monitorSyncPromise_ = (async () => {
                const result = await performFullReconciliation_();
                if (!result || !result.success) {
                    updateMonitorSyncLabels_('error', result && result.reason ? result.reason : 'Full reconciliation failed.');
                    return result || { success: false };
                }
                lastFullMonitorSyncAt_ = Date.now();
                fullMonitorDatasetResident_ = isFullMonitorViewOpen_();
                localStorage.setItem('lastFullMonitorSyncAt_v1', String(lastFullMonitorSyncAt_));
                updateMonitorSyncLabels_('ready', `${result.totalServer || 0} server records checked; ${result.added || 0} added to this device.`);
                updateSafetyRosterLoadState_('ready', 'Complete event data loaded. The Safety Log now lists every unique runner recorded in Racelog.');
                if (target === 'safety' || !document.getElementById('safetyLogView')?.classList.contains('hidden')) {
                    pullSafetyNotesFromServer_();
                    renderSafetyLog_();
                }
                if (target === 'director' || isDirectorModeOpen) {
                    getEnrichedLogsFromDb_(logs => renderDirectorModeContent_(logs));
                }
                if (!fullMonitorDatasetResident_ && syncUrl && db) {
                    // The monitor was closed while paging was still in flight. Reapply
                    // the newest-20 operational window after the full transaction lands.
                    setTimeout(() => pullServerRecords(), 0);
                }
                return result;
            })().finally(() => { monitorSyncPromise_ = null; });
            return monitorSyncPromise_;
        }

        function tickDirectorClock_() {
            const el = document.getElementById('directorClock');
            if (el) el.textContent = getFormattedTimestamp(new Date());
        }

        function openDirectorMode() {
            const overlay = document.getElementById('directorModeView');
            if (!overlay) return;
            overlay.classList.remove('hidden');
            isDirectorModeOpen = true;
            document.body.classList.add('overflow-hidden');
            resetDirectorToolbar_();
            migrateDirectorCompactLayout_();
            applyDirectorWidgetVisibility_();
            applyDirectorWidgetSizes_();
            applyDirectorFontScale_();
            ensureDirectorMasonryObserver_();
            scheduleDirectorMasonry_();

            // Auto mode should re-scale if the window/orientation changes while open
            // (e.g. an iPad rotating, or a browser window being resized on a PC).
            if (directorAutoResizeHandler) window.removeEventListener('resize', directorAutoResizeHandler);
            directorAutoResizeHandler = () => {
                if (getDirectorFontScaleMode_() === 'auto') applyDirectorFontScale_();
                applyDirectorWidgetSizes_();
                renderAllWidgetWidthControls_();
                scheduleDirectorMasonry_();
            };
            window.addEventListener('resize', directorAutoResizeHandler);

            renderDirectorSummaryTable_(lastKnownSummaryRows);
            renderAggregateFastStats_();
            fetchOperationsSummary_();
            if (db) loadHistory(); // triggers renderDirectorModeContent_ with fresh data

            if (directorClockIntervalId) clearInterval(directorClockIntervalId);
            tickDirectorClock_();
            directorClockIntervalId = setInterval(tickDirectorClock_, 30000);

            // Countdown text needs to change every minute, not every second -- a coarser
            // interval than the clock is plenty and cheaper to keep running.
            if (directorCotIntervalId) clearInterval(directorCotIntervalId);
            directorCotIntervalId = setInterval(() => renderDirectorCotCountdown_(lastKnownSummaryRows), 30000);

            // Director Mode is a complete-event monitor. Render local data immediately,
            // then page through the entire server dataset so a newly installed device sees
            // every checkpoint rather than only the latest incremental page.
            updateMonitorSyncLabels_('ready');
            if (syncUrl) syncAllMonitorData_('director', false);
        }

        function closeDirectorMode() {
            const overlay = document.getElementById('directorModeView');
            if (!overlay) return;
            overlay.classList.add('hidden');
            isDirectorModeOpen = false;
            document.body.classList.remove('overflow-hidden');
            resetDirectorToolbar_();
            restoreRootFontSize_();
            if (directorAutoResizeHandler) { window.removeEventListener('resize', directorAutoResizeHandler); directorAutoResizeHandler = null; }
            if (directorClockIntervalId) { clearInterval(directorClockIntervalId); directorClockIntervalId = null; }
            if (directorCotIntervalId) { clearInterval(directorCotIntervalId); directorCotIntervalId = null; }
            // Return to the lightweight newest-20 recording window once no monitor remains open.
            if (!isFullMonitorViewOpen_()) {
                fullMonitorDatasetResident_ = false;
                if (syncUrl && db) pullServerRecords();
            }
        }

        /* ════════════════════════════════════════════════════════════════════
           RUNNER SAFETY LOG
           One row per bib ever scanned, so a safety officer can account for
           every runner rather than scroll through a scan-by-scan history.
           Each row carries a shared status + remark (SafetyNotes sheet) that
           is visible on every device once synced — separate from the
           per-scan remark used at individual checkpoints.
           ════════════════════════════════════════════════════════════════════ */
        const SAFETY_STATUS_LABELS_ = { ok: '✅ OK', dns: '⏸️ DNS', dnf: '🏳️ DNF', withdrawn: '🚫 Withdrawn', medical: '🚑 Medical', missing: '❓ Missing' };
        // State bindings are declared with the other startup globals above so a fast
        // IndexedDB callback cannot hit a temporal dead zone before this section parses.

        function canonicalKmKey_(km) {
            const raw = String(km || '').trim().toUpperCase();
            const match = raw.match(/\d+(?:\.\d+)?/);
            return match ? String(parseFloat(match[0])) : (raw || 'UNSPECIFIED');
        }

        function formatKmLabel_(km) {
            const key = canonicalKmKey_(km);
            return key === 'UNSPECIFIED' ? 'Unspecified' : (/^\d/.test(key) ? `${key} KM` : key);
        }

        function distanceCategoryKey_(km, category) {
            return `${canonicalKmKey_(km)}||${String(category || '').trim().toUpperCase()}`;
        }

        function formatDistanceCategoryLabel_(km, category) {
            const cat = String(category || '').trim() || 'Uncategorized';
            const kmKey = canonicalKmKey_(km);
            return kmKey === 'UNSPECIFIED' ? cat : `${formatKmLabel_(km)} · ${cat}`;
        }

        function safetyComboKey_(km, category) {
            return distanceCategoryKey_(km, category);
        }

        function getSafetyMatrixCombos_() {
            const seen = new Set();
            const combos = [];
            const addCombo = (km, category, source) => {
                const normalizedCategory = String(category || '').trim() || 'Uncategorized';
                const normalizedKm = String(km || '').trim();
                const combo = {
                    km: normalizedKm,
                    kmKey: canonicalKmKey_(normalizedKm),
                    kmLabel: formatKmLabel_(normalizedKm),
                    category: normalizedCategory,
                    key: safetyComboKey_(normalizedKm, normalizedCategory),
                    source: source || 'observed'
                };
                if (seen.has(combo.key)) return;
                seen.add(combo.key);
                combos.push(combo);
            };

            (categoryConfig || []).forEach(cfg => {
                if (!cfg) return;
                addCombo(cfg.km || '', cfg.category || 'Uncategorized', 'configured');
            });
            (lastSafetyRosterForCounts_ || []).forEach(row => {
                if (!row) return;
                addCombo(row.km || '', row.category || 'Uncategorized', 'observed');
            });

            // Always expose the two reconciliation buckets even when their current
            // count is zero, so race control can see whether any unmatched records exist.
            addCombo('', 'Uncategorized', 'system');
            return combos;
        }

        function selectedSafetyComboKeys_() {
            const all = getSafetyMatrixCombos_().map(c => c.key);
            if (safetyMatrixSelection_ === null) return new Set(all);
            const valid = new Set(all);
            safetyMatrixSelection_ = new Set(Array.from(safetyMatrixSelection_).filter(k => valid.has(k)));
            return new Set(safetyMatrixSelection_);
        }

        function setSafetyMatrixSelection_(mode) {
            safetyMatrixSelection_ = mode === 'all' ? null : new Set();
            renderSafetyMatrix_();
            renderSafetyLog_();
        }

        function toggleSafetyMatrixCell_(encodedKey, checked) {
            const key = decodeURIComponent(encodedKey);
            const selected = selectedSafetyComboKeys_();
            if (checked) selected.add(key); else selected.delete(key);
            safetyMatrixSelection_ = selected;
            renderSafetyMatrix_();
            renderSafetyLog_();
        }

        function toggleSafetyMatrixKm_(encodedKmKey, checked) {
            const kmKey = decodeURIComponent(encodedKmKey);
            const selected = selectedSafetyComboKeys_();
            getSafetyMatrixCombos_().filter(c => c.kmKey === kmKey).forEach(c => checked ? selected.add(c.key) : selected.delete(c.key));
            safetyMatrixSelection_ = selected;
            renderSafetyMatrix_();
            renderSafetyLog_();
        }

        function toggleSafetyMatrixCategory_(encodedCategory, checked) {
            const category = decodeURIComponent(encodedCategory);
            const selected = selectedSafetyComboKeys_();
            getSafetyMatrixCombos_().filter(c => c.category === category).forEach(c => checked ? selected.add(c.key) : selected.delete(c.key));
            safetyMatrixSelection_ = selected;
            renderSafetyMatrix_();
            renderSafetyLog_();
        }

        function renderSafetyMatrix_(countRoster) {
            const container = document.getElementById('safetyMatrixFilter');
            if (!container) return;
            if (Array.isArray(countRoster)) lastSafetyRosterForCounts_ = countRoster;
            const combos = getSafetyMatrixCombos_();
            if (!combos.length) {
                container.innerHTML = '<div class="text-[10px] theme-text-muted p-2">No KM/category configuration or observed runner records are available yet.</div>';
                return;
            }
            const rosterForCounts = Array.isArray(lastSafetyRosterForCounts_) ? lastSafetyRosterForCounts_ : [];
            const comboCounts = new Map();
            rosterForCounts.forEach(r => comboCounts.set(r._comboKey, (comboCounts.get(r._comboKey) || 0) + 1));
            const selected = selectedSafetyComboKeys_();
            const kms = Array.from(new Map(combos.map(c => [c.kmKey, c])).values()).sort((a, b) => (parseFloat(b.kmKey) || 0) - (parseFloat(a.kmKey) || 0));
            const categories = Array.from(new Set(combos.map(c => c.category))).sort((a, b) => a.localeCompare(b));
            const available = new Set(combos.map(c => c.key));
            const categoryTotal = (category) => combos.filter(c => c.category === category).reduce((sum, c) => sum + (comboCounts.get(c.key) || 0), 0);
            const kmTotal = (kmKey) => combos.filter(c => c.kmKey === kmKey).reduce((sum, c) => sum + (comboCounts.get(c.key) || 0), 0);

            const header = categories.map((category, colIndex) => {
                const colCombos = combos.filter(c => c.category === category);
                const checkedCount = colCombos.filter(c => selected.has(c.key)).length;
                return `<th><label class="flex items-center justify-center gap-1 cursor-pointer"><input id="safety-matrix-col-${colIndex}" type="checkbox" class="safety-matrix-check" ${checkedCount === colCombos.length ? 'checked' : ''} onchange="toggleSafetyMatrixCategory_('${encodeInlineArg_(category)}', this.checked)"><span>${escapeHtml_(category)}</span><span class="safety-matrix-count">${categoryTotal(category)}</span></label></th>`;
            }).join('');

            const rows = kms.map((km, rowIndex) => {
                const rowCombos = combos.filter(c => c.kmKey === km.kmKey);
                const checkedCount = rowCombos.filter(c => selected.has(c.key)).length;
                const cells = categories.map(category => {
                    const key = safetyComboKey_(km.km, category);
                    if (!available.has(key)) return '<td class="safety-matrix-unavailable">—</td>';
                    const count = comboCounts.get(key) || 0;
                    return `<td><label class="inline-flex items-center justify-center gap-1 cursor-pointer"><input type="checkbox" class="safety-matrix-check" ${selected.has(key) ? 'checked' : ''} aria-label="${escapeHtmlAttr_(`${km.kmLabel} ${category}`)}" onchange="toggleSafetyMatrixCell_('${encodeInlineArg_(key)}', this.checked)"><span class="safety-matrix-count">${count}</span></label></td>`;
                }).join('');
                return `<tr><th><label class="flex items-center gap-1 cursor-pointer"><input id="safety-matrix-row-${rowIndex}" type="checkbox" class="safety-matrix-check" ${checkedCount === rowCombos.length ? 'checked' : ''} onchange="toggleSafetyMatrixKm_('${encodeInlineArg_(km.kmKey)}', this.checked)"><span>${escapeHtml_(km.kmLabel)}</span></label></th>${cells}<th><span class="safety-matrix-count">${kmTotal(km.kmKey)}</span></th></tr>`;
            }).join('');

            const grandTotal = rosterForCounts.length;
            container.innerHTML = `<table class="safety-matrix-table"><thead><tr><th>Distance</th>${header}<th>Total</th></tr></thead><tbody>${rows}<tr><th>Total</th>${categories.map(category => `<th><span class="safety-matrix-count">${categoryTotal(category)}</span></th>`).join('')}<th><span class="safety-matrix-count">${grandTotal}</span></th></tr></tbody></table>`;
            categories.forEach((category, i) => {
                const group = combos.filter(c => c.category === category);
                const count = group.filter(c => selected.has(c.key)).length;
                const el = document.getElementById(`safety-matrix-col-${i}`);
                if (el) el.indeterminate = count > 0 && count < group.length;
            });
            kms.forEach((km, i) => {
                const group = combos.filter(c => c.kmKey === km.kmKey);
                const count = group.filter(c => selected.has(c.key)).length;
                const el = document.getElementById(`safety-matrix-row-${i}`);
                if (el) el.indeterminate = count > 0 && count < group.length;
            });
        }

        function updateSafetySortUi_() {
            const sortBy = document.getElementById('safetySortSelect')?.value || 'bib';
            const directionLabel = safetySortAscending_ ? 'Ascending' : 'Descending';
            const arrow = safetySortAscending_ ? '↑' : '↓';
            const btn = document.getElementById('safetySortDirBtn');
            if (btn) {
                btn.innerHTML = safetySortAscending_ ? '⬆️ Asc' : '⬇️ Desc';
                btn.setAttribute('aria-label', `Sort ${directionLabel.toLowerCase()}`);
            }
            const bibIndicator = document.getElementById('safetyBibSortIndicator');
            const seenIndicator = document.getElementById('safetyLastSeenSortIndicator');
            if (bibIndicator) bibIndicator.textContent = sortBy === 'bib' ? arrow : '↕';
            if (seenIndicator) seenIndicator.textContent = sortBy === 'lastSeen' ? arrow : '↕';
            const bibHeader = document.getElementById('safetyBibHeader');
            const seenHeader = document.getElementById('safetyLastSeenHeader');
            if (bibHeader) bibHeader.setAttribute('aria-sort', sortBy === 'bib' ? (safetySortAscending_ ? 'ascending' : 'descending') : 'none');
            if (seenHeader) seenHeader.setAttribute('aria-sort', sortBy === 'lastSeen' ? (safetySortAscending_ ? 'ascending' : 'descending') : 'none');
        }

        function handleSafetySortSelect_() {
            const sortBy = document.getElementById('safetySortSelect')?.value || 'bib';
            // Bib lists are easiest to scan low-to-high; recent activity is usually
            // most useful newest-first. The direction button can still reverse either.
            safetySortAscending_ = sortBy !== 'lastSeen';
            updateSafetySortUi_();
            renderSafetyLog_();
        }

        function setSafetySort_(sortBy) {
            if (!['bib', 'lastSeen'].includes(sortBy)) return;
            const select = document.getElementById('safetySortSelect');
            const current = select?.value || 'bib';
            if (select) select.value = sortBy;
            if (current === sortBy) safetySortAscending_ = !safetySortAscending_;
            else safetySortAscending_ = sortBy !== 'lastSeen';
            updateSafetySortUi_();
            renderSafetyLog_();
        }

        /** Flips the sort direction and re-renders the safety roster. */
        function toggleSafetySortDirection_() {
            safetySortAscending_ = !safetySortAscending_;
            updateSafetySortUi_();
            renderSafetyLog_();
        }

        /**
         * A bib is "overdue" if its category's cutoff time (COT, from the Setup
         * sheet) has already passed and its most recent checkpoint doesn't look
         * like a finish line. This is a heuristic safety triage signal, not a
         * certainty — a slow-but-fine runner and a runner who dropped without
         * telling anyone look identical from scan data alone, which is exactly
         * why this exists as a *filter to go check on*, not an automatic status.
         */
        function isBibOverdue_(entry) {
            if (!entry || !entry.category) return false;
            const cfg = findCategoryConfigForBib_(entry.bib, categoryConfig) || (categoryConfig || []).find(c => c.category === entry.category && canonicalKmKey_(c.km) === canonicalKmKey_(entry.km));
            if (!cfg || !cfg.cotTime) return false;
            const cotDate = parseCustomOrIsoDate(cfg.cotTime);
            if (isNaN(cotDate.getTime())) return false;
            if (Date.now() < cotDate.getTime()) return false; // cutoff hasn't passed yet
            const cp = (entry.checkpoint || '').toLowerCase();
            if (cp.includes('finish')) return false; // already finished
            return true;
        }

        function applySafetyQuickFilter_(mode) {
            safetyQuickFilter_ = mode;
            document.querySelectorAll('.safety-quick-chip').forEach(btn => {
                btn.classList.toggle('active', btn.getAttribute('data-quick-filter') === mode);
            });
            // Quick filters are a fast path, independent of the status dropdown —
            // reset it so the two don't silently fight each other.
            const statusSelect = document.getElementById('safetyStatusFilterSelect');
            if (statusSelect && mode !== 'all') statusSelect.value = '';
            renderSafetyLog_();
        }

        function loadLocalSafetyNotes_(callback) {
            if (!db || !db.objectStoreNames.contains('safetyNotes')) { callback(); return; }
            db.transaction(['safetyNotes'], 'readonly').objectStore('safetyNotes').getAll().onsuccess = function(e) {
                localSafetyNotes_ = {};
                (e.target.result || []).forEach(n => { localSafetyNotes_[n.bib] = n; });
                if (callback) callback();
            };
        }

        function resetSafetyFilters_(shouldRender = true) {
            safetyQuickFilter_ = 'all';
            safetyMatrixSelection_ = null;
            [
                'safetySearchBar',
                'safetyCheckpointFilterSelect',
                'safetyVolunteerFilterSelect',
                'safetyStatusFilterSelect'
            ].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = '';
            });
            document.querySelectorAll('.safety-quick-chip').forEach(btn => {
                btn.classList.toggle('active', btn.getAttribute('data-quick-filter') === 'all');
            });
            const viewport = document.getElementById('safetyTableViewport');
            if (viewport) {
                viewport.scrollTop = 0;
                viewport.scrollLeft = 0;
            }
            renderSafetyMatrix_();
            if (shouldRender) renderSafetyLog_();
        }

        function openSafetyLog() {
            const overlay = document.getElementById('safetyLogView');
            if (!overlay) return;
            overlay.classList.remove('hidden');
            document.body.classList.add('overflow-hidden');
            resetSafetyFilters_(false);
            updateSafetyRosterLoadState_('syncing', 'Loading every runner recorded for this event…');
            updateMonitorSyncLabels_('ready');
            loadLocalSafetyNotes_(() => renderSafetyLog_());
            loadLocalIncidents_();
            loadLocalCotAlerts_();
            renderSafetyCotAlerts_();
            if (syncUrl) {
                syncAllMonitorData_('safety', false);
                pullIncidentsFromServer_();
                pullCotAlertsFromServer_();
            }
        }

        function closeSafetyLog() {
            const overlay = document.getElementById('safetyLogView');
            if (!overlay) return;
            overlay.classList.add('hidden');
            document.body.classList.remove('overflow-hidden');
            // Discard full-event cloud mirrors only when no other monitor remains open.
            if (!isFullMonitorViewOpen_()) {
                fullMonitorDatasetResident_ = false;
                if (syncUrl && db) pullServerRecords();
            }
        }

        /** One row per unique runner, using their latest passage while retaining
         * total passage count and first-seen time for an overall event roster. */
        function buildSafetyRosterFromLogs_(logs) {
            const byBib = new Map();
            (logs || []).forEach(l => {
                if (!isCountableLog_(l)) return;
                const key = bibIdentityKey_(l);
                if (!key) return;
                const parsedTs = parseCustomOrIsoDate(l.time).getTime();
                const ts = Number.isFinite(parsedTs) ? parsedTs : 0;
                const existing = byBib.get(key);
                if (!existing) {
                    byBib.set(key, Object.assign({}, l, {
                        _ts: ts,
                        _firstTs: ts,
                        _bibKey: key,
                        _passageCount: 1
                    }));
                    return;
                }
                existing._passageCount = Number(existing._passageCount || 0) + 1;
                if (!existing._firstTs || (ts && ts < existing._firstTs)) existing._firstTs = ts;
                if (ts >= Number(existing._ts || 0)) {
                    const count = existing._passageCount;
                    const firstTs = existing._firstTs;
                    Object.assign(existing, l, {
                        _ts: ts,
                        _firstTs: firstTs,
                        _bibKey: key,
                        _passageCount: count
                    });
                }
            });
            return Array.from(byBib.values());
        }

        /** Repopulates the checkpoint/volunteer filter dropdowns from whatever values
         * actually appear in the current roster, preserving the user's current
         * selection if it's still a valid option. Called every render so a newly-seen
         * checkpoint or volunteer shows up without needing to reopen the log. */
        function refreshSafetyDropdownOptions_(selectId, values, allLabel) {
            const select = document.getElementById(selectId);
            if (!select) return;
            const current = select.value;
            const unique = Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
            select.innerHTML = `<option value="">${allLabel}</option>` +
                unique.map(v => `<option value="${v.replace(/"/g,'&quot;')}">${v}</option>`).join('');
            if (unique.includes(current)) select.value = current;
        }

        function renderSafetyLog_() {
            const body = document.getElementById('safetyLogBody');
            const emptyState = document.getElementById('safetyLogEmptyState');
            if (!body || !db) return;

            getEnrichedLogsFromDb_(function(logs) {
                let roster = buildSafetyRosterFromLogs_(logs);
                const totalRosterCount = roster.length;
                if (totalRosterCount > 0 && fullMonitorDatasetResident_) {
                    updateSafetyRosterLoadState_('ready', `${totalRosterCount} unique runners loaded from the complete event dataset.`);
                } else if (totalRosterCount > 0) {
                    updateSafetyRosterLoadState_('syncing', `${totalRosterCount} runners are visible from local/recent data while the complete event roster downloads…`);
                }

                // Keep the checkpoint/volunteer dropdown options in sync with the data
                // BEFORE reading their .value, so a just-added option isn't missed.
                refreshSafetyDropdownOptions_('safetyCheckpointFilterSelect', roster.map(r => r.checkpoint), 'All checkpoints');
                refreshSafetyDropdownOptions_('safetyVolunteerFilterSelect', roster.map(r => r.volunteer), 'All volunteers');

                const query = (document.getElementById('safetySearchBar')?.value || '').toLowerCase().trim();
                const sortBy = document.getElementById('safetySortSelect')?.value || 'bib';
                updateSafetySortUi_();
                const statusFilter = document.getElementById('safetyStatusFilterSelect')?.value || '';
                const checkpointFilter = document.getElementById('safetyCheckpointFilterSelect')?.value || '';
                const volunteerFilter = document.getElementById('safetyVolunteerFilterSelect')?.value || '';

                roster = roster.map(r => {
                    const note = localSafetyNotes_[bibIdentityKey_(r)] || localSafetyNotes_[r.bib] || null;
                    const cfg = findCategoryConfigForBib_(r.bib, categoryConfig);
                    const km = (cfg && cfg.km) || r.km || '';
                    const category = (cfg && cfg.category) || r.category || 'Uncategorized';
                    return Object.assign({}, r, {
                        km,
                        category,
                        _comboKey: safetyComboKey_(km, category),
                        _safetyStatus: note ? note.status : '',
                        _safetyRemark: note ? note.remark : '',
                        _safetyUpdatedBy: note ? note.updatedBy : '',
                        _safetyUpdatedAt: note ? note.updatedAt : ''
                    });
                });
                const routeIssueByBib = new Map();
                buildRouteValidation_(logs).forEach(issue => { if (!routeIssueByBib.has(issue.bib)) routeIssueByBib.set(issue.bib, issue.message); });
                roster = roster.map(r => Object.assign({}, r, { _routeIssue: routeIssueByBib.get(bibIdentityKey_(r)) || '' }));
                evaluateCotAlerts_(logs.filter(isCountableLog_));

                if (query) {
                    roster = roster.filter(r =>
                        (r.bib||'').toLowerCase().includes(query) ||
                        (r.bibIndicator||'').toLowerCase().includes(query) ||
                        formatKmLabel_(r.km).toLowerCase().includes(query) ||
                        (r.category||'').toLowerCase().includes(query) ||
                        (r.checkpoint||'').toLowerCase().includes(query) ||
                        (r._safetyRemark||'').toLowerCase().includes(query)
                    );
                }
                if (statusFilter === '__none__') roster = roster.filter(r => !r._safetyStatus);
                else if (statusFilter) roster = roster.filter(r => r._safetyStatus === statusFilter);
                if (checkpointFilter) roster = roster.filter(r => (r.checkpoint || '') === checkpointFilter);
                if (volunteerFilter) roster = roster.filter(r => (r.volunteer || '') === volunteerFilter);

                const matrixCountRoster = roster.slice();
                renderSafetyMatrix_(matrixCountRoster);

                if (safetyMatrixSelection_ !== null) {
                    const selectedCombos = selectedSafetyComboKeys_();
                    roster = roster.filter(r => selectedCombos.has(r._comboKey));
                }

                // Counts reflect the search box (so the badges match what "All" would show)
                // but not the quick-filter itself, so switching between chips is meaningful.
                const nowMs = Date.now();
                const missingCount = roster.filter(r => r._safetyStatus === 'missing').length;
                const medicalCount = roster.filter(r => r._safetyStatus === 'medical').length;
                const unclassifiedCount = roster.filter(r => !r._safetyStatus && !isCompletionCheckpoint_(r.checkpoint)).length;
                const staleCount = roster.filter(r => Number.isFinite(r._ts) && (nowMs - r._ts) >= 60 * 60 * 1000 && !isCompletionCheckpoint_(r.checkpoint)).length;
                const overdueCount = roster.filter(r => isBibOverdue_(r) && r._safetyStatus !== 'ok' && r._safetyStatus !== 'withdrawn').length;
                const chipCounts = {
                    safetyChipCountMissing: missingCount,
                    safetyChipCountOverdue: overdueCount,
                    safetyChipCountMedical: medicalCount,
                    safetyChipCountUnclassified: unclassifiedCount,
                    safetyChipCountStale: staleCount
                };
                Object.entries(chipCounts).forEach(([id, count]) => {
                    const el = document.getElementById(id);
                    if (el) el.textContent = count;
                });

                if (safetyQuickFilter_ === 'missing') {
                    roster = roster.filter(r => r._safetyStatus === 'missing');
                } else if (safetyQuickFilter_ === 'overdue') {
                    roster = roster.filter(r => isBibOverdue_(r) && r._safetyStatus !== 'ok' && r._safetyStatus !== 'withdrawn');
                } else if (safetyQuickFilter_ === 'medical') {
                    roster = roster.filter(r => r._safetyStatus === 'medical');
                } else if (safetyQuickFilter_ === 'unclassified') {
                    roster = roster.filter(r => !r._safetyStatus && !isCompletionCheckpoint_(r.checkpoint));
                } else if (safetyQuickFilter_ === 'stale') {
                    roster = roster.filter(r => Number.isFinite(r._ts) && (nowMs - r._ts) >= 60 * 60 * 1000 && !isCompletionCheckpoint_(r.checkpoint));
                }

                // Base comparator always sorts ascending; toggleSafetySortDirection_() flips
                // the final result rather than every branch, so "largest to smallest" works
                // consistently whether sorting by bib, category, checkpoint, or status.
                roster.sort((a, b) => {
                    switch (sortBy) {
                        case 'category':   return (a.category||'').localeCompare(b.category||'') || compareBibNumericThenIdentity_(a, b);
                        case 'checkpoint': return (a.checkpoint||'').localeCompare(b.checkpoint||'') || compareBibNumericThenIdentity_(a, b);
                        case 'status':     return (a._safetyStatus||'zzz').localeCompare(b._safetyStatus||'zzz') || compareBibNumericThenIdentity_(a, b);
                        case 'lastSeen':   return a._ts - b._ts;
                        default:           return compareBibNumericThenIdentity_(a, b);
                    }
                });
                if (!safetySortAscending_) roster.reverse();

                lastVisibleSafetyRoster_ = roster.slice();
                const downloadBtn = document.getElementById('downloadSelectedSafetyBibsBtn');
                if (downloadBtn) {
                    downloadBtn.textContent = `⬇️ Download BIBs (${lastVisibleSafetyRoster_.length})`;
                    downloadBtn.disabled = lastVisibleSafetyRoster_.length === 0;
                }

                const selectedComboCount = selectedSafetyComboKeys_().size;
                const statsRoster = matrixCountRoster;
                const accountedCount = statsRoster.filter(r => r._safetyStatus === 'ok' || r._safetyStatus === 'withdrawn' || isCompletionCheckpoint_(r.checkpoint)).length;
                const attentionCount = statsRoster.filter(r => r._safetyStatus === 'missing' || r._safetyStatus === 'medical' || (isBibOverdue_(r) && r._safetyStatus !== 'ok' && r._safetyStatus !== 'withdrawn')).length;
                const noStatusCount = statsRoster.filter(r => !r._safetyStatus && !isCompletionCheckpoint_(r.checkpoint)).length;
                const recentSeenCount = statsRoster.filter(r => Number.isFinite(r._ts) && (Date.now() - r._ts) <= 30 * 60 * 1000).length;
                const totals = {
                    safetyVisibleTotal: roster.length,
                    safetyRosterTotal: totalRosterCount,
                    safetyAccountedTotal: accountedCount,
                    safetyAttentionTotal: attentionCount,
                    safetyUnclassifiedTotal: noStatusCount,
                    safetyRecentSeenTotal: recentSeenCount,
                    safetySelectedComboTotal: selectedComboCount,
                    safetyCheckpointScopeTotal: matrixCountRoster.length,
                    safetyLastFullSync: formatMonitorSyncAge_()
                };
                Object.entries(totals).forEach(([id, value]) => {
                    const el = document.getElementById(id);
                    if (el) el.textContent = value;
                });

                if (emptyState) {
                    emptyState.classList.toggle('hidden', roster.length > 0);
                    if (!roster.length && totalRosterCount > 0) {
                        emptyState.innerHTML = `No runners match the current filters.<br><button type="button" onclick="resetSafetyFilters_()" class="mt-3 theme-input border rounded-lg px-3 py-2 text-xs font-black">Show all ${totalRosterCount} runners</button>`;
                    } else if (!roster.length) {
                        emptyState.textContent = fullMonitorDatasetResident_
                            ? 'No runner records exist in Racelog for this event.'
                            : 'No runner records are stored locally yet. The complete event roster is still loading.';
                    }
                }
                setSafetyVirtualRoster_(roster);
            });
        }

        function downloadSelectedSafetyBibs_() {
            const bibs = Array.from(new Set((lastVisibleSafetyRoster_ || [])
                .map(r => String(r.bib || '').trim().toUpperCase())
                .filter(Boolean)))
                .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
            if (!bibs.length) {
                alert('No bib numbers match the current KM/category and safety selectors.');
                return;
            }
            const blob = new Blob([bibs.join('\n') + '\n'], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            a.href = url;
            a.download = `selected-bibs-${stamp}.txt`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }

        /**
         * Sets (or updates) a bib's safety status/remark. Writes locally first
         * (instant, offline-safe) then pushes to the shared server sheet so other
         * checkpoints see it too. `status` or `remark` can be undefined to leave
         * that field unchanged (e.g. the remark's onblur fires without a new status).
         */
        function setSafetyNote_(bib, status, remark) {
            if (!db) return;
            const existing = localSafetyNotes_[bib] || { bib, status: '', remark: '', updatedBy: '', updatedAt: '' };
            const nowIso = new Date().toISOString();
            const note = {
                bib,
                status: status !== undefined ? status : existing.status,
                remark: remark !== undefined ? remark : existing.remark,
                updatedBy: (document.getElementById('volunteer')?.value || '').trim().toUpperCase() || existing.updatedBy,
                updatedAt: nowIso,
                synced: false
            };
            localSafetyNotes_[bib] = note;

            const tx = db.transaction(['safetyNotes'], 'readwrite');
            tx.objectStore('safetyNotes').put(note);
            tx.oncomplete = function() {
                renderSafetyLog_();
                pushSafetyNoteToServer_(note);
            };
        }

        function pushSafetyNoteToServer_(note) {
            if (!syncUrl) return; // offline-first: stays queued locally, synced next time a URL is configured
            fetch(`${syncUrl}${syncUrl.includes('?') ? '&' : '?'}nocache=${Date.now()}`, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ action: 'safety_update', bib: note.bib, safetyStatus: note.status, remark: note.remark, updatedBy: note.updatedBy })
            }).then(async res => {
                const data = JSON.parse(await res.text());
                if (data.status === 'success' && data.note) {
                    const confirmed = Object.assign({}, data.note, { synced: true });
                    localSafetyNotes_[confirmed.bib] = confirmed;
                    if (db) db.transaction(['safetyNotes'], 'readwrite').objectStore('safetyNotes').put(confirmed);
                    updateMonitorSyncLabels_('ready', 'Safety note synced across devices.');
                    if (isDirectorModeOpen) getEnrichedLogsFromDb_(logs => renderDirectorOperations_(logs));
                }
            }).catch(() => {
                const badge = document.getElementById('safetySyncBadge');
                if (badge) badge.title = 'A safety-note update is queued and will retry when online.';
            });
        }

        /** Pulls the shared safety register from the server and merges it in
         * (server copy wins per-bib since it's the last write across all devices,
         * unless this device has a newer local edit still pending push). */
        function pullSafetyNotesFromServer_() {
            if (!syncUrl) return;
            const badge = document.getElementById('safetySyncBadge');
            if (badge) badge.title = 'Refreshing shared SafetyNotes…';
            fetch(`${syncUrl}${syncUrl.includes('?') ? '&' : '?'}action=safety&nocache=${Date.now()}`)
                .then(async res => {
                    const data = JSON.parse(await res.text());
                    if (data.status !== 'success' || !Array.isArray(data.safetyNotes)) return;
                    if (!db) return;
                    const tx = db.transaction(['safetyNotes'], 'readwrite');
                    const store = tx.objectStore('safetyNotes');
                    data.safetyNotes.forEach(serverNote => {
                        const local = localSafetyNotes_[serverNote.bib];
                        // Keep a local edit that hasn't been confirmed synced yet.
                        if (local && local.synced === false) return;
                        const merged = Object.assign({}, serverNote, { synced: true });
                        localSafetyNotes_[serverNote.bib] = merged;
                        store.put(merged);
                    });
                    tx.oncomplete = function() {
                        updateMonitorSyncLabels_('ready', 'All Racelog pages and shared SafetyNotes are available locally.');
                        renderSafetyLog_();
                        if (isDirectorModeOpen) getEnrichedLogsFromDb_(logs => renderDirectorOperations_(logs));
                    };
                })
                .catch(() => { if (badge) badge.title = 'SafetyNotes refresh failed; local notes remain available.'; });
        }

        function renderDirectorOperations_(allLogs) {
            const container = document.getElementById('directorOperationsBody');
            if (!container) return;
            if ((!allLogs || allLogs.length === 0) && serverOperationsSummary_) {
                renderServerOperationsCards_();
                return;
            }
            if (!allLogs || allLogs.length === 0) {
                container.innerHTML = `<div class="text-center theme-text-muted text-xs">Waiting for event data.</div>`;
                setDirectorWidgetEmptyState_('operations', true);
                return;
            }
            setDirectorWidgetEmptyState_('operations', false);
            const now = Date.now();
            const countable = (allLogs || []).filter(isCountableLog_);
            const inWindow = mins => countable.filter(log => {
                const ts = parseCustomOrIsoDate(log.time).getTime();
                return Number.isFinite(ts) && now - ts >= 0 && now - ts <= mins * 60000;
            });
            const last5 = inWindow(5);
            const last15 = inWindow(15);
            const last60 = inWindow(60);

            const cpStats = new Map();
            countable.forEach(log => {
                const cp = String(log.checkpoint || 'Unspecified').trim() || 'Unspecified';
                const ts = parseCustomOrIsoDate(log.time).getTime();
                const stat = cpStats.get(cp) || { total: 0, last15: 0, lastSeen: 0 };
                stat.total++;
                if (Number.isFinite(ts)) {
                    stat.lastSeen = Math.max(stat.lastSeen, ts);
                    if (now - ts >= 0 && now - ts <= 15 * 60000) stat.last15++;
                }
                cpStats.set(cp, stat);
            });
            const busiest = Array.from(cpStats.entries()).sort((a, b) => b[1].last15 - a[1].last15 || b[1].total - a[1].total)[0];
            const quietCheckpoints = Array.from(cpStats.values()).filter(stat => stat.lastSeen && now - stat.lastSeen > 30 * 60000).length;
            const activeCheckpoints = Array.from(cpStats.values()).filter(stat => stat.lastSeen && now - stat.lastSeen <= 15 * 60000).length;

            const devices = new Map();
            countable.forEach(log => {
                const key = log.device || log.creatorId || '';
                if (!key) return;
                const ts = parseCustomOrIsoDate(log.time).getTime();
                if (Number.isFinite(ts)) devices.set(key, Math.max(devices.get(key) || 0, ts));
            });
            const activeDevices = Array.from(devices.values()).filter(ts => now - ts <= 15 * 60000).length;
            const quietDevices = Array.from(devices.values()).filter(ts => now - ts > 15 * 60000).length;

            const duplicateAuditCount = (allLogs || []).filter(isDuplicateLog_).length;
            const locationSpamCount = (allLogs || []).filter(isLocationSpamLog_).length;
            const duplicateRate = allLogs && allLogs.length ? (duplicateAuditCount / allLogs.length) * 100 : 0;
            const pending = (allLogs || []).filter(log => !log.synced && !log.pendingDelete).length;
            const synced = Math.max(0, (allLogs || []).length - pending);
            const syncCoverage = allLogs && allLogs.length ? Math.round((synced / allLogs.length) * 100) : 100;

            const roster = buildSafetyRosterFromLogs_(countable).map(r => {
                const note = localSafetyNotes_[r.bib] || {};
                const cfg = findCategoryConfigForBib_(r.bib, categoryConfig);
                return Object.assign({}, r, {
                    km: (cfg && cfg.km) || r.km || '',
                    category: (cfg && cfg.category) || r.category || 'Uncategorized',
                    _safetyStatus: note.status || ''
                });
            });
            const safetyAlerts = roster.filter(r => r._safetyStatus === 'missing' || r._safetyStatus === 'medical' || (isBibOverdue_(r) && r._safetyStatus !== 'ok' && r._safetyStatus !== 'withdrawn')).length;
            const completed = roster.filter(r => isCompletionCheckpoint_(r.checkpoint)).length;

            const cards = [
                { label: 'Arrivals 5 min', value: last5.length, sub: `${last15.length} in 15 min · ${last60.length} in 60 min` },
                { label: 'Active checkpoints', value: `${activeCheckpoints}/${cpStats.size}`, sub: quietCheckpoints ? `${quietCheckpoints} quiet for over 30 min` : 'No checkpoint quiet alerts' },
                { label: 'Busiest now', value: busiest && busiest[1].last15 ? busiest[0] : '—', sub: busiest && busiest[1].last15 ? `${busiest[1].last15} scans in 15 min` : 'No arrivals in the last 15 min' },
                { label: 'Device activity', value: `${activeDevices} active`, sub: `${quietDevices} not heard from in 15 min` },
                { label: 'Safety attention', value: safetyAlerts, sub: `${completed} runners seen at finish/start-finish` },
                { label: 'Duplicate audit', value: `${duplicateRate.toFixed(1)}%`, sub: `${duplicateAuditCount} grey duplicate records` },
                { label: 'Location spam', value: locationSpamCount, sub: locationSpamCount ? 'Outside-event GPS records excluded from calculations' : 'No outside-event GPS records' },
                { label: 'Pending upload', value: pending, sub: `${syncCoverage}% of local rows confirmed` },
                { label: 'Full data freshness', value: formatMonitorSyncAge_(), sub: `${countable.length} active scans · ${roster.length} unique runners` }
            ];
            container.innerHTML = `<div class="monitor-stat-grid">${cards.map(card => `
                <div class="monitor-stat-card">
                    <div class="monitor-label">${escapeHtml_(card.label)}</div>
                    <div class="monitor-value">${escapeHtml_(String(card.value))}</div>
                    <div class="monitor-sub">${escapeHtml_(card.sub)}</div>
                </div>`).join('')}</div>`;
        }

        function renderDirectorModeContent_(allLogs) {
            const activeLogs = (allLogs || []).filter(isCountableLog_);
            renderDirectorStats_(activeLogs);
            renderDirectorLeaderboard_(activeLogs);
            renderDirectorAtAGlance_(activeLogs, lastKnownSummaryRows);
            renderDirectorCategoryChart_(activeLogs);
            renderDirectorTicker_(activeLogs);
            renderDirectorThroughput_(activeLogs);
            renderDirectorCategoryProgress_(activeLogs, lastKnownSummaryRows);
            renderDirectorFlagged_(activeLogs);
            renderDirectorDeviceActivity_(activeLogs);
            renderDirectorGpsMap_(allLogs || []);
            renderDirectorOperations_(allLogs || []);
            renderDirectorCotCountdown_(lastKnownSummaryRows);
            renderArrivalForecast_(allLogs || []);
            renderDeviceHealthWidget_();
            renderIncidentWidget_();
            renderDataIntegrityWidget_(allLogs || []);
            evaluateCotAlerts_(activeLogs);
        }

        function renderDirectorStats_(allLogs) {
            const container = document.getElementById('directorStatTiles');
            if (!container) return;

            const uniqueRunners = new Set(allLogs.map(bibIdentityKey_).filter(Boolean)).size;
            const categories = new Set(allLogs
                .filter(l => l && l.bib)
                .map(l => resolveDirectorDistanceCategory_(l).key)).size;
            const checkpoints = new Set(allLogs.map(l => l.checkpoint).filter(Boolean)).size;
            const pending = allLogs.filter(l => !l.synced).length;
            const lastSyncLabel = lastSyncSuccessAt
                ? Math.max(0, Math.floor((Date.now() - lastSyncSuccessAt) / 1000)) + 's ago'
                : 'Never';

            const tiles = [
                { label: 'Total Logs',    value: allLogs.length,  color: 'text-blue-700 dark:text-blue-500' },
                { label: 'Unique Runners', value: uniqueRunners,  color: 'text-indigo-700 dark:text-indigo-500' },
                { label: 'Categories',    value: categories,      color: 'text-purple-700 dark:text-purple-500' },
                { label: 'Checkpoints',   value: checkpoints,     color: 'text-cyan-700 dark:text-cyan-500' },
                { label: 'Pending Sync',  value: pending,         color: pending > 0 ? 'text-yellow-600 dark:text-yellow-500' : 'text-emerald-700 dark:text-emerald-500' },
                { label: 'Last Sync',     value: lastSyncLabel,   color: 'text-neutral-700 dark:text-neutral-400', small: true }
            ];

            container.innerHTML = tiles.map(t => `
                <div class="theme-panel rounded-xl border shadow-sm px-3 py-3 sm:px-4 sm:py-4 flex flex-col gap-1">
                    <div class="text-[9px] sm:text-[10px] theme-text-muted font-black uppercase tracking-wider truncate">${t.label}</div>
                    <div class="${t.small ? 'text-sm sm:text-lg' : 'text-2xl sm:text-4xl'} font-black ${t.color} leading-none">${t.value}</div>
                </div>
            `).join('');
        }

        function toggleDirectorKmGroup_(encodedKmKey) {
            const kmKey = decodeURIComponent(encodedKmKey);
            if (directorKmExpanded_.has(kmKey)) directorKmExpanded_.delete(kmKey);
            else directorKmExpanded_.add(kmKey);
            localStorage.setItem('directorKmExpanded_v1', JSON.stringify(Array.from(directorKmExpanded_)));
            renderDirectorSummaryTable_(lastKnownSummaryRows);
        }

        function renderDirectorSummaryTable_(summaryRows) {
            const tbody = document.getElementById('directorSummaryTableBody');
            if (!tbody) return;
            if (!summaryRows || summaryRows.length === 0) {
                tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center theme-text-muted text-xs">No category configs found on server range.</td></tr>`;
                return;
            }

            getEnrichedLogsFromDb_(function(allLogs) {
                const scannedByRow = countScannedBibsByRow_(summaryRows, allLogs);
                const groups = new Map();
                let lastKm = '', lastCot = '', lastCotTime = '', lastColor = null;

                summaryRows.forEach(row => {
                    if (!row.category && !row.runners && !row.bibRule) return;
                    const displayCategory = row.category || row.bibRule || '';
                    if (displayCategory.toLowerCase().includes('total')) return;

                    let km = row.km || lastKm;
                    let cot = row.cot || lastCot;
                    let cotTime = row.cotTime || lastCotTime;
                    let colorHex = (row.color && row.color.toLowerCase() !== 'sample') ? row.color.toLowerCase() : lastColor;
                    if (row.km) lastKm = row.km;
                    if (row.cot) lastCot = row.cot;
                    if (row.cotTime) lastCotTime = row.cotTime;
                    if (row.color && row.color.toLowerCase() !== 'sample') lastColor = row.color.toLowerCase();

                    const kmKey = canonicalKmKey_(km) || String(km || 'unknown').trim().toLowerCase() || 'unknown';
                    if (!groups.has(kmKey)) groups.set(kmKey, { key: kmKey, km, rows: [], scanned: 0, registered: 0, cots: new Set(), cotTimes: new Set(), colorHex });
                    const group = groups.get(kmKey);
                    const registered = parseInt(row.runners, 10) || 0;
                    const scanned = row.bibRule && scannedByRow.has(row.bibRule) ? scannedByRow.get(row.bibRule).size : 0;
                    group.rows.push({ row, displayCategory, km, cot, cotTime, colorHex, registered, scanned });
                    group.scanned += scanned;
                    group.registered += registered;
                    if (cot) group.cots.add(String(cot));
                    if (cotTime) group.cotTimes.add(String(cotTime));
                    if (!group.colorHex && colorHex) group.colorHex = colorHex;
                });

                const groupList = Array.from(groups.values()).sort((a, b) => {
                    const an = parseFloat(a.key), bn = parseFloat(b.key);
                    if (Number.isFinite(an) && Number.isFinite(bn)) return bn - an;
                    return formatKmLabel_(a.km).localeCompare(formatKmLabel_(b.km));
                });

                let totalScanned = 0, totalRegistered = 0;
                let html = '';
                groupList.forEach(group => {
                    totalScanned += group.scanned;
                    totalRegistered += group.registered;
                    const expanded = directorKmExpanded_.has(group.key);
                    const cotValues = Array.from(group.cots);
                    const cotTimes = Array.from(group.cotTimes);
                    const cotLabel = cotValues.length === 0 ? '-' : (cotValues.length === 1 ? cotValues[0] : 'Mixed');
                    const cotTimeLabel = cotTimes.length === 0 ? '-' : (cotTimes.length === 1 ? formatDashboardDateStr(cotTimes[0]) : 'Mixed');
                    const categoryCount = group.rows.length;
                    const kmLabel = formatKmLabel_(group.km || group.key);
                    html += `
                        <tr class="director-km-group-row border-b theme-border text-neutral-900 dark:text-white bg-neutral-200/30 dark:bg-neutral-900/30" onclick="toggleDirectorKmGroup_('${encodeInlineArg_(group.key)}')" aria-expanded="${expanded}">
                            <td class="p-2 sm:p-3 pl-3" ${group.colorHex ? `style="box-shadow: inset 5px 0 0 0 ${group.colorHex};"` : ''}>
                                <button type="button" class="director-km-toggle" aria-label="${expanded ? 'Collapse' : 'Expand'} ${escapeHtmlAttr_(kmLabel)} categories">
                                    <span class="director-km-arrow">${expanded ? '▼' : '▶'}</span>
                                    <span>${escapeHtml_(kmLabel)}</span>
                                    <span class="text-[9px] theme-text-muted font-bold">${categoryCount} ${categoryCount === 1 ? 'category' : 'categories'}</span>
                                </button>
                            </td>
                            <td class="p-2 sm:p-3 text-center font-black">${escapeHtml_(group.km || '-')}</td>
                            <td class="p-2 sm:p-3 text-center font-mono font-bold text-indigo-700 dark:text-indigo-400">${categoryCount} range${categoryCount === 1 ? '' : 's'}</td>
                            <td class="p-2 sm:p-3 text-center font-mono font-bold text-amber-700 dark:text-amber-400">${escapeHtml_(cotLabel)}</td>
                            <td class="p-2 sm:p-3 text-center font-mono text-[10px] sm:text-xs">${escapeHtml_(cotTimeLabel)}</td>
                            <td class="p-2 sm:p-3 text-center font-black font-mono pr-3 text-blue-700 dark:text-cyan-400">${group.scanned}/${group.registered}</td>
                        </tr>`;

                    group.rows.forEach(item => {
                        html += `
                            <tr class="director-km-detail-row ${expanded ? '' : 'hidden'} border-b theme-border text-neutral-900 dark:text-white hover:bg-neutral-200/50 dark:hover:bg-neutral-500/10">
                                <td class="p-2 sm:p-3 pl-3 font-bold" ${item.colorHex ? `style="box-shadow: inset 3px 0 0 0 ${item.colorHex};"` : ''}>${escapeHtml_(item.displayCategory)}</td>
                                <td class="p-2 sm:p-3 text-center font-bold">${escapeHtml_(item.km || '-')}</td>
                                <td class="p-2 sm:p-3 text-center font-mono font-bold text-indigo-700 dark:text-indigo-400">${escapeHtml_(item.row.bibRule || '-')}</td>
                                <td class="p-2 sm:p-3 text-center font-mono font-bold text-amber-700 dark:text-amber-400">${escapeHtml_(item.cot || '-')}</td>
                                <td class="p-2 sm:p-3 text-center font-mono text-[10px] sm:text-xs">${escapeHtml_(formatDashboardDateStr(item.cotTime))}</td>
                                <td class="p-2 sm:p-3 text-center font-black font-mono pr-3 text-blue-700 dark:text-cyan-400">${item.scanned}/${item.registered}</td>
                            </tr>`;
                    });
                });

                html += `
                    <tr class="bg-neutral-300/80 dark:bg-neutral-900/80 font-black border-t-2 border-neutral-400 dark:border-neutral-600 text-neutral-900 dark:text-white">
                        <td class="p-2 sm:p-3 pl-3 font-black uppercase text-amber-700 dark:text-amber-400" colspan="4">Total runner</td>
                        <td class="p-2 sm:p-3 text-center">-</td>
                        <td class="p-2 sm:p-3 text-center font-black font-mono pr-3 text-blue-800 dark:text-cyan-400">${totalScanned}/${totalRegistered}</td>
                    </tr>`;
                tbody.innerHTML = html;
            });
        }

        /**
         * Convert an "hh:mm:ss"-style duration string (as produced by the spreadsheet's
         * elapsed-time formulas) into seconds. Falls back to Infinity for missing/blank
         * values so unranked runners always sort last.
         */
        function parseDurationToSeconds_(str) {
            if (!str || str === '-') return Infinity;
            const parts = String(str).trim().split(':').map(p => parseFloat(p));
            if (parts.length === 0 || parts.some(isNaN)) return Infinity;
            let seconds = 0;
            for (let i = 0; i < parts.length; i++) seconds = seconds * 60 + parts[i];
            return seconds;
        }

        /** Pull the leading lap/checkpoint count out of a lap field like "3 (00:12:34)" or "1". */
        function parseLapCount_(lapStr) {
            if (!lapStr || lapStr === '-') return 0;
            const n = parseInt(String(lapStr), 10);
            return isNaN(n) ? 0 : n;
        }

        function resolveDirectorDistanceCategory_(log) {
            const configured = log?.bib ? findCategoryConfigForBib_(log.bib, categoryConfig || []) : null;
            const rawKm = String(log?.km || '').trim();
            const rawCategory = String(log?.category || '').trim();
            const km = rawKm && rawKm !== '-' ? rawKm : String(configured?.km || '').trim();
            const category = rawCategory && rawCategory !== '-' && rawCategory.toLowerCase() !== 'uncategorized'
                ? rawCategory
                : String(configured?.category || rawCategory || 'Uncategorized').trim() || 'Uncategorized';
            return {
                km,
                category,
                key: distanceCategoryKey_(km, category),
                label: `${formatKmLabel_(km)} · ${category}`
            };
        }

        /**
         * Builds live standings from raw checkpoint logs: for each bib, keep whichever
         * logged entry represents their furthest progress (highest lap count, tie-broken
         * by the latest timestamp), then rank bibs within their category by total elapsed
         * time. This is a LIVE approximation of standings for an in-progress race, not a
         * final results list — runners who haven't reached the same checkpoint yet are
         * simply grouped into a lower progress tier within their category.
         */
        function computeLeaderboard_(allLogs) {
            const latestByBib = new Map();
            allLogs.forEach(log => {
                if (!log.bib || log.remake) return;
                const lapCount = parseLapCount_(log.lap);
                const ts = parseCustomOrIsoDate(log.time).getTime();
                const key = bibIdentityKey_(log);
                const existing = latestByBib.get(key);
                if (!existing || lapCount > existing._lapCount || (lapCount === existing._lapCount && ts > existing._ts)) {
                    latestByBib.set(key, Object.assign({}, log, { _lapCount: lapCount, _ts: ts }));
                }
            });

            const byCategory = new Map();
            latestByBib.forEach(entry => {
                const group = resolveDirectorDistanceCategory_(entry);
                const groupLabel = group.label;
                if (!byCategory.has(groupLabel)) byCategory.set(groupLabel, []);
                byCategory.get(groupLabel).push(Object.assign({}, entry, { km: group.km, category: group.category }));
            });

            byCategory.forEach(list => {
                list.sort((a, b) => {
                    if (b._lapCount !== a._lapCount) return b._lapCount - a._lapCount;
                    return parseDurationToSeconds_(a.totalTime) - parseDurationToSeconds_(b.totalTime);
                });
            });

            return byCategory;
        }

        function renderDirectorLeaderboard_(allLogs) {
            const container = document.getElementById('directorLeaderboardBody');
            if (!container) return;

            const byCategory = computeLeaderboard_(allLogs);
            if (byCategory.size === 0) {
                container.innerHTML = `<div class="text-center theme-text-muted text-sm p-6">No runner data yet — standings appear once checkpoints start logging.</div>`;
                return;
            }

            const categories = Array.from(byCategory.keys()).sort((a, b) => {
                const kmDiff = (parseFloat(b) || 0) - (parseFloat(a) || 0);
                return kmDiff || a.localeCompare(b, undefined, { numeric: true });
            });
            let html = `<div class="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3 sm:gap-4">`;
            categories.forEach(cat => {
                const fullList = byCategory.get(cat);
                const topList = fullList.slice(0, 10);
                // Gap-to-leader only makes sense between runners on the same lap/checkpoint
                // tier — someone still on lap 1 isn't "behind" the lap-3 leader by their raw
                // totalTime difference, they're behind by laps. So the gap is computed against
                // the fastest runner *within the same lap tier as the overall #1*, and left
                // blank for anyone on a different tier.
                const leaderLapCount = topList.length ? parseLapCount_(topList[0].lap) : 0;
                const leaderSeconds = topList.length ? parseDurationToSeconds_(topList[0].totalTime) : Infinity;
                html += `
                    <div class="theme-card !gap-0 !p-0 overflow-hidden">
                        <div class="px-3 py-2 bg-neutral-200/60 dark:bg-neutral-900/40 border-b theme-border flex items-center justify-between gap-2">
                            <span class="font-black text-xs sm:text-sm uppercase tracking-wide theme-text truncate">${cat}</span>
                            <span class="text-[9px] sm:text-[10px] theme-text-muted font-bold whitespace-nowrap">${fullList.length} runner${fullList.length === 1 ? '' : 's'}</span>
                        </div>
                        <table class="w-full text-left border-collapse text-[11px] sm:text-xs">
                            <thead>
                                <tr class="text-neutral-500 dark:text-neutral-400 uppercase text-[9px] sm:text-[10px] font-bold border-b theme-border">
                                    <th class="p-2 pl-3 w-8">#</th>
                                    <th class="p-2">Bib</th>
                                    <th class="p-2 text-center">Lap</th>
                                    <th class="p-2 text-center hidden sm:table-cell">Speed</th>
                                    <th class="p-2 text-center">Pace</th>
                                    <th class="p-2 text-right">Total Time</th>
                                    <th class="p-2 text-right pr-3 hidden md:table-cell">Gap</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y theme-border">
                                ${topList.map((r, i) => {
                                    const lapCount = parseLapCount_(r.lap);
                                    let gapLabel = '-';
                                    if (i === 0) {
                                        gapLabel = 'Leader';
                                    } else if (lapCount === leaderLapCount) {
                                        const diffSeconds = parseDurationToSeconds_(r.totalTime) - leaderSeconds;
                                        gapLabel = isFinite(diffSeconds) ? `+${formatDurationHMS_(diffSeconds)}` : '-';
                                    } else {
                                        gapLabel = `${lapCount - leaderLapCount} lap${Math.abs(lapCount - leaderLapCount) === 1 ? '' : 's'}`;
                                    }
                                    return `
                                    <tr class="${i === 0 ? 'bg-amber-100/50 dark:bg-amber-900/10' : ''}">
                                        <td class="p-2 pl-3 font-black ${i === 0 ? 'text-amber-600 dark:text-amber-400' : 'theme-text-muted'}">${i + 1}</td>
                                        <td class="p-2 font-black bib-text-highlight">${escapeHtml_(r.bib)} ${bibCollisionBadgeHtml_(r)}</td>
                                        <td class="p-2 text-center font-mono font-bold text-blue-700 dark:text-cyan-400">${r.lap || '-'}</td>
                                        <td class="p-2 text-center font-mono font-bold text-emerald-700 dark:text-emerald-400 hidden sm:table-cell">${(r.speed||'-').replace('*','')}</td>
                                        <td class="p-2 text-center font-mono font-bold text-indigo-700 dark:text-indigo-400">${(r.pace||'-').replace('*','')}</td>
                                        <td class="p-2 text-right font-mono font-bold">${r.totalTime || '-'}</td>
                                        <td class="p-2 text-right pr-3 font-mono font-bold text-rose-700 dark:text-rose-400 hidden md:table-cell">${gapLabel}</td>
                                    </tr>`;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>`;
            });
            html += `</div>`;
            container.innerHTML = html;
        }

        // ============================================================
        // Race Command View — the six optional widgets
        // ============================================================

        /** 📡 Live Activity Ticker — most recent scans, newest first. */
        function renderDirectorTicker_(allLogs) {
            const container = document.getElementById('directorTickerBody');
            if (!container) return;
            const recent = [...allLogs]
                .filter(l => l.bib && !l.remake)
                .sort((a, b) => parseCustomOrIsoDate(b.time) - parseCustomOrIsoDate(a.time))
                .slice(0, 30);

            if (recent.length === 0) {
                container.innerHTML = `<div class="text-center theme-text-muted text-xs">No scans yet.</div>`;
                setDirectorWidgetEmptyState_('ticker', true);
                return;
            }
            setDirectorWidgetEmptyState_('ticker', false);

            container.innerHTML = recent.map(log => `
                <div class="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg hover:bg-neutral-200/40 dark:hover:bg-neutral-800/40 text-xs">
                    <div class="flex items-center gap-2 min-w-0">
                        <span class="font-black bib-text-highlight shrink-0">${escapeHtml_(log.bib)} ${bibCollisionBadgeHtml_(log)}</span>
                        <span class="text-[10px] bg-neutral-200 dark:bg-neutral-900 border theme-border px-1.5 py-0.5 rounded font-bold theme-text-muted shrink-0">${log.checkpoint || '-'}</span>
                    </div>
                    <span class="theme-text-muted text-[10px] shrink-0 whitespace-nowrap">${formatLogTime(log.time)}</span>
                </div>
            `).join('');
        }

        /** 📶 Checkpoint Throughput — simple horizontal bar chart, no chart library needed. */
        function renderDirectorThroughput_(allLogs) {
            const container = document.getElementById('directorThroughputBody');
            if (!container) return;
            const counts = {};
            allLogs.forEach(l => {
                if (!l.checkpoint || l.remake) return;
                counts[l.checkpoint] = (counts[l.checkpoint] || 0) + 1;
            });
            const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
            if (entries.length === 0) {
                container.innerHTML = `<div class="text-center theme-text-muted text-xs">No scans yet.</div>`;
                setDirectorWidgetEmptyState_('throughput', true);
                return;
            }
            setDirectorWidgetEmptyState_('throughput', false);
            const max = entries[0][1];
            container.innerHTML = entries.map(([cp, count]) => `
                <div class="flex flex-col gap-1">
                    <div class="flex items-center justify-between text-[11px]">
                        <span class="font-bold theme-text">${cp}</span>
                        <span class="font-mono font-black text-blue-700 dark:text-cyan-400">${count}</span>
                    </div>
                    <div class="w-full h-2.5 rounded-full bg-neutral-200 dark:bg-neutral-900 overflow-hidden">
                        <div class="h-full rounded-full bg-gradient-to-r from-blue-600 to-cyan-500" style="width:${Math.max(4, (count / max) * 100)}%"></div>
                    </div>
                </div>
            `).join('');
        }

        /** 📈 Category Progress — unique bibs seen vs. registered runner count per category. */
        function renderDirectorCategoryProgress_(allLogs, summaryRows) {
            const container = document.getElementById('directorProgressBody');
            if (!container) return;
            const rows = (summaryRows || []).filter(r => r.category && !r.category.toLowerCase().includes('total'));
            if (rows.length === 0) {
                container.innerHTML = `<div class="text-center theme-text-muted text-xs">No category data yet.</div>`;
                setDirectorWidgetEmptyState_('progress', true);
                return;
            }
            setDirectorWidgetEmptyState_('progress', false);

            const scannedByRow = countScannedBibsByRow_(rows, allLogs);

            container.innerHTML = rows.map(row => {
                const registered = parseInt(row.runners, 10) || 0;
                const seen = row.bibRule && scannedByRow.has(row.bibRule) ? scannedByRow.get(row.bibRule).size : 0;
                const pct = registered > 0 ? Math.min(100, Math.round((seen / registered) * 100)) : 0;
                const label = formatDistanceCategoryLabel_(row.km, row.category);
                return `
                    <div class="flex flex-col gap-1">
                        <div class="flex items-center justify-between text-[11px]">
                            <span class="font-bold theme-text">${label}</span>
                            <span class="font-mono font-black theme-text-muted">${seen}${registered ? ' / ' + registered : ''}</span>
                        </div>
                        <div class="w-full h-2.5 rounded-full bg-neutral-200 dark:bg-neutral-900 overflow-hidden">
                            <div class="h-full rounded-full bg-gradient-to-r from-emerald-600 to-emerald-400" style="width:${registered ? pct : 4}%"></div>
                        </div>
                    </div>`;
            }).join('');
        }

        /** 🚩 Flagged Entries — remarks and REMAKE REQUIRED entries, most recent first. */
        function renderDirectorFlagged_(allLogs) {
            const container = document.getElementById('directorFlaggedBody');
            if (!container) return;
            const flagged = allLogs
                .filter(l => l.bib && (l.remake || (l.remark && l.remark.trim())))
                .sort((a, b) => parseCustomOrIsoDate(b.time) - parseCustomOrIsoDate(a.time))
                .slice(0, 30);

            if (flagged.length === 0) {
                container.innerHTML = `<div class="text-center theme-text-muted text-xs">Nothing flagged right now.</div>`;
                setDirectorWidgetEmptyState_('flagged', true);
                return;
            }
            setDirectorWidgetEmptyState_('flagged', false);

            container.innerHTML = flagged.map(log => `
                <div class="flex flex-col gap-0.5 px-2.5 py-2 rounded-lg ${log.remake ? 'bg-red-100/60 dark:bg-red-900/20' : 'bg-yellow-100/40 dark:bg-yellow-900/10'} text-xs">
                    <div class="flex items-center justify-between gap-2">
                        <span class="font-black bib-text-highlight">${escapeHtml_(log.bib)} ${bibCollisionBadgeHtml_(log)}</span>
                        <span class="text-[10px] theme-text-muted whitespace-nowrap">${formatLogTime(log.time)}</span>
                    </div>
                    <div class="flex items-center gap-1.5 flex-wrap">
                        <span class="text-[10px] bg-neutral-200 dark:bg-neutral-900 border theme-border px-1.5 py-0.5 rounded font-bold theme-text-muted">${log.checkpoint || '-'}</span>
                        ${log.remake ? `<span class="text-[10px] font-black text-red-600 dark:text-red-500 animate-pulse">REMAKE REQUIRED</span>` : ''}
                    </div>
                    ${log.remark ? `<div class="text-[11px] italic text-yellow-800 dark:text-yellow-400 mt-0.5">💬 ${log.remark}</div>` : ''}
                </div>
            `).join('');
        }

        /** 📱 Checkpoint Device Activity — last logged scan per submitting device. */
        function renderDirectorDeviceActivity_(allLogs) {
            const container = document.getElementById('directorDevicesBody');
            if (!container) return;
            const byDevice = new Map();
            allLogs.forEach(l => {
                if (!l.device) return;
                const ts = parseCustomOrIsoDate(l.time).getTime();
                const existing = byDevice.get(l.device);
                if (!existing || ts > existing.lastSeen) {
                    byDevice.set(l.device, { lastSeen: ts, count: (existing ? existing.count : 0) + 1, checkpoint: l.checkpoint });
                } else {
                    existing.count++;
                }
            });

            if (byDevice.size === 0) {
                container.innerHTML = `<div class="text-center theme-text-muted text-xs">No device activity yet.</div>`;
                setDirectorWidgetEmptyState_('devices', true);
                return;
            }
            setDirectorWidgetEmptyState_('devices', false);

            const QUIET_THRESHOLD_MS = 10 * 60 * 1000;
            const now = Date.now();
            const entries = Array.from(byDevice.entries()).sort((a, b) => b[1].lastSeen - a[1].lastSeen);

            container.innerHTML = entries.map(([device, info]) => {
                const isQuiet = (now - info.lastSeen) > QUIET_THRESHOLD_MS;
                const minsAgo = Math.floor((now - info.lastSeen) / 60000);
                const agoLabel = minsAgo < 1 ? 'just now' : minsAgo < 60 ? `${minsAgo}m ago` : `${Math.floor(minsAgo / 60)}h ago`;
                return `
                    <div class="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg border theme-border text-xs ${isQuiet ? 'bg-orange-100/40 dark:bg-orange-900/10' : ''}">
                        <div class="flex flex-col min-w-0">
                            <span class="font-bold theme-text truncate">${getDeviceLabel(device)}</span>
                            <span class="text-[10px] theme-text-muted">${info.checkpoint || '-'} • ${info.count} scans</span>
                        </div>
                        <span class="text-[10px] font-bold whitespace-nowrap ${isQuiet ? 'text-orange-600 dark:text-orange-400' : 'text-emerald-700 dark:text-emerald-500'}">${isQuiet ? '⚠️ ' : '● '}${agoLabel}</span>
                    </div>`;
            }).join('');
        }

        // Compatibility no-ops for older Apps Script/UI builds that still include
        // a mapConfig object or call the retired browser-key settings renderer.
        // v19.3.5 uses OpenStreetMap tiles and never asks race-day users for a key.
        function applyGoogleMapsConfigFromPayload_() {}
        function updateGoogleMapsSettingsState_() {}

        function clearDirectorSlippyMap_() {
            if (!directorSlippyMapInstance_) return;
            try { directorSlippyMapInstance_.destroy(); } catch (_) { /* already removed */ }
            directorSlippyMapInstance_ = null;
        }

        async function renderDirectorGpsMap_(allLogs) {
            const container = document.getElementById('directorMapBody');
            if (!container) return;
            clearDirectorSlippyMap_();

            const logsWithGps = (allLogs || []).filter(log =>
                log && !log.pendingDelete && Number.isFinite(Number(log.latitude)) && Number.isFinite(Number(log.longitude))
            );
            const byDevice = new Map();
            const getGroup = (key, fallbackPoint) => {
                if (!byDevice.has(key)) byDevice.set(key, { key, points: [], latest: fallbackPoint || null, count: 0, health: null });
                return byDevice.get(key);
            };

            logsWithGps.forEach(log => {
                const key = String(log.device || log.creatorId || `${log.checkpoint || 'Unknown'} · ${log.volunteer || 'PWA'}`).trim() || 'Unknown PWA';
                const ts = parseCustomOrIsoDate(log.time).getTime();
                const point = {
                    latitude: Number(log.latitude), longitude: Number(log.longitude),
                    accuracy: Number(log.gpsAccuracyM || log.accuracy || 0) || null,
                    checkpoint: String(log.checkpoint || 'Unspecified').trim() || 'Unspecified',
                    volunteer: String(log.volunteer || '').trim(), time: Number.isFinite(ts) ? ts : 0,
                    source: 'log'
                };
                const group = getGroup(key, point);
                group.points.push(point);
                group.count += 1;
                if (!group.latest || point.time >= group.latest.time) group.latest = point;
            });

            // DeviceHealth can be newer than the most recent BIB log. Merge its latest
            // coordinate so the map locates active PWAs even during quiet checkpoints.
            const healthDevices = Array.isArray(serverOperationsSummary_?.devices) ? serverOperationsSummary_.devices : [];
            healthDevices.forEach(device => {
                if (!Number.isFinite(Number(device?.latitude)) || !Number.isFinite(Number(device?.longitude))) return;
                const key = String(device.device || device.deviceId || `${device.checkpoint || 'Unknown'} · ${device.volunteer || 'PWA'}`).trim() || 'Unknown PWA';
                const captured = parseCustomOrIsoDate(device.gpsCapturedAt || device.lastSeen || device.lastSync || '').getTime();
                const point = {
                    latitude: Number(device.latitude), longitude: Number(device.longitude),
                    accuracy: Number(device.gpsAccuracyM || 0) || null,
                    checkpoint: String(device.checkpoint || 'Unspecified').trim() || 'Unspecified',
                    volunteer: String(device.volunteer || '').trim(), time: Number.isFinite(captured) ? captured : 0,
                    source: 'device-health'
                };
                const group = getGroup(key, point);
                group.health = device;
                const duplicatePoint = group.points.some(existing =>
                    Math.abs(existing.latitude - point.latitude) < 0.000001 &&
                    Math.abs(existing.longitude - point.longitude) < 0.000001 &&
                    Math.abs((existing.time || 0) - (point.time || 0)) < 1000
                );
                if (!duplicatePoint) group.points.push(point);
                if (!group.latest || point.time >= group.latest.time) group.latest = point;
            });

            byDevice.forEach(group => {
                group.points = group.points
                    .filter(point => Number.isFinite(point.latitude) && Number.isFinite(point.longitude))
                    .sort((a, b) => a.time - b.time)
                    .slice(-30);
                if (!group.latest && group.points.length) group.latest = group.points[group.points.length - 1];
            });

            const configured = (typeof checkpointGpsProfiles_ === 'function' ? checkpointGpsProfiles_() : [])
                .filter(profile => profile && Number.isFinite(Number(profile.latitude)) && Number.isFinite(Number(profile.longitude)))
                .map(profile => ({
                    latitude: Number(profile.latitude), longitude: Number(profile.longitude),
                    checkpoint: String(profile.checkpoint || profile.name || 'Checkpoint').trim() || 'Checkpoint',
                    source: 'configured', sampleCount: 0
                }));
            const seen = new Set();
            const checkpointPoints = configured.filter(point => {
                const key = `${point.checkpoint.toUpperCase()}|${point.latitude.toFixed(6)}|${point.longitude.toFixed(6)}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });

            // When the optional CheckpointGPS sheet is not configured, infer station
            // locations from the GPS-tagged records already captured at each CP. This
            // ensures the map still locates both PWAs and checkpoint activity with zero
            // API keys or extra race-day setup.
            const configuredNames = new Set(checkpointPoints.map(point => point.checkpoint.toUpperCase()));
            const inferredGroups = new Map();
            logsWithGps.forEach(log => {
                const checkpoint = String(log.checkpoint || '').trim();
                if (!checkpoint || /^(?:UNSPECIFIED|UNKNOWN|-)$/i.test(checkpoint)) return;
                const key = checkpoint.toUpperCase();
                if (configuredNames.has(key)) return;
                if (!inferredGroups.has(key)) inferredGroups.set(key, { checkpoint, latitudes: [], longitudes: [] });
                const group = inferredGroups.get(key);
                group.latitudes.push(Number(log.latitude));
                group.longitudes.push(Number(log.longitude));
            });
            const median = values => {
                const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
                if (!sorted.length) return null;
                const middle = Math.floor(sorted.length / 2);
                return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
            };
            inferredGroups.forEach(group => {
                const latitude = median(group.latitudes);
                const longitude = median(group.longitudes);
                if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
                checkpointPoints.push({
                    checkpoint: group.checkpoint,
                    latitude,
                    longitude,
                    source: 'inferred',
                    sampleCount: Math.min(group.latitudes.length, group.longitudes.length)
                });
            });
            const deviceGroups = Array.from(byDevice.values())
                .filter(group => group.latest)
                .sort((a, b) => (b.latest?.time || 0) - (a.latest?.time || 0));
            const allCoordinates = checkpointPoints.concat(deviceGroups.flatMap(group => group.points));
            if (!allCoordinates.length) {
                container.innerHTML = '<div class="text-center theme-text-muted text-xs p-4">No GPS coordinates have been recorded yet. Checkpoint markers appear from CheckpointGPS, and PWA markers appear after a device reports location.</div>';
                setDirectorWidgetEmptyState_('map', true);
                return;
            }
            setDirectorWidgetEmptyState_('map', false);

            const now = Date.now();
            const labelForAge = ageMs => {
                if (!Number.isFinite(ageMs)) return 'time unknown';
                const mins = Math.max(0, Math.floor(ageMs / 60000));
                if (mins < 1) return 'just now';
                if (mins < 60) return `${mins}m ago`;
                return `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
            };
            const stateForAge = ageMs => ageMs > 30 * 60000 ? 'is-quiet' : ageMs > 10 * 60000 ? 'is-stale' : '';
            const newest = deviceGroups[0]?.latest?.time || 0;
            const legend = deviceGroups.map(group => {
                const latest = group.latest;
                const ageMs = latest.time ? Math.max(0, now - latest.time) : Infinity;
                const stateClass = stateForAge(ageMs);
                const label = getDeviceLabel(group.key) || group.key;
                const sourceLabel = group.count
                    ? `${group.count} geotagged log${group.count === 1 ? '' : 's'}`
                    : 'live device-health location';
                const health = group.health || {};
                const battery = Number.isFinite(Number(health.batteryPct)) ? ` · ${Math.round(Number(health.batteryPct))}% battery` : '';
                return `<div class="director-gps-device-row"><span class="director-gps-dot ${stateClass}" aria-hidden="true"></span><div class="min-w-0"><strong class="theme-text block truncate">${escapeHtml_(label)}</strong><span class="theme-text-muted block truncate">${escapeHtml_(latest.checkpoint)}${latest.volunteer ? ` · ${escapeHtml_(latest.volunteer)}` : ''} · ${sourceLabel}${battery}</span></div><div class="text-right whitespace-nowrap"><strong class="theme-text">${escapeHtml_(labelForAge(ageMs))}</strong>${latest.accuracy ? `<span class="theme-text-muted block">±${Math.round(latest.accuracy)}m</span>` : ''}</div></div>`;
            }).join('');

            container.innerHTML = `<div class="director-gps-map-shell"><div class="director-gps-map-summary"><span>${deviceGroups.length} PWA device${deviceGroups.length === 1 ? '' : 's'} located</span><span>${logsWithGps.length} geotagged log${logsWithGps.length === 1 ? '' : 's'}</span><span>${checkpointPoints.length} checkpoint marker${checkpointPoints.length === 1 ? '' : 's'}</span><span>Newest ${newest ? escapeHtml_(labelForAge(Math.max(0, now - newest))) : 'unknown'}</span></div><div class="director-gps-map-stage"><div id="directorOpenMapCanvas" class="director-google-map-canvas director-open-map-canvas"><div class="director-map-message">Loading interactive map…</div></div></div>${legend ? `<div class="director-gps-map-legend">${legend}</div>` : ''}<p class="text-[9px] theme-text-muted leading-snug">Drag to move, pinch or use +/− to zoom, and press ◎ to show all checkpoints and PWAs. The base map uses OpenStreetMap and requires no API key. Device trails show up to the last 30 reported coordinates.</p></div>`;

            try {
                if (typeof window.RaceSlippyMap !== 'function') throw new Error('The built-in map module did not load. Refresh the PWA after deploying all v19.3.5 files.');
                const canvas = document.getElementById('directorOpenMapCanvas');
                if (!canvas || !document.body.contains(canvas)) return;
                const centerSource = deviceGroups[0]?.latest || checkpointPoints[0] || allCoordinates[0];
                directorSlippyMapInstance_ = new window.RaceSlippyMap(canvas, {
                    center: { lat: Number(centerSource.latitude), lng: Number(centerSource.longitude) },
                    zoom: 14,
                    minZoom: 2,
                    maxZoom: 19
                });

                const markers = [];
                const polylines = [];
                checkpointPoints.forEach((point, index) => {
                    markers.push({
                        id: `checkpoint-${index}`,
                        kind: 'checkpoint',
                        lat: point.latitude,
                        lng: point.longitude,
                        title: point.source === 'inferred' ? `${point.checkpoint} (inferred)` : point.checkpoint,
                        ariaLabel: `Checkpoint ${point.checkpoint}${point.source === 'inferred' ? ', inferred from recorded GPS' : ''}`,
                        popupHtml: `<strong>${escapeHtml_(point.checkpoint)}</strong><br><span>${point.source === 'inferred' ? `Inferred CP position · ${point.sampleCount || 1} GPS record${point.sampleCount === 1 ? '' : 's'}` : 'Configured checkpoint / station'}</span><br><span>${point.latitude.toFixed(6)}, ${point.longitude.toFixed(6)}</span>`
                    });
                });

                deviceGroups.forEach((group, index) => {
                    const ageMs = group.latest.time ? Math.max(0, now - group.latest.time) : Infinity;
                    const state = stateForAge(ageMs);
                    const color = state === 'is-quiet' ? '#ef4444' : state === 'is-stale' ? '#f97316' : '#22c55e';
                    const path = group.points.map(point => ({ lat: point.latitude, lng: point.longitude }));
                    if (path.length > 1) {
                        polylines.push({ id: `trail-${index}`, points: path, color, width: 4, opacity: 0.62 });
                    }
                    const latest = group.latest;
                    const label = getDeviceLabel(group.key) || group.key;
                    const health = group.health || {};
                    const battery = Number.isFinite(Number(health.batteryPct)) ? `${Math.round(Number(health.batteryPct))}%${health.charging ? ' charging' : ''}` : 'Unknown';
                    const queue = Number.isFinite(Number(health.queueCount)) ? Number(health.queueCount) : 0;
                    const online = health.online === false ? 'Offline / stale' : health.online === true ? 'Online' : 'Status unknown';
                    const lastSync = health.lastSync ? labelForAge(Math.max(0, now - parseCustomOrIsoDate(health.lastSync).getTime())) : 'Unknown';
                    markers.push({
                        id: `device-${index}`,
                        kind: 'device',
                        state,
                        color,
                        label: String(index + 1),
                        lat: latest.latitude,
                        lng: latest.longitude,
                        title: label,
                        ariaLabel: `${label}, ${latest.checkpoint}, ${labelForAge(ageMs)}`,
                        popupHtml: `<strong>${escapeHtml_(label)}</strong><br><span>${escapeHtml_(latest.checkpoint)}${latest.volunteer ? ` · ${escapeHtml_(latest.volunteer)}` : ''}</span><br><span>${escapeHtml_(online)} · GPS ${escapeHtml_(labelForAge(ageMs))}</span><br><span>Battery ${escapeHtml_(battery)} · Queue ${queue} · Last sync ${escapeHtml_(lastSync)}</span>${latest.accuracy ? `<br><span>Accuracy ±${Math.round(latest.accuracy)}m</span>` : ''}<br><span>${latest.latitude.toFixed(6)}, ${latest.longitude.toFixed(6)}</span>`
                    });
                });

                directorSlippyMapInstance_.setData({ markers, polylines });
                directorSlippyMapInstance_.fitBounds(markers.map(marker => ({ lat: marker.lat, lng: marker.lng })), 54);
            } catch (error) {
                const canvas = document.getElementById('directorOpenMapCanvas');
                if (canvas) canvas.innerHTML = `<div class="director-map-message"><div><strong class="text-red-600 dark:text-red-400">Interactive map unavailable</strong><p class="mt-1">${escapeHtml_(error?.message || 'Map failed to load.')}</p><button type="button" onclick="location.reload()">Reload app</button></div></div>`;
            }
        }

        /** ⏱️ Cutoff Countdown — grouped by KM, with the categories that share each cutoff. */
        function renderDirectorCotCountdown_(summaryRows) {
            const container = document.getElementById('directorCotBody');
            if (!container) return;
            const rows = (summaryRows || []).filter(r => r.category && r.cotTime && !r.category.toLowerCase().includes('total'));
            if (rows.length === 0) {
                container.innerHTML = `<div class="text-center theme-text-muted text-xs">No cutoff times configured.</div>`;
                setDirectorWidgetEmptyState_('cot', true);
                return;
            }
            setDirectorWidgetEmptyState_('cot', false);

            // Distance is the primary key because names such as "Men Open" can
            // legitimately appear at 100 KM, 80 KM, 21 KM, etc. Within a distance,
            // split again only when its Setup rows contain genuinely different COT times.
            const groups = new Map();
            rows.forEach(row => {
                const kmKey = canonicalKmKey_(row.km);
                if (!groups.has(kmKey)) groups.set(kmKey, { km: row.km, kmKey, cutoffs: new Map() });
                const timeKey = String(row.cotTime || '').trim();
                const group = groups.get(kmKey);
                if (!group.cutoffs.has(timeKey)) group.cutoffs.set(timeKey, { cotTime: row.cotTime, categories: [] });
                const categoryList = group.cutoffs.get(timeKey).categories;
                if (!categoryList.includes(row.category)) categoryList.push(row.category);
            });

            const now = Date.now();
            const sortedGroups = Array.from(groups.values()).sort((a, b) => (parseFloat(b.kmKey) || 0) - (parseFloat(a.kmKey) || 0));
            container.innerHTML = sortedGroups.map(group => {
                const cutoffRows = Array.from(group.cutoffs.values()).map(cutoff => {
                    const cotDate = parseCustomOrIsoDate(cutoff.cotTime);
                    let label = '-';
                    let colorClass = 'theme-text-muted';
                    if (!isNaN(cotDate.getTime())) {
                        const diffMs = cotDate.getTime() - now;
                        const passed = diffMs <= 0;
                        const diffMins = Math.abs(Math.floor(diffMs / 60000));
                        label = passed
                            ? `CUTOFF PASSED (${Math.floor(diffMins / 60)}h ${diffMins % 60}m ago)`
                            : `${Math.floor(diffMins / 60)}h ${diffMins % 60}m left`;
                        colorClass = passed ? 'text-red-600 dark:text-red-500 font-black animate-pulse'
                            : diffMins <= 10 ? 'text-red-600 dark:text-red-500 font-black'
                            : diffMins <= 30 ? 'text-amber-600 dark:text-amber-500 font-bold'
                            : 'text-emerald-700 dark:text-emerald-500';
                    }
                    return `<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 py-1.5">
                        <div class="flex flex-wrap gap-1">${cutoff.categories.sort().map(cat => `<span class="text-[9px] font-bold px-1.5 py-0.5 rounded border theme-border">${cat}</span>`).join('')}</div>
                        <span class="font-mono whitespace-nowrap text-xs ${colorClass}">${label}</span>
                    </div>`;
                }).join('');
                return `<div class="px-2.5 py-2 rounded-lg border theme-border">
                    <div class="font-black theme-text text-sm border-b theme-border pb-1 mb-1">${formatKmLabel_(group.km)}</div>
                    ${cutoffRows}
                </div>`;
            }).join('');
        }

        /** 📊 At a Glance — one consolidated summary pulling the headline number out of
         * every other widget, for anyone who just wants the gist without reading six
         * separate panels. */
        function renderDirectorAtAGlance_(allLogs, summaryRows) {
            const container = document.getElementById('directorGlanceBody');
            if (!container) return;
            const validLogs = (allLogs || []).filter(l => l.bib && !l.remake);
            if (validLogs.length === 0) {
                container.innerHTML = `<div class="text-center theme-text-muted text-xs col-span-full">No data yet.</div>`;
                setDirectorWidgetEmptyState_('glance', true);
                return;
            }
            setDirectorWidgetEmptyState_('glance', false);

            const total = validLogs.length;
            const uniqueBibs = new Set(validLogs.map(bibIdentityKey_).filter(Boolean)).size;

            const cpCounts = {};
            validLogs.forEach(l => { if (l.checkpoint) cpCounts[l.checkpoint] = (cpCounts[l.checkpoint] || 0) + 1; });
            const topCp = Object.entries(cpCounts).sort((a, b) => b[1] - a[1])[0];

            const catCounts = {};
            validLogs.forEach(l => {
                const c = resolveDirectorDistanceCategory_(l).label;
                catCounts[c] = (catCounts[c] || 0) + 1;
            });
            const topCat = Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0];

            const flaggedCount = (allLogs || []).filter(l => l.bib && (l.remake || (l.remark && l.remark.trim()))).length;

            const byDeviceLastSeen = new Map();
            (allLogs || []).forEach(l => {
                if (!l.device) return;
                const ts = parseCustomOrIsoDate(l.time).getTime();
                const existing = byDeviceLastSeen.get(l.device);
                if (!existing || ts > existing) byDeviceLastSeen.set(l.device, ts);
            });
            const now = Date.now();
            const quietCount = Array.from(byDeviceLastSeen.values()).filter(ts => (now - ts) > 10 * 60 * 1000).length;

            const cotRows = (summaryRows || []).filter(r => r.category && r.cotTime && !r.category.toLowerCase().includes('total'));
            let nearestLabel = '—';
            let nearestDiffMs = Infinity;
            cotRows.forEach(row => {
                const cotDate = parseCustomOrIsoDate(row.cotTime);
                if (isNaN(cotDate.getTime())) return;
                const diff = cotDate.getTime() - now;
                if (diff > 0 && diff < nearestDiffMs) { nearestDiffMs = diff; nearestLabel = formatKmLabel_(row.km); }
            });
            const nearestMins = isFinite(nearestDiffMs) ? Math.floor(nearestDiffMs / 60000) : null;
            const nearestDisplay = nearestMins !== null ? `${nearestLabel} · ${Math.floor(nearestMins / 60)}h ${nearestMins % 60}m` : '—';

            const tiles = [
                { label: 'Total Scans', value: total, color: 'text-blue-700 dark:text-blue-500' },
                { label: 'Unique Bibs', value: uniqueBibs, color: 'text-indigo-700 dark:text-indigo-500' },
                { label: 'Busiest CP', value: topCp ? `${topCp[0]} (${topCp[1]})` : '—', color: 'text-cyan-700 dark:text-cyan-500', small: true },
                { label: 'Top Category', value: topCat ? `${topCat[0]} (${topCat[1]})` : '—', color: 'text-purple-700 dark:text-purple-500', small: true },
                { label: 'Flagged', value: flaggedCount, color: flaggedCount > 0 ? 'text-red-600 dark:text-red-500' : 'text-emerald-700 dark:text-emerald-500' },
                { label: 'Quiet Devices', value: quietCount, color: quietCount > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-emerald-700 dark:text-emerald-500' },
                { label: 'Nearest Cutoff', value: nearestDisplay, color: 'text-amber-600 dark:text-amber-500', small: true },
            ];

            container.innerHTML = tiles.map(t => `
                <div class="theme-card !gap-0.5 !p-2.5 rounded-lg">
                    <div class="text-[9px] theme-text-muted font-black uppercase tracking-wider truncate">${t.label}</div>
                    <div class="${t.small ? 'text-xs' : 'text-lg'} font-black ${t.color} leading-tight truncate" title="${t.value}">${t.value}</div>
                </div>`).join('');
        }

        // Fixed palette cycled by index -- categories are arbitrary/user-defined names,
        // so there's no "natural" color per category the way there is for, say, pass/fail.
        const DONUT_CHART_PALETTE = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#14b8a6'];

        /**
         * Builds a donut chart as plain SVG using the standard stroke-dasharray trick
         * (no chart library needed -- keeps this self-hosted/offline-safe like
         * everything else in this app). Each segment is one full circle stroked with a
         * dasharray of [its arc length, the rest], offset by the cumulative length of
         * every segment before it; wrapping in a -90deg-rotated <g> makes the first
         * segment start at 12 o'clock instead of 3 o'clock.
         */
        function buildDonutChartSVG_(entries, size, strokeWidth) {
            size = size || 150;
            strokeWidth = strokeWidth || 26;
            const total = entries.reduce((sum, e) => sum + e.count, 0);
            if (total <= 0) return '';

            const r = (size - strokeWidth) / 2;
            const cx = size / 2, cy = size / 2;
            const circumference = 2 * Math.PI * r;
            let cumulative = 0;

            const circles = entries.map(e => {
                const arcLen = (e.count / total) * circumference;
                const dasharray = `${arcLen.toFixed(2)} ${(circumference - arcLen).toFixed(2)}`;
                const dashoffset = -cumulative;
                cumulative += arcLen;
                return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${e.color}" stroke-width="${strokeWidth}" stroke-dasharray="${dasharray}" stroke-dashoffset="${dashoffset.toFixed(2)}" />`;
            }).join('');

            return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Category breakdown donut chart">
                <g transform="rotate(-90 ${cx} ${cy})">${circles}</g>
                <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" class="donut-chart-total-label">${total}</text>
            </svg>`;
        }

        /** 🥧 Category Breakdown — a donut chart of scans by category, with a legend. */
        function renderDirectorCategoryChart_(allLogs) {
            const container = document.getElementById('directorChartBody');
            if (!container) return;
            const counts = {};
            (allLogs || []).forEach(l => {
                if (!l.bib || l.remake) return;
                const cat = resolveDirectorDistanceCategory_(l).label;
                counts[cat] = (counts[cat] || 0) + 1;
            });
            const entries = Object.entries(counts)
                .map(([label, count], i) => ({ label, count, color: DONUT_CHART_PALETTE[i % DONUT_CHART_PALETTE.length] }))
                .sort((a, b) => b.count - a.count);

            if (entries.length === 0) {
                container.innerHTML = `<div class="text-center theme-text-muted text-xs">No scans yet.</div>`;
                setDirectorWidgetEmptyState_('chart', true);
                return;
            }
            setDirectorWidgetEmptyState_('chart', false);

            const total = entries.reduce((sum, e) => sum + e.count, 0);
            const svg = buildDonutChartSVG_(entries);
            const legend = entries.map(e => `
                <div class="flex items-center justify-between gap-2 text-[11px]">
                    <div class="flex items-center gap-1.5 min-w-0">
                        <span class="w-2.5 h-2.5 rounded-sm shrink-0" style="background-color:${e.color}"></span>
                        <span class="theme-text truncate">${e.label}</span>
                    </div>
                    <span class="font-mono font-bold theme-text-muted shrink-0">${e.count} (${Math.round((e.count / total) * 100)}%)</span>
                </div>`).join('');

            container.innerHTML = `
                <div class="flex flex-col sm:flex-row items-center gap-4 w-full">
                    <div class="shrink-0">${svg}</div>
                    <div class="flex flex-col gap-1.5 w-full min-w-0">${legend}</div>
                </div>`;
        }

        function loadHistory() {
            if (!db) return;
            db.transaction(["logs"], "readonly").objectStore("logs").getAll().onsuccess = function(e) {
                // ── Compute all metrics client-side from Setup config ────────────────
                // The server sends raw scan data only; every derived field (category,
                // lap, pace, speed, projected finish) is computed here using the
                // current categoryConfig sourced from the Setup sheet.
                const rawLogs = (e.target.result || []).filter(l => !l.pendingDelete && !isAutoRemovedDuplicate_(l)).map(decorateBibIdentity_);
                const _bibMap = buildBibHistoryMap_(rawLogs);
                const _metricContext = buildMetricEstimationContext_(rawLogs, categoryConfig);
                const logs = rawLogs.map(l => withLivePreview_(l, _bibMap, categoryConfig, _metricContext));
                applyBibCollisionIndicators_(logs);
                // ────────────────────────────────────────────────────────────────────

                const query = document.getElementById('searchBar').value.toLowerCase().trim();
                const currentCP = (document.getElementById('checkpoint').value || '').trim().toUpperCase();

                let scopedLogs = [...logs];
                if (activeScopeFilter === 'current') scopedLogs = logs.filter(l => l.checkpoint.toUpperCase() === currentCP);

                const activeScopedLogs = scopedLogs.filter(isCountableLog_);
                document.getElementById('totalCount').textContent = activeScopedLogs.length;
                document.getElementById('uniqueCount').textContent = new Set(activeScopedLogs.map(bibIdentityKey_).filter(Boolean)).size;
                const categoriesTile = document.getElementById('categoriesCount');
                if (categoriesTile) categoriesTile.textContent = new Set(activeScopedLogs
                    .filter(l => l.category && l.category !== '-')
                    .map(l => distanceCategoryKey_(l.km, l.category))).size;
                const pendingTile = document.getElementById('pendingSyncCount');
                if (pendingTile) pendingTile.textContent = activeScopedLogs.filter(l => !l.synced).length;
                // This is an entry audit, not a race-total metric: show the four most
                // recent records created on this device even when one was later marked
                // duplicate or Location Spam, so the volunteer can retrace their taps.
                const thisDeviceLogs = logs.filter(isThisDeviceEntry_);
                calculateLiveSplits(thisDeviceLogs);
                updateQueueStatus();
                if (isDirectorModeOpen) renderDirectorModeContent_(logs);

                const frequencies = {}; 
                activeScopedLogs.forEach(l => { const key = bibIdentityKey_(l); frequencies[key] = (frequencies[key] || 0) + 1; });
                const logList = document.getElementById('logList'); logList.innerHTML = '';

                // IndexedDB getAll() is primary-key ordered, not event-time ordered.
                // A server pull can insert an older scan today, so explicitly sort by
                // scan timestamp to guarantee newest-to-oldest history after every sync.
                let filteredLogs = [...scopedLogs].sort(compareLogsNewestFirst_).filter(log => {
                    return log.bib.toLowerCase().includes(query) ||
                           (log.bibIndicator && log.bibIndicator.toLowerCase().includes(query)) ||
                           log.checkpoint.toLowerCase().includes(query) || 
                           (log.remark && log.remark.toLowerCase().includes(query)) ||
                           (log.category && log.category.toLowerCase().includes(query)) ||
                           (log.volunteer && log.volunteer.toLowerCase().includes(query)) ||
                           normalizedLogStatus_(log).includes(query) ||
                           (log.duplicateOfUid && log.duplicateOfUid.toLowerCase().includes(query));
                });

                const totalFilteredCount = filteredLogs.length;
                const footerToggle = document.getElementById("historyFooterOption");
                const footerLabel = document.getElementById("footerUncapButton");
                if (totalFilteredCount > SCAN_HISTORY_MAX_ROWS) {
                    filteredLogs = filteredLogs.slice(0, SCAN_HISTORY_MAX_ROWS);
                    if (footerLabel) footerLabel.textContent = `Showing newest ${SCAN_HISTORY_MAX_ROWS} of ${totalFilteredCount}. Open Runner Safety Log or Director Mode for the complete event view.`;
                    if (footerToggle) footerToggle.classList.remove('hidden');
                } else if (footerToggle) {
                    footerToggle.classList.add('hidden');
                }

                filteredLogs.forEach(log => {
                    // `log` is already enriched — withLivePreview_() ran at the top of
                    // loadHistory() over the full log set before any filtering.
                    const row = document.createElement('div');
                    const duplicateLog = isDuplicateLog_(log);
                    const locationSpamLog = isLocationSpamLog_(log);
                    row.className = 'flex flex-col border-b theme-border bg-neutral-100/0 dark:bg-neutral-500/0 hover:bg-neutral-200/50 dark:hover:bg-neutral-500/5 transition-colors duration-700';
                    if (duplicateLog) row.classList.add('duplicate-log-row');
                    if (locationSpamLog) row.classList.add('location-spam-row');
                    if (triggerScanHistorySlideFlag && log.uid === lastCreatedUid) {
                        row.classList.add('animate-scan-slide-in');
                        triggerScanHistorySlideFlag = false; // fires once, not on every future re-render
                    }
                    
                    if (editingRowId === log.id) {
                        row.innerHTML = `
                            <div class="p-4 flex flex-col gap-2">
                                <div class="flex items-center gap-2">
                                    <input type="text" id="edit-bib-${log.id}" value="${escapeHtmlAttr_(log.remake ? '' : log.bib)}" class="w-24 theme-input border rounded px-2 py-0.5 text-sm font-black uppercase">
                                    <span class="text-[10px] bg-neutral-200 dark:bg-neutral-900 border px-1.5 py-0.5 rounded text-neutral-600 dark:text-neutral-400 font-bold">${log.checkpoint}</span>
                                </div>
                                <div class="flex items-center gap-2"><input type="text" id="edit-remark-${log.id}" value="${escapeHtmlAttr_(log.remark || '')}" class="flex-grow theme-input border rounded px-2 py-0.5 text-xs"></div>
                                <div class="flex justify-end gap-2 mt-1">
                                    <button onclick="cancelEditing()" class="text-xs bg-neutral-300 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-300 px-2.5 py-1 rounded font-bold">Cancel</button>
                                    <button onclick="saveEdit(${log.id})" class="text-xs bg-blue-600 dark:bg-blue-800 text-white px-3 py-1 rounded font-bold">Save</button>
                                </div>
                            </div>`;
                    } else {
                        const remarkHTML = log.remark ? `<div class="text-[11px] text-yellow-700 dark:text-yellow-500 italic mt-0.5">💬 ${escapeHtml_(log.remark)}</div>` : '';
                        const freqBadge = frequencies[bibIdentityKey_(log)] > 1 ? `<span class="text-[10px] bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-400 border border-indigo-300 dark:border-indigo-900 px-1.5 py-0.5 rounded font-bold">${frequencies[bibIdentityKey_(log)]}x</span>` : '';
                        const collisionBadge = bibCollisionBadgeHtml_(log);
                        const duplicateBadge = duplicateLog ? `<span class="duplicate-status-badge" title="Backend-detected same-bib/same-checkpoint scan from another device. Excluded from passage and runner totals.">◻ Duplicate${log.duplicateDeviceCount ? ` • ${log.duplicateDeviceCount} devices` : ''}</span>` : '';
                        const locationSpamBadge = locationSpamLog ? `<span class="location-spam-badge" title="GPS placed this device outside the configured event area. Preserved for audit, excluded from calculations.">🚫 Location spam</span>` : '';
                        
                        const ownEntry = isOwnEntry(log);
                        const editButtonHTML = (!duplicateLog && ownEntry && (isEditable(log.time) || log.remake)) ? `<button onclick="startEditing(${log.id}); event.stopPropagation();" class="text-xs text-blue-700 dark:text-blue-500 font-bold border border-blue-400/30 dark:border-blue-600/30 px-1.5 py-0.5 rounded bg-neutral-200/50 dark:bg-neutral-900/50">✏️ Edit</button>` : '';
                        const deleteButtonHTML = (ownEntry && isDeletable(log.time)) ? `<button onclick="deleteRow(${log.id}); event.stopPropagation();" class="icon-tap-target text-red-600 p-1 text-base hover:scale-115 transition">🗑️</button>` : '';
                        let statusText = log.synced ? 'Synced' : 'Queued';
                        let statusClass = log.synced ? 'text-emerald-700 dark:text-emerald-500 font-extrabold' : 'text-yellow-700 dark:text-yellow-600 font-extrabold';
                        if (log.remake) { statusText = 'REMAKE REQ'; statusClass = 'text-red-600 dark:text-red-500 font-black animate-pulse'; }
                        if (duplicateLog) { statusText = 'DUPLICATE'; statusClass = 'text-neutral-500 dark:text-neutral-400 font-black'; }
                        if (locationSpamLog) { statusText = 'GPS SPAM'; statusClass = 'text-red-600 dark:text-red-400 font-black'; }

                        const isCurrentlyExpanded = activeExpandedUids.has(log.uid);
                        const panelExpandedClass = isCurrentlyExpanded ? 'expanded' : '';
                        const chevronExpandedClass = isCurrentlyExpanded ? 'expanded' : '';
                        
                        let basicMetricsHTML = '';
                        if (log.pace || log.speed) {
                            const isPreview = (log.pace && log.pace.includes('*')) || (log.speed && log.speed.includes('*'));
                            basicMetricsHTML = `
                                <div class="flex items-center gap-2 mt-1 text-[10px] font-mono text-neutral-700 dark:text-neutral-300 flex-wrap">
                                    ${log.pace ? `<span title="Average pace from flag-off to the configured checkpoint KM">⏱️ Avg pace: ${log.pace.replace('*','')}</span>` : ''}
                                    ${log.speed ? `<span class="text-neutral-400">|</span><span title="Average speed from flag-off to the configured checkpoint KM">⚡ Avg speed: ${log.speed.replace('*','')}</span>` : ''}
                                    ${log.metricBasis ? `<span class="metric-basis-note">• based on ${escapeHtml_(log.metricBasis)} ${log.checkpointKmEstimated ? '<span class="metric-estimated-badge">EST.</span>' : ''}</span>` : ''}
                                    ${log.nextCheckpoint ? `<span class="metric-basis-note" title="Next checkpoint from the configured route${log.nextStraightLineKm ? '; straight-line GPS distance shown separately from course distance' : ''}">→ Next ${escapeHtml_(log.nextCheckpoint)}${Number.isFinite(Number(log.nextCourseDistanceKm)) ? ` • ${escapeHtml_(log.nextCourseDistanceKm)} course km` : ''}${Number.isFinite(Number(log.nextStraightLineKm)) ? ` • ${escapeHtml_(log.nextStraightLineKm)} km straight-line` : ''}</span>` : ''}
                                    ${isPreview ? `<span class="text-neutral-400 italic" title="Legacy on-device estimate. Available scan history may still change after sync, so do not use this indicator alone for DQ or elimination decisions.">(live est.)</span>` : ''}
                                </div>`;
                        }

                        if (!basicMetricsHTML && log.metricWarning && !duplicateLog) {
                            basicMetricsHTML = `<div class="metric-inline-indicator mt-1 text-[9px] text-amber-700 dark:text-amber-400 font-semibold" title="${escapeHtmlAttr_(log.metricWarning)}">ℹ️ ${escapeHtml_(log.metricWarning)}</div>`;
                        }

                        row.innerHTML = `
                            <div onclick="inlineLogPanelAccordionToggle('${log.uid}')" class="px-4 py-3 flex justify-between items-center cursor-pointer select-none">
                                <div class="flex-grow">
                                    <div class="flex items-center gap-2 flex-wrap">
                                        <span id="chevron-indicator-${log.uid}" class="text-neutral-600 dark:text-neutral-500 text-xs chevron-rotate ${chevronExpandedClass}">▼</span>
                                        <span class="text-xl ${log.remake ? 'text-red-600 line-through opacity-60' : (duplicateLog ? 'duplicate-bib-text font-black' : 'bib-text-highlight')}">${escapeHtml_(log.bib || '??')}</span>
                                        ${collisionBadge}
                                        ${freqBadge}
                                        ${duplicateBadge}
                                        ${locationSpamBadge}
                                        <span class="text-[10px] bg-neutral-200 dark:bg-neutral-900 border px-1.5 py-0.5 rounded text-neutral-700 dark:text-neutral-400 font-bold tracking-wide">${escapeHtml_(log.checkpoint)}</span>
                                        ${log.checkpointKm ? `<span class="text-[10px] bg-blue-100 dark:bg-blue-900/40 border border-blue-300 dark:border-blue-800 px-1.5 py-0.5 rounded text-blue-700 dark:text-blue-400 font-black">${escapeHtml_(log.checkpointKm)} KM</span>` : ''}
                                    </div>
                                    <div class="text-[10px] theme-text-muted mt-0.5 font-semibold">${formatLogTime(log.time)} • By: ${escapeHtml_(log.volunteer)}</div>
                                    ${duplicateLog && log.duplicateOfUid ? `<div class="text-[9px] theme-text-muted mt-0.5 font-mono">Canonical oldest UID: ${escapeHtml_(log.duplicateOfUid)}</div>` : ''}
                                    ${basicMetricsHTML}
                                    ${remarkHTML}
                                </div>
                                <div class="text-right flex items-center gap-2.5 shrink-0">
                                    <div class="flex flex-col items-end gap-1"><span class="text-[10px] ${statusClass}">${statusText}</span>${editButtonHTML}</div>
                                    ${deleteButtonHTML}
                                </div>
                            </div>

                            <div id="accordion-panel-${log.uid}" data-uid="${log.uid}" class="collapsible-log-panel ${panelExpandedClass} px-4 bg-neutral-200/50 dark:bg-neutral-950/20 border-t border-dashed theme-border">
                                <div class="py-3 overflow-x-auto">
                                    <table class="w-full text-left border-collapse text-[10px] font-mono text-neutral-800 dark:text-neutral-300">
                                        <thead>
                                            <tr class="border-b theme-border text-neutral-600 dark:text-neutral-400 font-bold uppercase tracking-wider text-[9px]">
                                                <th class="pb-1 pr-2">Categories</th>
                                                <th class="pb-1 px-2 text-center">At KM</th>
                                                <th class="pb-1 px-2 text-center">Passage # &amp; split</th>
                                                <th class="pb-1 px-2 text-center">Time since prior passage</th>
                                                <th class="pb-1 px-2 text-center">Total time</th>
                                                <th class="pb-1 pl-2 text-right">Projected Finish time</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            <tr>
                                                <td class="py-1.5 pr-2 font-bold text-neutral-900 dark:text-white">${escapeHtml_(log.category || '-')}</td>
                                                <td class="py-1.5 px-2 text-center font-bold text-blue-700 dark:text-blue-400">${log.checkpointKm ? `${escapeHtml_(log.checkpointKm)} KM` : '-'}</td>
                                                <td class="py-1.5 px-2 text-center font-bold ${duplicateLog ? 'text-neutral-500' : 'text-blue-700 dark:text-cyan-400'}">${escapeHtml_(log.lap || '-')}</td>
                                                <td class="py-1.5 px-2 text-center text-orange-700 dark:text-orange-400 font-bold">${escapeHtml_(log.timePerLap || '-')}</td>
                                                <td class="py-1.5 px-2 text-center font-bold">${escapeHtml_(log.totalTime || '-')}</td>
                                                <td class="py-1.5 pl-2 text-right text-amber-700 dark:text-amber-400 font-bold">${escapeHtml_(log.projectedFinish || '-')}</td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        `;
                    }
                    logList.appendChild(row);
                });
            };
        }

        function deleteRow(id) {
            db.transaction(["logs"], "readonly").objectStore("logs").get(id).onsuccess = function(e) {
                const log = e.target.result;
                if (!log || !isOwnEntry(log) || log.pendingDelete) return;
                const bib = log.bib;
                const time = log.time;
                if (!confirm(`Delete entry for Bib ${bib}?`)) return;

                if (!syncUrl) {
                    // No cloud connection configured at all -- nothing to sync to, so a
                    // straight local delete is correct here.
                    const txWrite = db.transaction(["logs"], "readwrite");
                    txWrite.objectStore("logs").delete(id);
                    txWrite.oncomplete = function() { scheduleAggregateRebuild_(); loadHistory(); updateSettingsWipeCounterFootprint(); };
                    return;
                }

                // Try the fast path first: an immediate, dedicated delete request. If it
                // succeeds, every other device picks up the resulting tombstone on its next
                // regular poll -- this is the quickest way to get a delete out to everyone.
                const deleteTargetUrl = `${syncUrl}${syncUrl.includes('?') ? '&' : '?'}nocache=${Date.now()}`;

                fetchWithTimeout(deleteTargetUrl, {
                    method: "POST",
                    headers: { "Content-Type": "text/plain;charset=utf-8" },
                    body: JSON.stringify({ action: "delete", uid: log.uid, bib: bib, time: time })
                }, 15000).then(async res => {
                    const data = JSON.parse(await res.text());
                    if (data.status !== "success") throw new Error(data.message || "Delete rejected.");
                    const txWrite = db.transaction(["logs"], "readwrite");
                    txWrite.objectStore("logs").delete(id);
                    txWrite.oncomplete = function() {
                        scheduleAggregateRebuild_(); loadHistory(); updateSettingsWipeCounterFootprint();
                        if (data.summary) renderSummaryDashboard(data.summary, data.configMeta);
                    };
                }).catch(() => {
                    // Offline, timed out, or the server hiccuped -- don't just alert and
                    // drop the request. Queue it: mark this entry pendingDelete + unsynced
                    // so it's hidden immediately (see getEnrichedLogsFromDb_) and picked up
                    // by the normal batch_sync retry loop AND the service worker's
                    // background sync (fires even if this tab later closes), each of which
                    // sends { uid, status: "delete" } until the server confirms it. This is
                    // what makes deletion reliably reach every device even when the device
                    // doing the deleting was offline at the moment of the tap.
                    log.pendingDelete = true;
                    log.status = "delete";
                    log.synced = false;
                    log.remake = false;
                    const txQueue = db.transaction(["logs"], "readwrite");
                    txQueue.objectStore("logs").put(log);
                    txQueue.oncomplete = function() {
                        scheduleAggregateRebuild_();
                        loadHistory();
                        updateSettingsWipeCounterFootprint();
                        requestBackgroundSync_();
                        // Also nudge an immediate retry in case connectivity is actually fine
                        // and it was just a one-off blip (e.g. a dropped request).
                        attemptSync();
                    };
                });
            };
        }

        // NOTE: this base exportCSV() is superseded at load time by patchExportCSV_()
        // further down the file, which reassigns window.exportCSV with backup-scope
        // filtering (current CP / current device / global) plus lat/long and analytics
        // columns. This copy never actually runs -- edit patchExportCSV_() instead.
        function exportCSV() {
            // Enriched (not raw) logs: raw IndexedDB rows only hold bib/time/checkpoint/
            // volunteer/remark/device — category, passage, pace, speed, projectedFinish and
            // flagoff are all computed on the fly, so a backup built from raw rows alone
            // silently drops those columns. Using getEnrichedLogsFromDb_ bakes the computed
            // values into the file itself so it's a self-contained record even if the Setup
            // config later changes, and so it can be recalculated/audited standalone in the PWA.
            getEnrichedLogsFromDb_(function(logs) {
                if (logs.length === 0) { alert("⚠️ No logs available!"); return; }
                let csvContent = "ID,Bib,Time,Checkpoint,Volunteer,Category,Lap,TimePerLap,TotalTime,Pace,Speed,ProjectedFinish,Flagoff,Remark,Device\r\n";
                logs.forEach(l => {
                    csvContent += [
                        l.id,
                        `"${(l.bib||'')}"`,
                        `"${(l.time||'')}"`,
                        `"${(l.checkpoint||'')}"`,
                        `"${(l.volunteer||'')}"`,
                        `"${(l.category||'')}"`,
                        `"${(l.lap||'')}"`,
                        `"${(l.timePerLap||'')}"`,
                        `"${(l.totalTime||'')}"`,
                        `"${(l.pace||'')}"`,
                        `"${(l.speed||'')}"`,
                        `"${(l.projectedFinish||'')}"`,
                        `"${(l.flagoff||'')}"`,
                        `"${(l.remark||'').replace(/"/g,'""')}"`,
                        `"${getDeviceLabel(l.device)}"`,
                    ].join(',') + '\r\n';
                });
                const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a"); 
                link.setAttribute("href", url);
                link.setAttribute("download", `Race_Logs_${new Date().toISOString().split('T')[0]}.csv`);
                document.body.appendChild(link); link.click(); document.body.removeChild(link);
                setTimeout(() => URL.revokeObjectURL(url), 10000);
            });
        }

        // NOTE: exportJSON() was removed — it was not producing usable backups
        // (see the removed "📦 JSON" buttons). exportCSV() is the one confirmed-
        // working export/backup path and is what every internal safety-backup
        // call site (Start Fresh Event, stale-queue banner, storage-full
        // warning, event-epoch mismatch) now uses instead.


        function clearDatabaseFromSettings() {
            if (prompt("Type '0000' to clear log history:") !== "0000") return;
            const tx = db.transaction(["logs"], "readwrite");
            tx.objectStore("logs").clear();
            tx.oncomplete = function() { scheduleAggregateRebuild_(true); loadHistory(); alert("Storage wiped."); closeSettings(); };
        }

        /* ════════════════════════════════════════════════════════════════════
           ADMIN ZONE — Start Fresh Event
           ════════════════════════════════════════════════════════════════════
           One button, admin-token gated, that does everything a race director
           would otherwise have to do by hand in the Google Sheet before a new
           event: archive the current Racelog + SafetyNotes data to timestamped
           backup tabs, mark the old Racelog rows Deleted (values retained), reset Safety Notes, and make sure every connected
           device — not just the one that pressed the button — ends up with a
           clean local log store too.

           Safety rule: a device holding entries that haven't synced yet is NOT
           allowed to just wipe them. It's forced to export a JSON backup first,
           and has to press the button again afterwards to confirm it actually
           has nothing left to lose.
           ════════════════════════════════════════════════════════════════════ */
        const LOCAL_EVENT_EPOCH_KEY_ = 'localEventEpoch';
        const LOCAL_BULK_DELETE_EPOCH_KEY_ = 'localBulkDeleteEpoch';
        let bulkDeleteWarningShownForEpoch_ = null;

        function clearLocalLogsForBulkDelete_(newEpoch) {
            if (!db) return;
            const tx = db.transaction(['logs'], 'readwrite');
            tx.objectStore('logs').clear();
            tx.oncomplete = function() {
                scheduleAggregateRebuild_(true);
                localStorage.setItem(LOCAL_BULK_DELETE_EPOCH_KEY_, String(newEpoch));
                currentLastSyncedRowMarker = 1;
                localStorage.setItem('lastDataRowMarker', '1');
                lastCreatedUid = null;
                editingRowId = null;
                loadHistory();
            };
        }

        /**
         * Google Sheets bulk-delete keeps every Racelog value for audit and changes
         * only Status -> Deleted. A separate epoch tells each device to clear its
         * local log store immediately even though those in-place sheet edits sit below
         * the device's incremental sinceRow bookmark. SafetyNotes are deliberately not
         * touched by this action.
         */
        function handleBulkDeleteEpochFromServer_(serverEpoch) {
            if (!serverEpoch) return false;
            const epoch = String(serverEpoch);
            const localEpoch = localStorage.getItem(LOCAL_BULK_DELETE_EPOCH_KEY_);
            if (!localEpoch && epoch === '0') { localStorage.setItem(LOCAL_BULK_DELETE_EPOCH_KEY_, epoch); return false; }
            if (localEpoch === epoch) return false;
            if (bulkDeleteWarningShownForEpoch_ === epoch) return true;

            countUnsyncedLocalLogs_((unsyncedCount) => {
                if (unsyncedCount > 0) {
                    bulkDeleteWarningShownForEpoch_ = epoch;
                    alert(`⚠️ The Race Log Admin marked all sheet rows Deleted, but this device still has ${unsyncedCount} unsynced entr${unsyncedCount === 1 ? 'y' : 'ies'}. A CSV backup will download before local logs are cleared.`);
                    exportCSV('global');
                    setTimeout(() => {
                        if (confirm('Backup saved? Tap OK to remove this device\'s local race logs and match the Google Sheet. Safety Log notes will be kept.')) {
                            clearLocalLogsForBulkDelete_(epoch);
                        } else {
                            bulkDeleteWarningShownForEpoch_ = null;
                        }
                    }, 800);
                } else {
                    clearLocalLogsForBulkDelete_(epoch);
                }
            });
            return true;
        }

        function countUnsyncedLocalLogs_(callback) {
            if (!db) { callback(0); return; }
            db.transaction(['logs'], 'readonly').objectStore('logs').getAll().onsuccess = function(e) {
                const logs = e.target.result || [];
                callback(logs.filter(l => !l.synced).length);
            };
        }

        function resetRaceSpecificSetupForNewEvent_() {
            checkpointKmByRace_ = {};
            checkpointKm = '';
            categoryConfig = [];
            lastKnownSummaryRows = [];
            eventConfigMeta_ = null;
            directorKmExpanded_ = new Set();
            isSetupLocked = false;

            [
                'checkpointKmByRace_v1', 'checkpointKmVal', CHECKPOINT_MAP_CONFIG_FINGERPRINT_KEY_,
                'lastCachedSummaryRows', EVENT_CONFIG_META_STORAGE_KEY_, 'directorKmExpanded_v1',
                'checkpointVal', 'settingsLocked', 'lapMode'
            ].forEach(key => localStorage.removeItem(key));

            const checkpointInput = document.getElementById('checkpoint');
            const kmInput = document.getElementById('checkpointKmInput');
            if (checkpointInput) checkpointInput.value = '';
            if (kmInput) kmInput.value = '';
            renderCheckpointKmByRaceInputs_();
            renderEventConfigSurfaces_();
            applyLockState();
        }

        /** Clears this device's local logs + safety notes and adopts the new epoch —
         *  shared by both the admin who triggers the reset and every other device
         *  that discovers it happened on its next sync. Race-specific checkpoint
         *  mappings and cached category configuration are also reset so a new event
         *  can never silently inherit last year's KM assumptions. */
        function wipeLocalDataForNewEvent_(newEpoch) {
            if (!db) return;
            const storeNames = ['logs'];
            if (db.objectStoreNames.contains('safetyNotes')) storeNames.push('safetyNotes');
            const tx = db.transaction(storeNames, 'readwrite');
            storeNames.forEach(name => tx.objectStore(name).clear());
            tx.oncomplete = function() {
                localSafetyNotes_ = {};
                if (newEpoch) localStorage.setItem(LOCAL_EVENT_EPOCH_KEY_, newEpoch);
                // The server sheet is now much smaller than before — reset the
                // incremental pull bookmark back to the start, otherwise this device
                // stays pinned past the new (tiny) lastRow and silently never sees
                // any data logged after the reset.
                currentLastSyncedRowMarker = 1;
                localStorage.setItem("lastDataRowMarker", "1");
                resetRaceSpecificSetupForNewEvent_();
                loadHistory();
            };
        }

        async function startFreshEventFlow_() {
            const adminToken = (document.getElementById('adminTokenInput')?.value || '').trim();
            if (!adminToken) { alert('⚠️ Enter the admin token first — this action is restricted to the event admin.'); return; }
            if (!syncUrl) { alert('⚠️ No sync URL configured — connect to the Google Sheet backend first.'); return; }

            const unsyncedCount = await new Promise(resolve => countUnsyncedLocalLogs_(resolve));
            if (unsyncedCount > 0) {
                alert(`⚠️ This device has ${unsyncedCount} entr${unsyncedCount === 1 ? 'y' : 'ies'} that haven't synced to the server yet. Exporting a CSV backup now — please save it somewhere safe, then press "Start Fresh Event" again to reset the live event.`);
                exportCSV('global'); // automated safety backup — always everything, no prompt
                return;
            }

            const confirmText = prompt('This will ARCHIVE the Google Sheet, mark every Racelog row Deleted without erasing its values, reset Safety Notes, and clear the live event from every device.\n\nType START FRESH to confirm:');
            if (confirmText !== 'START FRESH') return;

            await runStartFreshEventRequest_(adminToken, null, null);
        }

        async function runStartFreshEventRequest_(adminToken, resumeAtRow, resumeArchiveName) {
            try {
                const res = await fetch(`${syncUrl}${syncUrl.includes('?') ? '&' : '?'}nocache=${Date.now()}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                    body: JSON.stringify({ action: 'start_fresh_event', adminToken, resumeAtRow, resumeArchiveName })
                });
                const data = JSON.parse(await res.text());

                if (data.status === 'error') {
                    alert(`❌ Start Fresh Event failed: ${data.message || 'Unknown error.'}`);
                    return;
                }
                if (data.status === 'partial') {
                    // Very large sheet — the server paused near its time limit. Keep
                    // calling with the resume pointers it gave us until it finishes.
                    await runStartFreshEventRequest_(adminToken, data.resumeAtRow, data.resumeArchiveName);
                    return;
                }

                // status === 'success'
                wipeLocalDataForNewEvent_(data.eventEpoch);
                document.getElementById('adminTokenInput').value = '';
                alert(`✅ Archived as "${data.archivedAs}". Live event reset — old Racelog rows remain in the sheet with Status = Deleted. Other devices will reset automatically on their next sync.`);
                closeSettings();
            } catch (err) {
                alert('❌ Connection error while starting fresh event. Nothing has been changed — try again once back online.');
            }
        }

        /**
         * Called whenever a sync response includes an eventEpoch (ping/config/
         * dashboard/data-sync all do). If it differs from what this device last
         * saw, an admin started a fresh event — possibly from a different device
         * entirely — so this one needs to clear its local copy too. Unsynced
         * entries still get the same export-first protection as the button flow.
         */
        let epochWarningShownForEpoch_ = null; // in-memory guard so the unresolved-mismatch warning doesn't refire every sync tick

        function handleEventEpochFromServer_(serverEpoch) {
            if (!serverEpoch) return;
            const localEpoch = localStorage.getItem(LOCAL_EVENT_EPOCH_KEY_);
            if (!localEpoch) { localStorage.setItem(LOCAL_EVENT_EPOCH_KEY_, serverEpoch); return; } // first run — nothing to react to
            if (localEpoch === serverEpoch) return;
            if (epochWarningShownForEpoch_ === serverEpoch) return; // already nagged this session — wait for the user to act

            countUnsyncedLocalLogs_((unsyncedCount) => {
                if (unsyncedCount > 0) {
                    epochWarningShownForEpoch_ = serverEpoch;
                    alert(`⚠️ A new event has been started on the server, but this device still has ${unsyncedCount} unsynced entr${unsyncedCount === 1 ? 'y' : 'ies'} that were created before the event reset. Exporting a CSV backup now — please save it somewhere safe.`);
                    exportCSV('global'); // automated safety backup — always everything, no prompt
                    // No admin token needed here — the destructive server-side action
                    // already happened elsewhere; this device is just catching up.
                    // Give the download a moment to actually start before asking.
                    setTimeout(() => {
                        if (confirm('Backup saved? Tap OK to clear this device\'s local log history and match the new event. Tap Cancel to keep it a little longer (you\'ll be asked again on the next sync).')) {
                            wipeLocalDataForNewEvent_(serverEpoch);
                        }
                    }, 800);
                } else {
                    wipeLocalDataForNewEvent_(serverEpoch);
                }
            });
        }

        /* ════════════════════════════════════════════════════════════════════
           RUNNER PERFORMANCE ANALYTICS ENGINE  (v2 — enhanced)
           ════════════════════════════════════════════════════════════════════

           Architecture overview
           ─────────────────────
           All analytics are computed on-device from the local IndexedDB log
           store. No server round-trip is needed; the engine reads the same
           transaction the main loadHistory() already opened and derives its
           metrics from a read-only snapshot of the logs array.

           Public entry-points
           ────────────────────
           • buildPerformanceAnalytics_(logs, currentCP)
               Master orchestrator. Called by the patched loadHistory hook
               with the full logs array AFTER IndexedDB returns. Passes
               `currentCP` so zone stats are scoped to the active checkpoint.

           • togglePerfAnalytics()
               Collapse/expand the panel. Persists state to localStorage.

           Helpers (internal, prefixed _)
           ────────────────────────────────
           • parsePaceToSeconds_(str)          "MM:SS/km" → integer seconds
           • parseSpeedToFloat_(str)           "X.XX km/h" → float
           • classifyPaceZone_(paceSeconds)    → {id, label, icon, barColor, textColor, bgColor}
           • aggregatePaceZones_(logs)         → Map<zoneId, count>
           • calcThroughput_(logs, windowMin)  → { rate, count }
           • calcAvgSpeed_(logs)               → float | null
           • topNByPace_(logs, n)              → log[] sorted fastest first
           • buildSparklineBuckets_(logs, buckets, windowMin)
               → int[buckets] — arrival counts per equal-width time slice
           • renderPaceZoneChart_(logs)        → void (mutates DOM)
           • renderStatCards_(logs)            → void (mutates DOM)
           • renderArrivalSparkline_(logs)     → void (mutates DOM)
           • renderFastestRunners_(logs)       → void (mutates DOM)
           • renderCotRisk_(logs, summaryRows) → void (mutates DOM)

           Pace-zone thresholds
           ─────────────────────
           The five zones reflect broadly accepted amateur trail-running paces:
               Elite    < 4:30 /km   (sub-4h30 for 60 km — race-front runners)
               Fast     4:30–6:00    (competitive mid-pack trail pace)
               Moderate 6:00–8:00    (steady aerobic — majority of field)
               Steady   8:00–12:00   (back-of-pack / walking sections)
               Walk     > 12:00      (mostly walking, power-hiking)

           ════════════════════════════════════════════════════════════════════ */

        /* ── State ── */
        const storedPerfCollapse_ = localStorage.getItem('perfAnalyticsCollapsed');
        let perfAnalyticsCollapsed_ = storedPerfCollapse_ === null
            ? ((Number(navigator.deviceMemory || 0) > 0 && Number(navigator.deviceMemory) <= 4) || window.innerWidth < 700)
            : storedPerfCollapse_ === 'true';

        /* ── Initialise collapsed state on load ── */
        (function initPerfPanelCollapse_() {
            if (perfAnalyticsCollapsed_) {
                const content = document.getElementById('perfAnalyticsContent');
                const arrow   = document.getElementById('perfAnalyticsArrow');
                if (content) { content.classList.add('collapsed'); content.style.maxHeight = '0'; }
                if (arrow)   arrow.style.transform = 'rotate(180deg)';
            }
        })();

        /* ─────────────────────────────────────────────────────────────────
           togglePerfAnalytics  — public, called from HTML onclick
           ───────────────────────────────────────────────────────────────── */
        function togglePerfAnalytics() {
            perfAnalyticsCollapsed_ = !perfAnalyticsCollapsed_;
            localStorage.setItem('perfAnalyticsCollapsed', String(perfAnalyticsCollapsed_));
            const content = document.getElementById('perfAnalyticsContent');
            const arrow   = document.getElementById('perfAnalyticsArrow');
            if (!content) return;
            if (perfAnalyticsCollapsed_) {
                content.style.maxHeight = content.scrollHeight + 'px';
                requestAnimationFrame(() => {
                    content.style.maxHeight = '0';
                    content.style.paddingTop = '0';
                    content.style.paddingBottom = '0';
                    content.classList.add('collapsed');
                });
                if (arrow) arrow.style.transform = 'rotate(180deg)';
            } else {
                // The .collapsed CSS class carries `max-height:0 !important`, which
                // beats any inline style we set below — it MUST come off first or
                // the panel silently stays pinned shut (this was the "expansion not
                // working" bug: the class was added on load/collapse but never
                // removed again on expand).
                content.classList.remove('collapsed');
                content.style.maxHeight = content.scrollHeight + 'px';
                content.style.paddingTop = '';
                content.style.paddingBottom = '';
                if (arrow) arrow.style.transform = 'rotate(0deg)';
                setTimeout(() => { content.style.maxHeight = 'none'; }, 320);
                // Analytics are not calculated while collapsed on phones. Build them
                // once when the user explicitly opens the panel.
                setTimeout(() => loadHistory(), 0);
            }
        }

        /* ─────────────────────────────────────────────────────────────────
           parsePaceToSeconds_  — "7:45" or "7:45/km" → 465 (seconds)
                                  Returns Infinity for unparseable input.
           ───────────────────────────────────────────────────────────────── */
        function parsePaceToSeconds_(str) {
            if (!str || typeof str !== 'string') return Infinity;
            // Strip any trailing unit labels, asterisks, or whitespace
            const cleaned = str.replace(/[*/].*$/, '').replace(/[^0-9:]/g, '').trim();
            if (!cleaned) return Infinity;
            const parts = cleaned.split(':');
            if (parts.length < 2) return Infinity;
            const mins = parseInt(parts[0], 10);
            const secs = parseInt(parts[1], 10);
            if (isNaN(mins) || isNaN(secs)) return Infinity;
            return mins * 60 + secs;
        }

        /* ─────────────────────────────────────────────────────────────────
           parseSpeedToFloat_  — "12.34 km/h" or "12.34*" → 12.34
                                  Returns null for unparseable input.
           ───────────────────────────────────────────────────────────────── */
        function parseSpeedToFloat_(str) {
            if (!str || typeof str !== 'string') return null;
            const match = str.match(/([0-9]+(?:\.[0-9]+)?)/);
            if (!match) return null;
            const n = parseFloat(match[1]);
            return isNaN(n) ? null : n;
        }

        /* ─────────────────────────────────────────────────────────────────
           classifyPaceZone_  — seconds → zone descriptor object
           ───────────────────────────────────────────────────────────────── */
        function classifyPaceZone_(paceSeconds) {
            if (!isFinite(paceSeconds) || paceSeconds <= 0) {
                return { id: 'unknown', label: 'Unknown', icon: '❓',
                         barColor: 'var(--border-color)', textColor: 'var(--text-muted)',
                         bgColor: 'transparent' };
            }
            if (paceSeconds < 270) {           // < 4:30
                return { id: 'elite',    label: 'Elite',    icon: '🔴',
                         barColor: 'var(--zone-elite-bar)',    textColor: 'var(--zone-elite-text)',
                         bgColor: 'var(--zone-elite-bg)' };
            } else if (paceSeconds < 360) {    // 4:30 – 6:00
                return { id: 'fast',     label: 'Fast',     icon: '🟠',
                         barColor: 'var(--zone-fast-bar)',     textColor: 'var(--zone-fast-text)',
                         bgColor: 'var(--zone-fast-bg)' };
            } else if (paceSeconds < 480) {    // 6:00 – 8:00
                return { id: 'moderate', label: 'Moderate', icon: '🟡',
                         barColor: 'var(--zone-moderate-bar)', textColor: 'var(--zone-moderate-text)',
                         bgColor: 'var(--zone-moderate-bg)' };
            } else if (paceSeconds < 720) {    // 8:00 – 12:00
                return { id: 'steady',   label: 'Steady',   icon: '🟢',
                         barColor: 'var(--zone-steady-bar)',   textColor: 'var(--zone-steady-text)',
                         bgColor: 'var(--zone-steady-bg)' };
            } else {                           // > 12:00
                return { id: 'walk',     label: 'Walk',     icon: '🔵',
                         barColor: 'var(--zone-walk-bar)',     textColor: 'var(--zone-walk-text)',
                         bgColor: 'var(--zone-walk-bg)' };
            }
        }

        /* ─────────────────────────────────────────────────────────────────
           aggregatePaceZones_  — returns an ordered array of zone buckets
           ───────────────────────────────────────────────────────────────── */
        function aggregatePaceZones_(logs) {
            const ZONE_ORDER = ['elite', 'fast', 'moderate', 'steady', 'walk'];
            const counts = {};
            ZONE_ORDER.forEach(z => { counts[z] = 0; });
            let validCount = 0;

            logs.forEach(log => {
                if (!log.pace || log.remake) return;
                const secs = parsePaceToSeconds_(log.pace);
                if (!isFinite(secs) || secs <= 0) return;
                const zone = classifyPaceZone_(secs);
                if (zone.id !== 'unknown') { counts[zone.id]++; validCount++; }
            });

            return { zones: ZONE_ORDER.map(id => ({ id, count: counts[id] })), total: validCount };
        }

        /* ─────────────────────────────────────────────────────────────────
           calcThroughput_  — arrivals-per-hour based on logs within windowMin
           Returns { rate: number (bibs/h), count: number } or null
           ───────────────────────────────────────────────────────────────── */
        function calcThroughput_(logs, windowMin) {
            if (!logs || logs.length === 0) return null;
            const nowMs  = Date.now();
            const cutoff = nowMs - windowMin * 60 * 1000;
            let count = 0;
            logs.forEach(log => {
                if (log.remake) return;
                try {
                    const t = new Date(log.time).getTime();
                    if (!isNaN(t) && t >= cutoff) count++;
                } catch (e) { /* skip unparseable timestamps */ }
            });
            if (count === 0) return { rate: 0, count: 0 };
            const rate = Math.round((count / windowMin) * 60);
            return { rate, count };
        }

        /* ─────────────────────────────────────────────────────────────────
           calcAvgSpeed_  — mean speed (km/h) across logs with speed data
           ───────────────────────────────────────────────────────────────── */
        function calcAvgSpeed_(logs) {
            let total = 0, n = 0;
            logs.forEach(log => {
                if (log.remake) return;
                const s = parseSpeedToFloat_(log.speed);
                if (s !== null && s > 0 && s < 50) { total += s; n++; }
            });
            return n > 0 ? total / n : null;
        }

        /* ─────────────────────────────────────────────────────────────────
           calcAvgPaceSeconds_  — mean pace (seconds/km) across logs
           ───────────────────────────────────────────────────────────────── */
        function calcAvgPaceSeconds_(logs) {
            let total = 0, n = 0;
            logs.forEach(log => {
                if (log.remake) return;
                const s = parsePaceToSeconds_(log.pace);
                if (isFinite(s) && s > 0 && s < 7200) { total += s; n++; }
            });
            return n > 0 ? total / n : null;
        }

        /* ─────────────────────────────────────────────────────────────────
           formatSecondsAsPace_  — 425 → "7:05"
           ───────────────────────────────────────────────────────────────── */
        function formatSecondsAsPace_(totalSecs) {
            if (!isFinite(totalSecs) || totalSecs <= 0) return '--:--';
            const mins = Math.floor(totalSecs / 60);
            const secs = Math.round(totalSecs % 60);
            return `${mins}:${String(secs).padStart(2, '0')}`;
        }

        /* ─────────────────────────────────────────────────────────────────
           topNByPace_  — sorted fastest-to-slowest, returns top n logs
           ───────────────────────────────────────────────────────────────── */
        function topNByPace_(logs, n) {
            return logs
                .filter(log => !log.remake && log.pace)
                .map(log => ({ log, paceSeconds: parsePaceToSeconds_(log.pace) }))
                .filter(item => isFinite(item.paceSeconds) && item.paceSeconds > 0)
                .sort((a, b) => a.paceSeconds - b.paceSeconds)
                .slice(0, n)
                .map(item => item.log);
        }

        /* ─────────────────────────────────────────────────────────────────
           buildSparklineBuckets_  — divides last `windowMin` minutes into
           `buckets` equal-width slots and counts arrivals in each.
           Returns an array of integers, index 0 = oldest, last = newest.
           ───────────────────────────────────────────────────────────────── */
        function buildSparklineBuckets_(logs, buckets, windowMin) {
            const nowMs       = Date.now();
            const windowMs    = windowMin * 60 * 1000;
            const bucketMs    = windowMs / buckets;
            const counts      = new Array(buckets).fill(0);

            logs.forEach(log => {
                if (log.remake) return;
                try {
                    const t = new Date(log.time).getTime();
                    if (isNaN(t)) return;
                    const age = nowMs - t;
                    if (age < 0 || age > windowMs) return;
                    const bucket = Math.min(buckets - 1, Math.floor((windowMs - age) / bucketMs));
                    counts[bucket]++;
                } catch (e) { /* skip */ }
            });
            return counts;
        }

        /* ─────────────────────────────────────────────────────────────────
           renderPaceZoneChart_  — draws the 5-zone horizontal-bar breakdown
           ───────────────────────────────────────────────────────────────── */
        function renderPaceZoneChart_(logs) {
            const container = document.getElementById('paceZoneChart');
            const totalEl   = document.getElementById('paceZoneTotalLabel');
            if (!container) return;

            const { zones, total } = aggregatePaceZones_(logs);

            if (totalEl) totalEl.textContent = total > 0 ? `${total} runner${total !== 1 ? 's' : ''}` : '– runners';

            if (total === 0) {
                container.innerHTML = '<div style="text-align:center;padding:0.75rem 0;font-size:0.625rem;color:var(--text-muted);">No pace data yet — log some bibs first</div>';
                return;
            }

            const ZONE_META = {
                elite:    { label: 'Elite',    icon: '🔴' },
                fast:     { label: 'Fast',     icon: '🟠' },
                moderate: { label: 'Moderate', icon: '🟡' },
                steady:   { label: 'Steady',   icon: '🟢' },
                walk:     { label: 'Walk',      icon: '🔵' },
            };

            container.innerHTML = zones.map(({ id, count }) => {
                const zone = classifyPaceZone_(id === 'elite' ? 200 : id === 'fast' ? 300 : id === 'moderate' ? 400 : id === 'steady' ? 600 : 800);
                const meta = ZONE_META[id] || { label: id, icon: '⚪' };
                const pct  = total > 0 ? Math.round((count / total) * 100) : 0;
                return `
                    <div class="pace-zone-row">
                        <span class="pace-zone-icon">${meta.icon}</span>
                        <span class="pace-zone-label" style="color:${zone.textColor};">${meta.label}</span>
                        <div class="pace-zone-bar-track">
                            <div class="pace-zone-bar-fill" style="width:${pct}%;background:${zone.barColor};"></div>
                        </div>
                        <span class="pace-zone-count" style="color:${zone.textColor};">${count}</span>
                        <span class="pace-zone-pct">${pct > 0 ? pct + '%' : ''}</span>
                    </div>`;
            }).join('');

            // Show the live badge
            const badge = document.getElementById('perfLiveBadge');
            if (badge && total > 0) badge.classList.remove('hidden');
        }

        /* ─────────────────────────────────────────────────────────────────
           renderStatCards_  — fills in the five metric stat cards
           ───────────────────────────────────────────────────────────────── */
        function renderStatCards_(logs) {
            /* Throughput */
            const tpData = calcThroughput_(logs, 60); // last 60 minutes
            const tpEl   = document.getElementById('perfThroughputRate');
            const dotEl  = document.getElementById('throughputIndicator');
            if (tpEl) {
                tpEl.textContent = tpData && tpData.count > 0 ? String(tpData.rate) : '--';
                tpEl.classList.add('stat-animate');
                setTimeout(() => tpEl.classList.remove('stat-animate'), 350);
            }
            if (dotEl) {
                dotEl.classList.toggle('inactive', !tpData || tpData.count === 0);
            }

            /* Average speed */
            const avgSpeedEl = document.getElementById('perfAvgSpeed');
            if (avgSpeedEl) {
                const spd = calcAvgSpeed_(logs);
                avgSpeedEl.textContent = spd !== null ? spd.toFixed(1) : '--';
            }

            /* Best & slowest pace */
            const sorted = logs
                .filter(l => !l.remake && l.pace)
                .map(l => ({ log: l, s: parsePaceToSeconds_(l.pace) }))
                .filter(x => isFinite(x.s) && x.s > 0)
                .sort((a, b) => a.s - b.s);

            const bestEl   = document.getElementById('perfBestPace');
            const bestBib  = document.getElementById('perfBestPaceBib');
            const slowEl   = document.getElementById('perfSlowestPace');
            const slowBib  = document.getElementById('perfSlowestBib');
            const avgPaceEl = document.getElementById('perfAvgPace');

            if (sorted.length > 0) {
                if (bestEl)  bestEl.textContent  = formatSecondsAsPace_(sorted[0].s);
                if (bestBib) bestBib.textContent = `Bib ${sorted[0].log.bib || '?'} — min/km`;
                const last = sorted[sorted.length - 1];
                if (slowEl)  slowEl.textContent  = formatSecondsAsPace_(last.s);
                if (slowBib) slowBib.textContent = `Bib ${last.log.bib || '?'} — min/km`;
            } else {
                if (bestEl)  bestEl.textContent  = '--:--';
                if (bestBib) bestBib.textContent  = 'min/km';
                if (slowEl)  slowEl.textContent  = '--:--';
                if (slowBib) slowBib.textContent  = 'min/km';
            }

            const avgSecs = calcAvgPaceSeconds_(logs);
            if (avgPaceEl) avgPaceEl.textContent = avgSecs ? formatSecondsAsPace_(avgSecs) : '--:--';
        }

        /* ─────────────────────────────────────────────────────────────────
           renderArrivalSparkline_  — draws the 12-bucket bar chart SVG
           Bucket width: 5 min each → covers 60 min total.
           ───────────────────────────────────────────────────────────────── */
        function renderArrivalSparkline_(logs) {
            const svgEl = document.getElementById('activitySparklineSVG');
            if (!svgEl) return;

            const BUCKETS   = 12;
            const WINDOW    = 60; // minutes
            const W = 360, H = 56;
            const PAD_L = 0, PAD_R = 0, PAD_T = 4, PAD_B = 4;
            const chartW = W - PAD_L - PAD_R;
            const chartH = H - PAD_T - PAD_B;
            const BAR_GAP = 2;

            const counts = buildSparklineBuckets_(logs, BUCKETS, WINDOW);
            const maxCount = Math.max(...counts, 1);

            if (counts.every(c => c === 0)) {
                svgEl.innerHTML = `
                    <rect width="${W}" height="${H}" fill="transparent"/>
                    <text class="sparkline-empty-label" x="${W/2}" y="${H/2 + 4}" text-anchor="middle" font-size="10" fill="var(--text-muted)" font-family="ui-sans-serif,sans-serif" font-weight="600">Log bibs to see arrival rate</text>`;
                return;
            }

            const barW = (chartW / BUCKETS) - BAR_GAP;

            // Color bars: recent = brighter blue, old = dimmer
            const bars = counts.map((count, i) => {
                const x    = PAD_L + i * (chartW / BUCKETS) + BAR_GAP / 2;
                const barH = chartH * (count / maxCount);
                const y    = PAD_T + chartH - barH;
                const alpha = 0.35 + (i / (BUCKETS - 1)) * 0.65; // fade from old→new
                const fill = `rgba(59,130,246,${alpha.toFixed(2)})`;
                const label = count > 0
                    ? `<text x="${x + barW/2}" y="${y - 2}" text-anchor="middle" font-size="7" fill="var(--text-muted)" font-weight="700" font-family="ui-monospace,monospace">${count}</text>`
                    : '';
                return `
                    <rect class="sparkline-bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" rx="2" fill="${fill}"/>
                    ${label}`;
            }).join('');

            // Baseline
            const baseline = `<line x1="${PAD_L}" y1="${H - PAD_B}" x2="${W - PAD_R}" y2="${H - PAD_B}" stroke="var(--border-color)" stroke-width="1"/>`;

            svgEl.innerHTML = `
                <rect width="${W}" height="${H}" fill="transparent"/>
                ${baseline}
                ${bars}`;
        }

        /* ─────────────────────────────────────────────────────────────────
           renderFastestRunners_  — renders the top-5 fastest-pace runners
           ───────────────────────────────────────────────────────────────── */
        function renderFastestRunners_(logs) {
            const container = document.getElementById('fastestRunnersList');
            if (!container) return;

            const top = topNByPace_(logs, 5);

            if (top.length === 0) {
                container.innerHTML = '<div style="text-align:center;padding:0.5rem 0;font-size:0.625rem;color:var(--text-muted);">No pace data yet</div>';
                return;
            }

            // Slowest pace among the top N (for relative bar width scaling)
            const maxPaceSecs = Math.max(...top.map(l => parsePaceToSeconds_(l.pace)));

            const RANK_CLASSES = ['gold', 'silver', 'bronze', '', ''];
            const RANK_ICONS   = ['🥇', '🥈', '🥉', '4.', '5.'];

            container.innerHTML = top.map((log, i) => {
                const pSecs   = parsePaceToSeconds_(log.pace);
                const zone    = classifyPaceZone_(pSecs);
                const paceStr = formatSecondsAsPace_(pSecs);
                const speedStr= log.speed ? parseSpeedToFloat_(log.speed)?.toFixed(1) + ' km/h' : '';
                const barPct  = maxPaceSecs > 0 ? Math.max(10, Math.round(100 - (pSecs / maxPaceSecs) * 85)) : 10;
                const catLabel= (log.category || '').slice(0, 8).toUpperCase() || 'N/A';
                return `
                    <div class="fastest-runner-row">
                        <span class="fastest-runner-rank ${RANK_CLASSES[i]}">${RANK_ICONS[i]}</span>
                        <span class="fastest-runner-bib">${escapeHtml_(log.bib || '?')} ${bibCollisionBadgeHtml_(log)}</span>
                        <span class="fastest-runner-cat">${catLabel}</span>
                        <div class="fastest-runner-bar">
                            <div class="fastest-runner-bar-fill" style="width:${barPct}%;background:${zone.barColor};"></div>
                        </div>
                        <span class="fastest-runner-pace" style="color:${zone.textColor};">${paceStr}</span>
                        ${speedStr ? `<span class="fastest-runner-speed">${speedStr}</span>` : ''}
                    </div>`;
            }).join('');
        }

        /* ─────────────────────────────────────────────────────────────────
           renderCotRisk_  — show runners whose projected finish > COT
           `summaryRows` comes from the last known server sync payload.
           ───────────────────────────────────────────────────────────────── */
        function renderCotRisk_(logs, summaryRows) {
            const section = document.getElementById('cotRiskSection');
            const list    = document.getElementById('cotRiskList');
            if (!section || !list) return;

            if (!summaryRows || summaryRows.length === 0) {
                section.classList.add('hidden');
                section.style.display = '';
                return;
            }

            // Resolve COT by the bib rule, not category name. Category labels such as
            // "MEN OPEN" legitimately repeat across different distances (for example
            // 100 KM and 80 KM), so a category-only map can silently apply the wrong
            // cutoff. Setup bib ranges are the authoritative dynamic KM/category key.
            const cotConfigRows = summaryRows.filter(row => row && row.bibRule && row.cot);
            if (cotConfigRows.length === 0) {
                section.classList.add('hidden');
                section.style.display = '';
                return;
            }

            const riskyRunners = [];
            logs.forEach(log => {
                if (log.remake || !log.projectedFinish || !log.bib) return;
                const cfg = findCategoryConfigForBib_(log.bib, cotConfigRows);
                const cotStr = cfg && cfg.cot;
                if (!cotStr) return;

                // Parse "HH:MM" or "H:MM" COT duration
                const parseDuration = s => {
                    const parts = (s || '').split(':').map(Number);
                    if (parts.length < 2 || parts.some(isNaN)) return null;
                    return parts[0] * 60 + parts[1]; // total minutes
                };

                const cotMins  = parseDuration(cotStr);
                const projMins = parseDuration(
                    (log.projectedFinish || '').replace(/[^0-9:]/g, '').trim()
                );
                if (cotMins === null || projMins === null || projMins <= 0) return;

                const overBy = projMins - cotMins; // positive = at risk
                if (overBy > -20) { // flag if within 20 mins of cutoff or already over
                    riskyRunners.push({ log, cfg, cotMins, projMins, overBy });
                }
            });

            // Sort: most at-risk (largest overBy) first
            riskyRunners.sort((a, b) => b.overBy - a.overBy);

            if (riskyRunners.length === 0) {
                section.classList.add('hidden');
                section.style.display = '';
                return;
            }

            section.classList.remove('hidden');
            section.style.display = 'flex';

            list.innerHTML = riskyRunners.slice(0, 8).map(({ log, cfg, projMins, cotMins, overBy }) => {
                const isCritical = overBy >= 0;
                const cls        = isCritical ? 'critical' : 'warning';
                const badge      = isCritical
                    ? `<span class="cot-risk-badge-critical">Over COT</span>`
                    : `<span class="cot-risk-badge-warning">${Math.round(Math.abs(overBy))}m left</span>`;
                const projStr    = `${Math.floor(projMins / 60)}h${String(Math.round(projMins % 60)).padStart(2, '0')}m`;
                const cotStr2    = `${Math.floor(cotMins / 60)}h${String(Math.round(cotMins % 60)).padStart(2, '0')}m`;
                return `
                    <div class="cot-risk-row ${cls}">
                        <span class="cot-risk-bib">${log.bib || '?'}</span>
                        <span class="cot-risk-label">Proj ${projStr} · COT ${cotStr2} · ${formatKmLabel_(cfg.km)} · ${(cfg.category || log.category || '').toUpperCase()}</span>
                        ${badge}
                    </div>`;
            }).join('');
        }

        /* ─────────────────────────────────────────────────────────────────
           buildPerformanceAnalytics_  — master orchestrator
           Called by the loadHistory hook with the full logs array.
           `currentCP` is the currently-active checkpoint name (uppercased).
           ───────────────────────────────────────────────────────────────── */
        function buildPerformanceAnalytics_(allLogs, currentCP) {
            allLogs = (allLogs || []).filter(isCountableLog_);
            // Skip if panel doesn't exist or is collapsed. This avoids doing
            // pace charts and leaderboards on every scan when a phone user is not
            // looking at the analytics panel.
            if (!document.getElementById('perfAnalyticsPanel') || perfAnalyticsCollapsed_) return;

            // Filter to current checkpoint only for most metrics
            // (global scope is set by the existing activeScopeFilter toggle)
            const scopedLogs = (currentCP && activeScopeFilter === 'current')
                ? allLogs.filter(l => (l.checkpoint || '').toUpperCase() === currentCP.toUpperCase())
                : allLogs;

            // Run all renderers
            renderPaceZoneChart_(scopedLogs);
            renderStatCards_(scopedLogs);
            renderArrivalSparkline_(scopedLogs);
            renderFastestRunners_(scopedLogs);

            // COT risk uses the last known summary rows from server sync
            try {
                const lastSummary = localStorage.getItem('lastCachedSummaryRows');
                const summaryRows = lastSummary ? JSON.parse(lastSummary) : [];
                renderCotRisk_(scopedLogs, summaryRows);
            } catch (e) { /* ignore parse errors */ }
        }

        /* ─────────────────────────────────────────────────────────────────
           Hook buildPerformanceAnalytics_ into the existing loadHistory
           function. We wrap the original function so the analytics panel
           updates automatically every time the history list is refreshed
           (on every bib log, sync, search, or scope change).

           Strategy: store a reference to the original loadHistory, then
           replace it with a wrapper that calls the original and afterwards
           reads the DB once more to feed the analytics engine.
           ───────────────────────────────────────────────────────────────── */
        (function patchLoadHistoryForAnalytics_() {
            // We run after DOMContentLoaded so loadHistory is already defined.
            // Use a 100ms debounce so rapid repeated calls collapse to one render.
            let analyticsDebounce_ = null;
            const scheduleAnalytics_ = () => {
                if (analyticsDebounce_) clearTimeout(analyticsDebounce_);
                analyticsDebounce_ = setTimeout(() => {
                    analyticsDebounce_ = null;
                    if (!db || perfAnalyticsCollapsed_) return;
                    const currentCP = (document.getElementById('checkpoint')?.value || '').trim().toUpperCase();
                    try {
                        // Use the enriched logs (category/pace/speed/etc. computed),
                        // not a raw getAll() — raw records don't carry those fields,
                        // which is why this panel used to report "no data".
                        getEnrichedLogsFromDb_(function(logs) {
                            buildPerformanceAnalytics_(logs, currentCP);
                        });
                    } catch (err) { /* DB not open yet */ }
                }, 120);
            };

            // Intercept every call once. A top-level function declaration creates a
            // non-configurable property on Window in Chromium, so trying to redefine it
            // with Object.defineProperty throws and stops the rest of the app script.
            // A normal assignment is sufficient and keeps the original arguments/`this`.
            const originalLoadHistory = window.loadHistory;
            window.loadHistory = function() {
                originalLoadHistory.apply(this, arguments);
                scheduleAnalytics_();
            };

            // Also trigger analytics after the page's own DOMContentLoaded fires
            document.addEventListener('DOMContentLoaded', () => {
                setTimeout(scheduleAnalytics_, 600);
            });
        })();

        /* ════════════════════════════════════════════════════════════════════
           END OF RUNNER PERFORMANCE ANALYTICS ENGINE
           ════════════════════════════════════════════════════════════════════ */

        /* ════════════════════════════════════════════════════════════════════
           EXTENDED ANALYTICS MODULE — Checkpoint Comparison & Trend Analysis
           ════════════════════════════════════════════════════════════════════

           This module provides additional analytics beyond the core panel:

           1. Cross-checkpoint comparison — compare pace/speed distributions
              across all checkpoints seen in the log store, so a race director
              can quickly see whether a particular segment is slow (terrain,
              aid station congestion, hot sun on a south-facing ridge, etc.).

           2. Performance trend per bib — given enough checkpoints for a single
              bib number, reconstruct that runner's full split progression: are
              they fading (pace slowing each lap), holding steady, or even
              negative-splitting? Displayed in the director mode leaderboard
              accordion on demand.

           3. Category performance comparison — for each category group, show
              the distribution of paces so a race director can compare 21K vs
              42K vs 100K field performance at the same checkpoint.

           4. Race time predictor — given a runner's current pace at checkpoint
              N, project their full-course finish time using a fatigue model
              (pace degrades ~3–7% per remaining segment, configurable). The
              resulting estimate is shown alongside the server-computed
              projectedFinish for cross-validation.

           5. Arrival wave detection — identifies "pelotons" (clusters of bibs
              that passed a checkpoint within a short window of each other),
              useful for staffing decisions at aid stations.

           ════════════════════════════════════════════════════════════════════ */

        /* ─────────────────────────────────────────────────────────────────
           getCheckpointSet_  — returns a Set of all unique checkpoint names
           seen in the given log array (uppercased).
           ───────────────────────────────────────────────────────────────── */
        function getCheckpointSet_(logs) {
            const s = new Set();
            logs.forEach(l => { if (l.checkpoint) s.add(l.checkpoint.toUpperCase()); });
            return s;
        }

        /* ─────────────────────────────────────────────────────────────────
           groupLogsByCheckpoint_  — { 'CP1': [log, …], 'CP2': [log, …] }
           ───────────────────────────────────────────────────────────────── */
        function groupLogsByCheckpoint_(logs) {
            const map = {};
            logs.forEach(l => {
                const cp = (l.checkpoint || 'UNKNOWN').toUpperCase();
                if (!map[cp]) map[cp] = [];
                map[cp].push(l);
            });
            return map;
        }

        /* ─────────────────────────────────────────────────────────────────
           groupLogsByBib_  — { '1234': [log, …], '5678': [log, …] }
           Only includes bibs with at least `minLogs` entries.
           ───────────────────────────────────────────────────────────────── */
        function groupLogsByBib_(logs, minLogs) {
            const minCount = minLogs || 1;
            const map = {};
            logs.forEach(l => {
                const bib = bibIdentityKey_(l);
                if (!bib) return;
                if (!map[bib]) map[bib] = [];
                map[bib].push(l);
            });
            // Filter to bibs with enough entries
            Object.keys(map).forEach(bib => {
                if (map[bib].length < minCount) delete map[bib];
            });
            return map;
        }

        /* ─────────────────────────────────────────────────────────────────
           calcCpPaceSummary_  — for each checkpoint, return
           { cp, count, avgPaceSecs, medianPaceSecs, fastestSecs, slowestSecs }
           ───────────────────────────────────────────────────────────────── */
        function calcCpPaceSummary_(logs) {
            const byCP = groupLogsByCheckpoint_(logs);
            return Object.entries(byCP).map(([cp, cpLogs]) => {
                const paceSecs = cpLogs
                    .filter(l => !l.remake && l.pace)
                    .map(l => parsePaceToSeconds_(l.pace))
                    .filter(s => isFinite(s) && s > 0)
                    .sort((a, b) => a - b);
                if (paceSecs.length === 0) {
                    return { cp, count: cpLogs.length, avgPaceSecs: null, medianPaceSecs: null, fastestSecs: null, slowestSecs: null };
                }
                const sum = paceSecs.reduce((a, b) => a + b, 0);
                const mid = Math.floor(paceSecs.length / 2);
                return {
                    cp,
                    count:          cpLogs.length,
                    avgPaceSecs:    sum / paceSecs.length,
                    medianPaceSecs: paceSecs.length % 2 === 0
                                        ? (paceSecs[mid - 1] + paceSecs[mid]) / 2
                                        : paceSecs[mid],
                    fastestSecs:    paceSecs[0],
                    slowestSecs:    paceSecs[paceSecs.length - 1],
                    p25:            paceSecs[Math.floor(paceSecs.length * 0.25)] || paceSecs[0],
                    p75:            paceSecs[Math.floor(paceSecs.length * 0.75)] || paceSecs[paceSecs.length - 1],
                };
            }).sort((a, b) => (a.cp < b.cp ? -1 : a.cp > b.cp ? 1 : 0));
        }

        /* ─────────────────────────────────────────────────────────────────
           getBibSplitTrend_  — for a single bib, return its pace-per-CP
           sequence sorted by log timestamp, so fade/negative-split can be shown.
           Returns null if fewer than 2 checkpoints recorded.
           ───────────────────────────────────────────────────────────────── */
        function getBibSplitTrend_(logs, bib) {
            const bibLogs = logs
                .filter(l => (l.bib || '').toUpperCase() === bib.toUpperCase() && !l.remake && l.pace)
                .map(l => ({ cp: (l.checkpoint || '').toUpperCase(), time: new Date(l.time).getTime(), paceSecs: parsePaceToSeconds_(l.pace) }))
                .filter(x => isFinite(x.time) && isFinite(x.paceSecs) && x.paceSecs > 0)
                .sort((a, b) => a.time - b.time);
            if (bibLogs.length < 2) return null;
            return bibLogs;
        }

        /* ─────────────────────────────────────────────────────────────────
           classifyTrend_  — given a sequence of pace values (ascending order
           = chronological), return 'fading' | 'steady' | 'negative-splitting'
           using linear regression slope direction.
           ───────────────────────────────────────────────────────────────── */
        function classifyTrend_(paceSecsArray) {
            if (!paceSecsArray || paceSecsArray.length < 2) return 'unknown';
            const n = paceSecsArray.length;
            let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
            paceSecsArray.forEach((y, x) => { sumX += x; sumY += y; sumXY += x * y; sumX2 += x * x; });
            const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
            if (Math.abs(slope) < 15) return 'steady';         // < 15 sec/segment drift → steady
            return slope > 0 ? 'fading' : 'negative-splitting'; // positive slope = getting slower
        }

        /* ─────────────────────────────────────────────────────────────────
           detectArrivalWaves_  — finds clusters of bibs that passed a given
           checkpoint within `gapMinutes` of each other.
           Returns an array of wave objects:
           { startTime, endTime, bibs: [] }
           ───────────────────────────────────────────────────────────────── */
        function detectArrivalWaves_(cpLogs, gapMinutes) {
            const gap = (gapMinutes || 5) * 60 * 1000; // ms
            const sorted = cpLogs
                .filter(l => !l.remake)
                .map(l => ({ bib: l.bib, t: new Date(l.time).getTime() }))
                .filter(x => !isNaN(x.t))
                .sort((a, b) => a.t - b.t);

            if (sorted.length === 0) return [];

            const waves = [];
            let currentWave = { startTime: sorted[0].t, endTime: sorted[0].t, bibs: [sorted[0].bib] };

            for (let i = 1; i < sorted.length; i++) {
                const item = sorted[i];
                if (item.t - sorted[i - 1].t <= gap) {
                    // Still in same wave
                    currentWave.endTime = item.t;
                    currentWave.bibs.push(item.bib);
                } else {
                    // Gap detected — close this wave, start a new one
                    if (currentWave.bibs.length >= 2) waves.push({ ...currentWave });
                    currentWave = { startTime: item.t, endTime: item.t, bibs: [item.bib] };
                }
            }
            if (currentWave.bibs.length >= 2) waves.push(currentWave);
            return waves.sort((a, b) => b.bibs.length - a.bibs.length); // largest wave first
        }

        /* ─────────────────────────────────────────────────────────────────
           predictFinishTime_  — fatigue-model race time predictor.
           
           Given:
             startPaceSecs  — the runner's current pace (s/km)
             remainingKm    — distance remaining from current checkpoint
             fatigueRate    — expected pace degradation per remaining km
                              (default 0.004 = 0.4% slower per km remaining)
           
           Returns the predicted total finish time in minutes, or null.
           
           Model: the runner's pace for each future segment is estimated as
               segPace = currentPace × (1 + fatigueRate)^(segIndex)
           where segIndex counts from the current position. We integrate
           these segment times over the remaining distance.
           
           This is intentionally simple — the goal is a plausible directional
           estimate for the race director, not a competition-grade predictor.
           ───────────────────────────────────────────────────────────────── */
        function predictFinishTime_(startPaceSecs, remainingKm, fatigueRate) {
            if (!startPaceSecs || !remainingKm || startPaceSecs <= 0 || remainingKm <= 0) return null;
            const fr = fatigueRate !== undefined ? fatigueRate : 0.004;
            let totalSeconds = 0;
            const SEG_KM = 1.0; // integrate in 1 km segments
            let paceAtSeg = startPaceSecs;
            let kmLeft = remainingKm;
            let seg = 0;
            while (kmLeft > 0) {
                const segSize = Math.min(SEG_KM, kmLeft);
                totalSeconds += paceAtSeg * segSize;
                kmLeft -= segSize;
                seg++;
                paceAtSeg = startPaceSecs * Math.pow(1 + fr, seg);
            }
            return totalSeconds / 60; // return minutes
        }

        /* ─────────────────────────────────────────────────────────────────
           calcCategoryStats_  — returns per-category aggregated metrics
           { category, count, avgPace, medianPace, paceSpread, avgSpeed }
           Used by director mode's category comparison chart.
           ───────────────────────────────────────────────────────────────── */
        function calcCategoryStats_(logs) {
            const byCat = {};
            logs.forEach(l => {
                if (l.remake || !l.category) return;
                const cat = formatDistanceCategoryLabel_(l.km, l.category).toUpperCase();
                if (!byCat[cat]) byCat[cat] = { paces: [], speeds: [], count: 0 };
                byCat[cat].count++;
                const ps = parsePaceToSeconds_(l.pace);
                if (isFinite(ps) && ps > 0) byCat[cat].paces.push(ps);
                const sp = parseSpeedToFloat_(l.speed);
                if (sp !== null && sp > 0) byCat[cat].speeds.push(sp);
            });

            return Object.entries(byCat).map(([category, data]) => {
                data.paces.sort((a, b) => a - b);
                const mid = Math.floor(data.paces.length / 2);
                const avgPace = data.paces.length > 0
                    ? data.paces.reduce((a, b) => a + b, 0) / data.paces.length : null;
                const medPace = data.paces.length > 0
                    ? (data.paces.length % 2 === 0 ? (data.paces[mid-1]+data.paces[mid])/2 : data.paces[mid])
                    : null;
                const spread = data.paces.length > 1
                    ? data.paces[data.paces.length-1] - data.paces[0] : 0;
                const avgSpeed = data.speeds.length > 0
                    ? data.speeds.reduce((a, b) => a + b, 0) / data.speeds.length : null;
                return { category, count: data.count, avgPaceSecs: avgPace, medianPaceSecs: medPace,
                         paceSpreadSecs: spread, avgSpeed };
            }).sort((a, b) => (a.category < b.category ? -1 : 1));
        }

        /* ─────────────────────────────────────────────────────────────────
           renderCheckpointComparisonInDirector_
           Renders a cross-checkpoint pace comparison table into the
           director mode "At a Glance" widget body when director mode is open.
           Called by the analytics hook whenever director mode is visible.
           ───────────────────────────────────────────────────────────────── */
        function renderCheckpointComparisonInDirector_(logs) {
            // Only render if director mode is currently open
            if (!isDirectorModeOpen) return;

            const glanceBody = document.getElementById('directorGlanceBody');
            if (!glanceBody) return;

            const cpSummaries = calcCpPaceSummary_(logs);
            if (cpSummaries.length === 0) {
                glanceBody.innerHTML = '<div class="text-center theme-text-muted text-xs p-4 col-span-full">No data yet.</div>';
                return;
            }

            // Build the cross-checkpoint comparison table
            const tableHTML = `
                <div class="overflow-x-auto col-span-full rounded-lg border theme-border">
                    <table class="w-full text-left border-collapse text-[10px] font-mono">
                        <thead>
                            <tr style="background:var(--th-bg);" class="text-neutral-900 dark:text-white font-black border-b theme-border uppercase tracking-wider text-[9px]">
                                <th class="p-2 pl-3">Checkpoint</th>
                                <th class="p-2 text-center">Scans</th>
                                <th class="p-2 text-center">Avg Pace</th>
                                <th class="p-2 text-center">Median</th>
                                <th class="p-2 text-center">Best</th>
                                <th class="p-2 text-center pr-3">P25–P75</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y theme-border">
                            ${cpSummaries.map(s => {
                                const avgZone = s.avgPaceSecs ? classifyPaceZone_(s.avgPaceSecs) : null;
                                return `
                                    <tr class="hover:bg-neutral-200/30 dark:hover:bg-neutral-800/30 transition-colors">
                                        <td class="p-2 pl-3 font-bold theme-text text-[10px]">${s.cp}</td>
                                        <td class="p-2 text-center text-blue-700 dark:text-cyan-400 font-bold">${s.count}</td>
                                        <td class="p-2 text-center font-bold" style="color:${avgZone ? avgZone.textColor : 'var(--text-muted)'};">
                                            ${s.avgPaceSecs ? formatSecondsAsPace_(s.avgPaceSecs) : '–'}
                                        </td>
                                        <td class="p-2 text-center text-neutral-700 dark:text-neutral-300 font-semibold">
                                            ${s.medianPaceSecs ? formatSecondsAsPace_(s.medianPaceSecs) : '–'}
                                        </td>
                                        <td class="p-2 text-center text-emerald-700 dark:text-emerald-400 font-bold">
                                            ${s.fastestSecs ? formatSecondsAsPace_(s.fastestSecs) : '–'}
                                        </td>
                                        <td class="p-2 text-center pr-3 text-neutral-600 dark:text-neutral-400 text-[9px]">
                                            ${s.p25 && s.p75 ? formatSecondsAsPace_(s.p25) + ' – ' + formatSecondsAsPace_(s.p75) : '–'}
                                        </td>
                                    </tr>`;
                            }).join('')}
                        </tbody>
                    </table>
                </div>`;

            // Also add category breakdown below the table
            const catStats = calcCategoryStats_(logs);
            const catHTML = catStats.length > 0 ? `
                <div class="col-span-full">
                    <div class="text-[9px] font-bold theme-text-muted uppercase tracking-wider mb-2 mt-1">Category Performance Summary</div>
                    <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1.5">
                        ${catStats.map(c => {
                            const zone = c.avgPaceSecs ? classifyPaceZone_(c.avgPaceSecs) : null;
                            return `
                                <div class="rounded-lg border theme-border p-2 text-center" style="background:${zone ? zone.bgColor : 'var(--card-tint)'};">
                                    <div class="text-[9px] font-black theme-text uppercase tracking-wide">${c.category}</div>
                                    <div class="text-sm font-black mt-0.5" style="color:${zone ? zone.textColor : 'var(--text-main)'};">
                                        ${c.avgPaceSecs ? formatSecondsAsPace_(c.avgPaceSecs) : '–'}
                                    </div>
                                    <div class="text-[8px] theme-text-muted">${c.count} runner${c.count !== 1 ? 's' : ''} avg pace</div>
                                    ${c.avgSpeed ? `<div class="text-[8px] font-bold text-emerald-700 dark:text-emerald-400">${c.avgSpeed.toFixed(1)} km/h avg</div>` : ''}
                                </div>`;
                        }).join('')}
                    </div>
                </div>` : '';

            glanceBody.innerHTML = tableHTML + catHTML;
        }

        /* ─────────────────────────────────────────────────────────────────
           renderWaveDetectionInDirector_
           Identifies arrival waves (pelotons) and shows them as an
           informational notice in the throughput widget.
           ───────────────────────────────────────────────────────────────── */
        function renderWaveDetectionInDirector_(logs) {
            if (!isDirectorModeOpen) return;
            const throughputBody = document.getElementById('directorThroughputBody');
            if (!throughputBody) return;

            const byCP = groupLogsByCheckpoint_(logs);
            const wavesByCP = {};
            Object.entries(byCP).forEach(([cp, cpLogs]) => {
                const waves = detectArrivalWaves_(cpLogs, 5); // 5-minute gap
                if (waves.length > 0) wavesByCP[cp] = waves;
            });

            // Build the throughput bars (existing behaviour reimplemented here to
            // add wave annotations without breaking the existing director render logic)
            const cpEntries = Object.entries(byCP).sort((a, b) => b[1].length - a[1].length);
            if (cpEntries.length === 0) {
                throughputBody.innerHTML = '<div class="text-center theme-text-muted text-xs p-4">No scans yet.</div>';
                return;
            }
            const maxCount = cpEntries[0][1].length;

            throughputBody.innerHTML = cpEntries.map(([cp, cpLogs]) => {
                const pct    = maxCount > 0 ? Math.round((cpLogs.length / maxCount) * 100) : 0;
                const waves  = wavesByCP[cp] || [];
                const bigWave = waves[0]; // largest wave at this CP
                const waveNote = bigWave && bigWave.bibs.length >= 4
                    ? `<div class="text-[9px] text-amber-700 dark:text-amber-400 font-bold mt-0.5">🌊 Wave of ${bigWave.bibs.length} runners detected</div>`
                    : '';
                const avgPace = (() => {
                    const secs = cpLogs.filter(l => !l.remake && l.pace).map(l => parsePaceToSeconds_(l.pace)).filter(s => isFinite(s) && s > 0);
                    if (!secs.length) return '';
                    const avg = secs.reduce((a, b) => a + b, 0) / secs.length;
                    const zone = classifyPaceZone_(avg);
                    return `<span style="color:${zone.textColor};font-weight:700;">${formatSecondsAsPace_(avg)}</span> avg pace`;
                })();
                return `
                    <div class="mb-2">
                        <div class="flex justify-between items-center mb-1 text-[10px]">
                            <span class="font-bold theme-text">${cp}</span>
                            <span class="font-mono font-black text-blue-700 dark:text-cyan-400">${cpLogs.length} scans${avgPace ? ' · ' : ''}${avgPace}</span>
                        </div>
                        <div class="h-2 rounded-full bg-neutral-300/40 dark:bg-neutral-900/50 overflow-hidden">
                            <div class="h-2 rounded-full bg-blue-500 dark:bg-blue-600 transition-all duration-500" style="width:${pct}%;"></div>
                        </div>
                        ${waveNote}
                    </div>`;
            }).join('');
        }

        /* ─────────────────────────────────────────────────────────────────
           renderBibTrendBadge_  — given a bib's split history, appends a
           small trend badge (📈 fading / ➡️ steady / 📉 negative-splitting)
           to any log rows in the scan history list that match this bib.
           Called lazily after renderFastestRunners_ completes.
           ───────────────────────────────────────────────────────────────── */
        function renderBibTrendBadges_(allLogs) {
            const byBib = groupLogsByBib_(allLogs, 2);
            Object.entries(byBib).forEach(([bib, bibLogs]) => {
                const trend = getBibSplitTrend_(bibLogs, bib);
                if (!trend) return;
                const trendClass = classifyTrend_(trend.map(t => t.paceSecs));
                const badge = {
                    'fading':             { icon: '📈', label: 'Fading',            color: '#f97316' },
                    'steady':             { icon: '➡️',  label: 'Steady',            color: '#a3a3ab' },
                    'negative-splitting': { icon: '📉', label: 'Negative splitting', color: '#10b981' },
                }[trendClass] || null;
                if (!badge) return;
                // Find all DOM rows for this bib and add the badge
                const logList = document.getElementById('logList');
                if (!logList) return;
                logList.querySelectorAll(`[data-bib="${bib.toUpperCase()}"]`).forEach(row => {
                    const existingBadge = row.querySelector('.trend-badge');
                    if (existingBadge) return; // don't double-render
                    const badgeEl = document.createElement('span');
                    badgeEl.className = 'trend-badge';
                    badgeEl.title = badge.label + ' — pace trend across checkpoints';
                    badgeEl.style.cssText = `font-size:0.5rem;font-weight:900;padding:0.1rem 0.3rem;border-radius:0.2rem;background:rgba(128,128,128,0.1);color:${badge.color};border:1px solid ${badge.color}33;margin-left:0.25rem;`;
                    badgeEl.textContent = badge.icon + ' ' + badge.label;
                    const bibSpan = row.querySelector('.bib-text-highlight, .text-xl');
                    if (bibSpan && bibSpan.parentNode) bibSpan.parentNode.insertBefore(badgeEl, bibSpan.nextSibling);
                });
            });
        }

        /* ─────────────────────────────────────────────────────────────────
           Full analytics integration hook — extends buildPerformanceAnalytics_
           to also fire the director-mode and trend-badge renderers.
           ───────────────────────────────────────────────────────────────── */
        (function extendAnalyticsHook_() {
            const originalBuild = buildPerformanceAnalytics_;
            window.buildPerformanceAnalytics_ = function(allLogs, currentCP) {
                originalBuild(allLogs, currentCP);
                // Director-mode extras (no-ops when director mode is closed)
                try { renderCheckpointComparisonInDirector_(allLogs); } catch (e) { /* safe */ }
                try { renderWaveDetectionInDirector_(allLogs); }        catch (e) { /* safe */ }
                // Trend badges on history rows (deferred 200ms so DOM is painted first)
                setTimeout(() => {
                    try { renderBibTrendBadges_(allLogs); } catch (e) { /* safe */ }
                }, 200);
            };
        })();

        /* ════════════════════════════════════════════════════════════════════
           PERFORMANCE EXPORT MODULE — CSV enrichment
           ════════════════════════════════════════════════════════════════════

           Extends the existing exportCSV() with analytics-
           enriched columns:
           • paceZone           — 'Elite' | 'Fast' | 'Moderate' | 'Steady' | 'Walk'
           • paceSeconds        — numeric pace in seconds/km (easier to sort in Excel)
           • speedFloat         — numeric speed in km/h
           • predictedFinishMins— on-device fatigue-model prediction (minutes)
           • trendLabel         — 'Fading' | 'Steady' | 'Negative-splitting' | ''

           The enriched fields are appended as additional columns so the
           existing column layout is preserved for any downstream scripts that
           already parse the original format.
           ════════════════════════════════════════════════════════════════════ */

        function enrichLogForExport_(log, allLogs) {
            const pSecs  = parsePaceToSeconds_(log.pace);
            const zone   = isFinite(pSecs) && pSecs > 0 ? classifyPaceZone_(pSecs) : { label: '' };
            const spd    = parseSpeedToFloat_(log.speed);

            // Trend: only meaningful if this bib appears at 2+ checkpoints
            let trendLabel = '';
            const bibLogs = (allLogs || []).filter(l => (l.bib||'') === (log.bib||'') && !l.remake && l.pace);
            if (bibLogs.length >= 2) {
                const trend = getBibSplitTrend_(bibLogs, log.bib);
                if (trend) trendLabel = classifyTrend_(trend.map(t => t.paceSecs));
            }

            return {
                paceZone:            zone.label,
                paceSeconds:         isFinite(pSecs) && pSecs > 0 ? pSecs : '',
                speedFloat:          spd !== null ? spd.toFixed(2) : '',
                trendLabel,
            };
        }

        /* Enrich exportCSV with analytics columns (pace zone / trend), on top of the
           already-enriched category/lap/pace/speed/projectedFinish/flagoff fields.

           Column order matches the Racelog Google Sheet's own column order for the
           first 8 data columns (BIB, Time, Checkpoint, Volunteer, Remark, Device,
           Latitude, Longitude -- see HEADERS in Code.gs) so this export can be pasted
           straight into the Racelog sheet without reordering. UID/ID and the PWA-only
           computed columns (Category, Passage, Pace, Speed, analytics, etc.) come after,
           since the sheet itself doesn't have those columns.

           Backup scope (current CP / current device / global) is no longer a
           standing dropdown — tapping the CSV export button opens the
           #exportScopeModal chooser, which explains the three options and
           passes the pick back into exportCSV(scope). Programmatic safety
           backups call exportCSV('global') directly so they never show the
           modal. */
        function filterLogsByExportScope_(logs, scope) {
            scope = scope || 'currentCp';
            if (scope === 'currentDevice') return logs.filter(l => isOwnEntry(l));
            if (scope === 'global') return logs;
            // currentCp (default): match the checkpoint currently typed into Setup.
            const cp = (document.getElementById('checkpoint')?.value || '').trim().toUpperCase();
            if (!cp) return logs; // Setup not filled in yet -- nothing to scope against, export everything rather than silently empty the file
            return logs.filter(l => (l.checkpoint || '').toUpperCase() === cp);
        }

        function exportScopeLabel_(scope) {
            scope = scope || 'currentCp';
            if (scope === 'currentDevice') return 'ThisDevice';
            if (scope === 'global') return 'Global';
            const cp = (document.getElementById('checkpoint')?.value || '').trim().toUpperCase();
            return cp ? cp.replace(/[^a-zA-Z0-9_-]/g, '') : 'CurrentCP';
        }

        /* ── Export scope chooser modal ──────────────────────────────────────
           Opened whenever the CSV export button is tapped without an explicit
           scope. Personalizes the Current CP option with the actual checkpoint
           name, then dispatches the pick to exportCSV(scope). */
        function openExportScopePrompt_() {
            const titleEl = document.getElementById('exportScopeModalTitle');
            if (titleEl) titleEl.textContent = '📥 What should this CSV backup include?';
            const cp = (document.getElementById('checkpoint')?.value || '').trim().toUpperCase();
            const cpDescEl = document.getElementById('exportScopeCpDesc');
            if (cpDescEl) {
                cpDescEl.textContent = cp
                    ? `Only entries logged at ${cp} (this device's current checkpoint) — from every device that scanned there. Best for an end-of-shift backup of this station's records.`
                    : `Only entries logged at this device's current checkpoint — from every device that scanned there. (No checkpoint is set in Setup yet, so this would currently export everything.) Best for an end-of-shift station backup.`;
            }
            document.getElementById('exportScopeModal')?.classList.remove('hidden');
        }

        function closeExportScopePrompt_() {
            document.getElementById('exportScopeModal')?.classList.add('hidden');
        }

        function chooseExportScope_(scope) {
            closeExportScopePrompt_();
            exportCSV(scope);
        }

        (function patchExportCSV_() {
            window.exportCSV = function(scope) {
                if (!scope) { openExportScopePrompt_(); return; }
                getEnrichedLogsFromDb_(function(allLogs) {
                    const logs = filterLogsByExportScope_(allLogs || [], scope);
                    if (!logs || logs.length === 0) { alert('⚠️ No logs available for this backup scope!'); return; }

                    // Time is kept as quoted text (not a bare unquoted value), which stops
                    // spreadsheet apps from reinterpreting the "DD/MM/YYYY hh:mm:ss AM/PM"
                    // string (see getFormattedTimestamp) as a date/number and truncating the
                    // display to ##### for a too-narrow column. A UTF-8 BOM is prepended below
                    // so Excel opens the file as UTF-8 instead of guessing a legacy codepage,
                    // which is the other common cause of a CSV looking corrupted on open.
                    let csvContent = 'OriginalBIB,NumericBIB,NumericKey,RunnerIndicator,BIBIdentityKey,Time,OriginalDeviceTime,ClockOffsetMs,ClockConfidenceMs,AppVersion,Checkpoint,CheckpointKM,CheckpointKMSource,Volunteer,Remark,Device,Latitude,Longitude,GPSAccuracyM,GPSValidationStatus,GPSNearestCheckpoint,GPSDistanceToNearestM,LocationMismatchAcknowledged,NextCheckpoint,NextCheckpointKM,NextCourseDistanceKM,NextStraightLineKM,ID,UID,Category,PassageMode,Passage,Status,DuplicateOfUID,DuplicateDeviceCount,TimeSincePriorPassage,TotalTime,Pace,Speed,ProjectedFinish,ProjectionMethod,Flagoff,PaceZone,PaceSecs,SpeedFloat,TrendLabel\r\n';
                    logs.forEach(l => {
                        const enriched = enrichLogForExport_(l, logs);
                        csvContent += [
                            `"${(l.bib||'').replace(/"/g,'""')}"`,
                            `"${extractBibNumber_(l.bibNumber || l.bib)}"`,
                            `"${bibNumberKey_(l)}"`,
                            `"${(l.bibIndicator || bibNumberKey_(l) || '').replace(/"/g,'""')}"`,
                            `"${bibIdentityKey_(l)}"`,
                            `"${(l.time||'').replace(/"/g,'""')}"`,
                            `"${(l.originalDeviceTime||l.time||'').replace(/"/g,'""')}"`,
                            Number(l.clockOffsetMs) || 0,
                            Number(l.clockConfidenceMs) || 0,
                            `"${(l.appVersion||'').replace(/"/g,'""')}"`,
                            `"${(l.checkpoint||'').replace(/"/g,'""')}"`,
                            (l.checkpointKm !== undefined && l.checkpointKm !== null && l.checkpointKm !== '') ? l.checkpointKm : '',
                            `"${(l.checkpointKmSource||'').replace(/"/g,'""')}"`,
                            `"${(l.volunteer||'').replace(/"/g,'""')}"`,
                            `"${(l.remark||'').replace(/"/g,'""')}"`,
                            `"${getDeviceLabel(l.device)}"`,
                            (l.latitude !== undefined && l.latitude !== null && l.latitude !== '') ? l.latitude : '',
                            (l.longitude !== undefined && l.longitude !== null && l.longitude !== '') ? l.longitude : '',
                            (l.gpsAccuracyM !== undefined && l.gpsAccuracyM !== null && l.gpsAccuracyM !== '') ? l.gpsAccuracyM : '',
                            `"${(l.gpsValidationStatus||'').replace(/"/g,'""')}"`,
                            `"${(l.gpsNearestCheckpoint||'').replace(/"/g,'""')}"`,
                            (l.gpsDistanceToNearestM !== undefined && l.gpsDistanceToNearestM !== null && l.gpsDistanceToNearestM !== '') ? l.gpsDistanceToNearestM : '',
                            l.locationMismatchAcknowledged ? 'TRUE' : 'FALSE',
                            `"${(l.nextCheckpoint||'').replace(/"/g,'""')}"`,
                            (l.nextCheckpointKm !== undefined && l.nextCheckpointKm !== null && l.nextCheckpointKm !== '') ? l.nextCheckpointKm : '',
                            (l.nextCourseDistanceKm !== undefined && l.nextCourseDistanceKm !== null && l.nextCourseDistanceKm !== '') ? l.nextCourseDistanceKm : '',
                            (l.nextStraightLineKm !== undefined && l.nextStraightLineKm !== null && l.nextStraightLineKm !== '') ? l.nextStraightLineKm : '',
                            l.id,
                            `"${(l.uid||'').replace(/"/g,'""')}"`,
                            `"${(l.category||'').replace(/"/g,'""')}"`,
                            `"automatic"`,
                            `"${(l.lap||'').replace(/"/g,'""')}"`,
                            `"${(l.status||'Active').replace(/"/g,'""')}"`,
                            `"${(l.duplicateOfUid||'').replace(/"/g,'""')}"`,
                            Number(l.duplicateDeviceCount) || 1,
                            `"${(l.timePerLap||'').replace(/"/g,'""')}"`,
                            `"${(l.totalTime||'').replace(/"/g,'""')}"`,
                            `"${(l.pace||'').replace(/"/g,'""')}"`,
                            `"${(l.speed||'').replace(/"/g,'""')}"`,
                            `"${(l.projectedFinish||'').replace(/"/g,'""')}"`,
                            `"${(l.projectionMethod||'').replace(/"/g,'""')}"`,
                            `"${(l.flagoff||'').replace(/"/g,'""')}"`,
                            `"${enriched.paceZone}"`,
                            enriched.paceSeconds,
                            enriched.speedFloat,
                            `"${enriched.trendLabel}"`,
                        ].join(',') + '\r\n';
                    });
                    const BOM = '\uFEFF';
                    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
                    const url  = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.setAttribute('href', url);
                    link.setAttribute('download', `Race_Logs_${exportScopeLabel_(scope)}_${new Date().toISOString().split('T')[0]}.csv`);
                    document.body.appendChild(link); link.click(); document.body.removeChild(link);
                    setTimeout(() => URL.revokeObjectURL(url), 10000);
                });
            };
        })();

        /* ════════════════════════════════════════════════════════════════════
           UI ENHANCEMENT: Keyboard shortcut layer
           ════════════════════════════════════════════════════════════════════

           Adds race-operator-friendly keyboard shortcuts for the most common
           actions. All shortcuts require no modifier key (no Ctrl/Alt/Shift)
           EXCEPT Escape (already handled) to avoid conflicts with browser
           shortcuts and screen-reader navigation.

           Shortcuts active when no input element is focused:
             F2    → focus the Bib input (same as tapping the field)
             F3    → toggle Director / Command View
             F5    → force a manual sync refresh
             F9    → toggle Settings modal
             F10   → toggle the Performance Analytics panel
             /     → focus the Search bar in the history panel

           All shortcuts are disabled when a text input or textarea is focused
           so they don't interfere with normal typing.
           ════════════════════════════════════════════════════════════════════ */
        document.addEventListener('keydown', function(e) {
            // Only fire when no text-entry element is the active element
            const tag = (document.activeElement?.tagName || '').toUpperCase();
            const isTyping = ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag);

            switch (e.key) {
                case 'F2':
                    e.preventDefault();
                    document.getElementById('bibInput')?.focus();
                    break;
                case 'F3':
                    e.preventDefault();
                    if (typeof isDirectorModeOpen !== 'undefined') {
                        if (isDirectorModeOpen) { if (typeof closeDirectorMode === 'function') closeDirectorMode(); }
                        else                    { if (typeof openDirectorMode  === 'function') openDirectorMode(); }
                    }
                    break;
                case 'F5':
                    e.preventDefault();
                    if (typeof attemptSync === 'function') { attemptSync(); pullServerRecords && pullServerRecords(); }
                    break;
                case 'F9':
                    e.preventDefault();
                    if (typeof toggleSettings === 'function') toggleSettings();
                    break;
                case 'F10':
                    e.preventDefault();
                    togglePerfAnalytics();
                    break;
                case '/':
                    if (!isTyping) {
                        e.preventDefault();
                        document.getElementById('searchBar')?.focus();
                    }
                    break;
            }
        });

        /* ════════════════════════════════════════════════════════════════════
           UI ENHANCEMENT: Bib input auto-font-scaling improvement
           ════════════════════════════════════════════════════════════════════
           The existing autoScaleBibFontSize_() call in oninput already scales
           the font. This extension additionally dims the LOG button when the
           input is empty and restores it when a value is present, providing
           clear visual feedback that the button is ready (or not).
           ════════════════════════════════════════════════════════════════════ */
        (function patchBibInputFeedback_() {
            const bibInput = document.getElementById('bibInput');
            const logBtn   = document.getElementById('logActionButton');
            if (!bibInput || !logBtn) return;

            function updateLogBtnState_() {
                const hasValue = bibInput.value.trim().length > 0;
                logBtn.style.opacity = hasValue ? '1' : '0.55';
                logBtn.style.pointerEvents = hasValue ? 'auto' : 'auto'; // always clickable — alert handles empty
                logBtn.style.boxShadow = hasValue
                    ? '0 4px 12px rgba(29,78,216,0.35)'
                    : '0 2px 6px rgba(29,78,216,0.1)';
            }

            bibInput.addEventListener('input', updateLogBtnState_);
            bibInput.addEventListener('change', updateLogBtnState_);
            updateLogBtnState_(); // initialise
        })();

        /* ════════════════════════════════════════════════════════════════════
           UI ENHANCEMENT: Live clock in header
           ════════════════════════════════════════════════════════════════════
           Shows HH:MM:SS race-day time in the header bar, updating every
           second. Useful for volunteers who have their screen brightness up
           and want a quick time-check without leaving the app.
           ════════════════════════════════════════════════════════════════════ */
        (function startHeaderClock_() {
            // Create the clock element if it doesn't exist
            const header = document.querySelector('header');
            if (!header) return;

            let clockEl = document.getElementById('headerLiveClock');
            if (!clockEl) {
                clockEl = document.createElement('span');
                clockEl.id = 'headerLiveClock';
                clockEl.style.cssText = `
                    font-size: 0.6875rem;
                    font-family: ui-monospace, monospace;
                    font-weight: 700;
                    color: var(--header-text);
                    opacity: 0.7;
                    letter-spacing: 0.05em;
                    flex-shrink: 0;
                `;
                // Insert before the theme/settings buttons
                const btnGroup = header.querySelector('.flex.items-center.gap-1\\.5');
                if (btnGroup) header.insertBefore(clockEl, btnGroup);
            }

            function tick_() {
                if (document.hidden) return;
                const now = new Date();
                const h = String(now.getHours()).padStart(2, '0');
                const m = String(now.getMinutes()).padStart(2, '0');
                if (clockEl) clockEl.textContent = `${h}:${m}`;
            }
            tick_();
            setInterval(tick_, 30000);
        })();

        /* ════════════════════════════════════════════════════════════════════
           UI ENHANCEMENT: Scan-count milestone toasts
           ════════════════════════════════════════════════════════════════════
           Shows a celebratory one-time toast for milestone scan counts:
           25, 50, 100, 250, 500, 1000 logs at the current checkpoint.
           The milestone is per-session (stored in sessionStorage) so it
           only fires once per browser tab lifetime, not every page load.
           ════════════════════════════════════════════════════════════════════ */
        const MILESTONE_COUNTS_ = [25, 50, 100, 250, 500, 1000];
        const MILESTONE_MSGS_   = {
            25:   '🎯 25 bibs logged!',
            50:   '🔥 50 bibs — great pace!',
            100:  '💯 100 bibs at this CP!',
            250:  '🏅 250 runners passed!',
            500:  '🚀 500 bibs — incredible!',
            1000: '🏆 1,000 bibs! All-time record!',
        };

        function checkScanMilestones_(count) {
            if (!count || count < 25) return;
            const key = 'milestones_fired';
            let fired = [];
            try { fired = JSON.parse(sessionStorage.getItem(key) || '[]'); } catch (e) { fired = []; }
            const milestone = MILESTONE_COUNTS_.find(m => count >= m && !fired.includes(m));
            if (!milestone) return;
            fired.push(milestone);
            try { sessionStorage.setItem(key, JSON.stringify(fired)); } catch (e) { /* ignore */ }
            // Show a temporary overlay toast (different from the LOG success toast)
            const toast = document.createElement('div');
            toast.style.cssText = `
                position: fixed; bottom: 5rem; left: 50%; transform: translateX(-50%);
                background: rgba(16,185,129,0.95); color: white;
                font-size: 0.875rem; font-weight: 900; padding: 0.5rem 1.25rem;
                border-radius: 2rem; box-shadow: 0 4px 20px rgba(0,0,0,0.3);
                z-index: 9998; white-space: nowrap; letter-spacing: 0.02em;
                animation: scanHistorySlideIn 0.4s ease forwards;
            `;
            toast.textContent = MILESTONE_MSGS_[milestone] || `🎉 ${milestone} bibs!`;
            document.body.appendChild(toast);
            setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.4s ease'; setTimeout(() => toast.remove(), 400); }, 3500);
        }

        /* Hook milestone checks into loadHistory via the totalCount display */
        (function hookMilestoneCheck_() {
            const origLoad = window.loadHistory;
            window.loadHistory = function() {
                origLoad.apply(this, arguments);
                // Read the totalCount DOM element after render
                setTimeout(() => {
                    const el = document.getElementById('totalCount');
                    if (el) {
                        const n = parseInt(el.textContent, 10);
                        if (!isNaN(n)) checkScanMilestones_(n);
                    }
                }, 50);
            };
        })();

        /* ════════════════════════════════════════════════════════════════════
           ACCESSIBILITY ENHANCEMENT: Announce new bib logs to screen readers
           ════════════════════════════════════════════════════════════════════
           Creates a visually-hidden ARIA live region that announces each
           successful log so assistive-technology users get confirmation
           without relying on the visual toast animation.
           ════════════════════════════════════════════════════════════════════ */
        (function setupA11yLiveRegion_() {
            const region = document.createElement('div');
            region.id = 'a11yLiveRegion';
            region.setAttribute('aria-live', 'polite');
            region.setAttribute('aria-atomic', 'true');
            region.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden;';
            document.body.appendChild(region);

            // Expose a helper so the existing logging flow can call it
            window.announceToA11y_ = function(msg) {
                region.textContent = '';
                setTimeout(() => { region.textContent = msg; }, 50);
            };
        })();

        /* ════════════════════════════════════════════════════════════════════
           DATA INTEGRITY: Duplicate run-streak detector
           ════════════════════════════════════════════════════════════════════
           After each log, checks whether the same bib appears more than
           `STREAK_WARN_COUNT` times at the same checkpoint within the last
           `STREAK_WINDOW_MIN` minutes. This catches accidental repeated
           scanning (e.g. a volunteer scanning the same bib each time they
           process a paper form batch) vs. legitimate multi-lap entries.
           The warning is non-blocking — it shows a soft banner that the
           volunteer can dismiss, unlike the hard duplicate-guard which blocks.
           ════════════════════════════════════════════════════════════════════ */
        const STREAK_WARN_COUNT_  = 3;   // warn if this bib appears ≥ N times at this CP
        const STREAK_WINDOW_MIN_  = 30;  // within this many minutes

        function checkRunStreak_(bib, checkpoint, allLogs) {
            if (!bib || !checkpoint) return;
            const cpUpper  = checkpoint.toUpperCase();
            const bibUpper = bib.toUpperCase();
            const cutoff   = Date.now() - STREAK_WINDOW_MIN_ * 60 * 1000;
            const recent   = (allLogs || []).filter(l =>
                (l.bib||'').toUpperCase() === bibUpper &&
                (l.checkpoint||'').toUpperCase() === cpUpper &&
                !l.remake &&
                new Date(l.time).getTime() >= cutoff
            );
            if (recent.length >= STREAK_WARN_COUNT_) {
                showStreakWarning_(bib, checkpoint, recent.length);
            }
        }

        function showStreakWarning_(bib, checkpoint, count) {
            const existing = document.getElementById('streakWarningBanner');
            if (existing) existing.remove();
            const banner = document.createElement('div');
            banner.id = 'streakWarningBanner';
            banner.style.cssText = `
                position: fixed; top: 4rem; left: 50%; transform: translateX(-50%);
                background: rgba(245,158,11,0.97); color: white;
                font-size: 0.75rem; font-weight: 800; padding: 0.5rem 1rem;
                border-radius: 0.5rem; box-shadow: 0 4px 16px rgba(0,0,0,0.25);
                z-index: 9997; max-width: 90vw; text-align: center;
                animation: scanHistorySlideIn 0.3s ease forwards; cursor: pointer;
            `;
            banner.innerHTML = `⚠️ Bib ${bib} logged ${count}× at ${checkpoint} in ${STREAK_WINDOW_MIN_} min — verify if intentional <span style="opacity:0.7;font-size:0.65rem;">(tap to dismiss)</span>`;
            banner.onclick = () => banner.remove();
            document.body.appendChild(banner);
            setTimeout(() => { if (banner.parentNode) banner.remove(); }, 8000);
        }

        /* ════════════════════════════════════════════════════════════════════
           NETWORK QUALITY INDICATOR
           ════════════════════════════════════════════════════════════════════
           Monitors the browser's online/offline status and updates the sync
           badge in real-time. When the connection drops, the badge turns red
           and an explanatory message is shown. When it comes back, the badge
           updates and an auto-sync is triggered.
           ════════════════════════════════════════════════════════════════════ */
        (function setupNetworkMonitor_() {
            function updateNetworkBadge_(isOnline) {
                const badge = document.getElementById('syncStatus');
                if (!badge) return;
                if (!isOnline) {
                    badge.onclick = null;
                    badge.textContent = '⚡ Offline';
                    badge.className = 'text-[10px] bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-400 border border-red-300 dark:border-red-800 px-2 py-0.5 rounded-full font-bold';
                } else {
                    // Restore the normal sync status label
                    if (typeof updateSyncStatusLabel === 'function') updateSyncStatusLabel();
                    // On reconnect: push whatever queued while offline AND pull anything
                    // logged by other devices in the meantime — a device that was offline
                    // for hours needs both directions, not just its own queue draining.
                    setTimeout(() => {
                        if (typeof attemptSync === 'function') attemptSync();
                        if (typeof pullServerRecords === 'function') pullServerRecords();
                    }, 500);
                }
            }

            window.addEventListener('online',  () => updateNetworkBadge_(true));
            window.addEventListener('offline', () => updateNetworkBadge_(false));
            // Initial state
            if (!navigator.onLine) updateNetworkBadge_(false);
        })();

        /* ════════════════════════════════════════════════════════════════════
           OFFLINE RESILIENCE: persistent storage + quota watchdog
           ════════════════════════════════════════════════════════════════════
           A multi-hour race with 100 volunteer devices logging offline for long
           stretches (weak trailhead signal, aid stations with no coverage) can
           build up thousands of queued IndexedDB rows before ever reaching a
           signal. Two protections:
             1. Ask the browser to mark this origin's storage "persistent" so it
                is exempt from the automatic eviction that can otherwise silently
                wipe IndexedDB when the device is low on space — normally not
                guaranteed for a web app, this is the standard way to opt in.
             2. Periodically check navigator.storage.estimate() and warn (once)
                if usage is getting close to quota, so a volunteer can back up
                via Export CSV before anything is at risk.
           ════════════════════════════════════════════════════════════════════ */
        (function setupOfflineStorageResilience_() {
            if (navigator.storage && navigator.storage.persist) {
                navigator.storage.persist().catch(() => {/* best-effort only */});
            }
            if (!navigator.storage || !navigator.storage.estimate) return;

            let quotaWarningShown = false;
            async function checkQuota_() {
                try {
                    const { usage, quota } = await navigator.storage.estimate();
                    if (!quota) return;
                    const ratio = usage / quota;
                    if (ratio > 0.8 && !quotaWarningShown) {
                        quotaWarningShown = true;
                        alert('⚠️ This device\'s local storage is over 80% full. Please use the Export & Download CSV button to back up your logs, and free up device storage if possible.');
                    }
                } catch (e) { /* not fatal */ }
            }
            checkQuota_();
            setInterval(checkQuota_, 10 * 60 * 1000); // recheck every 10 minutes
        })();

        /* ════════════════════════════════════════════════════════════════════
           SESSION STATISTICS SUMMARY
           ════════════════════════════════════════════════════════════════════
           Computes and stores a running summary of session-level statistics
           that can be used to populate the director mode "At a Glance" tiles
           with richer data:
           • sessionStartTime     — first log timestamp in the local DB
           • sessionDurationMins  — minutes since first log
           • peakThroughputBib/h  — highest observed throughput in any 5-min window
           • totalUniqueCategories— distinct category names seen
           • avgPaceAllTime       — all-time average pace across all logs
           ════════════════════════════════════════════════════════════════════ */
        function calcSessionStats_(logs) {
            if (!logs || logs.length === 0) return null;

            const times = logs
                .filter(l => !l.remake)
                .map(l => { try { return new Date(l.time).getTime(); } catch(e) { return NaN; } })
                .filter(t => !isNaN(t))
                .sort((a, b) => a - b);

            if (times.length === 0) return null;

            const sessionStart = times[0];
            const sessionEnd   = times[times.length - 1];
            const durationMins = (sessionEnd - sessionStart) / 60000;

            // Peak throughput: slide a 5-min window across all timestamps
            let peakThroughput = 0;
            const WIN = 5 * 60 * 1000;
            for (let i = 0; i < times.length; i++) {
                const windowEnd = times[i];
                const windowStart = windowEnd - WIN;
                const inWindow = times.filter(t => t >= windowStart && t <= windowEnd).length;
                const rate = Math.round((inWindow / 5) * 60); // bibs/hour
                if (rate > peakThroughput) peakThroughput = rate;
            }

            const categories = new Set(logs
                .filter(l => l.category)
                .map(l => distanceCategoryKey_(l.km, l.category)));
            const avgPace    = calcAvgPaceSeconds_(logs);

            return {
                sessionStart, sessionEnd, durationMins,
                peakThroughput,
                totalUniqueCategories: categories.size,
                avgPaceAllTimeSecs: avgPace,
                totalLogs: logs.filter(l => !l.remake).length,
            };
        }

        /* ════════════════════════════════════════════════════════════════════
           UTILITY: Format duration in minutes → "Xh Ym" or "Zm min"
           ════════════════════════════════════════════════════════════════════ */
        function formatDurationMins_(mins) {
            if (!mins || mins < 0) return '--';
            if (mins < 60) return Math.round(mins) + ' min';
            const h = Math.floor(mins / 60);
            const m = Math.round(mins % 60);
            return `${h}h ${String(m).padStart(2,'0')}m`;
        }

        /* ════════════════════════════════════════════════════════════════════
           DIRECTOR MODE INTEGRATION: Session stats glance tiles
           ════════════════════════════════════════════════════════════════════
           Adds session-level stat tiles (duration, peak rate, categories) to
           the director mode glance bar. These complement the existing per-CP
           and category analytics from the main server sync payload.
           ════════════════════════════════════════════════════════════════════ */
        (function hookSessionStatsIntoDirector_() {
            const origOpen = window.openDirectorMode;
            if (typeof origOpen !== 'function') return;
            window.openDirectorMode = function() {
                origOpen.apply(this, arguments);
                setTimeout(() => {
                    if (!db) return;
                    try {
                        db.transaction(['logs'], 'readonly').objectStore('logs').getAll().onsuccess = function(e) {
                            const logs = e.target.result || [];
                            const stats = calcSessionStats_(logs);
                            if (!stats) return;
                            // Add a session summary row above the stat tiles
                            const tilesEl = document.getElementById('directorStatTiles');
                            if (!tilesEl) return;
                            const sessionTile = document.createElement('div');
                            sessionTile.className = 'col-span-full sm:col-auto';
                            sessionTile.style.cssText = `
                                background: linear-gradient(135deg, rgba(99,102,241,0.1), rgba(59,130,246,0.1));
                                border: 1px solid rgba(99,102,241,0.25);
                                border-radius: 0.75rem; padding: 0.5rem 0.75rem;
                                display: flex; gap: 1.5rem; align-items: center;
                                font-size: 0.625rem; font-weight: 700;
                                color: var(--text-muted); flex-wrap: wrap;
                            `;
                            sessionTile.innerHTML = `
                                <span>⏱ Session: <strong style="color:var(--text-main);">${formatDurationMins_(stats.durationMins)}</strong></span>
                                <span>📈 Peak rate: <strong style="color:#3b82f6;">${stats.peakThroughput} bibs/h</strong></span>
                                <span>🏷 Categories: <strong style="color:var(--text-main);">${stats.totalUniqueCategories}</strong></span>
                                ${stats.avgPaceAllTimeSecs ? `<span>⚡ Session avg pace: <strong style="color:#10b981;">${formatSecondsAsPace_(stats.avgPaceAllTimeSecs)}/km</strong></span>` : ''}
                            `;
                            // Insert at start of tiles if not already there
                            if (!document.getElementById('sessionSummaryTile')) {
                                sessionTile.id = 'sessionSummaryTile';
                                tilesEl.insertBefore(sessionTile, tilesEl.firstChild);
                            }
                        };
                    } catch (err) { /* safe */ }
                }, 300);
            };
        })();

        /* ════════════════════════════════════════════════════════════════════
           CHECKPOINT COMPARISON PANEL — renderCpComparisonPanel_
           ════════════════════════════════════════════════════════════════════
           Builds the per-checkpoint pace comparison table in the new CP
           Comparison panel. Only shown when 2+ distinct checkpoints are
           present in the current log set.
           ════════════════════════════════════════════════════════════════════ */
        let cpComparisonCollapsed_ = (localStorage.getItem('cpComparisonCollapsed') === 'true');

        function toggleCpComparison_() {
            cpComparisonCollapsed_ = !cpComparisonCollapsed_;
            localStorage.setItem('cpComparisonCollapsed', String(cpComparisonCollapsed_));
            const content = document.getElementById('cpComparisonContent');
            const arrow   = document.getElementById('cpComparisonArrow');
            if (!content) return;
            content.classList.toggle('hidden', cpComparisonCollapsed_);
            if (arrow) arrow.textContent = cpComparisonCollapsed_ ? '▲' : '▼';
        }

        // Initialise collapsed state
        (function() {
            if (cpComparisonCollapsed_) {
                const c = document.getElementById('cpComparisonContent');
                const a = document.getElementById('cpComparisonArrow');
                if (c) c.classList.add('hidden');
                if (a) a.textContent = '▲';
            }
        })();

        function renderCpComparisonPanel_(allLogs) {
            const panel   = document.getElementById('cpComparisonPanel');
            const tbody   = document.getElementById('cpComparisonTableBody');
            const cpCount = document.getElementById('cpComparisonCpCount');
            if (!panel || !tbody) return;

            const cpSummaries = calcCpPaceSummary_(allLogs);
            const distinctCPs = cpSummaries.length;

            // Hide the panel if fewer than 2 checkpoints
            if (distinctCPs < 2) {
                panel.classList.add('hidden');
                return;
            }

            panel.classList.remove('hidden');
            if (cpCount) cpCount.textContent = `${distinctCPs} CPs`;

            // Find the fastest average pace for relative bar coloring
            const fastestAvg = Math.min(...cpSummaries.filter(s => s.avgPaceSecs).map(s => s.avgPaceSecs));

            tbody.innerHTML = cpSummaries.map(s => {
                const zone       = s.avgPaceSecs ? classifyPaceZone_(s.avgPaceSecs) : null;
                const spreadSecs = s.fastestSecs && s.slowestSecs ? s.slowestSecs - s.fastestSecs : null;
                const isFastest  = s.avgPaceSecs && s.avgPaceSecs === fastestAvg;
                return `
                    <tr class="${isFastest ? 'bg-emerald-50/50 dark:bg-emerald-950/20' : ''} hover:bg-neutral-100/50 dark:hover:bg-neutral-800/20 transition-colors border-b theme-border">
                        <td class="p-1.5 pl-2.5 font-black theme-text text-[10px] whitespace-nowrap">
                            ${isFastest ? '⚡ ' : ''}<span style="${isFastest ? 'color:var(--zone-fast-text);' : ''}">${s.cp}</span>
                        </td>
                        <td class="p-1.5 text-center font-bold text-blue-700 dark:text-cyan-400">${s.count}</td>
                        <td class="p-1.5 text-center font-black" style="color:${zone ? zone.textColor : 'var(--text-muted)'};">
                            ${s.avgPaceSecs ? formatSecondsAsPace_(s.avgPaceSecs) : '–'}
                        </td>
                        <td class="p-1.5 text-center text-emerald-700 dark:text-emerald-400 font-bold">
                            ${s.fastestSecs ? formatSecondsAsPace_(s.fastestSecs) : '–'}
                        </td>
                        <td class="p-1.5 text-center pr-2.5 text-neutral-500 dark:text-neutral-500 text-[9px]">
                            ${spreadSecs ? '±' + formatSecondsAsPace_(spreadSecs / 2) : '–'}
                        </td>
                    </tr>`;
            }).join('');
        }

        /* Hook cp comparison into analytics pipeline */
        (function hookCpComparison_() {
            const orig = window.buildPerformanceAnalytics_;
            window.buildPerformanceAnalytics_ = function(allLogs, currentCP) {
                orig(allLogs, currentCP);
                try { renderCpComparisonPanel_(allLogs); } catch(e) { /* safe */ }
            };
        })();

        /* ════════════════════════════════════════════════════════════════════
           MICRO-INTERACTION: Animate totalCount and uniqueCount on change
           ════════════════════════════════════════════════════════════════════ */
        (function animateCounters_() {
            const WATCHED = ['totalCount', 'uniqueCount', 'categoriesCount', 'pendingSyncCount'];
            const lastValues = {};
            const observer = new MutationObserver(mutations => {
                mutations.forEach(m => {
                    const el = m.target;
                    const newVal = el.textContent;
                    if (lastValues[el.id] !== newVal) {
                        lastValues[el.id] = newVal;
                        el.classList.remove('stat-animate');
                        void el.offsetWidth; // force reflow
                        el.classList.add('stat-animate');
                    }
                });
            });
            WATCHED.forEach(id => {
                const el = document.getElementById(id);
                if (el) { lastValues[id] = el.textContent; observer.observe(el, { childList: true, characterData: true, subtree: true }); }
            });
        })();

        /* ════════════════════════════════════════════════════════════════════
           RACE ANALYTICS REFERENCE DATA
           ════════════════════════════════════════════════════════════════════
           Structured reference constants used across analytics calculations.
           Centralising them here avoids magic numbers scattered through the
           codebase and makes future calibration (e.g. tuning pace thresholds
           for road vs. trail) a single-file edit.
           ════════════════════════════════════════════════════════════════════ */

        const RACE_ANALYTICS_CONFIG_ = Object.freeze({

            /* Pace-zone boundary definitions (seconds/km).
               Lower bound is inclusive; upper bound is exclusive.
               Zones are ordered fastest → slowest. */
            paceZones: [
                { id: 'elite',    label: 'Elite',    icon: '🔴', minSecs: 0,    maxSecs: 270,  description: 'Sub-4:30/km — race front, competitive athletes' },
                { id: 'fast',     label: 'Fast',     icon: '🟠', minSecs: 270,  maxSecs: 360,  description: '4:30–6:00/km — strong recreational runner' },
                { id: 'moderate', label: 'Moderate', icon: '🟡', minSecs: 360,  maxSecs: 480,  description: '6:00–8:00/km — mid-pack mainstream pace' },
                { id: 'steady',   label: 'Steady',   icon: '🟢', minSecs: 480,  maxSecs: 720,  description: '8:00–12:00/km — back of pack / hiking sections' },
                { id: 'walk',     label: 'Walk',     icon: '🔵', minSecs: 720,  maxSecs: Infinity, description: '>12:00/km — mostly walking / power-hiking' },
            ],

            /* Fatigue model parameters for predictFinishTime_() */
            fatigueModel: {
                default:      0.004,  // 0.4% pace degradation per km remaining
                aggressive:   0.008,  // 0.8% — hot day, significant elevation, late-race
                conservative: 0.002,  // 0.2% — experienced runner, flat course, cool conditions
                recovery:    -0.001,  // −0.1% — negative-splitting runner (getting faster)
            },

            /* Duplicate-warning guard configuration */
            duplicateGuard: {
                defaultWindowSeconds: 20,
                minWindowSeconds:      3,
                maxWindowSeconds:      120,
            },

            /* Arrival wave detection */
            waveDetection: {
                gapThresholdMins:  5,    // gap > this = new wave
                minWaveSize:       4,    // only flag waves ≥ this many runners
                warnLargeWave:     10,   // extra emphasis for waves ≥ this
            },

            /* COT risk tracker */
            cotRisk: {
                warningMarginMins: 20,   // flag runners within this many mins of COT
                criticalMarginMins: 0,   // flag runners whose projected time exceeds COT
                maxDisplayCount:   8,    // most at-risk runners to show
            },

            /* Sparkline configuration */
            sparkline: {
                windowMins:   60,        // total time window covered by the chart
                bucketCount:  12,        // number of equal-width bars
                minBarHeight: 2,         // minimum visible bar height in px
            },

            /* Leaderboard display */
            leaderboard: {
                topN:         5,         // fastest runners to display in the panel
                trendMinLogs: 2,         // minimum log count to show a trend badge
            },

            /* Throughput calculation */
            throughput: {
                windowMins:   60,        // window for bibs/hour calculation
                displayDecimals: 0,      // round to integer for display
            },

            /* Streak / run-repeat detection */
            streakDetection: {
                windowMins:   30,
                warnCount:    3,         // show soft warning if same bib appears ≥ N times
                autoRemakeThreshold: 0,  // never auto-mark; always human decision
            },

        });

        /* ════════════════════════════════════════════════════════════════════
           RACE FORMAT LIBRARY — common race distance profiles
           ════════════════════════════════════════════════════════════════════
           Pre-built race format templates that can be loaded via Settings
           (future feature) to pre-configure checkpoint lists, COT values,
           and category bib ranges. Stored here as reference data.
           ════════════════════════════════════════════════════════════════════ */

        const RACE_FORMAT_TEMPLATES_ = [
            {
                name: '21K Trail',
                distanceKm: 21.1,
                typicalCotHours: 4,
                typicalPaceZone: 'moderate',
                checkpoints: ['START', 'CP1', 'CP2', 'CP3', 'FINISH'],
                bibRangeStart: 1000, bibRangeEnd: 1999,
                description: 'Half-marathon trail distance. Most runners take 2.5–4h.',
            },
            {
                name: '42K Trail',
                distanceKm: 42.2,
                typicalCotHours: 8,
                typicalPaceZone: 'moderate',
                checkpoints: ['START', 'CP1', 'CP2', 'WS1', 'CP3', 'CP4', 'WS2', 'CP5', 'FINISH'],
                bibRangeStart: 2000, bibRangeEnd: 2999,
                description: 'Marathon trail distance. Most runners take 4.5–8h.',
            },
            {
                name: '50K Ultra',
                distanceKm: 50,
                typicalCotHours: 10,
                typicalPaceZone: 'steady',
                checkpoints: ['START', 'CP1', 'WS1', 'CP2', 'WS2', 'CP3', 'WS3', 'CP4', 'FINISH'],
                bibRangeStart: 3000, bibRangeEnd: 3999,
                description: '50 km ultramarathon. COT typically 10–12h from gun.',
            },
            {
                name: '60K Ultra',
                distanceKm: 60,
                typicalCotHours: 13,
                typicalPaceZone: 'steady',
                checkpoints: ['START', 'CP1', 'WS1', 'CP2', 'WS2', 'TURNAROUND', 'WS3', 'CP3', 'WS4', 'FINISH'],
                bibRangeStart: 4000, bibRangeEnd: 4999,
                description: '60 km ultramarathon with mid-course turnaround.',
            },
            {
                name: '100K Ultra',
                distanceKm: 100,
                typicalCotHours: 20,
                typicalPaceZone: 'walk',
                checkpoints: ['START', 'CP1', 'WS1', 'CP2', 'WS2', 'CP3', 'WS3', 'CP4', 'WS4', 'CP5', 'WS5', 'CP6', 'FINISH'],
                bibRangeStart: 5000, bibRangeEnd: 5999,
                description: '100 km ultramarathon. COT typically 18–24h. Pace zones shift significantly after 50K mark.',
            },
            {
                name: '100M Ultra',
                distanceKm: 160.9,
                typicalCotHours: 36,
                typicalPaceZone: 'walk',
                checkpoints: ['START', 'CP1', 'CP2', 'WS1', 'CP3', 'CP4', 'WS2', 'CP5', 'CP6', 'WS3', 'CP7', 'CP8', 'WS4', 'CP9', 'FINISH'],
                bibRangeStart: 6000, bibRangeEnd: 6999,
                description: '100-mile ultramarathon. Sleep deprivation and fatigue are primary variables after 60K.',
            },
        ];

        /* Expose templates for future Settings integration */
        window.RACE_FORMAT_TEMPLATES_ = RACE_FORMAT_TEMPLATES_;

        /* ════════════════════════════════════════════════════════════════════
           PERFORMANCE ANALYTICS — Advanced helper functions
           ════════════════════════════════════════════════════════════════════ */

        /* ─────────────────────────────────────────────────────────────────
           getPacePercentile_
           Returns the Pth percentile pace (in seconds/km) from a logs array.
           P = 0 → fastest (min), P = 100 → slowest (max).
           ───────────────────────────────────────────────────────────────── */
        function getPacePercentile_(logs, P) {
            const paces = logs
                .filter(l => !l.remake && l.pace)
                .map(l => parsePaceToSeconds_(l.pace))
                .filter(s => isFinite(s) && s > 0)
                .sort((a, b) => a - b);
            if (paces.length === 0) return null;
            const idx = Math.min(paces.length - 1, Math.floor((P / 100) * paces.length));
            return paces[idx];
        }

        /* ─────────────────────────────────────────────────────────────────
           calcStdDevPace_  — standard deviation of pace values (s/km)
           A higher std-dev means a more spread-out field.
           ───────────────────────────────────────────────────────────────── */
        function calcStdDevPace_(logs) {
            const paces = logs
                .filter(l => !l.remake && l.pace)
                .map(l => parsePaceToSeconds_(l.pace))
                .filter(s => isFinite(s) && s > 0);
            if (paces.length < 2) return null;
            const mean = paces.reduce((a, b) => a + b, 0) / paces.length;
            const variance = paces.reduce((acc, s) => acc + Math.pow(s - mean, 2), 0) / paces.length;
            return Math.sqrt(variance);
        }

        /* ─────────────────────────────────────────────────────────────────
           buildPaceHistogram_
           Divides the pace range into `bins` equal-width buckets and
           counts how many logs fall in each. Returns:
           { bins: [{minSecs, maxSecs, count, label}], maxCount }
           ───────────────────────────────────────────────────────────────── */
        function buildPaceHistogram_(logs, numBins) {
            const paces = logs
                .filter(l => !l.remake && l.pace)
                .map(l => parsePaceToSeconds_(l.pace))
                .filter(s => isFinite(s) && s > 0);
            if (paces.length < 2) return null;
            numBins = numBins || 8;
            const minPace = Math.min(...paces);
            const maxPace = Math.max(...paces);
            const binWidth = (maxPace - minPace) / numBins || 60;
            const bins = Array.from({ length: numBins }, (_, i) => ({
                minSecs: Math.round(minPace + i * binWidth),
                maxSecs: Math.round(minPace + (i + 1) * binWidth),
                count: 0,
                label: '',
            }));
            paces.forEach(s => {
                const bi = Math.min(numBins - 1, Math.floor((s - minPace) / binWidth));
                bins[bi].count++;
            });
            bins.forEach(b => { b.label = formatSecondsAsPace_(b.minSecs) + '–' + formatSecondsAsPace_(b.maxSecs); });
            return { bins, maxCount: Math.max(...bins.map(b => b.count)) };
        }

        /* ─────────────────────────────────────────────────────────────────
           getMedianSplitTime_  — median time between consecutive checkpoint
           visits for a given bib. Useful for detecting consistent pacers.
           ───────────────────────────────────────────────────────────────── */
        function getMedianSplitTime_(bib, allLogs) {
            const bibLogs = allLogs
                .filter(l => (l.bib || '').toUpperCase() === bib.toUpperCase() && !l.remake)
                .map(l => { try { return new Date(l.time).getTime(); } catch(e) { return NaN; } })
                .filter(t => !isNaN(t))
                .sort((a, b) => a - b);
            if (bibLogs.length < 2) return null;
            const splits = [];
            for (let i = 1; i < bibLogs.length; i++) splits.push(bibLogs[i] - bibLogs[i-1]);
            splits.sort((a, b) => a - b);
            const mid = Math.floor(splits.length / 2);
            return splits.length % 2 === 0 ? (splits[mid-1] + splits[mid]) / 2 : splits[mid];
        }

        /* ─────────────────────────────────────────────────────────────────
           estimateFinishFromPace_  — simple linear finish estimator
           Given a runner's current pace and remaining distance, return
           an estimated finish as a wall-clock Date object.
           ───────────────────────────────────────────────────────────────── */
        function estimateFinishFromPace_(currentPaceSecs, remainingKm, fromTimeMs) {
            if (!currentPaceSecs || !remainingKm || currentPaceSecs <= 0) return null;
            const remainingMs = currentPaceSecs * remainingKm * 1000;
            const from = fromTimeMs || Date.now();
            return new Date(from + remainingMs);
        }

        /* ─────────────────────────────────────────────────────────────────
           getFieldSpreadLabel_  — human-readable description of how spread
           out the field is at this checkpoint, based on pace std-dev.
           ───────────────────────────────────────────────────────────────── */
        function getFieldSpreadLabel_(stdDevSecs) {
            if (!stdDevSecs || stdDevSecs < 0) return 'Unknown';
            if (stdDevSecs < 60)  return 'Very tight field';
            if (stdDevSecs < 120) return 'Compact field';
            if (stdDevSecs < 180) return 'Moderate spread';
            if (stdDevSecs < 300) return 'Wide spread';
            return 'Very wide spread';
        }

        /* ─────────────────────────────────────────────────────────────────
           buildRunnerCard_  — builds a self-contained HTML string
           summarising a single runner's complete scan history from allLogs.
           ───────────────────────────────────────────────────────────────── */
        function buildRunnerCard_(bib, allLogs) {
            const runs = allLogs
                .filter(l => (l.bib || '').toUpperCase() === bib.toUpperCase() && !l.remake)
                .sort((a, b) => {
                    try { return new Date(a.time) - new Date(b.time); } catch(e) { return 0; }
                });
            if (runs.length === 0) return '<p class="rc-text-muted rc-mono-xs">No records found for this bib.</p>';

            const firstLog = runs[0];
            const lastLog  = runs[runs.length - 1];
            const catLabel = formatDistanceCategoryLabel_(firstLog.km, firstLog.category).toUpperCase() || 'N/A';

            const splitRows = runs.map((log, i) => {
                const pace  = log.pace  ? formatSecondsAsPace_(parsePaceToSeconds_(log.pace)) : '–';
                const speed = log.speed ? (parseSpeedToFloat_(log.speed) || 0).toFixed(1) + ' km/h' : '–';
                const zone  = log.pace  ? classifyPaceZone_(parsePaceToSeconds_(log.pace)) : null;
                return `
                    <tr>
                        <td class="rc-td-mono">${i + 1}</td>
                        <td>${(log.checkpoint || '').toUpperCase()}</td>
                        <td class="rc-td-mono" style="color:${zone ? zone.textColor : 'inherit'};">${pace}</td>
                        <td class="rc-td-mono">${speed}</td>
                        <td class="rc-td-mono">${log.lap || '–'}</td>
                        <td class="rc-td-mono">${log.totalTime || '–'}</td>
                        <td class="rc-td-mono">${log.projectedFinish || '–'}</td>
                    </tr>`;
            }).join('');

            const trend = getBibSplitTrend_(runs, bib);
            const trendClass  = trend ? classifyTrend_(trend.map(t => t.paceSecs)) : 'unknown';
            const trendBadge  = {
                'fading':             '📈 Fading',
                'steady':             '➡️ Steady',
                'negative-splitting': '📉 Negative Splitting',
                'unknown':            '',
            }[trendClass] || '';

            return `
                <div class="rc-card rc-fade-in-up">
                    <div class="rc-card-header">
                        Bib ${bib} — ${catLabel}
                        ${trendBadge ? `<span class="rc-badge rc-badge-neutral">${trendBadge}</span>` : ''}
                    </div>
                    <div class="rc-card-body" style="padding:0;">
                        <div style="overflow-x:auto;">
                            <table class="rc-table">
                                <thead>
                                    <tr>
                                        <th>#</th><th>CP</th><th>Pace</th><th>Speed</th>
                                        <th>Lap</th><th>Total</th><th>Proj. Finish</th>
                                    </tr>
                                </thead>
                                <tbody>${splitRows}</tbody>
                            </table>
                        </div>
                        ${lastLog.remark ? `<div class="rc-p-2 rc-text-muted rc-mono-xs">📝 Remark: ${lastLog.remark}</div>` : ''}
                    </div>
                </div>`;
        }

        /* Expose for potential use by other modules */
        window.buildRunnerCard_ = buildRunnerCard_;

        /* ════════════════════════════════════════════════════════════════════
           SEARCH ENHANCEMENT — Runner quick-lookup
           ════════════════════════════════════════════════════════════════════
           Detects when the search bar contains a pure bib number and, after
           a 500ms debounce, fires buildRunnerCard_() to inject a runner
           summary card above the scan history list — giving the volunteer a
           one-glance view of that runner's entire progress before they
           physically arrive.
           ════════════════════════════════════════════════════════════════════ */
        (function setupRunnerQuickLookup_() {
            const searchBar = document.getElementById('searchBar');
            if (!searchBar) return;

            let lookupTimeout_ = null;
            let lastLookupBib_ = null;
            const CARD_ID = 'runnerQuickLookupCard';

            function clearCard_() {
                const el = document.getElementById(CARD_ID);
                if (el) el.remove();
                lastLookupBib_ = null;
            }

            function showCard_(bib, allLogs) {
                const logList = document.getElementById('logList');
                if (!logList) return;
                let card = document.getElementById(CARD_ID);
                if (!card) {
                    card = document.createElement('div');
                    card.id = CARD_ID;
                    card.style.cssText = 'margin:0.5rem 0.75rem;';
                    logList.insertBefore(card, logList.firstChild);
                }
                card.innerHTML = buildRunnerCard_(bib, allLogs);
            }

            searchBar.addEventListener('input', function() {
                clearTimeout(lookupTimeout_);
                const val = searchBar.value.trim().toUpperCase();

                // Only activate if value looks like a pure bib number (2–6 digits/letters, no spaces)
                if (!val || val.includes(' ') || val.length < 2 || val.length > 6) {
                    clearCard_();
                    return;
                }
                const isPureBib = /^[A-Z0-9]{2,6}$/.test(val);
                if (!isPureBib) { clearCard_(); return; }
                if (val === lastLookupBib_) return; // same bib — no-op

                lookupTimeout_ = setTimeout(() => {
                    if (!db) return;
                    try {
                        db.transaction(['logs'], 'readonly').objectStore('logs').getAll().onsuccess = function(e) {
                            const logs = e.target.result || [];
                            const hasLogs = logs.some(l => (l.bib || '').toUpperCase() === val);
                            if (hasLogs) {
                                lastLookupBib_ = val;
                                showCard_(val, logs);
                            } else {
                                clearCard_();
                            }
                        };
                    } catch (err) { clearCard_(); }
                }, 500);
            });

            // Clear card when search is emptied
            searchBar.addEventListener('blur', function() {
                if (!searchBar.value.trim()) clearCard_();
            });
        })();

        /* ════════════════════════════════════════════════════════════════════
           PERFORMANCE ANALYTICS PANEL — Field statistics summary row
           ════════════════════════════════════════════════════════════════════
           Appends a compact "field stats" row at the bottom of the analytics
           panel showing: P25 pace, P75 pace, standard deviation, and field
           spread label. This gives the race director a quick sense of how
           bunched or spread out the field is at this checkpoint.
           ════════════════════════════════════════════════════════════════════ */
        function renderFieldStats_(logs) {
            const container = document.getElementById('perfAnalyticsContent');
            if (!container) return;
            let statsRow = document.getElementById('fieldStatsRow_');

            const validLogs = logs.filter(l => !l.remake && l.pace);
            if (validLogs.length < 3) {
                if (statsRow) statsRow.remove();
                return;
            }

            const p25  = getPacePercentile_(validLogs, 25);
            const p75  = getPacePercentile_(validLogs, 75);
            const stDev = calcStdDevPace_(validLogs);
            const spreadLabel = getFieldSpreadLabel_(stDev);
            const histogram   = buildPaceHistogram_(validLogs, 8);

            if (!statsRow) {
                statsRow = document.createElement('div');
                statsRow.id = 'fieldStatsRow_';
                container.appendChild(statsRow);
            }

            let histogramSVG = '';
            if (histogram && histogram.maxCount > 0) {
                const W = 280, H = 36, barW = Math.floor(W / histogram.bins.length) - 2;
                const bars = histogram.bins.map((b, i) => {
                    const barH = histogram.maxCount > 0 ? Math.max(2, Math.round((b.count / histogram.maxCount) * H)) : 2;
                    const x = i * (W / histogram.bins.length) + 1;
                    const zone = classifyPaceZone_((b.minSecs + b.maxSecs) / 2);
                    return `<rect x="${x.toFixed(0)}" y="${(H - barH)}" width="${barW}" height="${barH}" rx="1" fill="${zone.barColor}" opacity="0.7" title="${b.label}: ${b.count}"/>`;
                }).join('');
                histogramSVG = `
                    <div style="margin-top:0.25rem;">
                        <span class="rc-label" style="display:block;margin-bottom:0.25rem;">Pace Distribution Histogram</span>
                        <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="width:100%;border-radius:0.375rem;overflow:hidden;">
                            <rect width="${W}" height="${H}" fill="var(--card-tint)"/>
                            ${bars}
                        </svg>
                        <div style="display:flex;justify-content:space-between;font-size:0.45rem;color:var(--text-muted);margin-top:0.1rem;">
                            <span>${formatSecondsAsPace_(histogram.bins[0].minSecs)}</span>
                            <span>Pace range</span>
                            <span>${formatSecondsAsPace_(histogram.bins[histogram.bins.length-1].maxSecs)}</span>
                        </div>
                    </div>`;
            }

            statsRow.innerHTML = `
                <div class="perf-section-divider"><span class="perf-section-divider-text">Field Distribution</span></div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.375rem;margin-top:0.25rem;">
                    <div class="perf-stat-card accent-indigo" style="padding:0.375rem;">
                        <span class="perf-stat-label">P25 Pace</span>
                        <span class="perf-stat-value" style="font-size:0.8rem;color:#6366f1;">${p25 ? formatSecondsAsPace_(p25) : '–'}</span>
                    </div>
                    <div class="perf-stat-card accent-amber" style="padding:0.375rem;">
                        <span class="perf-stat-label">P75 Pace</span>
                        <span class="perf-stat-value" style="font-size:0.8rem;color:#f59e0b;">${p75 ? formatSecondsAsPace_(p75) : '–'}</span>
                    </div>
                    <div class="perf-stat-card accent-rose" style="padding:0.375rem;">
                        <span class="perf-stat-label">Std Dev</span>
                        <span class="perf-stat-value" style="font-size:0.8rem;color:#f43f5e;">${stDev ? '±' + formatSecondsAsPace_(Math.round(stDev)) : '–'}</span>
                    </div>
                </div>
                <div style="font-size:0.55rem;font-weight:700;color:var(--text-muted);margin-top:0.25rem;text-align:center;">${spreadLabel}</div>
                ${histogramSVG}`;
        }

        /* Hook field stats into the analytics build pipeline */
        (function hookFieldStats_() {
            const orig = window.buildPerformanceAnalytics_;
            window.buildPerformanceAnalytics_ = function(allLogs, currentCP) {
                orig(allLogs, currentCP);
                const scopedLogs = (currentCP && (typeof activeScopeFilter !== 'undefined') && activeScopeFilter === 'current')
                    ? allLogs.filter(l => (l.checkpoint || '').toUpperCase() === currentCP.toUpperCase())
                    : allLogs;
                try { renderFieldStats_(scopedLogs); } catch(e) { /* safe */ }
            };
        })();

        /* ════════════════════════════════════════════════════════════════════
           VOLUNTEER PRODUCTIVITY TRACKER
           ════════════════════════════════════════════════════════════════════
           Counts how many bib logs each volunteer (by their initials) has
           submitted in the current session. Shows a compact leaderboard in
           the Performance Analytics panel when more than one volunteer is
           detected — useful for multi-volunteer checkpoints where you want
           to ensure equitable load distribution.
           ════════════════════════════════════════════════════════════════════ */
        function calcVolunteerStats_(logs) {
            const counts = {};
            logs.forEach(l => {
                if (l.remake) return;
                const vol = (l.volunteer || 'UNKNOWN').toUpperCase().trim();
                if (!vol) return;
                counts[vol] = (counts[vol] || 0) + 1;
            });
            return Object.entries(counts)
                .map(([vol, count]) => ({ vol, count }))
                .sort((a, b) => b.count - a.count);
        }

        function renderVolunteerStats_(logs) {
            const container = document.getElementById('perfAnalyticsContent');
            if (!container) return;
            let volRow = document.getElementById('volunteerStatsRow_');

            const stats = calcVolunteerStats_(logs);
            if (stats.length < 2) {
                if (volRow) volRow.remove();
                return;
            }

            if (!volRow) {
                volRow = document.createElement('div');
                volRow.id = 'volunteerStatsRow_';
                container.appendChild(volRow);
            }

            const maxCount = stats[0].count;
            const rows = stats.map((s, i) => {
                const pct = maxCount > 0 ? Math.round((s.count / maxCount) * 100) : 0;
                const color = ['#3b82f6','#10b981','#f59e0b','#6366f1','#f43f5e'][Math.min(i, 4)];
                return `
                    <div style="display:flex;align-items:center;gap:0.4rem;padding:0.2rem 0;">
                        <span style="font-size:0.6rem;font-weight:900;color:var(--text-muted);width:0.9rem;text-align:center;">${i+1}</span>
                        <span class="volunteer-chip">${s.vol}</span>
                        <div class="rc-progress-track" style="flex:1;">
                            <div class="rc-progress-fill" style="width:${pct}%;background:${color};"></div>
                        </div>
                        <span style="font-size:0.625rem;font-weight:900;font-family:ui-monospace,monospace;color:${color};width:1.5rem;text-align:right;">${s.count}</span>
                    </div>`;
            }).join('');

            volRow.innerHTML = `
                <div class="perf-section-divider"><span class="perf-section-divider-text">👋 Volunteer Activity</span></div>
                <div style="margin-top:0.25rem;">${rows}</div>`;
        }

        /* Hook volunteer stats into the analytics build pipeline */
        (function hookVolunteerStats_() {
            const orig = window.buildPerformanceAnalytics_;
            window.buildPerformanceAnalytics_ = function(allLogs, currentCP) {
                orig(allLogs, currentCP);
                const scopedLogs = (currentCP && (typeof activeScopeFilter !== 'undefined') && activeScopeFilter === 'current')
                    ? allLogs.filter(l => (l.checkpoint || '').toUpperCase() === currentCP.toUpperCase())
                    : allLogs;
                try { renderVolunteerStats_(scopedLogs); } catch(e) { /* safe */ }
            };
        })();

        /* ════════════════════════════════════════════════════════════════════
           RACE SESSION REPORT GENERATOR
           ════════════════════════════════════════════════════════════════════
           Generates a self-contained HTML race session report that can be
           opened in a new tab and printed / saved as PDF. The report
           includes the following sections:

           1. Session Header        — race name, date, generated timestamp
           2. Summary Statistics    — total logs, unique bibs, CPs covered
           3. Category Breakdown    — runners per category with avg metrics
           4. Checkpoint Summary    — avg pace, throughput, spread per CP
           5. Top Performers        — top 10 fastest at each checkpoint
           6. Flagged Entries       — entries with remarks or REMAKE status
           7. COT Risk Summary      — runners flagged as at-risk of DNF
           8. Volunteer Activity    — scan counts per volunteer
           9. Full Log Table        — every scan with all metrics

           The report is rendered as clean HTML (no external dependencies)
           using inline styles so it prints cleanly on any printer and
           survives being exported to a local file.
           ════════════════════════════════════════════════════════════════════ */

        function generateRaceReport_(logs, summaryRows) {
            if (!logs || logs.length === 0) return null;
            summaryRows = summaryRows || [];

            const now         = new Date();
            const dateStr     = now.toLocaleDateString(undefined, { weekday:'long', year:'numeric', month:'long', day:'numeric' });
            const timeStr     = now.toLocaleTimeString();
            const sessionStats = calcSessionStats_(logs) || {};
            const cpSummaries  = calcCpPaceSummary_(logs);
            const catStats     = calcCategoryStats_(logs);
            const volStats     = calcVolunteerStats_(logs);
            const top10        = topNByPace_(logs, 10);
            const flagged      = logs.filter(l => l.remake || (l.remark && l.remark.trim()));

            const STYLE = `
                <style>
                    *{box-sizing:border-box;margin:0;padding:0;}
                    body{font-family:ui-sans-serif,system-ui,sans-serif;font-size:11pt;color:#111;background:#fff;padding:1.5rem;}
                    h1{font-size:1.5rem;font-weight:900;letter-spacing:-0.01em;margin-bottom:0.15rem;}
                    h2{font-size:0.875rem;font-weight:800;text-transform:uppercase;letter-spacing:0.06em;color:#555;margin:1.25rem 0 0.5rem;border-bottom:1px solid #e0e0e0;padding-bottom:0.25rem;}
                    h3{font-size:0.75rem;font-weight:700;color:#333;margin:0.75rem 0 0.25rem;}
                    p{font-size:0.8125rem;color:#555;line-height:1.5;}
                    table{width:100%;border-collapse:collapse;font-size:0.75rem;margin-bottom:0.75rem;}
                    th{background:#f0f0f0;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;font-size:0.625rem;color:#444;padding:0.3rem 0.5rem;border:1px solid #ddd;text-align:left;}
                    td{padding:0.25rem 0.5rem;border:1px solid #e8e8e8;vertical-align:top;}
                    tr:nth-child(even) td{background:#fafafa;}
                    .badge{display:inline-block;font-size:0.55rem;font-weight:800;padding:0.1rem 0.375rem;border-radius:9999px;text-transform:uppercase;letter-spacing:0.05em;}
                    .badge-green{background:#d1fae5;color:#065f46;}
                    .badge-red{background:#fee2e2;color:#991b1b;}
                    .badge-amber{background:#fef3c7;color:#92400e;}
                    .badge-blue{background:#dbeafe;color:#1e40af;}
                    .stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:0.75rem;margin:0.5rem 0;}
                    .stat-box{background:#f8f8f8;border:1px solid #e0e0e0;border-radius:0.5rem;padding:0.5rem 0.75rem;text-align:center;}
                    .stat-val{font-size:1.375rem;font-weight:900;font-family:ui-monospace,monospace;color:#1e40af;}
                    .stat-lbl{font-size:0.5rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#888;margin-top:0.1rem;}
                    .bib{font-weight:900;font-family:ui-monospace,monospace;color:#047857;}
                    .pace-elite{color:#b91c1c;} .pace-fast{color:#c2410c;} .pace-moderate{color:#b45309;} .pace-steady{color:#047857;} .pace-walk{color:#4338ca;}
                    .flag-remake{text-decoration:line-through;opacity:0.6;}
                    .footer{margin-top:2rem;padding-top:0.75rem;border-top:1px solid #e0e0e0;font-size:0.625rem;color:#aaa;text-align:center;}
                    @media print{body{padding:0.75cm;}h2{page-break-before:auto;break-before:auto;}table{page-break-inside:auto;}tr{page-break-inside:avoid;}}
                </style>`;

            // ─── Helper: pace class ───────────────────────────────────────
            function paceClass_(pSecs) {
                if (!pSecs || !isFinite(pSecs)) return '';
                if (pSecs < 270) return 'pace-elite';
                if (pSecs < 360) return 'pace-fast';
                if (pSecs < 480) return 'pace-moderate';
                if (pSecs < 720) return 'pace-steady';
                return 'pace-walk';
            }

            // ─── Section 1: Header ────────────────────────────────────────
            const cpNames = [...getCheckpointSet_(logs)].sort().join(', ') || 'N/A';
            const headerHTML = `
                <h1>🏁 Race Session Report</h1>
                <p style="color:#888;font-size:0.8rem;">${dateStr} &nbsp;·&nbsp; Generated at ${timeStr} &nbsp;·&nbsp; Checkpoints: ${cpNames}</p>`;

            // ─── Section 2: Summary Statistics ───────────────────────────
            const uniqueBibs = new Set(logs.filter(l => !l.remake).map(bibIdentityKey_).filter(Boolean)).size;
            const totalScans = logs.filter(l => !l.remake).length;
            const remarked   = flagged.length;
            const avgPace    = calcAvgPaceSeconds_(logs);
            const avgSpd     = calcAvgSpeed_(logs);

            const summaryHTML = `
                <h2>Summary Statistics</h2>
                <div class="stat-grid">
                    <div class="stat-box"><div class="stat-val">${totalScans}</div><div class="stat-lbl">Total Scans</div></div>
                    <div class="stat-box"><div class="stat-val">${uniqueBibs}</div><div class="stat-lbl">Unique Bibs</div></div>
                    <div class="stat-box"><div class="stat-val">${cpSummaries.length}</div><div class="stat-lbl">Checkpoints</div></div>
                    <div class="stat-box"><div class="stat-val">${formatDurationMins_(sessionStats.durationMins)}</div><div class="stat-lbl">Session Duration</div></div>
                    <div class="stat-box"><div class="stat-val">${sessionStats.peakThroughput || '--'}</div><div class="stat-lbl">Peak Bibs/h</div></div>
                    <div class="stat-box"><div class="stat-val" style="font-size:1.1rem;">${avgPace ? formatSecondsAsPace_(avgPace) : '--'}</div><div class="stat-lbl">Avg Pace /km</div></div>
                    <div class="stat-box"><div class="stat-val" style="font-size:1.1rem;">${avgSpd ? avgSpd.toFixed(1) + ' km/h' : '--'}</div><div class="stat-lbl">Avg Speed</div></div>
                    <div class="stat-box"><div class="stat-val">${remarked}</div><div class="stat-lbl">Flagged Entries</div></div>
                </div>`;

            // ─── Section 3: Category Breakdown ───────────────────────────
            const catHTML = catStats.length > 0 ? `
                <h2>Category Performance</h2>
                <table>
                    <thead><tr><th>Category</th><th>Runners</th><th>Avg Pace</th><th>Avg Speed</th><th>Spread</th></tr></thead>
                    <tbody>
                        ${catStats.map(c => {
                            const pSecs = c.avgPaceSecs;
                            const cls   = paceClass_(pSecs);
                            return `<tr>
                                <td><strong>${c.category}</strong></td>
                                <td style="text-align:center;font-weight:900;">${c.count}</td>
                                <td class="${cls}" style="font-weight:800;font-family:monospace;">${pSecs ? formatSecondsAsPace_(pSecs) : '–'}</td>
                                <td style="font-family:monospace;">${c.avgSpeed ? c.avgSpeed.toFixed(1) + ' km/h' : '–'}</td>
                                <td style="font-family:monospace;color:#888;">${c.paceSpreadSecs ? '±' + formatSecondsAsPace_(c.paceSpreadSecs / 2) : '–'}</td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>` : '';

            // ─── Section 4: Checkpoint Summary ────────────────────────────
            const cpHTML = cpSummaries.length > 0 ? `
                <h2>Checkpoint Summary</h2>
                <table>
                    <thead><tr><th>Checkpoint</th><th>Scans</th><th>Avg Pace</th><th>Best Pace</th><th>Median</th><th>P25–P75 Range</th></tr></thead>
                    <tbody>
                        ${cpSummaries.map(s => {
                            const cls = paceClass_(s.avgPaceSecs);
                            return `<tr>
                                <td><strong>${s.cp}</strong></td>
                                <td style="text-align:center;font-weight:900;">${s.count}</td>
                                <td class="${cls}" style="font-weight:800;font-family:monospace;">${s.avgPaceSecs ? formatSecondsAsPace_(s.avgPaceSecs) : '–'}</td>
                                <td style="color:#047857;font-weight:800;font-family:monospace;">${s.fastestSecs ? formatSecondsAsPace_(s.fastestSecs) : '–'}</td>
                                <td style="font-family:monospace;">${s.medianPaceSecs ? formatSecondsAsPace_(s.medianPaceSecs) : '–'}</td>
                                <td style="font-family:monospace;color:#888;font-size:0.65rem;">${s.p25 && s.p75 ? formatSecondsAsPace_(s.p25) + ' – ' + formatSecondsAsPace_(s.p75) : '–'}</td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>` : '';

            // ─── Section 5: Top Performers ────────────────────────────────
            const topHTML = top10.length > 0 ? `
                <h2>Top 10 Fastest Runners</h2>
                <table>
                    <thead><tr><th>#</th><th>Bib</th><th>Category</th><th>Checkpoint</th><th>Pace</th><th>Speed</th><th>Total Time</th><th>Proj. Finish</th></tr></thead>
                    <tbody>
                        ${top10.map((log, i) => {
                            const pSecs = parsePaceToSeconds_(log.pace);
                            const cls   = paceClass_(pSecs);
                            return `<tr>
                                <td style="text-align:center;font-weight:900;">${i+1}</td>
                                <td class="bib">${log.bib || '?'}</td>
                                <td>${log.category || '–'}</td>
                                <td>${log.checkpoint || '–'}</td>
                                <td class="${cls}" style="font-weight:900;font-family:monospace;">${formatSecondsAsPace_(pSecs)}</td>
                                <td style="font-family:monospace;">${log.speed || '–'}</td>
                                <td style="font-family:monospace;">${log.totalTime || '–'}</td>
                                <td style="font-family:monospace;">${log.projectedFinish || '–'}</td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>` : '';

            // ─── Section 6: Flagged Entries ───────────────────────────────
            const flaggedHTML = flagged.length > 0 ? `
                <h2>Flagged Entries (${flagged.length})</h2>
                <table>
                    <thead><tr><th>Bib</th><th>Checkpoint</th><th>Time</th><th>Volunteer</th><th>Category</th><th>Status</th><th>Remark</th></tr></thead>
                    <tbody>
                        ${flagged.map(log => `<tr>
                            <td class="bib ${log.remake ? 'flag-remake' : ''}">${log.bib || '?'}</td>
                            <td>${log.checkpoint || '–'}</td>
                            <td style="font-family:monospace;font-size:0.65rem;">${log.time ? new Date(log.time).toLocaleTimeString() : '–'}</td>
                            <td>${log.volunteer || '–'}</td>
                            <td>${log.category || '–'}</td>
                            <td>${log.remake ? '<span class="badge badge-red">REMAKE</span>' : '<span class="badge badge-amber">REMARK</span>'}</td>
                            <td style="font-size:0.7rem;color:#555;">${log.remark || '–'}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>` : '';

            // ─── Section 7: Volunteer Activity ───────────────────────────
            const volHTML = volStats.length > 0 ? `
                <h2>Volunteer Scan Activity</h2>
                <table style="max-width:400px;">
                    <thead><tr><th>Volunteer</th><th style="text-align:right;">Scans</th></tr></thead>
                    <tbody>
                        ${volStats.map(v => `<tr>
                            <td style="font-weight:700;">${v.vol}</td>
                            <td style="text-align:right;font-weight:900;font-family:monospace;">${v.count}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>` : '';

            // ─── Section 8: Full Log Table (first 200 rows) ───────────────
            const logRows = [...logs]
                .sort((a, b) => { try { return new Date(b.time) - new Date(a.time); } catch(e) { return 0; } })
                .slice(0, 200);
            const fullLogHTML = `
                <h2>Full Scan Log (${logRows.length} most recent${logs.length > 200 ? ` of ${logs.length}` : ''})</h2>
                <table>
                    <thead><tr><th>Bib</th><th>Checkpoint</th><th>Time</th><th>Volunteer</th><th>Category</th><th>Pace</th><th>Speed</th><th>Lap</th><th>Total</th><th>Proj. Finish</th><th>Status</th></tr></thead>
                    <tbody>
                        ${logRows.map(log => {
                            const pSecs = parsePaceToSeconds_(log.pace);
                            const cls   = isFinite(pSecs) ? paceClass_(pSecs) : '';
                            return `<tr>
                                <td class="bib ${log.remake ? 'flag-remake' : ''}">${log.bib || '?'}</td>
                                <td>${log.checkpoint || '–'}</td>
                                <td style="font-family:monospace;font-size:0.65rem;">${log.time ? new Date(log.time).toLocaleTimeString() : '–'}</td>
                                <td>${log.volunteer || '–'}</td>
                                <td>${log.category || '–'}</td>
                                <td class="${cls}" style="font-family:monospace;font-weight:800;">${log.pace || '–'}</td>
                                <td style="font-family:monospace;">${log.speed || '–'}</td>
                                <td style="font-family:monospace;">${log.lap || '–'}</td>
                                <td style="font-family:monospace;">${log.totalTime || '–'}</td>
                                <td style="font-family:monospace;">${log.projectedFinish || '–'}</td>
                                <td>${log.remake ? '<span class="badge badge-red">REMAKE</span>' : (log.remark ? '<span class="badge badge-amber">REMARK</span>' : '<span class="badge badge-green">OK</span>')}</td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>`;

            const footerHTML = `<div class="footer">Race Bib Logger — generated ${dateStr} at ${timeStr} · Derived pace and ETA use the configured checkpoint KM and device scan timestamps.</div>`;

            return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Race Session Report — ${dateStr}</title>${STYLE}</head><body>${headerHTML}${summaryHTML}${catHTML}${cpHTML}${topHTML}${flaggedHTML}${volHTML}${fullLogHTML}${footerHTML}</body></html>`;
        }

        /* ─────────────────────────────────────────────────────────────────
           openRaceReport_  — public function to generate and open the report
           ───────────────────────────────────────────────────────────────── */
        window.openRaceReport_ = function() {
            if (!db) { alert('Database not ready.'); return; }
            db.transaction(['logs'], 'readonly').objectStore('logs').getAll().onsuccess = function(e) {
                const logs = e.target.result || [];
                if (logs.length === 0) { alert('⚠️ No logs to report yet.'); return; }
                let summaryRows = [];
                try { summaryRows = JSON.parse(localStorage.getItem('lastCachedSummaryRows') || '[]'); } catch(x) { /* ok */ }
                const html = generateRaceReport_(logs, summaryRows);
                if (!html) { alert('Could not generate report.'); return; }
                const blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
                const url  = URL.createObjectURL(blob);
                window.open(url, '_blank');
                setTimeout(() => URL.revokeObjectURL(url), 30000);
            };
        };

        /* ════════════════════════════════════════════════════════════════════
           EXPORT PANEL: Add Report button to mobile export section
           ════════════════════════════════════════════════════════════════════ */
        (function addReportButtonToExport_() {
            // Mobile export section (block lg:hidden)
            const mobileSection = document.querySelector('section.block.lg\\:hidden');
            if (mobileSection) {
                const btn = document.createElement('button');
                btn.onclick = function() { openRaceReport_(); };
                btn.className = 'w-full mt-2 bg-purple-700 dark:bg-purple-800 hover:bg-purple-600 dark:hover:bg-purple-700 active:scale-95 text-white font-black py-3 rounded-xl shadow-md transition flex justify-center items-center gap-2';
                btn.innerHTML = '📋 Race Report';
                mobileSection.appendChild(btn);
            }
        })();

        /* ════════════════════════════════════════════════════════════════════
           ADVANCED UX: Checkpoint auto-lock on first log
           ════════════════════════════════════════════════════════════════════
           When `autoLockOnFirstLog` is enabled in localStorage, the app
           automatically locks the Setup panel (checkpoint + volunteer)
           after the first successful bib log. This prevents accidental
           changes mid-session without requiring the volunteer to manually
           click the Lock button.
           ════════════════════════════════════════════════════════════════════ */
        let _autoLockFired = false;
        (function setupAutoLockOnFirstLog_() {
            const orig = window.loadHistory;
            window.loadHistory = function() {
                orig.apply(this, arguments);
                if (_autoLockFired) return;
                const autoLock = localStorage.getItem('autoLockOnFirstLog') === 'true';
                if (!autoLock) return;
                // Check if there's at least one log at the current CP
                if (!db) return;
                const cpVal = (document.getElementById('checkpoint')?.value || '').trim().toUpperCase();
                if (!cpVal) return;
                try {
                    db.transaction(['logs'], 'readonly').objectStore('logs').getAll().onsuccess = function(e) {
                        const logs = e.target.result || [];
                        const hasCpLog = logs.some(l => (l.checkpoint || '').toUpperCase() === cpVal && !l.remake);
                        if (hasCpLog && !isSetupLocked) {
                            _autoLockFired = true;
                            if (typeof toggleLock === 'function') toggleLock();
                        }
                    };
                } catch (err) { /* safe */ }
            };
        })();

        /* ════════════════════════════════════════════════════════════════════
           TOUCH ENHANCEMENT: Swipe-to-dismiss on floating toasts
           ════════════════════════════════════════════════════════════════════
           Any dismissible toast/banner element that is already the active
           element gets a swipe-right-to-dismiss gesture on mobile. This uses
           the Pointer Events API (same as the widget drag system) for full
           cross-device support.
           ════════════════════════════════════════════════════════════════════ */
        (function setupSwipeToDismiss_() {
            const SWIPE_THRESHOLD = 80; // px horizontal movement to trigger dismiss
            let swipeStartX = null;
            let swipeTarget = null;

            document.addEventListener('pointerdown', function(e) {
                const el = e.target.closest('#streakWarningBanner, #successToast, #runnerQuickLookupCard');
                if (!el) return;
                swipeTarget = el;
                swipeStartX = e.clientX;
                el.setPointerCapture(e.pointerId);
            }, { passive: true });

            document.addEventListener('pointermove', function(e) {
                if (!swipeTarget || swipeStartX === null) return;
                const dx = e.clientX - swipeStartX;
                if (dx > 0) {
                    swipeTarget.style.transform = `translateX(${dx}px) translateY(-50%)`;
                    swipeTarget.style.opacity = String(Math.max(0, 1 - dx / SWIPE_THRESHOLD));
                }
            }, { passive: true });

            document.addEventListener('pointerup', function(e) {
                if (!swipeTarget) return;
                const dx = e.clientX - (swipeStartX || 0);
                if (dx >= SWIPE_THRESHOLD) {
                    swipeTarget.style.transition = 'all 0.2s ease';
                    swipeTarget.style.transform = 'translateX(200px) translateY(-50%)';
                    swipeTarget.style.opacity = '0';
                    setTimeout(() => { if (swipeTarget && swipeTarget.parentNode) swipeTarget.remove(); }, 200);
                } else {
                    swipeTarget.style.transform = '';
                    swipeTarget.style.opacity = '';
                }
                swipeTarget = null;
                swipeStartX = null;
            }, { passive: true });
        })();


        /* ════════════════════════════════════════════════════════════════════
           v17 OPERATIONS, AGGREGATES, CLOCK AUDIT, INCIDENTS AND ACCESSIBILITY
           ════════════════════════════════════════════════════════════════════ */

        function announceToScreenReader_(message) {
            if (!screenReaderAnnouncements_ || !message) return;
            const el = document.getElementById('srAnnouncer');
            if (!el) return;
            el.textContent = '';
            setTimeout(() => { el.textContent = String(message); }, 20);
        }

        function applyAppTextScale_() {
            document.body.classList.remove('text-scale-large', 'text-scale-xlarge');
            if (appTextScale_ === 'large') document.body.classList.add('text-scale-large');
            if (appTextScale_ === 'xlarge') document.body.classList.add('text-scale-xlarge');
            requestAnimationFrame(() => renderSafetyVirtualWindow_());
        }

        function getCorrectedNowMs_() { return Date.now() + (Number(clockOffsetMs_) || 0); }
        function parseTimeStrictMs_(value) {
            const raw = String(value || '').trim();
            if (!raw) return NaN;
            let m = raw.match(/^(\d{2})[\/-](\d{2})[\/-](\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)?$/i);
            if (m) { let h=Number(m[4]); const ap=(m[7]||'').toUpperCase(); if(ap==='PM'&&h<12)h+=12;if(ap==='AM'&&h===12)h=0; const d=new Date(Number(m[3]),Number(m[2])-1,Number(m[1]),h,Number(m[5]),Number(m[6])); return d.getTime(); }
            if (/^\d{4}-\d{2}-\d{2}[T\s]/.test(raw)) { const t=Date.parse(raw); return Number.isFinite(t)?t:NaN; }
            return NaN;
        }

        function updateClockDriftSample_(serverTime, requestStartedAt, responseReceivedAt) {
            const serverMs = new Date(serverTime).getTime();
            if (!Number.isFinite(serverMs)) return;
            const start = Number(requestStartedAt) || Date.now();
            const end = Number(responseReceivedAt) || Date.now();
            const midpoint = start + Math.max(0, end - start) / 2;
            const measuredOffset = serverMs - midpoint;
            const confidence = Math.max(1, Math.round(Math.max(0, end - start) / 2));
            if (Math.abs(measuredOffset) > 12 * 60 * 60 * 1000) return;
            const weight = confidence <= 1500 ? 0.35 : confidence <= 5000 ? 0.2 : 0.08;
            clockOffsetMs_ = clockSampleCount_ ? Math.round(clockOffsetMs_ * (1 - weight) + measuredOffset * weight) : Math.round(measuredOffset);
            clockConfidenceMs_ = clockSampleCount_ ? Math.round(clockConfidenceMs_ * 0.7 + confidence * 0.3) : confidence;
            clockSampleCount_++;
            localStorage.setItem('clockOffsetMs_v1', String(clockOffsetMs_));
            localStorage.setItem('clockConfidenceMs_v1', String(clockConfidenceMs_));
            localStorage.setItem('clockSampleCount_v1', String(clockSampleCount_));
        }

        function aggregateCategoryForLog_(log) {
            const cfg = findCategoryConfigForBib_(log?.bib, categoryConfig);
            return String((cfg && cfg.category) || log?.category || 'UNCATEGORIZED').toUpperCase();
        }

        function aggregateEligibleLog_(log) { return !!log && !log.pendingDelete && !isAutoRemovedDuplicate_(log); }
        function adjustAggregateMap_(map, key, delta) {
            if (!key) return;
            map[key] = Math.max(0, Number(map[key] || 0) + delta);
            if (!map[key]) delete map[key];
        }

        function updateAggregateForMutation_(before, after) {
            if (!db || !db.objectStoreNames.contains('aggregates')) return;
            const tx = db.transaction(['aggregates'], 'readwrite');
            const store = tx.objectStore('aggregates');
            const req = store.getAll();
            req.onsuccess = e => {
                const rows = {}; (e.target.result || []).forEach(r => rows[r.key] = r);
                if (!rows.global || !rows.checkpoint || !rows.category || !rows.bib || !rows.sync) {
                    scheduleAggregateRebuild_(true);
                    return;
                }
                const global = rows.global;
                const checkpoint = rows.checkpoint;
                const category = rows.category;
                const bib = rows.bib;
                const sync = rows.sync;
                checkpoint.values = Object.assign({}, checkpoint.values || {});
                category.values = Object.assign({}, category.values || {});
                bib.values = Object.assign({}, bib.values || {});

                const apply = (log, delta) => {
                    if (!aggregateEligibleLog_(log)) return;
                    global.total = Math.max(0, Number(global.total || 0) + delta);
                    if (isDuplicateLog_(log)) global.duplicate = Math.max(0, Number(global.duplicate || 0) + delta);
                    else global.active = Math.max(0, Number(global.active || 0) + delta);
                    if (log.synced) sync.synced = Math.max(0, Number(sync.synced || 0) + delta);
                    else sync.pending = Math.max(0, Number(sync.pending || 0) + delta);
                    adjustAggregateMap_(checkpoint.values, String(log.checkpoint || 'UNSPECIFIED').toUpperCase(), delta);
                    adjustAggregateMap_(category.values, aggregateCategoryForLog_(log), delta);
                    adjustAggregateMap_(bib.values, bibIdentityKey_(log), delta);
                };
                apply(before, -1); apply(after, 1);
                global.uniqueBibs = Object.keys(bib.values).length;
                sync.coverage = global.total ? Math.round(Number(sync.synced || 0) * 100 / global.total) : 100;
                const generatedAt = new Date().toISOString();
                [global, checkpoint, category, bib, sync].forEach(r => { r.generatedAt = generatedAt; store.put(r); });
            };
            req.onerror = () => scheduleAggregateRebuild_();
        }

        function syncPendingOperationalRecords_() {
            if (operationalSyncInFlight_ || !syncUrl || !db) return;
            const incidents = Object.values(localIncidents_).filter(i => i && i.synced === false);
            const alerts = Object.values(localCotAlerts_).filter(a => a && a.synced === false);
            if (!incidents.length && !alerts.length) return;
            operationalSyncInFlight_ = true;
            const jobs = incidents.map(i => fetch(`${syncUrl}${syncUrl.includes('?')?'&':'?'}nocache=${Date.now()}`, {method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action:'incident_upsert',incident:i})})
                .then(r=>r.json()).then(d=>{if(d.status==='success'&&d.incident){const saved=Object.assign({},d.incident,{synced:true});localIncidents_[saved.id]=saved;db.transaction(['incidents'],'readwrite').objectStore('incidents').put(saved);}}))
              .concat(alerts.map(a => fetch(`${syncUrl}${syncUrl.includes('?')?'&':'?'}nocache=${Date.now()}`, {method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action:'cot_alert_upsert',alert:a})})
                .then(r=>r.json()).then(d=>{if(d.status==='success'&&d.alert){const saved=Object.assign({},d.alert,{synced:true});localCotAlerts_[saved.key]=saved;db.transaction(['cotAlerts'],'readwrite').objectStore('cotAlerts').put(saved);}})));
            Promise.allSettled(jobs).finally(()=>{operationalSyncInFlight_=false;renderIncidentWidget_();renderSafetyCotAlerts_();});
        }

        function scheduleAggregateRebuild_(immediate) {
            if (!db || !db.objectStoreNames.contains('aggregates')) return;
            if (aggregateRebuildTimer_) clearTimeout(aggregateRebuildTimer_);
            aggregateRebuildTimer_ = setTimeout(() => { aggregateRebuildTimer_ = null; rebuildAggregateStore_(); }, immediate ? 0 : 500);
        }

        function rebuildAggregateStore_() {
            if (!db || !db.objectStoreNames.contains('aggregates')) return;
            const byCheckpoint = {}, byCategory = {}, byBib = {};
            let total = 0, synced = 0, pending = 0, duplicate = 0, active = 0;
            const tx = db.transaction(['logs'], 'readonly');
            const cursorReq = tx.objectStore('logs').openCursor();
            cursorReq.onsuccess = e => {
                const cursor = e.target.result;
                if (!cursor) return;
                const log = cursor.value;
                if (aggregateEligibleLog_(log)) {
                    total++;
                    if (isDuplicateLog_(log)) duplicate++; else active++;
                    if (log.synced) synced++; else pending++;
                    const cp = String(log.checkpoint || 'UNSPECIFIED').toUpperCase();
                    const cat = aggregateCategoryForLog_(log);
                    const bib = bibIdentityKey_(log);
                    byCheckpoint[cp] = (byCheckpoint[cp] || 0) + 1;
                    byCategory[cat] = (byCategory[cat] || 0) + 1;
                    if (bib) byBib[bib] = (byBib[bib] || 0) + 1;
                }
                cursor.continue();
            };
            tx.oncomplete = () => {
                const writtenAt = new Date().toISOString();
                const writeTx = db.transaction(['aggregates'], 'readwrite');
                const store = writeTx.objectStore('aggregates');
                store.put({ key: 'global', total, active, duplicate, uniqueBibs: Object.keys(byBib).length, generatedAt: writtenAt });
                store.put({ key: 'checkpoint', values: byCheckpoint, generatedAt: writtenAt });
                store.put({ key: 'category', values: byCategory, generatedAt: writtenAt });
                store.put({ key: 'bib', values: byBib, generatedAt: writtenAt });
                store.put({ key: 'sync', synced, pending, coverage: total ? Math.round(synced * 100 / total) : 100, generatedAt: writtenAt });
            };
        }

        function readAggregateSnapshot_(callback) {
            if (!db || !db.objectStoreNames.contains('aggregates')) { callback({}); return; }
            const req = db.transaction(['aggregates'], 'readonly').objectStore('aggregates').getAll();
            req.onsuccess = e => {
                const out = {};
                (e.target.result || []).forEach(row => { out[row.key] = row; });
                callback(out);
            };
            req.onerror = () => callback({});
        }

        function renderAggregateFastStats_() {
            readAggregateSnapshot_(snapshot => {
                const container = document.getElementById('directorStatTiles');
                if (!container || !snapshot.global) return;
                const g = snapshot.global, sync = snapshot.sync || {};
                container.innerHTML = [
                    ['Total Logs', g.active || 0], ['Unique Runners', g.uniqueBibs || 0],
                    ['Checkpoints', Object.keys((snapshot.checkpoint || {}).values || {}).length],
                    ['Categories', Object.keys((snapshot.category || {}).values || {}).length],
                    ['Pending Sync', sync.pending || 0], ['Local Coverage', (sync.coverage ?? 100) + '%']
                ].map(([label,value]) => `<div class="theme-panel rounded-xl border shadow-sm px-3 py-3"><div class="text-[9px] theme-text-muted font-black uppercase">${escapeHtml_(label)}</div><div class="aggregate-fast-stat text-2xl font-black">${escapeHtml_(String(value))}</div></div>`).join('');
            });
        }

        function renderSafetyRowHtml_(r, absoluteIndex) {
            const statusOptions = ['', 'ok', 'dns', 'dnf', 'withdrawn', 'medical', 'missing'].map(st => `<option value="${st}" ${r._safetyStatus === st ? 'selected' : ''}>${st ? SAFETY_STATUS_LABELS_[st] : '— set status —'}</option>`).join('');
            const updatedLabel = r._safetyUpdatedAt ? `${formatLogTime(r._safetyUpdatedAt)}${r._safetyUpdatedBy ? ' • ' + r._safetyUpdatedBy : ''}` : '';
            const rowFlagClass = r._safetyStatus === 'missing' ? 'bg-red-100/60 dark:bg-red-900/20' : r._safetyStatus === 'medical' ? 'bg-orange-100/60 dark:bg-orange-900/20' : r._safetyStatus === 'withdrawn' ? 'bg-neutral-200/60 dark:bg-neutral-800/40' : '';
            const routeFlag = r._routeIssue ? `<span class="text-red-600 font-black" title="${escapeHtmlAttr_(r._routeIssue)}">⚠ route</span>` : '';
            const collisionBadge = bibCollisionBadgeHtml_(r);
            return `<tr class="${rowFlagClass}" aria-rowindex="${Number(absoluteIndex || 0) + 2}">
                <td class="p-2 pl-3 font-black bib-text-highlight whitespace-nowrap">${escapeHtml_(r.bib)} ${collisionBadge} ${routeFlag}</td>
                <td class="p-2 whitespace-nowrap font-black">${escapeHtml_(formatKmLabel_(r.km))}</td>
                <td class="p-2 whitespace-nowrap">${escapeHtml_(r.category || '-')}</td>
                <td class="p-2 whitespace-nowrap">${escapeHtml_(r.checkpoint || '-')}</td>
                <td class="p-2 text-center font-black font-mono">${escapeHtml_(String(r._passageCount || 1))}</td>
                <td class="p-2 whitespace-nowrap text-[11px] theme-text-muted">${escapeHtml_(formatLogTime(r.time))}</td>
                <td class="p-2"><select onchange="setSafetyNote_('${encodeInlineArg_(r.bib)}', this.value, document.getElementById('remark-${encodeInlineArg_(r.bib)}')?.value || '')" class="theme-input border rounded px-1.5 py-1 text-[11px]">${statusOptions}</select></td>
                <td class="p-2"><input type="text" id="remark-${encodeInlineArg_(r.bib)}" value="${escapeHtmlAttr_(r._safetyRemark || '')}" onblur="setSafetyNote_('${encodeInlineArg_(r.bib)}', undefined, this.value)" onkeydown="if(event.key==='Enter') this.blur();" class="w-full theme-input border rounded px-2 py-1 text-[11px]"></td>
                <td class="p-2 text-[10px] theme-text-muted whitespace-nowrap">${escapeHtml_(updatedLabel || '-')}</td></tr>`;
        }

        function getSafetyVirtualRowHeight_() {
            if (document.body.classList.contains('text-scale-xlarge')) return 80;
            if (document.body.classList.contains('text-scale-large')) return 68;
            return SAFETY_VIRTUAL_ROW_HEIGHT_;
        }

        function updateSafetyBibColumnWidth_(roster) {
            const table = document.getElementById('safetyLogTable');
            if (!table) return;
            const values = (roster || []).slice(0, 3000).map(row => String(row?.bib || '').trim()).filter(Boolean);
            let measured = 0;
            try {
                const canvas = updateSafetyBibColumnWidth_.canvas || (updateSafetyBibColumnWidth_.canvas = document.createElement('canvas'));
                const context = canvas.getContext('2d');
                if (context) {
                    context.font = '900 12px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
                    measured = Math.max(context.measureText('BIB ↑').width, ...values.map(value => context.measureText(value).width));
                }
            } catch (_) { measured = 0; }
            if (!measured) measured = Math.max(34, ...values.map(value => Math.min(22, value.length) * 7.2));
            const hasBadges = (roster || []).some(row => row?._routeIssue || row?.bibCollision || row?._bibCollision);
            const width = Math.max(72, Math.min(220, Math.ceil(measured + (hasBadges ? 62 : 34))));
            table.style.setProperty('--safety-bib-col-width', width + 'px');
        }

        function setSafetyVirtualRoster_(roster) {
            safetyVirtualRoster_ = roster || [];
            updateSafetyBibColumnWidth_(safetyVirtualRoster_);
            safetyVirtualRenderToken_++;
            const viewport = document.getElementById('safetyTableViewport');
            if (viewport && viewport.scrollTop > safetyVirtualRoster_.length * getSafetyVirtualRowHeight_()) viewport.scrollTop = 0;
            renderSafetyVirtualWindow_();
        }

        function renderSafetyVirtualWindow_() {
            const body = document.getElementById('safetyLogBody');
            const viewport = document.getElementById('safetyTableViewport');
            if (!body || !viewport) return;
            const total = safetyVirtualRoster_.length;
            if (!total) { body.innerHTML = ''; return; }
            const table = document.getElementById('safetyLogTable');
            if (table) table.setAttribute('aria-rowcount', String(total + 1));

            // A few hundred runner rows are inexpensive on current phones and rendering
            // them normally avoids Safari table-spacer bugs that created a large blank
            // band above the first BIB. Virtualization remains for unusually large races.
            if (total <= SAFETY_VIRTUAL_THRESHOLD_) {
                const renderToken = String(safetyVirtualRenderToken_);
                if (body.dataset.safetyRenderToken !== renderToken) {
                    body.innerHTML = safetyVirtualRoster_.map((row, index) => renderSafetyRowHtml_(row, index)).join('');
                    body.dataset.safetyRenderToken = renderToken;
                }
                body.classList.add('safety-nonvirtual-body');
                return;
            }
            delete body.dataset.safetyRenderToken;
            body.classList.remove('safety-nonvirtual-body');
            const rowHeight = getSafetyVirtualRowHeight_();
            const visibleCount = Math.ceil((viewport.clientHeight || 600) / rowHeight);
            const start = Math.max(0, Math.floor(viewport.scrollTop / rowHeight) - SAFETY_VIRTUAL_OVERSCAN_);
            const end = Math.min(total, start + visibleCount + SAFETY_VIRTUAL_OVERSCAN_ * 2);
            const topHeight = start * rowHeight;
            const bottomHeight = Math.max(0, (total - end) * rowHeight);
            const rows = safetyVirtualRoster_.slice(start, end).map((row, i) => renderSafetyRowHtml_(row, start + i)).join('');
            const topSpacer = topHeight > 0 ? `<tr class="virtual-spacer-row" aria-hidden="true"><td colspan="9" class="virtual-spacer-cell" style="height:${topHeight}px"></td></tr>` : '';
            const bottomSpacer = bottomHeight > 0 ? `<tr class="virtual-spacer-row" aria-hidden="true"><td colspan="9" class="virtual-spacer-cell" style="height:${bottomHeight}px"></td></tr>` : '';
            body.innerHTML = `${topSpacer}${rows}${bottomSpacer}`;
        }

        function buildRouteModelsClientFromLogs_(logs) {
            const grouped = new Map();
            const byRunner = new Map();
            (logs || []).filter(isCountableLog_).forEach(log => {
                const bib = bibIdentityKey_(log);
                if (!bib) return;
                if (!byRunner.has(bib)) byRunner.set(bib, []);
                byRunner.get(bib).push(log);
            });
            byRunner.forEach((runnerLogs, bib) => {
                const cfg = findCategoryConfigForBib_(runnerLogs[0]?.bib, categoryConfig) || inferRouteConfigFromHistory_(runnerLogs, '');
                const key = routeCategoryKeyForConfig_(cfg);
                if (!key) return;
                if (!grouped.has(key)) grouped.set(key, { cfg, byBib: new Map() });
                grouped.get(key).byBib.set(bib, runnerLogs);
            });
            const models = {};
            grouped.forEach((group, key) => {
                const entrants = Array.from(group.byBib.entries()).map(([bib, rows]) => ({ bib, first: Math.min(...rows.map(r => parseCustomOrIsoDate(r.time).getTime()).filter(Number.isFinite)) })).sort((a,b) => a.first-b.first || a.bib.localeCompare(b.bib));
                const pioneers = entrants.slice(0,30).map(e => e.bib);
                const cfg = group.cfg || {};
                const sequence = Array.isArray(cfg.checkpointSequence) ? cfg.checkpointSequence.map(v=>String(v).trim().toUpperCase()).filter(Boolean) : [];
                const transitions = {};
                const addEdge = (from,to,count=1,support=1) => {
                    if (!from || !to) return;
                    if (!transitions[from]) transitions[from]=[];
                    if (!transitions[from].some(e=>e.to===to)) transitions[from].push({to,count,support});
                };
                if (sequence.length) {
                    for (let i=0;i<sequence.length-1;i++) addEdge(sequence[i],sequence[i+1],pioneers.length,1);
                } else {
                    const fromRunners = {}, edgeRunners = {};
                    pioneers.forEach(bib => {
                        const cps=[];
                        (group.byBib.get(bib)||[]).slice().sort((a,b)=>parseCustomOrIsoDate(a.time)-parseCustomOrIsoDate(b.time)).forEach(r=>{const cp=String(r.checkpoint||'').trim().toUpperCase();if(cp&&cps[cps.length-1]!==cp)cps.push(cp);});
                        const seenFrom=new Set(), seenEdges=new Set();
                        for(let i=0;i<cps.length-1;i++){seenFrom.add(cps[i]);seenEdges.add(`${cps[i]}>${cps[i+1]}`);}
                        seenFrom.forEach(from=>fromRunners[from]=(fromRunners[from]||0)+1);
                        seenEdges.forEach(edge=>edgeRunners[edge]=(edgeRunners[edge]||0)+1);
                    });
                    const byFrom={}; Object.entries(edgeRunners).forEach(([edge,count])=>{const cut=edge.indexOf('>');const from=edge.slice(0,cut),to=edge.slice(cut+1);(byFrom[from]||(byFrom[from]=[])).push({to,count,support:count/Math.max(1,fromRunners[from]||1)});});
                    Object.entries(byFrom).forEach(([from,edges])=>{const max=Math.max(...edges.map(e=>e.count));transitions[from]=edges.filter(e=>(fromRunners[from]||0)>=3&&(e.count===max||e.support>=0.5)).sort((a,b)=>b.count-a.count||a.to.localeCompare(b.to));});
                }
                models[key]={key,km:cfg.km||'',category:cfg.category||'',source:sequence.length?'configured':'pioneer-majority',pioneers,pioneerCount:pioneers.length,ready:pioneers.length>=30,sequence,maxJump:Math.max(1,Number(cfg.maxCheckpointJump)||1),transitions};
            });
            return models;
        }

        function buildRouteValidation_(logs) {
            const issues = [];
            const localModels = Object.keys(routeModelsByKey_ || {}).length ? routeModelsByKey_ : buildRouteModelsClientFromLogs_(logs);
            const byBib = new Map();
            (logs || []).filter(isCountableLog_).forEach(log => {
                const bib = bibIdentityKey_(log);
                if (!bib) return;
                if (!byBib.has(bib)) byBib.set(bib, []);
                byBib.get(bib).push(log);
            });
            byBib.forEach((runnerLogs, bib) => {
                const cfg = findCategoryConfigForBib_(runnerLogs[0]?.bib, categoryConfig) || inferRouteConfigFromHistory_(runnerLogs, '');
                const model = localModels[routeCategoryKeyForConfig_(cfg)];
                if (!model || !model.ready || (model.pioneers || []).map(bibIdentityKey_).includes(bib)) return;
                const cps=[];
                runnerLogs.slice().sort((a,b)=>parseCustomOrIsoDate(a.time)-parseCustomOrIsoDate(b.time)).forEach(log=>{const cp=String(log.checkpoint||'').trim().toUpperCase();if(cp&&cps[cps.length-1]!==cp)cps.push(cp);});
                if (Array.isArray(model.sequence) && model.sequence.length) {
                    const aligned=alignObservedRouteToSequence_(cps,model.sequence);
                    if (!aligned) { if(cps.length>1)issues.push({bib,type:'abnormal',message:`Route does not match ${model.category||'category'} sequence`}); return; }
                    const maxJump=Math.max(1,Number(model.maxJump)||1);
                    for(let i=1;i<aligned.path.length;i++){const a=aligned.path[i-1],b=aligned.path[i];if(b-a>maxJump){const missing=model.sequence.slice(a+1,b);issues.push({bib,type:'skip',from:model.sequence[a],to:model.sequence[b],message:`Skipped ${missing.join(' → ')} (${model.sequence[a]} → ${model.sequence[b]})`});}}
                    return;
                }
                for(let i=1;i<cps.length;i++){
                    const from=cps[i-1],to=cps[i],direct=routeTransitionOptions_(model,from);
                    if(!direct.length||direct.some(e=>String(e.to).toUpperCase()===to))continue;
                    const path=findRoutePath_(model,from,to);
                    issues.push({bib,type:path&&path.length>2?'skip':'abnormal',from,to,message:path&&path.length>2?`Skipped ${path.slice(1,-1).join(' → ')} (${from} → ${to})`:`Unusual route ${from} → ${to}`});
                }
            });
            return issues;
        }

        async function fetchOperationsSummary_() {
            if (!syncUrl) return;
            const started = Date.now();
            try {
                const sep = syncUrl.includes('?') ? '&' : '?';
                const res = await fetchWithTimeout(`${syncUrl}${sep}action=operations&nocache=${Date.now()}`, {}, 20000);
                const data = await res.json();
                if (data.status !== 'success') throw new Error(data.message || 'Operations summary rejected');
                serverOperationsSummary_ = data;
                applyRouteModelsFromPayload_(data);
                applyGoogleMapsConfigFromPayload_(data);
                if (data.serverTime) updateClockDriftSample_(data.serverTime, started, Date.now());
                if (Array.isArray(data.incidents)) mergeIncidentsIntoLocal_(data.incidents);
                if (Array.isArray(data.cotAlerts)) mergeCotAlertsIntoLocal_(data.cotAlerts);
                renderServerOperationsCards_();
                renderArrivalForecast_([]);
                renderDeviceHealthWidget_();
                if (isDirectorModeOpen && typeof getEnrichedLogsFromDb_ === 'function') {
                    getEnrichedLogsFromDb_(logs => renderDirectorGpsMap_(logs || []));
                }
                renderIncidentWidget_();
                renderDataIntegrityWidget_([]);
            } catch (e) { console.warn('Operations summary unavailable', e); }
        }

        function renderServerOperationsCards_() {
            const container = document.getElementById('directorOperationsBody');
            const s = serverOperationsSummary_;
            if (!container || !s) return;
            const totals = s.totals || {}, arrivals = s.arrivals || {}, cps = s.checkpoints || {};
            const activeCps = Object.values(cps).filter(v => v.lastSeen && Date.now() - Number(v.lastSeen) <= 15*60000).length;
            const cards = [
                ['Arrivals 5 min', arrivals.last5 || 0, `${arrivals.last15 || 0} in 15 min · ${arrivals.last60 || 0} in 60 min`],
                ['Active checkpoints', `${activeCps}/${Object.keys(cps).length}`, 'Cached server summary'],
                ['Unique runners', totals.uniqueBibs || 0, `${totals.activeScans || 0} active scans`],
                ['Pending BIB sync', Number(window.RaceState?.getState?.().queueSummary?.logs || 0), 'Operational records sync in the background'],
                ['COT requiring action', totals.unacknowledgedCotAlerts || 0, 'Open cutoff risks only'],
                ['Generated', formatLogTime(s.generatedAt), `Server v${s.appVersion || '?'}`]
            ];
            container.innerHTML = `<div class="monitor-stat-grid">${cards.map(c=>`<div class="monitor-stat-card"><div class="monitor-label">${escapeHtml_(c[0])}</div><div class="monitor-value">${escapeHtml_(String(c[1]))}</div><div class="monitor-sub">${escapeHtml_(c[2])}</div></div>`).join('')}</div>`;
            setDirectorWidgetEmptyState_('operations', false);
        }

        function renderArrivalForecast_(allLogs) {
            const el = document.getElementById('directorForecastBody'); if (!el) return;
            let forecast = serverOperationsSummary_?.forecast || [];
            if (!forecast.length && allLogs?.length) {
                const now = Date.now(), cp = {};
                allLogs.filter(isCountableLog_).forEach(l => {
                    const ts = parseCustomOrIsoDate(l.time).getTime();
                    if (!Number.isFinite(ts) || now - ts > 3600000 || now < ts) return;
                    const k = l.checkpoint || 'Unspecified';
                    cp[k] = cp[k] || { a15: 0, a60: 0 };
                    cp[k].a60++;
                    if (now - ts <= 900000) cp[k].a15++;
                });
                forecast = Object.entries(cp).map(([checkpoint, v]) => {
                    const recent = v.a15 / 15;
                    const older = Math.max(0, v.a60 - v.a15) / 45;
                    const delta = recent - older;
                    const rate = Math.max(0, recent * 0.7 + older * 0.3 + delta * 0.2);
                    return {
                        checkpoint,
                        next10: Math.round(rate * 10), next20: Math.round(rate * 20), next30: Math.round(rate * 30),
                        scansPerMinute: Number(rate.toFixed(2)), confidence: v.a60 >= 20 ? 'high' : v.a60 >= 6 ? 'medium' : 'low',
                        trend: recent > older + .15 ? 'rising' : recent < older - .15 ? 'falling' : 'steady'
                    };
                }).sort((a, b) => b.next10 - a.next10 || b.next30 - a.next30);
            }
            if (!forecast.length) { el.innerHTML='<div class="text-center theme-text-muted text-xs">Not enough recent arrivals to forecast.</div>'; setDirectorWidgetEmptyState_('forecast',true); return; }
            el.innerHTML = forecast.slice(0, 16).map(f => `<div class="forecast-row"><strong>${escapeHtml_(f.checkpoint)}</strong><span>${Number(f.next10)||0} / ${Number(f.next20)||0} / ${Number(f.next30)||0} runners in 10 / 20 / 30m · ${Number(f.scansPerMinute||0).toFixed(2)}/min</span><span class="${f.trend==='rising'?'ops-status-warn':f.trend==='falling'?'ops-status-good':''}">${f.trend==='rising'?'↗':f.trend==='falling'?'↘':'→'} ${escapeHtml_(f.trend||'steady')} · ${escapeHtml_(f.confidence||'low')} confidence</span></div>`).join('');
            setDirectorWidgetEmptyState_('forecast', false);
        }

        function renderDeviceHealthWidget_() {
            const el=document.getElementById('directorHealthBody'); if(!el)return;
            const devices=serverOperationsSummary_?.devices || [];
            if(!devices.length){el.innerHTML='<div class="text-center theme-text-muted text-xs">No device reports yet.</div>';setDirectorWidgetEmptyState_('health',true);return;}
            el.innerHTML=devices.sort((a,b)=>new Date(b.lastSeen)-new Date(a.lastSeen)).map(d=>{
                const battery=d.batteryPercent===null||d.batteryPercent===undefined?'—':Math.round(d.batteryPercent*100)+'%';
                const stale=!d.lastSeen||Date.now()-new Date(d.lastSeen).getTime()>3*60000;
                const drift=Math.round((Number(d.clockOffsetMs)||0)/1000);
                return `<div class="device-health-row"><strong>${escapeHtml_(d.checkpoint||d.deviceId||'Device')}</strong><span class="${stale?'ops-status-bad':'ops-status-good'}">${stale?'stale':'online'} · 🔋 ${battery} · queue ${d.queueCount||0}</span><span>${d.storageUsedMb==null?'storage —':Math.round(d.storageUsedMb)+' MB'} · drift ${drift}s · v${escapeHtml_(d.appVersion||'?')}</span></div>`;
            }).join(''); setDirectorWidgetEmptyState_('health',false);
        }

        function loadLocalIncidents_() {
            if(!db||!db.objectStoreNames.contains('incidents'))return;
            const req=db.transaction(['incidents'],'readonly').objectStore('incidents').getAll();
            req.onsuccess=e=>{localIncidents_={};(e.target.result||[]).forEach(i=>localIncidents_[i.id]=i);renderIncidentWidget_();};
        }
        function loadLocalCotAlerts_() {
            if(!db||!db.objectStoreNames.contains('cotAlerts'))return;
            const req=db.transaction(['cotAlerts'],'readonly').objectStore('cotAlerts').getAll();
            req.onsuccess=e=>{localCotAlerts_={};(e.target.result||[]).forEach(a=>localCotAlerts_[a.key]=a);renderSafetyCotAlerts_();};
        }
        function mergeIncidentsIntoLocal_(items){if(!db||!db.objectStoreNames.contains('incidents'))return;const tx=db.transaction(['incidents'],'readwrite'),store=tx.objectStore('incidents');(items||[]).forEach(i=>{const local=localIncidents_[i.id];if(local&&local.synced===false)return;const m=Object.assign({},i,{synced:true});localIncidents_[m.id]=m;store.put(m);});tx.oncomplete=renderIncidentWidget_;}
        function mergeCotAlertsIntoLocal_(items){if(!db||!db.objectStoreNames.contains('cotAlerts'))return;const tx=db.transaction(['cotAlerts'],'readwrite'),store=tx.objectStore('cotAlerts');(items||[]).forEach(a=>{const local=localCotAlerts_[a.key];if(local&&local.synced===false)return;const m=Object.assign({},a,{synced:true});localCotAlerts_[m.key]=m;store.put(m);});tx.oncomplete=()=>{renderSafetyCotAlerts_();renderDirectorCotCountdown_(lastKnownSummaryRows);};}

        function openIncidentModal_(incidentId, bib) {
            const decodedId = incidentId ? decodeURIComponent(incidentId) : '';
            const incident = decodedId ? localIncidents_[decodedId] : null;
            document.getElementById('incidentIdInput').value = incident?.id || '';
            document.getElementById('incidentBibInput').value = incident?.bib || bib || '';
            document.getElementById('incidentTypeSelect').value = incident?.type || 'medical';
            document.getElementById('incidentSeveritySelect').value = incident?.severity || 'medium';
            document.getElementById('incidentStatusSelect').value = incident?.status || 'open';
            document.getElementById('incidentCheckpointInput').value = incident?.checkpoint || (document.getElementById('checkpoint')?.value || '');
            document.getElementById('incidentTransportInput').value = incident?.transport || '';
            document.getElementById('incidentOwnerInput').value = incident?.owner || '';
            document.getElementById('incidentDestinationInput').value = incident?.destination || '';
            document.getElementById('incidentCallCountInput').value = Math.max(0, Number(incident?.callCount) || 0);
            document.getElementById('incidentSearchCountInput').value = Math.max(0, Number(incident?.searchCount) || 0);
            document.getElementById('incidentLastSightingInput').value = incident?.lastSighting || '';
            document.getElementById('incidentNotesInput').value = incident?.notes || '';
            document.getElementById('incidentResolutionInput').value = incident?.resolution || '';
            document.getElementById('incidentModal').classList.remove('hidden');
        }
        function closeIncidentModal_(){document.getElementById('incidentModal')?.classList.add('hidden');}
        function saveIncident_(){
            if(!db||!db.objectStoreNames.contains('incidents'))return;
            const id=document.getElementById('incidentIdInput').value||generateUID();
            const existing=localIncidents_[id]||{};
            const now=new Date().toISOString();
            const status=document.getElementById('incidentStatusSelect').value;
            const resolution=(document.getElementById('incidentResolutionInput')?.value||'').trim();
            if(['resolved','closed'].includes(status)&&!resolution){
                alert('Add a resolution / outcome before resolving or closing the incident.');
                document.getElementById('incidentResolutionInput')?.focus();
                return;
            }
            const acknowledgedAt=existing.acknowledgedAt||(['responding','dispatched','monitoring','resolved','closed'].includes(status)?now:'');
            const resolvedAt=['resolved','closed'].includes(status)?(existing.resolvedAt||now):'';
            const incident={
                id,
                bib:(document.getElementById('incidentBibInput').value||'').trim().toUpperCase(),
                type:document.getElementById('incidentTypeSelect').value,
                severity:document.getElementById('incidentSeveritySelect').value,
                status,
                checkpoint:(document.getElementById('incidentCheckpointInput').value||'').trim().toUpperCase(),
                transport:(document.getElementById('incidentTransportInput').value||'').trim(),
                owner:(document.getElementById('incidentOwnerInput').value||'').trim(),
                destination:(document.getElementById('incidentDestinationInput')?.value||'').trim(),
                callCount:Math.max(0,Number(document.getElementById('incidentCallCountInput')?.value)||0),
                searchCount:Math.max(0,Number(document.getElementById('incidentSearchCountInput')?.value)||0),
                lastSighting:(document.getElementById('incidentLastSightingInput')?.value||'').trim(),
                notes:(document.getElementById('incidentNotesInput').value||'').trim(),
                resolution,
                acknowledgedAt,
                resolvedAt,
                createdAt:existing.createdAt||now,
                updatedAt:now,
                updatedBy:(document.getElementById('volunteer')?.value||'').trim().toUpperCase(),
                deviceId:getOrCreateDeviceId(),
                synced:false
            };
            localIncidents_[id]=incident;
            const tx=db.transaction(['incidents'],'readwrite');
            tx.objectStore('incidents').put(incident);
            tx.oncomplete=()=>{closeIncidentModal_();renderIncidentWidget_();announceToScreenReader_(`Incident saved for bib ${incident.bib||'unspecified'}.`);pushIncidentToServer_(incident);if(window.RaceDirectorOpsV192)window.RaceDirectorOpsV192.render();};
        }
        function pushIncidentToServer_(incident){if(!syncUrl)return;fetch(`${syncUrl}${syncUrl.includes('?')?'&':'?'}nocache=${Date.now()}`,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action:'incident_upsert',incident})}).then(r=>r.json()).then(data=>{if(data.status==='success'&&data.incident){const c=Object.assign({},data.incident,{synced:true});localIncidents_[c.id]=c;db?.transaction(['incidents'],'readwrite').objectStore('incidents').put(c);renderIncidentWidget_();}}).catch(()=>{});}
        function pullIncidentsFromServer_(){if(!syncUrl)return;fetch(`${syncUrl}${syncUrl.includes('?')?'&':'?'}action=incidents&nocache=${Date.now()}`).then(r=>r.json()).then(d=>{if(d.status==='success')mergeIncidentsIntoLocal_(d.incidents||[]);}).catch(()=>{});}
        function renderIncidentWidget_(){const el=document.getElementById('directorIncidentsBody');const safety=document.getElementById('safetyIncidentPanel');const items=Object.values(localIncidents_).filter(i=>!['closed','resolved'].includes(String(i.status||'').toLowerCase())).sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt));const html=items.slice(0,30).map(i=>`<button type="button" onclick="openIncidentModal_('${encodeInlineArg_(i.id)}')" class="incident-row incident-severity-${escapeHtmlAttr_(i.severity||'medium')} text-left w-full"><strong>${escapeHtml_(i.bib||'No bib')} · ${escapeHtml_(i.type||'incident')}</strong><span>${escapeHtml_(i.status||'open')} · ${escapeHtml_(i.checkpoint||'location pending')}</span><span>${escapeHtml_(i.owner||'unassigned')} · ${formatLogTime(i.updatedAt)}</span></button>`).join('');if(el){if(!items.length){el.innerHTML='<div class="text-center theme-text-muted text-xs">No open incidents.</div>';setDirectorWidgetEmptyState_('incidents',true);}else{el.innerHTML=html;setDirectorWidgetEmptyState_('incidents',false);}}if(safety){safety.classList.toggle('hidden',!items.length);safety.innerHTML=items.length?`<div class="flex items-center justify-between mb-2"><strong class="text-xs">🚨 Open incidents (${items.length})</strong><button onclick="openIncidentModal_()" class="theme-input border rounded px-2 py-1 text-[10px] font-black">＋ Add</button></div>${html}`:'';}}

        function cotAlertKey_(bib,cotTime){return `${String(bib||'').toUpperCase()}|${String(cotTime||'')}`;}
        function evaluateCotAlerts_(logs){
            if(!cotAlertsEnabled_||!db||!db.objectStoreNames.contains('cotAlerts'))return;
            const roster=buildSafetyRosterFromLogs_(logs||[]),now=getCorrectedNowMs_(),updates=[];
            roster.forEach(r=>{if(isCompletionCheckpoint_(r.checkpoint))return;const cfg=findCategoryConfigForBib_(r.bib,categoryConfig);if(!cfg||!cfg.cotTime)return;const cot=parseCustomOrIsoDate(cfg.cotTime).getTime();if(!Number.isFinite(cot))return;const remain=(cot-now)/60000;const warning=cfg.cotWarningMinutes??cotWarningMinutes_, escalation=cfg.cotEscalationMinutes??cotEscalationMinutes_;let level='';if(remain<=0)level='overdue';else if(remain<=escalation)level='critical';else if(remain<=warning)level='warning';if(!level)return;const key=cotAlertKey_(r.bib,cfg.cotTime),existing=localCotAlerts_[key]||{};const changed=!existing.key||existing.level!==level||existing.escalated!==(level==='critical'||level==='overdue');const alert=Object.assign({},existing,{key,bib:r.bib,category:cfg.category||r.category||'',cotTime:cfg.cotTime,level,escalated:level==='critical'||level==='overdue',updatedAt:new Date().toISOString(),synced:changed?false:existing.synced!==false});localCotAlerts_[key]=alert;if(changed||!existing.key)updates.push(alert);});
            const completedBibs=new Set(roster.filter(r=>isCompletionCheckpoint_(r.checkpoint)).map(bibIdentityKey_).filter(Boolean));
            Object.values(localCotAlerts_).forEach(a=>{if(!a.acknowledged&&completedBibs.has(bibIdentityKey_(a.bib))){a.acknowledged=true;a.acknowledgedBy='SYSTEM-FINISH';a.acknowledgedAt=new Date(now).toISOString();a.updatedAt=a.acknowledgedAt;a.synced=false;updates.push(a);}});
            if(updates.length){const dedup=[...new Map(updates.map(a=>[a.key,a])).values()];const tx=db.transaction(['cotAlerts'],'readwrite'),store=tx.objectStore('cotAlerts');dedup.forEach(a=>store.put(a));tx.oncomplete=()=>{renderSafetyCotAlerts_();syncPendingOperationalRecords_();const unack=dedup.filter(a=>!a.acknowledged);if(unack.length)announceToScreenReader_(`${unack.length} cutoff alert${unack.length===1?'':'s'} require acknowledgement.`);};}
        }
        function acknowledgeCotAlert_(key){const a=localCotAlerts_[decodeURIComponent(key)]||localCotAlerts_[key];if(!a)return;a.acknowledged=true;a.acknowledgedBy=(document.getElementById('volunteer')?.value||'').trim().toUpperCase();a.acknowledgedAt=new Date().toISOString();a.synced=false;db?.transaction(['cotAlerts'],'readwrite').objectStore('cotAlerts').put(a);renderSafetyCotAlerts_();if(syncUrl)fetch(`${syncUrl}${syncUrl.includes('?')?'&':'?'}nocache=${Date.now()}`,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action:'cot_alert_upsert',alert:a})}).then(r=>r.json()).then(d=>{if(d.status==='success'){a.synced=true;localCotAlerts_[a.key]=a;db?.transaction(['cotAlerts'],'readwrite').objectStore('cotAlerts').put(a);}}).catch(()=>{});}
        function pullCotAlertsFromServer_(){if(!syncUrl)return;fetch(`${syncUrl}${syncUrl.includes('?')?'&':'?'}action=cot_alerts&nocache=${Date.now()}`).then(r=>r.json()).then(d=>{if(d.status==='success')mergeCotAlertsIntoLocal_(d.cotAlerts||[]);}).catch(()=>{});}
        function toggleSafetyCotAlertsExpanded_(){safetyCotAlertsExpanded_=!safetyCotAlertsExpanded_;renderSafetyCotAlerts_();}
        function renderSafetyCotAlerts_(){
            const panel=document.getElementById('safetyCotAlertsPanel');if(!panel)return;
            const rank={overdue:0,critical:1,warning:2};
            const alerts=Object.values(localCotAlerts_).filter(a=>!a.acknowledged).sort((a,b)=>(rank[String(a.level||'').toLowerCase()]??9)-(rank[String(b.level||'').toLowerCase()]??9)||new Date(a.cotTime)-new Date(b.cotTime));
            panel.classList.toggle('hidden',!alerts.length);
            panel.classList.toggle('critical',alerts.some(a=>a.level==='critical'||a.level==='overdue'));
            if(!alerts.length){panel.innerHTML='';safetyCotAlertsExpanded_=false;return;}
            if(alerts.length<=3)safetyCotAlertsExpanded_=false;
            const visible=safetyCotAlertsExpanded_?alerts:alerts.slice(0,3);
            const hiddenCount=Math.max(0,alerts.length-visible.length);
            const detail=safetyCotAlertsExpanded_?'All alerts shown':hiddenCount?`Showing 3 highest-priority alerts · ${hiddenCount} more collapsed`:'All alerts shown';
            const toggle=alerts.length>3?`<button type="button" class="cot-alert-expand-btn" onclick="toggleSafetyCotAlertsExpanded_()" aria-expanded="${safetyCotAlertsExpanded_?'true':'false'}">${safetyCotAlertsExpanded_?'Collapse all':`Expand all (${alerts.length})`}</button>`:'';
            panel.innerHTML=`<div class="cot-alert-banner-header"><div class="cot-alert-banner-heading"><strong>⏱️ ${alerts.length} COT alert${alerts.length===1?'':'s'} require acknowledgement</strong><span>${detail}</span></div>${toggle}</div>${visible.map(a=>`<div class="cot-alert-row"><strong>Bib ${escapeHtml_(a.bib)} · ${escapeHtml_(a.level)}</strong><span>${escapeHtml_(a.category||'')} · ${formatLogTime(a.cotTime)}</span><button class="theme-input border rounded px-2 py-1 font-black" onclick="acknowledgeCotAlert_('${encodeURIComponent(a.key)}')">Acknowledge</button></div>`).join('')}`;
        }

        function collectDeviceHealth_() {
            return new Promise(resolve => {
                const finish = async logs => {
                    let storageUsedMb = null, storageQuotaMb = null;
                    try {
                        if (navigator.storage?.estimate) {
                            const estimate = await navigator.storage.estimate();
                            storageUsedMb = estimate.usage / 1048576;
                            storageQuotaMb = estimate.quota / 1048576;
                        }
                    } catch (_) { /* optional */ }
                    const unsynced = (logs || []).filter(l => !l.synced);
                    const oldest = unsynced.length ? Math.max(0, (Date.now() - Math.min(...unsynced.map(l => Number(l.originalDeviceTimeMs) || parseCustomOrIsoDate(l.originalDeviceTime || l.time).getTime()))) / 60000) : 0;
                    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
                    const gpsCapturedAt = lastGeoposition?.timestamp ? new Date(lastGeoposition.timestamp).toISOString() : '';
                    resolve({
                        deviceId: getOrCreateDeviceId(), device: buildDeviceString(),
                        checkpoint: (document.getElementById('checkpoint')?.value || '').trim().toUpperCase(),
                        volunteer: (document.getElementById('volunteer')?.value || '').trim().toUpperCase(),
                        batteryPercent: latestBatteryState_.level, charging: latestBatteryState_.charging,
                        queueCount: unsynced.length, oldestQueueAgeMinutes: Math.round(oldest),
                        storageUsedMb, storageQuotaMb, appVersion: APP_VERSION,
                        lastSync: lastSyncSuccessAt ? new Date(lastSyncSuccessAt).toISOString() : '',
                        clockOffsetMs: Math.round(clockOffsetMs_), clockConfidenceMs: Math.round(clockConfidenceMs_),
                        connectivity: navigator.onLine ? 'online' : 'offline',
                        effectiveType: connection?.effectiveType || '',
                        latitude: lastGeoposition?.latitude, longitude: lastGeoposition?.longitude,
                        gpsAccuracyM: lastGeoposition?.accuracy, gpsCapturedAt
                    });
                };
                if (!db) { finish([]); return; }
                const req = db.transaction(['logs'], 'readonly').objectStore('logs').getAll();
                req.onsuccess = e => finish(e.target.result || []);
                req.onerror = () => finish([]);
            });
        }
        function persistLocalDeviceHealth_(health) { if (!db || !db.objectStoreNames.contains('deviceHealth')) return; try { db.transaction(['deviceHealth'],'readwrite').objectStore('deviceHealth').put(health); } catch (_) {} }
        async function reportDeviceHealth_(){const health=await collectDeviceHealth_();persistLocalDeviceHealth_(health);if(!syncUrl)return;try{const started=Date.now();const res=await fetch(`${syncUrl}${syncUrl.includes('?')?'&':'?'}nocache=${Date.now()}`,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action:'device_health',health})});const data=await res.json();if(data.serverTime)updateClockDriftSample_(data.serverTime,started,Date.now());}catch(_){}}
        function scheduleDeviceHealthReport_(delay=1000){setTimeout(()=>{if(!document.hidden)reportDeviceHealth_();},delay);}
        function startDeviceHealthReporting_(){if(deviceHealthTimer_)clearInterval(deviceHealthTimer_);scheduleDeviceHealthReport_(1500);deviceHealthTimer_=setInterval(()=>{if(!document.hidden)reportDeviceHealth_();},120000);}

        function renderDataIntegrityWidget_(logs){
            const el=document.getElementById('directorIntegrityBody');
            if(!el)return;
            const local=logs||[];
            const malformed=local.filter(l=>!Number.isFinite(parseTimeStrictMs_(l.time))).length;
            const uncategorized=new Set(local.filter(l=>l.bib&&!findCategoryConfigForBib_(l.bib,categoryConfig)).map(bibIdentityKey_).filter(Boolean)).size;
            const mapping=local.filter(l=>isCountableLog_(l)&&(l.checkpointKm===''||l.checkpointKm===null||l.checkpointKm===undefined||!Number.isFinite(Number(l.checkpointKm))||Number(l.checkpointKm)<0)).length;
            const locationSpam=local.filter(isLocationSpamLog_).length;
            const route=buildRouteValidation_(local);
            const server=serverOperationsSummary_?.integrity||{};
            const serverSpam=Number(serverOperationsSummary_?.totals?.locationSpam)||0;
            const rows=[
                ['Malformed times',Math.max(malformed,server.malformedTimes||0),'Check device locale and source timestamp','bad'],
                ['Uncategorized bibs',Math.max(uncategorized,server.uncategorizedBibs||0),'Retained, counted, and matched to a route when possible','warn'],
                ['Location spam',Math.max(locationSpam,serverSpam),'GPS outside the configured event area; preserved for audit and excluded','bad'],
                ['Route jumps',Math.max(route.length,server.routeJumps||0),route[0]?.message||server.routeSamples?.[0]?.message||'Expected checkpoint sequence','bad'],
                ['Mapping gaps',Math.max(mapping,server.mappingGaps||0),'Checkpoint KM is missing','bad'],
                ['Stale devices',server.staleDevices||0,'No health report in 3 minutes','bad'],
                ['High clock drift',server.highClockDriftDevices||0,'Absolute offset exceeds 30 seconds','bad']
            ];
            el.innerHTML=rows.map(([name,count,desc,level])=>`<div class="integrity-issue-row"><strong>${escapeHtml_(name)}</strong><span class="${count?(level==='warn'?'ops-status-warn':'ops-status-bad'):'ops-status-good'}">${count}</span><span>${escapeHtml_(desc)}</span></div>`).join('');
            setDirectorWidgetEmptyState_('integrity',false);
        }

        const modalActionLastRun_ = new Map();

        function runModalActionOnce_(key, action) {
            const now = performance.now();
            const last = modalActionLastRun_.get(key) || 0;
            if (now - last < 500) return false;
            modalActionLastRun_.set(key, now);
            action();
            return true;
        }

        function closeModalByKey_(key, event) {
            if (event) {
                event.preventDefault();
                event.stopPropagation();
                if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
            }
            runModalActionOnce_(`close:${key}`, () => {
                if (key === 'settings') closeSettings();
                else if (key === 'directorCustomize') closeDirectorCustomize();
                else if (key === 'exportScope') closeExportScopePrompt_();
                else if (key === 'eventProfile') closeEventProfile_();
                else if (key === 'bibScanner') closeBibScanner();
                else if (key === 'incident') closeIncidentModal_();
            });
        }

        function handleOneTapModalControl_(event) {
            if (event.type === 'pointerup' && event.button !== undefined && event.button !== 0) return;
            const target = event.target instanceof Element ? event.target : null;
            if (!target) return;
            const closeControl = target.closest('[data-modal-close]');
            if (closeControl) {
                closeModalByKey_(closeControl.dataset.modalClose, event);
                return;
            }
            const exportControl = target.closest('[data-export-scope]');
            if (exportControl) {
                event.preventDefault(); event.stopPropagation();
                if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
                const scope = exportControl.dataset.exportScope;
                runModalActionOnce_(`export:${scope}`, () => chooseExportScope_(scope));
                return;
            }
            const backdrop = target.closest('[data-modal-backdrop]');
            if (backdrop && event.target === backdrop) closeModalByKey_(backdrop.dataset.modalBackdrop, event);
        }

        // Pointer-up closes immediately on modern touch/mouse devices. The click
        // listener is a compatibility fallback for older WebViews and keyboard
        // activation; the 500 ms action lock prevents a generated click repeating it.
        document.addEventListener('pointerup', handleOneTapModalControl_, true);
        document.addEventListener('click', handleOneTapModalControl_, true);

        document.getElementById('gpsSwitchCheckpointBtn')?.addEventListener('click', useGpsDetectedCheckpoint_);
        document.getElementById('gpsKeepCheckpointBtn')?.addEventListener('click', keepCurrentCheckpointFromGps_);


        /* v19 compatibility bridge: expose selected global lexical state through safe
           getters/setters so the new domain modules can be loaded as separate files. */
        (function exposeV19RuntimeBridge_() {
            const bridge = {
                db: [() => db], categoryConfig: [() => categoryConfig], syncUrl: [() => syncUrl],
                clockOffsetMs_: [() => clockOffsetMs_, v => { clockOffsetMs_ = v; }],
                clockConfidenceMs_: [() => clockConfidenceMs_, v => { clockConfidenceMs_ = v; }],
                clockSampleCount_: [() => clockSampleCount_, v => { clockSampleCount_ = v; }],
                bibLogSubmissionInFlight_: [() => bibLogSubmissionInFlight_, v => { bibLogSubmissionInFlight_ = v; }],
                minimalBibModeActive_: [() => minimalBibModeActive_, v => { minimalBibModeActive_ = v; }],
                triggerInlineAnimationFlag: [() => triggerInlineAnimationFlag, v => { triggerInlineAnimationFlag = v; }],
                isSyncing: [() => isSyncing, v => { isSyncing = v; }],
                syncRetryTimeoutId: [() => syncRetryTimeoutId, v => { syncRetryTimeoutId = v; }],
                syncFailureStreak: [() => syncFailureStreak, v => { syncFailureStreak = v; }],
                syncRerunQueued: [() => syncRerunQueued, v => { syncRerunQueued = v; }],
                operationalSyncInFlight_: [() => operationalSyncInFlight_, v => { operationalSyncInFlight_ = v; }],
                localIncidents_: [() => localIncidents_], localSafetyNotes_: [() => localSafetyNotes_], localCotAlerts_: [() => localCotAlerts_],
                cotAlertsEnabled_: [() => cotAlertsEnabled_, v => { cotAlertsEnabled_ = v; }],
                cotWarningMinutes_: [() => cotWarningMinutes_, v => { cotWarningMinutes_ = v; }],
                cotEscalationMinutes_: [() => cotEscalationMinutes_, v => { cotEscalationMinutes_ = v; }],
                safetyCotAlertsExpanded_: [() => safetyCotAlertsExpanded_, v => { safetyCotAlertsExpanded_ = v; }],
                serverOperationsSummary_: [() => serverOperationsSummary_, v => { serverOperationsSummary_ = v; }],
                DIRECTOR_WIDGET_DEFS: [() => DIRECTOR_WIDGET_DEFS],
                LOCAL_EVENT_EPOCH_KEY_: [() => LOCAL_EVENT_EPOCH_KEY_]
            };
            Object.entries(bridge).forEach(([name, pair]) => {
                if (Object.getOwnPropertyDescriptor(window, name)) return;
                Object.defineProperty(window, name, { configurable: true, enumerable: false, get: pair[0], set: pair[1] || undefined });
            });
        })();

        /* ════════════════════════════════════════════════════════════════════
           FINAL EVENT LISTENER REGISTRATIONS
           ════════════════════════════════════════════════════════════════════ */

        /* ════════════════════════════════════════════════════════════════════
           RACE DAY UTILITY FUNCTIONS — General-purpose helpers
           ════════════════════════════════════════════════════════════════════ */

        /* Format wall-clock milliseconds → "HH:MM:SS" */
        function formatWallClockMs_(ms) {
            if (!ms || ms < 0) return '--:--:--';
            const totalSec = Math.floor(ms / 1000);
            const h = Math.floor(totalSec / 3600);
            const m = Math.floor((totalSec % 3600) / 60);
            const s = totalSec % 60;
            return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
        }

        /* Format a duration in seconds → human-readable "Xh Ym Zs" */
        function formatDurationSecs_(secs) {
            if (!secs || secs < 0) return '--';
            if (secs < 60)   return Math.round(secs) + 's';
            if (secs < 3600) return Math.floor(secs/60) + 'm ' + (Math.round(secs%60)) + 's';
            const h = Math.floor(secs/3600);
            const m = Math.floor((secs%3600)/60);
            return `${h}h ${String(m).padStart(2,'0')}m`;
        }

        /* Debounce factory — returns a debounced version of fn */
        function debounce_(fn, delayMs) {
            let timer = null;
            return function() {
                const ctx  = this;
                const args = arguments;
                clearTimeout(timer);
                timer = setTimeout(() => { timer = null; fn.apply(ctx, args); }, delayMs);
            };
        }

        /* Throttle factory — returns a throttled version of fn */
        function throttle_(fn, limitMs) {
            let last = 0;
            return function() {
                const now = Date.now();
                if (now - last >= limitMs) { last = now; fn.apply(this, arguments); }
            };
        }

        /* Deep-clone a plain object (no circular refs) */
        function cloneDeep_(obj) {
            try { return JSON.parse(JSON.stringify(obj)); } catch(e) { return obj; }
        }

        /* Clamp a number between min and max */
        function clamp_(val, min, max) { return Math.min(max, Math.max(min, val)); }

        /* Linear interpolate between two values */
        function lerp_(a, b, t) { return a + (b - a) * clamp_(t, 0, 1); }

        /* Round to a given number of decimal places */
        function roundTo_(n, decimals) {
            const factor = Math.pow(10, decimals);
            return Math.round(n * factor) / factor;
        }

        /* Slugify a string for use as an HTML ID */
        function slugify_(str) {
            return (str || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        }

        /* Generate a colour from a string (deterministic) */
        function stringToColor_(str) {
            let hash = 0;
            for (let i = 0; i < (str||'').length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
            const hue = Math.abs(hash) % 360;
            return `hsl(${hue},65%,55%)`;
        }

        /* Format bytes → KB / MB */
        function formatBytes_(bytes) {
            if (bytes < 1024) return bytes + ' B';
            if (bytes < 1048576) return roundTo_(bytes/1024, 1) + ' KB';
            return roundTo_(bytes/1048576, 2) + ' MB';
        }

        /* ════════════════════════════════════════════════════════════════════
           STORAGE FOOTPRINT ESTIMATOR
           ════════════════════════════════════════════════════════════════════
           Estimates the total size of the IndexedDB log store for display in
           Settings. Uses JSON.stringify byte-counting as a proxy (actual
           IndexedDB overhead may differ).
           ════════════════════════════════════════════════════════════════════ */
        function estimateStorageFootprint_(logs) {
            try {
                const jsonStr = JSON.stringify(logs || []);
                return jsonStr.length; // rough byte estimate (UTF-16 chars)
            } catch(e) { return 0; }
        }

        /* ════════════════════════════════════════════════════════════════════
           RACE COMMAND VIEW: Enhanced stat tiles with analytics
           ════════════════════════════════════════════════════════════════════
           Extends the director stat tiles with extra data computed from the
           analytics engine: field spread, peak throughput, avg pace, and
           the current-CP throughput rate — giving the watching director a
           richer at-a-glance view on any connected large screen.
           ════════════════════════════════════════════════════════════════════ */
        function buildEnhancedDirectorTiles_(logs) {
            if (!isDirectorModeOpen) return;
            const tilesEl = document.getElementById('directorStatTiles');
            if (!tilesEl) return;

            // Remove any previously-injected analytics tiles
            tilesEl.querySelectorAll('[data-analytics-tile]').forEach(el => el.remove());

            if (!logs || logs.length === 0) return;

            const avgPace   = calcAvgPaceSeconds_(logs);
            const avgSpeed  = calcAvgSpeed_(logs);
            const stdDev    = calcStdDevPace_(logs);
            const tp60      = calcThroughput_(logs, 60);
            const top1      = topNByPace_(logs, 1)[0];
            const catCount  = new Set(logs
                .filter(l => l.category)
                .map(l => distanceCategoryKey_(l.km, l.category))).size;

            const tiles = [
                avgPace   ? { label: 'Avg Pace',    value: formatSecondsAsPace_(avgPace) + '/km', color: '#6366f1' } : null,
                avgSpeed  ? { label: 'Avg Speed',   value: avgSpeed.toFixed(1) + ' km/h',          color: '#10b981' } : null,
                tp60      ? { label: 'Bibs/h (60m)',value: String(tp60.rate),                       color: '#3b82f6' } : null,
                stdDev    ? { label: 'Field Spread', value: getFieldSpreadLabel_(stdDev).split(' ')[0], color: '#f59e0b' } : null,
                top1      ? { label: 'Leader Pace',  value: formatSecondsAsPace_(parsePaceToSeconds_(top1.pace)) + '/km', color: '#ef4444' } : null,
                catCount  ? { label: 'Categories',   value: String(catCount),                       color: '#8b5cf6' } : null,
            ].filter(Boolean);

            tiles.forEach(tile => {
                const el = document.createElement('div');
                el.setAttribute('data-analytics-tile', '1');
                el.className = 'theme-panel border rounded-xl text-center py-2 px-2 shadow-sm flex flex-col justify-between';
                el.innerHTML = `
                    <div style="font-size:0.5rem;font-weight:800;text-transform:uppercase;letter-spacing:0.09em;color:var(--text-muted);">${tile.label}</div>
                    <div style="font-size:0.875rem;font-weight:900;font-family:ui-monospace,monospace;color:${tile.color};line-height:1;margin-top:0.15rem;">${tile.value}</div>`;
                tilesEl.appendChild(el);
            });
        }

        /* Hook enhanced tiles into director mode open/refresh */
        (function hookEnhancedDirectorTiles_() {
            const origOpen = window.openDirectorMode;
            if (typeof origOpen !== 'function') return;
            window.openDirectorMode = function() {
                origOpen.apply(this, arguments);
                setTimeout(() => {
                    if (!db) return;
                    try {
                        db.transaction(['logs'], 'readonly').objectStore('logs').getAll().onsuccess = function(e) {
                            buildEnhancedDirectorTiles_(e.target.result || []);
                        };
                    } catch(err) { /* safe */ }
                }, 500);
            };

            const orig = window.buildPerformanceAnalytics_;
            window.buildPerformanceAnalytics_ = function(allLogs, currentCP) {
                orig(allLogs, currentCP);
                try { buildEnhancedDirectorTiles_(allLogs); } catch(e) { /* safe */ }
            };
        })();

        /* ════════════════════════════════════════════════════════════════════
           RACE ANALYTICS: Bib-range validator
           ════════════════════════════════════════════════════════════════════
           Cross-checks bib numbers against the known race format templates'
           bib ranges. If a scanned bib falls outside all known ranges, a
           soft warning note is attached to help volunteers catch misrouted
           runners (e.g., a 50K runner accidentally at a 21K checkpoint).
           Opt-in: only activates if at least one RACE_FORMAT_TEMPLATES_ entry
           has been configured with bibRangeStart/End.
           ════════════════════════════════════════════════════════════════════ */
        function getBibRangeCategory_(bibStr) {
            const bib = parseInt(bibStr, 10);
            if (isNaN(bib)) return null;
            for (const fmt of (RACE_FORMAT_TEMPLATES_ || [])) {
                if (bib >= fmt.bibRangeStart && bib <= fmt.bibRangeEnd) return fmt.name;
            }
            return null; // outside all configured ranges
        }

        /* ════════════════════════════════════════════════════════════════════
           VISUAL POLISH: Dynamic gradient on the Performance Analytics panel
           header based on the most-populated pace zone
           ════════════════════════════════════════════════════════════════════ */
        function updatePerfPanelAccent_(logs) {
            const header = document.querySelector('.perf-panel-header');
            if (!header) return;
            const { zones, total } = aggregatePaceZones_(logs);
            if (total === 0) return;
            const dominant = zones.reduce((a, b) => a.count > b.count ? a : b);
            if (dominant.count === 0) return;
            const zone = classifyPaceZone_(
                dominant.id === 'elite'    ? 200 :
                dominant.id === 'fast'     ? 300 :
                dominant.id === 'moderate' ? 400 :
                dominant.id === 'steady'   ? 600 : 800
            );
            header.style.background = `linear-gradient(90deg, ${zone.bgColor} 0%, rgba(99,102,241,0.06) 100%)`;
        }

        /* Hook accent update into build pipeline */
        (function hookPerfPanelAccent_() {
            const orig = window.buildPerformanceAnalytics_;
            window.buildPerformanceAnalytics_ = function(allLogs, currentCP) {
                orig(allLogs, currentCP);
                const scopedLogs = (currentCP && (typeof activeScopeFilter !== 'undefined') && activeScopeFilter === 'current')
                    ? allLogs.filter(l => (l.checkpoint || '').toUpperCase() === currentCP.toUpperCase())
                    : allLogs;
                try { updatePerfPanelAccent_(scopedLogs); } catch(e) { /* safe */ }
            };
        })();

        /* The former floating pre-race checklist was removed in v12. Setup readiness
           is now communicated inline beside 1. Setup and by the disabled Enter Bib panel,
           so volunteers are not obstructed by a timed floating banner during logging. */

        /* ════════════════════════════════════════════════════════════════════
           PERFORMANCE: requestIdleCallback shim for older browsers
           ════════════════════════════════════════════════════════════════════ */
        window.requestIdleCallback = window.requestIdleCallback || function(cb) {
            return setTimeout(function() { cb({ didTimeout: false, timeRemaining: () => 50 }); }, 16);
        };
        window.cancelIdleCallback = window.cancelIdleCallback || clearTimeout;

        /* ════════════════════════════════════════════════════════════════════
           IDLE ANALYTICS REFRESH
           ════════════════════════════════════════════════════════════════════
           Schedule a full analytics rebuild during browser idle time every
           30 seconds. This keeps the Performance Analytics panel fresh even
           when no new bib logs are being submitted (e.g., between runner
           waves) without interfering with active logging.
           ════════════════════════════════════════════════════════════════════ */
        (function scheduleIdleAnalyticsRefresh_() {
            // Intentionally event-driven. Analytics refresh after a log, sync, scope
            // change, or panel expansion; a permanent 30-second getAll() loop was costly
            // on low-memory phones and continued doing work during quiet race periods.
        })();

        /* ════════════════════════════════════════════════════════════════════
           PACE-ZONE GLOSSARY — full definitions for documentation purposes
           ════════════════════════════════════════════════════════════════════
           The following constants fully document every pace zone threshold,
           colour token, icon, description, equivalent speed range, and
           recommended race director action associated with each zone.
           This block is also the authoritative reference for updating zone
           definitions in future versions — change values here and the
           corresponding CSS variables and JS classifyPaceZone_() function.
           ════════════════════════════════════════════════════════════════════ */
        const PACE_ZONE_GLOSSARY_ = Object.freeze([
            {
                id:             'elite',
                label:          'Elite',
                icon:           '🔴',
                minPaceSecs:    0,
                maxPaceSecs:    269,       // exclusive upper bound
                minSpeedKmh:    13.4,
                maxSpeedKmh:    Infinity,
                cssBarColor:    'var(--zone-elite-bar)',
                cssTextColor:   'var(--zone-elite-text)',
                cssBgColor:     'var(--zone-elite-bg)',
                hexLight:       '#ef4444',
                hexDark:        '#f87171',
                description:    'Front-of-pack competitive athletes. Sub-4:30/km trail pace. Watch for course record attempts.',
                directorAction: 'Notify finish area. Ensure photographer and timing mat are ready. Prep medical if this is a heat-affected race.',
                typicalAthletes:'Podium contenders, sponsored runners, elite wave starters.',
                fatigueProfile: 'Minimal — typically negative-split or even pace. Watch for late-race fade in ultras.',
            },
            {
                id:             'fast',
                label:          'Fast',
                icon:           '🟠',
                minPaceSecs:    270,
                maxPaceSecs:    359,
                minSpeedKmh:    10.0,
                maxSpeedKmh:    13.3,
                cssBarColor:    'var(--zone-fast-bar)',
                cssTextColor:   'var(--zone-fast-text)',
                cssBgColor:     'var(--zone-fast-bg)',
                hexLight:       '#f97316',
                hexDark:        '#fb923c',
                description:    'Strong recreational runners. 4:30–6:00/km. Well-trained field athletes on target for podium category places.',
                directorAction: 'Normal operations. Monitor for bottlenecks at narrow trail sections.',
                typicalAthletes:'Age-group winners, club runners, experienced trail athletes.',
                fatigueProfile: 'Moderate — slight pace drop in final 20% of race distance.',
            },
            {
                id:             'moderate',
                label:          'Moderate',
                icon:           '🟡',
                minPaceSecs:    360,
                maxPaceSecs:    479,
                minSpeedKmh:    7.5,
                maxSpeedKmh:    10.0,
                cssBarColor:    'var(--zone-moderate-bar)',
                cssTextColor:   'var(--zone-moderate-text)',
                cssBgColor:     'var(--zone-moderate-bg)',
                hexLight:       '#eab308',
                hexDark:        '#facc15',
                description:    'Mid-pack mainstream pace. 6:00–8:00/km. The majority of runners in most trail ultramarathon fields.',
                directorAction: 'Peak traffic window. Ensure sufficient aid station volunteers, hydration stock, and medical coverage.',
                typicalAthletes:'Recreational runners, first-time ultramarathoners, back-to-back race participants.',
                fatigueProfile: 'Variable — watch for pace drops >15% vs early splits; may signal heat stress or nutrition issues.',
            },
            {
                id:             'steady',
                label:          'Steady',
                icon:           '🟢',
                minPaceSecs:    480,
                maxPaceSecs:    719,
                minSpeedKmh:    5.0,
                maxSpeedKmh:    7.5,
                cssBarColor:    'var(--zone-steady-bar)',
                cssTextColor:   'var(--zone-steady-text)',
                cssBgColor:     'var(--zone-steady-bg)',
                hexLight:       '#10b981',
                hexDark:        '#34d399',
                description:    'Back-of-pack or runners on technical/hilly segments. 8:00–12:00/km. Power-hiking sections inflate pace.',
                directorAction: 'Monitor COT approach. Alert downstream CPs of incoming back-of-pack wave. Ensure sweep runners are informed.',
                typicalAthletes:'Back-of-pack finishers, heavy pack carriers, runners conserving for long distance.',
                fatigueProfile: 'Highly variable. Many runners alternate run/walk. Pace data may reflect walk sections.',
            },
            {
                id:             'walk',
                label:          'Walk',
                icon:           '🔵',
                minPaceSecs:    720,
                maxPaceSecs:    Infinity,
                minSpeedKmh:    0,
                maxSpeedKmh:    5.0,
                cssBarColor:    'var(--zone-walk-bar)',
                cssTextColor:   'var(--zone-walk-text)',
                cssBgColor:     'var(--zone-walk-bg)',
                hexLight:       '#6366f1',
                hexDark:        '#818cf8',
                description:    'Walking pace. >12:00/km. May indicate injury, extreme fatigue, technical descent, or COT-management strategy.',
                directorAction: 'Assess COT risk. Consider welfare check if multiple runners in this zone at mid-race checkpoint. Activate sweep if near COT.',
                typicalAthletes:'Injured runners, first-time distance athletes, runners managing COT, high-altitude events.',
                fatigueProfile: 'Walk-dominant. Splits may be misleading — elapsed segment time includes stopped time at aid stations.',
            },
        ]);

        window.PACE_ZONE_GLOSSARY_ = PACE_ZONE_GLOSSARY_;

        /* ════════════════════════════════════════════════════════════════════
           ACCESSIBILITY: ARIA labels on dynamic elements
           ════════════════════════════════════════════════════════════════════ */
        (function applyAriaLabels_() {
            const ariaMap = {
                'bibInput':           { label: 'Bib number input', role: 'textbox' },
                'remarkInput':        { label: 'Optional remark', role: 'textbox' },
                'searchBar':          { label: 'Search scan history', role: 'searchbox' },
                'logActionButton':    { label: 'Log bib entry', role: 'button' },
                'lockBtn':            { label: 'Lock or unlock setup fields', role: 'button' },
                'totalCount':         { label: 'Total scan count', role: 'status', live: 'polite' },
                'uniqueCount':        { label: 'Unique bib count', role: 'status', live: 'polite' },
                'perfThroughputRate': { label: 'Current bibs per hour rate', role: 'status', live: 'polite' },
                'perfAvgSpeed':       { label: 'Average runner speed in km/h', role: 'status', live: 'polite' },
                'perfBestPace':       { label: 'Best pace at current checkpoint', role: 'status', live: 'polite' },
                'activitySparklineSVG': { role: 'img', label: 'Arrival rate chart — last 60 minutes' },
                'logList':            { role: 'log', label: 'Scan history list', live: 'polite', relevant: 'additions' },
                'successToast':       { role: 'alert', live: 'assertive' },
                'paceZoneChart':      { role: 'img', label: 'Pace zone distribution chart' },
                'fastestRunnersList': { role: 'list', label: 'Fastest runners leaderboard' },
            };
            Object.entries(ariaMap).forEach(([id, attrs]) => {
                const el = document.getElementById(id);
                if (!el) return;
                if (attrs.role)  el.setAttribute('role', attrs.role);
                if (attrs.label) el.setAttribute('aria-label', attrs.label);
                if (attrs.live)  el.setAttribute('aria-live', attrs.live);
                if (attrs.relevant) el.setAttribute('aria-relevant', attrs.relevant);
            });
        })();

        /* ════════════════════════════════════════════════════════════════════
           CSS CUSTOM PROPERTY REPORTER (dev helper, zero UI impact)
           ════════════════════════════════════════════════════════════════════ */
        /* v2.0.0-enhanced */ window.__getRaceLogTheme = function() {
            const style = getComputedStyle(document.documentElement);
            const props = [
                '--bg-color','--panel-bg','--card-tint',
                '--text-main','--text-muted','--border-color',
                '--bib-color','--header-bg','--header-text',
                '--zone-elite-bar','--zone-fast-bar',
                '--zone-moderate-bar','--zone-steady-bar','--zone-walk-bar',
            ];
            const result = {};
            props.forEach(p => { result[p] = style.getPropertyValue(p).trim(); });
            return result;
        };

        /* ════════════════════════════════════════════════════════════════════
           ANALYTICS ENGINE VERSION STAMP
           ════════════════════════════════════════════════════════════════════ */
        /* ════════════════════════════════════════════════════════════════════
           PACE-TO-SPEED CONVERSION TABLE — full reference
           ════════════════════════════════════════════════════════════════════
           Pre-computed lookup table for common pace/speed conversions.
           Useful for quickly verifying that the JS parsers are producing
           reasonable values, and as an in-app reference for volunteers who
           are unfamiliar with pace vs speed notation.

           Pace (min/km) | Speed (km/h) | Speed (mph) | Zone
           ─────────────────────────────────────────────────
            3:00          |    20.0      |   12.4      | Elite
            3:30          |    17.1      |   10.6      | Elite
            4:00          |    15.0      |    9.3      | Elite
            4:15          |    14.1      |    8.8      | Elite
            4:29          |    13.4      |    8.3      | Elite (boundary)
            4:30          |    13.3      |    8.3      | Fast  (boundary)
            5:00          |    12.0      |    7.5      | Fast
            5:30          |    10.9      |    6.8      | Fast
            5:59          |    10.0      |    6.2      | Fast (boundary)
            6:00          |    10.0      |    6.2      | Moderate (boundary)
            6:30          |     9.2      |    5.7      | Moderate
            7:00          |     8.6      |    5.3      | Moderate
            7:30          |     8.0      |    5.0      | Moderate
            7:59          |     7.5      |    4.7      | Moderate (boundary)
            8:00          |     7.5      |    4.7      | Steady (boundary)
            9:00          |     6.7      |    4.1      | Steady
           10:00          |     6.0      |    3.7      | Steady
           11:00          |     5.5      |    3.4      | Steady
           11:59          |     5.0      |    3.1      | Steady (boundary)
           12:00          |     5.0      |    3.1      | Walk (boundary)
           15:00          |     4.0      |    2.5      | Walk
           20:00          |     3.0      |    1.9      | Walk
           ════════════════════════════════════════════════════════════════════ */

        /* Compact lookup array for fast binary-search style lookups */
        const PACE_SPEED_TABLE_ = [
            { paceSecs:180, speedKmh:20.0 }, { paceSecs:210, speedKmh:17.1 },
            { paceSecs:240, speedKmh:15.0 }, { paceSecs:255, speedKmh:14.1 },
            { paceSecs:269, speedKmh:13.4 }, { paceSecs:270, speedKmh:13.3 },
            { paceSecs:300, speedKmh:12.0 }, { paceSecs:330, speedKmh:10.9 },
            { paceSecs:359, speedKmh:10.0 }, { paceSecs:360, speedKmh:10.0 },
            { paceSecs:390, speedKmh: 9.2 }, { paceSecs:420, speedKmh: 8.6 },
            { paceSecs:450, speedKmh: 8.0 }, { paceSecs:479, speedKmh: 7.5 },
            { paceSecs:480, speedKmh: 7.5 }, { paceSecs:540, speedKmh: 6.7 },
            { paceSecs:600, speedKmh: 6.0 }, { paceSecs:660, speedKmh: 5.5 },
            { paceSecs:719, speedKmh: 5.0 }, { paceSecs:720, speedKmh: 5.0 },
            { paceSecs:900, speedKmh: 4.0 }, { paceSecs:1200,speedKmh: 3.0 },
        ];

        /* Convert pace seconds to speed km/h using linear interpolation */
        function paceSecsToSpeedKmh_(paceSeconds) {
            if (!paceSeconds || paceSeconds <= 0) return null;
            // Direct formula is exact; table is for validation only
            return roundTo_(3600 / paceSeconds, 2);
        }

        /* Convert speed km/h to pace seconds/km */
        function speedKmhToPaceSecs_(speedKmh) {
            if (!speedKmh || speedKmh <= 0) return null;
            return Math.round(3600 / speedKmh);
        }

        window.PACE_SPEED_TABLE_       = PACE_SPEED_TABLE_;
        window.paceSecsToSpeedKmh_     = paceSecsToSpeedKmh_;
        window.speedKmhToPaceSecs_     = speedKmhToPaceSecs_;
        window.formatWallClockMs_      = formatWallClockMs_;
        window.formatDurationSecs_     = formatDurationSecs_;
        window.buildPaceHistogram_     = buildPaceHistogram_;
        window.getPacePercentile_      = getPacePercentile_;
        window.calcStdDevPace_         = calcStdDevPace_;
        window.detectArrivalWaves_     = detectArrivalWaves_;
        window.calcSessionStats_       = calcSessionStats_;
        window.generateRaceReport_     = generateRaceReport_;
        window.calcCategoryStats_      = calcCategoryStats_;
        window.calcCpPaceSummary_      = calcCpPaceSummary_;
        window.RACE_ANALYTICS_CONFIG_  = RACE_ANALYTICS_CONFIG_;

        window.__raceAnalyticsVersion = {
            version:    '2.0.0',
            build:      'enhanced-perf-analytics',
            features: [
                'pace-zone-distribution',
                'arrival-rate-sparkline',
                'fastest-runners-leaderboard',
                'cot-risk-tracker',
                'checkpoint-comparison',
                'field-distribution-histogram',
                'volunteer-productivity',
                'runner-quick-lookup',
                'bib-split-trend-badges',
                'wave-detection',
                'race-report-generator',
                'session-statistics',
                'enhanced-csv-export',
                'keyboard-shortcuts',
                'live-header-clock',
                'milestone-toasts',
                'network-quality-indicator',
                'pre-race-checklist',
                'idle-analytics-refresh',
                'swipe-to-dismiss-toasts',
                'director-enhanced-tiles',
            ],
        };

        /* ════════════════════════════════════════════════════════════════════
           BIB SCANNER (camera OCR) — full ML pipeline
           ════════════════════════════════════════════════════════════════════
           Reads a bib number from a live camera frame so a volunteer doesn't have
           to type it. This runs several real models/APIs in sequence, each one
           narrowing or short-circuiting the work the next one has to do:

             Stage 0 — Barcode/QR detection (window.BarcodeDetector, native
             browser API). Many timing systems print a barcode on the bib as a
             chip-less backup read; a decode here is exact and skips every
             stage below. See detectBarcodeDigits_.

             Stage 1 — Image quality (classical CV: Laplacian-variance blur +
             brightness). See assessImageQuality_ for the honest caveat: this
             is hand-tuned computer vision, not a trained model — there's no
             small, reliably-loadable no-reference quality neural net the way
             there is for the other stages.

             Stage 2 — Object detection, narrowing the crop to the runner's
             torso, in order of precedence: MediaPipe Tasks Vision's
             PoseLandmarker (BlazePose) gives an exact shoulder/hip-measured
             crop on high-tier devices (see detectTorsoBandFromPose_);
             TensorFlow.js + BlazeFace, a lightweight face detector, estimates
             the torso from the detected face using standard body-proportion
             ratios when pose isn't available/enabled (see detectFaceBox_ /
             computeTorsoRectFromFaceBox_); TensorFlow.js + coco-ssd's person
             bounding box (heuristically cropped to a torso band) is the
             fallback everywhere else (see detectPersonBox_).

             Stage 3 — Text detection (window.TextDetector, native browser API
             where available) narrows further to the actual glyphs.

             Stage 4 — OCR recognition, one of three selectable engines:

             • Tesseract.js  — a real, working, fully client-side OCR engine.
               This is the default and is the most battle-tested of the three
               for arbitrary printed digits.

             • PaddleOCR.js  — PaddlePaddle's Paddle.js OCR model
               (@paddlejs-models/ocr), a real detection+recognition pipeline that
               also runs entirely client-side (WebGL). It's a genuine second OCR
               engine, not a stub — but its API/output shape has shifted across
               versions in the wild, so runPaddleOcrEngine_ below defensively
               handles a few known response shapes and treats a missing
               per-result confidence score as "moderate confidence" (Paddle's
               model doesn't expose per-character confidence the way Tesseract
               does). Worth watching for API changes if you upgrade the CDN
               version pinned below.

             • TensorFlow.js — Google's ML Kit itself is a native Android/iOS SDK
               and has no web/PWA build, so there is no drop-in "ML Kit for the
               browser". This option loads tfjs and is wired up as the slot where
               a custom-trained digit/bib recognition model would plug in (see
               runTensorFlowOcr_ below) — for now it degrades to the Tesseract
               pipeline under the hood so the option is never a dead end, and is
               labeled "experimental" in the UI for that reason.

           All models/libraries are loaded lazily (only when actually needed)
           rather than at page load, since this is an offline-first PWA and the
           CDN URLs aren't part of the service-worker precache list. Which
           stages actually run is device-tier-dependent — see getOcrDeviceProfile_.

           Accuracy pipeline (this is the part that actually matters for OCR
           quality on a phone camera pointed at a bold, high-contrast bib number):
             1. Crop to the on-screen guide box only, mapped from CSS pixels into
                the video's native pixel space (accounting for object-fit: cover
                scaling) — cropping out the background is worth far more than any
                OCR engine tuning, since Tesseract wastes accuracy trying to parse
                whatever else is in frame otherwise.
             2. Upscale the crop ~3x — bib digits are usually a small fraction of
                the frame, and Tesseract reads larger text far more reliably.
             3. Grayscale + Otsu-style adaptive threshold to pure black/white —
                removes lighting gradients/shadows that confuse character edges.
             4. Continuous auto-scan (every ~700ms while the modal is open) that
                only accepts a reading once the SAME digit string comes back
                twice in a row AND Tesseract's own confidence score clears a
                minimum bar — a single noisy frame can misread a digit, but two
                consecutive agreeing reads at reasonable confidence is a strong
                signal it is actually right. The second matching frame records the
                bib immediately, while a recent-duplicate latch prevents the same
                runner from being logged repeatedly.
        */

        let ocrEngine = localStorage.getItem('ocrEngine') || 'tesseract';
        // 'full'   — runs every detection stage (object/face/pose/text) for the
        //            most accurate crop, at the cost of loading heavier models.
        // 'bibOnly'— skips object/face/pose/text detection entirely and just
        //            quality-gates + reads the guide-box crop directly. Barcode
        //            detection (Stage 0) still runs either way since it's cheap
        //            and, when a bib has one, more reliable than OCR anyway --
        //            it's still fundamentally "get the bib number", the same
        //            goal, just via a faster instead of a maximal-accuracy path.
        let detectionMode = localStorage.getItem('detectionMode') || 'bibOnly';
        let bibScannerStream_ = null;
        let tesseractWorker_ = null;
        let tesseractWorkerPromise_ = null;
        let tesseractWorkerPromiseGeneration_ = -1;
        let ocrResourceGeneration_ = 0;
        let tfjsLoaded_ = false;
        let ocrLibraryLoadPromise_ = null;
        let autoScanTimerId_ = null;
        let ocrCleanupTimer_ = null;
        let autoScanBusy_ = false;
        let lastAutoScanReading_ = '';
        let ocrAcceptedThisSession_ = false; // retained for compatibility; live OCR now keeps scanning
        let autoLogInFlight_ = false;
        let autoLoggedBibLatch_ = '';
        let autoReadMissStreak_ = 0;
        let ocrDeviceProfile_ = null;
        let availableCameraDevices_ = [];
        let currentCameraDeviceId_ = null;
        let bibScannerUsingFallback_ = false;
        const OCR_MIN_CONFIDENCE = 55;      // 0-100, Tesseract's own confidence score
        const OCR_MIN_DIGITS = 1;           // shortest plausible bib number

        // ── Device capability detection ──────────────────────────────────────────
        // Every device already runs a one-time CPU benchmark at startup (see
        // profileDevicePerformanceCapabilities(), which sets isHighEndSoc /
        // dynamicHardwareMaxCap) -- reusing that instead of re-profiling here means
        // OCR settings and the rest of the app's adaptive behavior always agree
        // about what tier a given device is in.
        function getOcrDeviceProfile_() {
            let tier = 'low';
            if (dynamicHardwareMaxCap >= 800) tier = 'high';
            else if (dynamicHardwareMaxCap >= 350) tier = 'mid';

            const profiles = {
                high: { idealWidth: 1280, idealHeight: 960, scanIntervalMs: 550,  upscale: 3,   allowHeavyEngines: true,  enableObjectDetection: true,  enableTextDetection: true,  enablePoseRefinement: true,  enableFaceDetection: true,  detectEveryNTicks: 1 },
                mid:  { idealWidth: 960,  idealHeight: 720, scanIntervalMs: 800,  upscale: 2.5, allowHeavyEngines: true,  enableObjectDetection: true,  enableTextDetection: true,  enablePoseRefinement: false, enableFaceDetection: true,  detectEveryNTicks: 2 },
                low:  { idealWidth: 640,  idealHeight: 480, scanIntervalMs: 1300, upscale: 2,   allowHeavyEngines: false, enableObjectDetection: false, enableTextDetection: false, enablePoseRefinement: false, enableFaceDetection: false, detectEveryNTicks: 999 }
            };
            const profile = Object.assign({ tier }, profiles[tier]);

            // "Bib Number Only (Fast)" mode: the person is deliberately skipping
            // object/face/pose/text detection in favor of speed and lower device
            // load -- e.g. reading a bib held up close and already filling the
            // guide box, where locating the runner's torso first is unnecessary
            // work. allowHeavyEngines (OCR engine choice) is left untouched;
            // this only affects the crop-detection stages.
            if (detectionMode === 'bibOnly') {
                profile.enableObjectDetection = false;
                profile.enableTextDetection = false;
                profile.enablePoseRefinement = false;
                profile.enableFaceDetection = false;
            }
            return profile;
        }

        function setDetectionMode_(mode) {
            detectionMode = mode;
            localStorage.setItem('detectionMode', mode);
            ocrDeviceProfile_ = getOcrDeviceProfile_();
            lastPersonBox_ = null;       // crop strategy just changed -- drop any cached box
            detectionTickCounter_ = 0;
            lastAutoScanReading_ = '';   // avoid comparing against a reading taken under the old mode
            updateDetectionModeButtons_();
        }

        function updateDetectionModeButtons_() {
            const fullBtn = document.getElementById('detectionModeFullBtn');
            const bibOnlyBtn = document.getElementById('detectionModeBibOnlyBtn');
            if (!fullBtn || !bibOnlyBtn) return;
            const activeCls = 'bg-blue-600 text-white';
            const inactiveCls = 'theme-input theme-text-muted';
            fullBtn.className = `flex-1 py-1.5 transition ${detectionMode === 'full' ? activeCls : inactiveCls}`;
            bibOnlyBtn.className = `flex-1 py-1.5 transition ${detectionMode === 'bibOnly' ? activeCls : inactiveCls}`;
            updateBibScannerTipText_();
        }

        function updateBibScannerTipText_() {
            if (bibScannerUsingFallback_) return; // fallback path sets its own tip text
            document.getElementById('bibScannerTip').textContent = detectionMode === 'bibOnly'
                ? 'Fast mode: fill the guide box with just the bib number (e.g. V1001, 1001, V 1001) and hold steady. Skips the runner-detection check — only use up close on an actual bib.'
                : 'Video OCR scans continuously — frame the runner wearing the bib. A stable registered number is logged automatically; no capture or LOG tap is needed.';
        }

        function isWebglAvailable_() {
            try {
                const c = document.createElement('canvas');
                return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
            } catch (e) { return false; }
        }

        function isCameraApiSupported_() {
            return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
        }

        // getUserMedia is blocked outright in insecure (plain HTTP) contexts on
        // every modern browser -- worth detecting explicitly so the fallback
        // message can say why, instead of a generic "camera unavailable".
        function isSecureContextForCamera_() {
            return !!window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
        }

        // Disables/relabels engine options this device genuinely can't run well
        // (TensorFlow.js and PaddleOCR.js both need a WebGL backend, and both are
        // heavy enough to stutter a low-tier device), and silently falls the
        // active selection back to Tesseract.js if it was pointed at one of them.
        function applyOcrEngineAvailability_(profile) {
            const webgl = isWebglAvailable_();
            const heavyOk = webgl && profile.allowHeavyEngines;
            const select = document.getElementById('ocrEngineSelect');
            Array.from(select.options).forEach(opt => {
                if (opt.value === 'tesseract') return;
                const baseLabel = opt.value === 'tensorflow' ? 'TensorFlow.js' : 'PaddleOCR.js';
                if (heavyOk) {
                    opt.disabled = false;
                    opt.textContent = `${baseLabel} (experimental)`;
                } else {
                    opt.disabled = true;
                    opt.textContent = `${baseLabel} (unsupported on this device)`;
                }
            });
            if (!heavyOk && ocrEngine !== 'tesseract') {
                setOcrEngine('tesseract');
            }
            select.value = ocrEngine;
        }

        /* ── STAGE 1: IMAGE QUALITY ────────────────────────────────────────────
           A lightweight, real, computed-not-guessed frame-quality gate that runs
           before anything else on every tick. To be upfront about what this is:
           it's classical computer vision (Laplacian-variance blur estimate +
           mean brightness), not a trained neural net -- there's no small,
           reliably-CDN-loadable no-reference image-quality neural model the way
           there is for object detection or OCR, so this is the honest, working
           equivalent rather than a placeholder pretending to be one. It gates
           the same "is this frame worth spending CPU on" decision a learned
           quality model would. */
        function assessImageQuality_(sourceCanvas) {
            const w = 160, h = Math.max(1, Math.round(160 * sourceCanvas.height / sourceCanvas.width));
            const tmp = document.createElement('canvas');
            tmp.width = w; tmp.height = h;
            const tctx = tmp.getContext('2d');
            tctx.drawImage(sourceCanvas, 0, 0, w, h);
            const data = tctx.getImageData(0, 0, w, h).data;

            const gray = new Float32Array(w * h);
            let sum = 0;
            for (let i = 0, p = 0; i < data.length; i += 4, p++) {
                const g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
                gray[p] = g;
                sum += g;
            }
            const brightness = sum / gray.length;

            // Laplacian variance: the standard, well-established no-reference
            // blur metric (higher variance = more edge energy = sharper image).
            let lapSum = 0, lapSumSq = 0, count = 0;
            for (let y = 1; y < h - 1; y++) {
                for (let x = 1; x < w - 1; x++) {
                    const idx = y * w + x;
                    const lap = gray[idx - 1] + gray[idx + 1] + gray[idx - w] + gray[idx + w] - 4 * gray[idx];
                    lapSum += lap; lapSumSq += lap * lap; count++;
                }
            }
            const lapMean = lapSum / count;
            const blurVariance = (lapSumSq / count) - (lapMean * lapMean);

            // Thresholds are hand-tuned against typical phone-camera frames, not
            // learned from a labeled dataset -- treat them as reasonable
            // defaults, not calibrated ground truth.
            const isDark = brightness < 40;
            const isOverexposed = brightness > 225;
            const isBlurry = blurVariance < 60;
            return { brightness, blurVariance, isDark, isOverexposed, isBlurry, ok: !isDark && !isOverexposed && !isBlurry };
        }

        /* ── STAGE 2: OBJECT DETECTION ML ──────────────────────────────────────
           TensorFlow.js + the official pretrained coco-ssd model. This is a
           real, working object-detection network (not a stub) — it finds the
           runner in frame, and the pipeline narrows the crop to their torso
           (where a bib actually is) instead of trusting the person to hold
           still inside a fixed on-screen box. Loaded lazily and only on
           devices with WebGL + a mid/high performance tier (see
           getOcrDeviceProfile_). cocoSsdModel_/cocoSsdLoadPromise_/
           lastPersonBox_/detectionTickCounter_ are declared in the main
           scanner-state block near the top of this section. */

        async function ensureObjectDetectionLoaded_() {
            if (cocoSsdModel_) return;
            await ensureTensorFlowLoaded_();
            if (!window.cocoSsd) {
                await loadExternalScript_('https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js');
            }
            if (!cocoSsdLoadPromise_) cocoSsdLoadPromise_ = window.cocoSsd.load();
            cocoSsdModel_ = await cocoSsdLoadPromise_;
        }

        // Accepts a <video>, <img>, or <canvas> -- coco-ssd's detect() takes any
        // of these directly, so this works for both the live camera path and
        // the photo-upload fallback path.
        async function detectPersonBox_(source) {
            if (!cocoSsdModel_) return null;
            const predictions = await cocoSsdModel_.detect(source);
            const people = predictions.filter(p => p.class === 'person' && p.score > 0.5);
            if (!people.length) return null;
            // If more than one person is in frame, assume the largest/closest
            // one is whoever is being scanned.
            people.sort((a, b) => (b.bbox[2] * b.bbox[3]) - (a.bbox[2] * a.bbox[3]));
            const [x, y, w, h] = people[0].bbox;
            return { x, y, w, h };
        }

        // Bib numbers sit roughly chest-to-waist and centered -- this heuristic
        // band is what actually turns a person bounding box into a useful crop.
        function computeTorsoRectFromPersonBox_(box, sourceW, sourceH) {
            const x = Math.max(0, box.x + box.w * 0.15);
            const y = Math.max(0, box.y + box.h * 0.20);
            const w = Math.min(sourceW - x, box.w * 0.70);
            const h = Math.min(sourceH - y, box.h * 0.32);
            return { x, y, w, h };
        }

        /* ── STAGE 3: TEXT DETECTION ML ────────────────────────────────────────
           The browser's native Shape Detection API (window.TextDetector) is a
           real, on-device text-detection model — where it's available (Chromium
           on some platforms today), it locates the actual text glyphs within
           the torso crop and narrows to just that, cutting out clothing/skin/
           background the object-detection stage alone can't. Where it isn't
           available this stage is a clean no-op — the pipeline just proceeds on
           the torso crop, and if PaddleOCR.js is the selected OCR engine it
           still runs its own internal text-detection pass regardless. */
        let textDetectorInstance_ = null;

        function isTextDetectorSupported_() {
            return typeof window.TextDetector === 'function';
        }

        async function detectTextRegionInCanvas_(canvas) {
            if (!isTextDetectorSupported_()) return null;
            try {
                if (!textDetectorInstance_) textDetectorInstance_ = new window.TextDetector();
                const results = await textDetectorInstance_.detect(canvas);
                if (!results || !results.length) return null;
                let best = results[0];
                for (const r of results) {
                    if (r.boundingBox.width * r.boundingBox.height > best.boundingBox.width * best.boundingBox.height) best = r;
                }
                return best.boundingBox;
            } catch (e) {
                return null; // non-fatal -- caller falls back to the un-narrowed crop
            }
        }

        // Shared by both the live-camera and photo-upload pipelines: crops
        // `workingCanvas` down to the detected text region (with padding), or
        // returns it unchanged if detection isn't available/found nothing.
        async function applyTextDetectionCrop_(workingCanvas, profile) {
            if (!(profile.enableTextDetection && isTextDetectorSupported_())) return workingCanvas;
            const textBox = await detectTextRegionInCanvas_(workingCanvas);
            if (!textBox || textBox.width <= 4 || textBox.height <= 4) return workingCanvas;

            const pad = 0.15;
            const px = Math.max(0, textBox.x - textBox.width * pad);
            const py = Math.max(0, textBox.y - textBox.height * pad);
            const pw = Math.min(workingCanvas.width - px, textBox.width * (1 + pad * 2));
            const ph = Math.min(workingCanvas.height - py, textBox.height * (1 + pad * 2));

            const textCanvas = document.createElement('canvas');
            textCanvas.width = Math.max(1, Math.round(pw));
            textCanvas.height = Math.max(1, Math.round(ph));
            textCanvas.getContext('2d').drawImage(workingCanvas, px, py, pw, ph, 0, 0, textCanvas.width, textCanvas.height);
            return textCanvas;
        }

        /* ── STAGE 2b: POSE REFINEMENT ML (precision upgrade to Stage 2) ──────
           MediaPipe Tasks Vision's PoseLandmarker — a real, Google-maintained
           pretrained pose model (BlazePose), loaded as an ES module via dynamic
           import() since it ships as one rather than a global-exposing UMD
           script. Where coco-ssd only gives a rough person bounding box (torso
           cropped by a fixed percentage heuristic), this gives actual shoulder
           and hip landmark coordinates — a real measurement of where the torso
           is instead of a guess — so the crop lands on the bib far more
           reliably when a runner isn't perfectly centered/upright in frame.
           High-tier devices only: it's the heaviest stage in the whole
           pipeline, and coco-ssd's box heuristic remains the fallback (and the
           only tier-appropriate option on mid/low-tier devices, or if this
           fails to load). Only wired up for the live-video path — the
           photo-upload fallback sticks to coco-ssd, since PoseLandmarker's
           createFromOptions here is configured for VIDEO running mode and
           switching modes per-call adds complexity not worth it for a
           fallback path. Note: MediaPipe's hosted model URL / package version
           below is accurate as of this writing but, like PaddleOCR.js, is
           the kind of third-party detail that can drift across releases. */
        let mediapipeVisionModulePromise_ = null;
        let poseLandmarkerPromise_ = null;

        async function ensurePoseLandmarkerLoaded_() {
            if (!mediapipeVisionModulePromise_) {
                mediapipeVisionModulePromise_ = import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs');
            }
            const { PoseLandmarker, FilesetResolver } = await mediapipeVisionModulePromise_;
            if (!poseLandmarkerPromise_) {
                poseLandmarkerPromise_ = (async () => {
                    const filesetResolver = await FilesetResolver.forVisionTasks(
                        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
                    );
                    return PoseLandmarker.createFromOptions(filesetResolver, {
                        baseOptions: {
                            modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
                            delegate: 'GPU'
                        },
                        runningMode: 'VIDEO',
                        numPoses: 1
                    });
                })();
            }
            return poseLandmarkerPromise_;
        }

        // BlazePose's 33 landmarks: 11/12 = left/right shoulder, 23/24 = left/
        // right hip. Coordinates are normalized [0,1] relative to the input
        // frame. Returns a precise chest-to-waist crop rect in video pixel
        // space, or null if a pose (or those specific landmarks) wasn't found.
        async function detectTorsoBandFromPose_(video) {
            const landmarker = await ensurePoseLandmarkerLoaded_();
            const result = landmarker.detectForVideo(video, performance.now());
            const lm = result && result.landmarks && result.landmarks[0];
            if (!lm) return null;
            const ls = lm[11], rs = lm[12], lh = lm[23], rh = lm[24];
            if (!ls || !rs || !lh || !rh) return null;

            const minX = Math.min(ls.x, rs.x, lh.x, rh.x);
            const maxX = Math.max(ls.x, rs.x, lh.x, rh.x);
            const minY = Math.min(ls.y, rs.y);
            const maxY = Math.max(lh.y, rh.y);
            // A bib is usually pinned a little wider than shoulder-to-shoulder
            // and can hang slightly below the hip landmarks -- pad accordingly.
            const padX = (maxX - minX) * 0.15;
            const padYBottom = (maxY - minY) * 0.10;

            const x = Math.max(0, minX - padX) * video.videoWidth;
            const y = Math.max(0, minY) * video.videoHeight;
            const w = Math.min(1 - (minX - padX), (maxX - minX) + padX * 2) * video.videoWidth;
            const h = Math.min(1 - minY, (maxY - minY) + padYBottom) * video.videoHeight;
            if (w <= 0 || h <= 0) return null;
            return { x, y, w, h };
        }

        /* ── STAGE 2c: FACE DETECTION ML (mid-tier torso refinement) ──────────
           TensorFlow.js + BlazeFace — Google's real, lightweight pretrained
           face-detection model (much smaller/faster than coco-ssd or
           PoseLandmarker, since it only has one job). Used as a middle rung
           between the two: better-than-coco-ssd precision without pose
           landmarking's cost, so mid-tier devices (which can't afford full
           pose estimation) still get a real anatomical anchor instead of just
           a person bounding box guessed at with fixed percentages.

           The torso rect here is derived from the detected face using standard
           figure-drawing body-proportion ratios (a head-height is a well-known
           unit for estimating the rest of the body: roughly 3 head-heights
           span chest-to-waist, worn-bib width runs a bit past shoulder width)
           -- not a learned regression, but a defensible, real anthropometric
           heuristic anchored to a genuine ML detection (the face box), the
           same spirit as the pose-landmark torso band above just anchored to
           a coarser landmark. Falls back to coco-ssd if no face is found
           (runner facing away, angle, etc.) or BlazeFace fails to load. */
        let blazefaceModel_ = null;
        let blazefaceLoadPromise_ = null;

        async function ensureFaceDetectionLoaded_() {
            if (blazefaceModel_) return;
            await ensureTensorFlowLoaded_();
            if (!window.blazeface) {
                await loadExternalScript_('https://cdn.jsdelivr.net/npm/@tensorflow-models/blazeface@0.1.0/dist/blazeface.min.js');
            }
            if (!blazefaceLoadPromise_) blazefaceLoadPromise_ = window.blazeface.load();
            blazefaceModel_ = await blazefaceLoadPromise_;
        }

        // Accepts a <video>, <img>, or <canvas>, same as coco-ssd's detect().
        async function detectFaceBox_(source) {
            if (!blazefaceModel_) return null;
            const predictions = await blazefaceModel_.estimateFaces(source, false);
            if (!predictions || !predictions.length) return null;
            // Largest/most confident face if more than one is in frame.
            predictions.sort((a, b) => {
                const areaA = (a.bottomRight[0] - a.topLeft[0]) * (a.bottomRight[1] - a.topLeft[1]);
                const areaB = (b.bottomRight[0] - b.topLeft[0]) * (b.bottomRight[1] - b.topLeft[1]);
                return areaB - areaA;
            });
            const f = predictions[0];
            return {
                x: f.topLeft[0], y: f.topLeft[1],
                w: f.bottomRight[0] - f.topLeft[0], h: f.bottomRight[1] - f.topLeft[1]
            };
        }

        function computeTorsoRectFromFaceBox_(face, sourceW, sourceH) {
            const headH = face.h;
            const centerX = face.x + face.w / 2;
            const neckGap = headH * 0.3;                 // small gap below the chin
            const torsoTop = face.y + face.h + neckGap;
            const torsoHeight = headH * 3.0;              // chest-to-waist, ~3 head-heights
            const torsoWidth = headH * 4.0;               // shoulder-to-shoulder + bib margin

            const x = Math.max(0, centerX - torsoWidth / 2);
            const y = Math.max(0, torsoTop);
            const w = Math.min(sourceW - x, torsoWidth);
            const h = Math.min(sourceH - y, torsoHeight);
            if (w <= 0 || h <= 0) return null;
            return { x, y, w, h };
        }

        /* ── STAGE 0: BARCODE / QR FAST PATH ───────────────────────────────────
           Many race timing systems print a barcode (or occasionally a QR code)
           on the bib alongside the printed number, specifically as a chip-less
           backup read method. The browser's native Shape Detection API
           (window.BarcodeDetector) is a real, on-device detection+decode
           model — where it's available (Chromium-based browsers), this is
           tried first on every tick because a successful decode is an *exact*
           value, not an OCR guess, and is far more reliable than reading the
           printed digits whenever a barcode is present and in frame. On success
           it skips every other stage entirely for that read. Where unsupported,
           or when no barcode is found, this is a fast, harmless no-op and the
           object/text-detection + OCR stages proceed exactly as before. */
        let barcodeDetectorInstance_ = null;

        function isBarcodeDetectorSupported_() {
            return typeof window.BarcodeDetector === 'function';
        }

        async function detectBarcodeDigits_(source) {
            if (!isBarcodeDetectorSupported_()) return null;
            try {
                if (!barcodeDetectorInstance_) {
                    // Formats a printed race bib is realistically likely to carry.
                    barcodeDetectorInstance_ = new window.BarcodeDetector({
                        formats: ['code_128', 'code_39', 'qr_code', 'ean_13', 'upc_a']
                    });
                }
                const results = await barcodeDetectorInstance_.detect(source);
                if (!results || !results.length) return null;
                for (const r of results) {
                    const digits = cleanOcrDigits_(r.rawValue);
                    if (digits) return digits;
                }
                return null;
            } catch (e) {
                return null; // non-fatal -- pipeline proceeds to OCR as normal
            }
        }

        function loadExternalScript_(url) {
            return new Promise((resolve, reject) => {
                const existing = document.querySelector(`script[src="${url}"]`);
                if (existing) {
                    if (existing.dataset.loaded === 'true') { resolve(); return; }
                    existing.addEventListener('load', () => resolve(), { once: true });
                    existing.addEventListener('error', () => reject(new Error('Failed to load ' + url)), { once: true });
                    return;
                }
                const script = document.createElement('script');
                script.src = url;
                script.async = true;
                script.crossOrigin = 'anonymous';
                script.referrerPolicy = 'no-referrer';
                script.onload = () => { script.dataset.loaded = 'true'; resolve(); };
                script.onerror = () => reject(new Error('Failed to load ' + url));
                document.head.appendChild(script);
            });
        }

        function setOcrEngine(engine) {
            ocrEngine = engine;
            localStorage.setItem('ocrEngine', engine);
            lastAutoScanReading_ = ''; // engine changed -- don't compare against a stale reading
        }

        function showBibScannerFallback_(message) {
            bibScannerUsingFallback_ = true;
            document.getElementById('bibScannerVideo').classList.add('hidden');
            document.getElementById('bibScannerFallback').classList.remove('hidden');
            document.getElementById('bibScannerFallbackMsg').textContent = message;
            document.getElementById('bibScannerSwitchCamBtn').classList.add('hidden');
            document.getElementById('bibScannerTip').textContent = 'Pick or take a photo of the bib — a valid recognized number is logged automatically.';
            stopAutoScan_();
        }

        function hideBibScannerFallback_() {
            bibScannerUsingFallback_ = false;
            document.getElementById('bibScannerVideo').classList.remove('hidden');
            document.getElementById('bibScannerFallback').classList.add('hidden');
            updateBibScannerTipText_();
        }

        async function refreshCameraDeviceList_() {
            try {
                if (!navigator.mediaDevices.enumerateDevices) return;
                const devices = await navigator.mediaDevices.enumerateDevices();
                availableCameraDevices_ = devices.filter(d => d.kind === 'videoinput');
                document.getElementById('bibScannerSwitchCamBtn').classList.toggle('hidden', availableCameraDevices_.length < 2);
            } catch (e) { /* non-fatal -- switch button just stays hidden */ }
        }

        async function startCameraStream_(constraintsOverride) {
            const video = document.getElementById('bibScannerVideo');
            if (bibScannerStream_) {
                bibScannerStream_.getTracks().forEach(t => t.stop());
                bibScannerStream_ = null;
            }

            const profile = ocrDeviceProfile_ || getOcrDeviceProfile_();
            const baseVideoConstraints = constraintsOverride || {
                facingMode: { ideal: 'environment' },
                width: { ideal: profile.idealWidth },
                height: { ideal: profile.idealHeight },
                frameRate: { ideal: 24, max: 30 }
            };

            const stream = await navigator.mediaDevices.getUserMedia({ video: baseVideoConstraints, audio: false });
            bibScannerStream_ = stream;
            video.onloadedmetadata = null;
            video.srcObject = stream;

            await new Promise((resolve, reject) => {
                if (video.readyState >= 1 && video.videoWidth) { resolve(); return; }
                const timeout = setTimeout(() => reject(new Error('Camera started but did not produce video frames.')), 8000);
                video.onloadedmetadata = () => { clearTimeout(timeout); resolve(); };
            });
            await video.play();

            const track = stream.getVideoTracks()[0];
            currentCameraDeviceId_ = track && track.getSettings ? track.getSettings().deviceId : null;
            if (track) {
                track.addEventListener('ended', () => {
                    if (!document.getElementById('bibScannerModal')?.classList.contains('hidden')) {
                        showBibScannerFallback_('⚠️ The camera stopped. Reopen OCR or use the photo option.');
                    }
                }, { once: true });
                try {
                    const caps = track.getCapabilities ? track.getCapabilities() : {};
                    const advanced = {};
                    if (Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) advanced.focusMode = 'continuous';
                    if (Array.isArray(caps.exposureMode) && caps.exposureMode.includes('continuous')) advanced.exposureMode = 'continuous';
                    if (Object.keys(advanced).length) await track.applyConstraints({ advanced: [advanced] });
                } catch (constraintError) { /* optional camera tuning only */ }
            }

            await refreshCameraDeviceList_();
            await prewarmOcrEngine_();
            if (bibScannerStream_ === stream && !document.getElementById('bibScannerModal')?.classList.contains('hidden')) {
                startAutoScan_();
            }
        }

        async function switchBibScannerCamera_() {
            if (availableCameraDevices_.length < 2) return;
            const currentIndex = availableCameraDevices_.findIndex(d => d.deviceId === currentCameraDeviceId_);
            const next = availableCameraDevices_[(currentIndex + 1) % availableCameraDevices_.length];
            setBibScannerStatus_('🔄 Switching camera...');
            lastPersonBox_ = null; detectionTickCounter_ = 0; // new camera view -- stale torso box would be wrong
            try {
                await startCameraStream_({ deviceId: { exact: next.deviceId } });
                setBibScannerStatus_('');
            } catch (err) {
                setBibScannerStatus_('⚠️ Could not switch camera: ' + err.message);
            }
        }

        async function prewarmOcrEngine_() {
            try {
                if (ocrEngine !== 'tesseract') return;
                if (!tesseractWorker_) {
                    setBibScannerStatus_('⏳ Preparing OCR engine…');
                    await getTesseractWorker_();
                }
                if (!autoLogInFlight_) setBibScannerStatus_('👀 Live OCR ready — hold a bib steady in the guide');
            } catch (error) {
                if (String(error && error.message || '').includes('session closed')) return;
                setBibScannerStatus_('⚠️ OCR engine could not load. Check the connection or use photo/manual entry.');
            }
        }

        async function openBibScanner() {
          if (!updateSetupGate_()) {
            alert('⚠️ Complete 1. Setup before starting live OCR.');
            focusIncompleteSetup_();
            return;
          }
          // Wrapped so the OCR button can never silently "do nothing": if anything
          // in the setup path throws, the modal still opens in photo-fallback
          // mode and the person is told what happened instead of a dead tap.
          try {
            if (ocrCleanupTimer_) { clearTimeout(ocrCleanupTimer_); ocrCleanupTimer_ = null; }
            ocrResourceGeneration_++;
            ocrDeviceProfile_ = getOcrDeviceProfile_();
            applyOcrEngineAvailability_(ocrDeviceProfile_);
            updateDetectionModeButtons_();
          } catch (setupErr) {
            console.error('Bib scanner setup failed:', setupErr);
          }
          try {
            lastPersonBox_ = null;
            detectionTickCounter_ = 0;

            document.getElementById('bibScannerFileInput').value = '';
            hideBibScannerFallback_();
            lastAutoScanReading_ = '';
            ocrAcceptedThisSession_ = false;
            autoLogInFlight_ = false;
            autoLoggedBibLatch_ = '';
            autoReadMissStreak_ = 0;
            setBibScannerStatus_('👀 Starting live OCR…');
            const modalEl = document.getElementById('bibScannerModal');
            modalEl.classList.remove('hidden');
            modalEl.style.display = 'flex'; // belt-and-braces if the stylesheet is stale/cached

            if (!isSecureContextForCamera_()) {
                showBibScannerFallback_('⚠️ Camera access needs a secure (HTTPS) connection. Use the photo option below instead.');
                return;
            }
            if (!isCameraApiSupported_()) {
                showBibScannerFallback_('This browser/device doesn\'t support live camera capture. Use the photo option below instead.');
                return;
            }
          } catch (uiErr) {
            console.error('Bib scanner UI failed to open:', uiErr);
            alert('⚠️ Could not open the bib scanner: ' + uiErr.message + '\n\nTry a hard refresh (or clear the app cache in Settings) to load the latest app version.');
            return;
          }

            try {
                await startCameraStream_();
            } catch (err) {
                // Common on desktops with no rear camera, or a browser that rejects
                // the ideal-resolution hint outright -- retry once with the barest
                // possible constraints before giving up and falling back to photo
                // upload. NotAllowedError means the person denied the permission
                // prompt, which no constraint retry can fix.
                if (err.name !== 'NotAllowedError' && err.name !== 'SecurityError') {
                    try {
                        await startCameraStream_(true);
                        return;
                    } catch (err2) { /* fall through to the fallback UI below */ }
                }
                const reason = err.name === 'NotAllowedError'
                    ? 'Camera permission was denied.'
                    : (err.name === 'NotFoundError' ? 'No camera was found on this device.' : ('Camera unavailable (' + err.message + ').'));
                showBibScannerFallback_('⚠️ ' + reason + ' Use the photo option below instead.');
            }
        }

        async function releaseOcrResources_() {
            ocrCleanupTimer_ = null;
            if (autoScanBusy_ || autoLogInFlight_) {
                ocrCleanupTimer_ = setTimeout(releaseOcrResources_, 1500);
                return;
            }
            try {
                if (tesseractWorker_ && typeof tesseractWorker_.terminate === 'function') await tesseractWorker_.terminate();
            } catch (e) { /* cleanup only */ }
            tesseractWorker_ = null;
            tesseractWorkerPromise_ = null;
            tesseractWorkerPromiseGeneration_ = -1;
            ocrLibraryLoadPromise_ = null;
            try { if (cocoSsdModel_ && typeof cocoSsdModel_.dispose === 'function') cocoSsdModel_.dispose(); } catch (e) {}
            cocoSsdModel_ = null;
            cocoSsdLoadPromise_ = null;
            lastPersonBox_ = null;
            try {
                if (window.tf && typeof window.tf.disposeVariables === 'function' && (ocrDeviceProfile_?.tier || 'low') === 'low') window.tf.disposeVariables();
            } catch (e) {}
        }

        function closeBibScanner() {
            ocrResourceGeneration_++;
            stopAutoScan_();
            if (bibScannerStream_) {
                bibScannerStream_.getTracks().forEach(track => track.stop());
                bibScannerStream_ = null;
            }
            const video = document.getElementById('bibScannerVideo');
            if (video) { video.pause(); video.srcObject = null; video.onloadedmetadata = null; }
            const modalEl = document.getElementById('bibScannerModal');
            modalEl.classList.add('hidden');
            modalEl.style.display = '';
            const delay = (ocrDeviceProfile_?.tier || 'low') === 'low' ? 1500 : 30000;
            if (ocrCleanupTimer_) clearTimeout(ocrCleanupTimer_);
            ocrCleanupTimer_ = setTimeout(releaseOcrResources_, delay);
        }

        function startAutoScan_() {
            stopAutoScan_();
            if (bibScannerUsingFallback_) return; // no live frames to sample in fallback mode
            const intervalMs = (ocrDeviceProfile_ || getOcrDeviceProfile_()).scanIntervalMs;
            setBibScannerStatus_('👀 Live OCR ready — hold a bib steady in the guide');
            autoScanTimerId_ = setInterval(() => { autoScanTick_(); }, intervalMs);
            setTimeout(() => autoScanTick_(), 150);
        }

        function stopAutoScan_() {
            if (autoScanTimerId_) { clearInterval(autoScanTimerId_); autoScanTimerId_ = null; }
        }

        function setBibScannerStatus_(text) {
            const el = document.getElementById('bibScannerStatus');
            el.textContent = text;
            el.style.display = text ? 'block' : 'none';
        }

        // Extracts the set of category-letter prefixes this event actually
        // configures (Setup sheet bibRule, e.g. "V1001-V1050" -> "V"), reusing
        // the same categoryConfig + parseBibRange_ the rest of the app already
        // uses for category/lap/pace lookups (see findCategoryConfigForBib_).
        function getKnownBibPrefixes_() {
            const prefixes = new Set();
            (categoryConfig || []).forEach(c => {
                const r = parseBibRange_(c.bibRule);
                if (r && r.prefix) prefixes.add(r.prefix.toUpperCase());
            });
            return prefixes;
        }

        // Cleans a raw OCR/manual reading into a bib value. This event's bibs
        // can carry a category letter prefix (e.g. "V1001" alongside plain
        // "1401" -- see the sample bib photos), so this can't just strip every
        // letter to digits the way a purely-numeric bib scheme would: a leading
        // letter run is kept as-is when it matches a prefix this event's Setup
        // sheet actually configures. If category config hasn't synced yet, a
        // leading letter is still trusted UNLESS it's one of the classic OCR
        // digit-lookalikes (O/I/L/S/B) -- those stay on the "probably a
        // misread digit" side by default until config confirms otherwise, so
        // an all-numeric bib like "1401" misread as "I4OI" still recovers
        // correctly even before the first sync.
        const OCR_AMBIGUOUS_PREFIX_LETTERS = new Set(['O', 'I', 'L', 'S', 'B']);

        function cleanOcrDigits_(raw) {
            const s = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').trim();
            if (!s) return '';

            const correctDigitLookalikes = (str) => str
                .replace(/O/g, '0')
                .replace(/[IL]/g, '1')
                .replace(/S/g, '5')
                .replace(/B/g, '8')
                .replace(/[^0-9]/g, '');

            const leadingLetters = s.match(/^([A-Z]+)/);
            if (leadingLetters) {
                const prefix = leadingLetters[1];
                const knownPrefixes = getKnownBibPrefixes_();
                const prefixLooksValid = knownPrefixes.has(prefix) || (
                    knownPrefixes.size === 0 &&
                    !(prefix.length === 1 && OCR_AMBIGUOUS_PREFIX_LETTERS.has(prefix))
                );
                if (prefixLooksValid) {
                    return prefix + correctDigitLookalikes(s.slice(prefix.length));
                }
            }

            return correctDigitLookalikes(s);
        }

        async function ensureTesseractLoaded_() {
            if (window.Tesseract) return;
            if (!ocrLibraryLoadPromise_) {
                ocrLibraryLoadPromise_ = loadExternalScript_('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js');
            }
            await ocrLibraryLoadPromise_;
        }

        async function ensureTensorFlowLoaded_() {
            if (tfjsLoaded_ && window.tf) return;
            await loadExternalScript_('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.20.0/dist/tf.min.js');
            tfjsLoaded_ = true;
        }

        // PaddleOCR.js (@paddlejs-models/ocr) needs Paddle.js' core runtime plus a
        // WebGL backend loaded first, then the OCR model package itself, which
        // exposes a global `ocr` object with an async init()/recognize() pair.
        let paddleOcrLoadPromise_ = null;
        let paddleOcrInitPromise_ = null;

        async function ensurePaddleOcrLoaded_() {
            if (!paddleOcrLoadPromise_) {
                paddleOcrLoadPromise_ = (async () => {
                    await loadExternalScript_('https://cdn.jsdelivr.net/npm/@paddlejs/paddlejs-core/lib/index.js');
                    await loadExternalScript_('https://cdn.jsdelivr.net/npm/@paddlejs/paddlejs-backend-webgl/lib/index.js');
                    await loadExternalScript_('https://cdn.jsdelivr.net/npm/@paddlejs-models/ocr/lib/index.js');
                })();
            }
            await paddleOcrLoadPromise_;

            if (!window.ocr) throw new Error('PaddleOCR.js failed to expose the global "ocr" object.');
            if (!paddleOcrInitPromise_) {
                // Downloads PaddleOCR's own detection+recognition model weights the
                // first time this runs (from Baidu's/Paddle.js's own CDN, not ours) —
                // this can take a few seconds on the first scan of a session.
                paddleOcrInitPromise_ = window.ocr.init();
            }
            await paddleOcrInitPromise_;
        }

        // Maps the on-screen guide box (CSS pixels) into the video's native pixel
        // space, correctly accounting for object-fit: cover's uniform scale + crop
        // (a naive per-axis scaleX/scaleY ratio is wrong whenever the video's
        // native aspect ratio doesn't exactly match the display box's aspect ratio,
        // which is the normal case on phone cameras).
        function computeGuideCropRect_(video, guideEl) {
            const videoRect = video.getBoundingClientRect();
            const guideRect = guideEl.getBoundingClientRect();
            const vw = video.videoWidth, vh = video.videoHeight;
            if (!vw || !vh || !videoRect.width || !videoRect.height) return null;

            const coverScale = Math.max(videoRect.width / vw, videoRect.height / vh);
            const displayedW = vw * coverScale, displayedH = vh * coverScale;
            const offsetX = (displayedW - videoRect.width) / 2;
            const offsetY = (displayedH - videoRect.height) / 2;

            const guideLeftInVideoEl = guideRect.left - videoRect.left;
            const guideTopInVideoEl  = guideRect.top - videoRect.top;

            const x = Math.max(0, (guideLeftInVideoEl + offsetX) / coverScale);
            const y = Math.max(0, (guideTopInVideoEl + offsetY) / coverScale);
            const w = Math.min(vw - x, guideRect.width / coverScale);
            const h = Math.min(vh - y, guideRect.height / coverScale);
            return { x, y, w, h };
        }

        // Grayscale + adaptive (mean-based) threshold to clean black/white, shared
        // by both the live-camera path and the photo-upload fallback path.
        function applyGrayscaleThreshold_(ctx, w, h) {
            const imgData = ctx.getImageData(0, 0, w, h);
            const px = imgData.data;
            let sum = 0;
            const gray = new Uint8ClampedArray(w * h);
            for (let i = 0, p = 0; i < px.length; i += 4, p++) {
                const g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
                gray[p] = g;
                sum += g;
            }
            const mean = sum / gray.length;
            // Bias the threshold slightly below the mean -- bib text is usually
            // dark-on-light, so this keeps thin strokes from getting wiped out.
            const threshold = mean * 0.85;
            for (let i = 0, p = 0; i < px.length; i += 4, p++) {
                const v = gray[p] > threshold ? 255 : 0;
                px[i] = px[i + 1] = px[i + 2] = v;
            }
            ctx.putImageData(imgData, 0, 0);
        }

        // Crops to the guide box, upscales (device-tier-dependent factor), and
        // applies the shared grayscale/threshold pass — this alone typically
        // matters more for accuracy than anything downstream in the OCR engine.
        // ── STAGE 4 entry point + full pipeline (live camera) ────────────────
        // Chains all four stages: quality gate -> object detection (torso crop)
        // -> text detection (glyph crop) -> upscale/threshold, ready for OCR.
        // Returns { canvas, quality } on success or { error } if the quality
        // gate rejected the frame (caller decides what to do/show).
        async function runFullDetectionPipeline_() {
            const video = document.getElementById('bibScannerVideo');
            if (!video.videoWidth) return { error: 'not_ready' };

            const profile = ocrDeviceProfile_ || getOcrDeviceProfile_();

            // Stage 0: Barcode/QR fast path -- an exact decode when a bib
            // carries one, skipping every stage below entirely on success.
            const barcodeDigits = await detectBarcodeDigits_(video);
            if (barcodeDigits) return { barcodeDigits };

            const guideEl = document.getElementById('bibScannerGuide');
            const guideCrop = computeGuideCropRect_(video, guideEl) || { x: 0, y: 0, w: video.videoWidth, h: video.videoHeight };

            // Stage 1: Image Quality -- cheap, always first, so a bad frame
            // never wastes cycles on the heavier stages below.
            const quickCanvas = document.createElement('canvas');
            quickCanvas.width = Math.max(1, Math.round(guideCrop.w));
            quickCanvas.height = Math.max(1, Math.round(guideCrop.h));
            quickCanvas.getContext('2d').drawImage(video, guideCrop.x, guideCrop.y, guideCrop.w, guideCrop.h, 0, 0, quickCanvas.width, quickCanvas.height);
            const quality = assessImageQuality_(quickCanvas);
            if (!quality.ok) {
                return { error: quality.isBlurry ? 'blurry' : (quality.isDark ? 'dark' : 'bright') };
            }

            // Stage 2 (+2b/2c): Object Detection, upgraded to a precise
            // anatomical torso band where available. Precedence: pose
            // refinement (high tier only, most precise) -> face-detection
            // anthropometric estimate (mid/high tier, lighter than pose) ->
            // coco-ssd person-box heuristic (heaviest/least precise fallback)
            // -> static guide box. Throttled (detectEveryNTicks) since all
            // three detection stages are meaningfully heavier than the rest of
            // the pipeline, and the previous tick's box is reused in between
            // runs so the crop doesn't jump every tick even though detection
            // itself is cheaper.
            let cropRect = guideCrop;
            let usedRefinedCrop = false;
            if (profile.enablePoseRefinement) {
                detectionTickCounter_++;
                if (!lastPersonBox_ || detectionTickCounter_ % profile.detectEveryNTicks === 0) {
                    try {
                        const band = await detectTorsoBandFromPose_(video);
                        if (band) { lastPersonBox_ = { poseRect: band }; }
                    } catch (e) { /* non-fatal -- fall back to face/coco-ssd/guide box below */ }
                }
                if (lastPersonBox_ && lastPersonBox_.poseRect) {
                    cropRect = lastPersonBox_.poseRect;
                    usedRefinedCrop = true;
                }
            }
            if (!usedRefinedCrop && profile.enableFaceDetection && isWebglAvailable_()) {
                detectionTickCounter_++;
                if (!lastPersonBox_ || detectionTickCounter_ % profile.detectEveryNTicks === 0) {
                    try {
                        await ensureFaceDetectionLoaded_();
                        const faceBox = await detectFaceBox_(video);
                        const band = faceBox ? computeTorsoRectFromFaceBox_(faceBox, video.videoWidth, video.videoHeight) : null;
                        if (band) { lastPersonBox_ = { faceRect: band }; }
                    } catch (e) { /* non-fatal -- fall back to coco-ssd/guide box below */ }
                }
                if (lastPersonBox_ && lastPersonBox_.faceRect) {
                    cropRect = lastPersonBox_.faceRect;
                    usedRefinedCrop = true;
                }
            }
            if (!usedRefinedCrop && profile.enableObjectDetection && isWebglAvailable_()) {
                detectionTickCounter_++;
                if (!lastPersonBox_ || detectionTickCounter_ % profile.detectEveryNTicks === 0) {
                    try {
                        await ensureObjectDetectionLoaded_();
                        const box = await detectPersonBox_(video);
                        // On a detection tick, a miss CLEARS the remembered box instead of
                        // reusing a stale one — otherwise a runner walking out of frame
                        // would leave the person-first gate below permanently satisfied
                        // and OCR free to read whatever wandered into frame (car plates,
                        // signage, etc.).
                        lastPersonBox_ = box ? { box } : null;
                    } catch (e) { /* non-fatal -- fall back to the static guide box */ }
                }
                if (lastPersonBox_ && lastPersonBox_.box) {
                    cropRect = computeTorsoRectFromPersonBox_(lastPersonBox_.box, video.videoWidth, video.videoHeight);
                    usedRefinedCrop = true;
                }
            }

            // ── PERSON-FIRST GATE ────────────────────────────────────────────
            // A bib number is always worn by a runner, so OCR is only allowed to
            // run once a person has actually been detected in frame (via pose,
            // face, or coco-ssd person box). This is what stops the scanner from
            // happily reading car plates, signage, or any other random text that
            // fills the guide box. The gate is skipped only when:
            //   • "Bib Number Only (Fast)" mode is explicitly selected, or
            //   • the device tier has every detection stage disabled (low tier /
            //     models unavailable) — there OCR still runs, but the reading is
            //     validated against the event's configured bib ranges instead
            //     (see isValidConfiguredBib_), which rejects non-bib text.
            const personGateActive = detectionMode !== 'bibOnly'
                && (profile.enablePoseRefinement || profile.enableFaceDetection || profile.enableObjectDetection);
            if (personGateActive && !usedRefinedCrop) {
                return { error: 'noPerson' };
            }

            const workingCanvas = document.createElement('canvas');
            workingCanvas.width = Math.max(1, Math.round(cropRect.w));
            workingCanvas.height = Math.max(1, Math.round(cropRect.h));
            workingCanvas.getContext('2d').drawImage(video, cropRect.x, cropRect.y, cropRect.w, cropRect.h, 0, 0, workingCanvas.width, workingCanvas.height);

            // Stage 3: Text Detection -- narrows further to the actual glyphs.
            const finalSourceCanvas = await applyTextDetectionCrop_(workingCanvas, profile);

            // Stage 4 prep: upscale + grayscale/threshold, ready for OCR.
            const upscale = profile.upscale;
            const outW = Math.max(1, Math.round(finalSourceCanvas.width * upscale));
            const outH = Math.max(1, Math.round(finalSourceCanvas.height * upscale));
            const outCanvas = document.getElementById('bibScannerCanvas');
            outCanvas.width = outW; outCanvas.height = outH;
            const octx = outCanvas.getContext('2d');
            octx.imageSmoothingEnabled = true;
            octx.drawImage(finalSourceCanvas, 0, 0, outW, outH);
            applyGrayscaleThreshold_(octx, outW, outH);
            return { canvas: outCanvas, quality };
        }

        // Same pipeline, but for a static uploaded/captured photo instead of a
        // live video element (used by the camera-unavailable fallback path).
        // Barcode detection, face detection, and coco-ssd all accept an <img>
        // element directly, same as they accept <video>. Pose refinement is
        // skipped here deliberately -- see the Stage 2b comment above; it's
        // configured for VIDEO running mode and switching modes per-call isn't
        // worth the complexity for a fallback path. Face detection (Stage 2c)
        // is tried first here regardless of device tier -- there's no live
        // throttling concern for a single still photo, and it's a real
        // precision upgrade over coco-ssd's box heuristic when a face is
        // visible in the photo. There's no "wait for a better frame" option
        // for a still photo, so a quality warning is surfaced rather than
        // blocking.
        async function runDetectionPipelineOnImage_(imgEl) {
            const profile = ocrDeviceProfile_ || getOcrDeviceProfile_();

            const barcodeDigits = await detectBarcodeDigits_(imgEl);
            if (barcodeDigits) return { barcodeDigits };

            const fullCanvas = document.createElement('canvas');
            fullCanvas.width = imgEl.naturalWidth || imgEl.width;
            fullCanvas.height = imgEl.naturalHeight || imgEl.height;
            fullCanvas.getContext('2d').drawImage(imgEl, 0, 0, fullCanvas.width, fullCanvas.height);
            const quality = assessImageQuality_(fullCanvas);

            let cropRect = { x: 0, y: 0, w: fullCanvas.width, h: fullCanvas.height };
            let personDetectedInPhoto = false;
            const photoDetectionAvailable = (profile.enableFaceDetection || profile.enableObjectDetection) && isWebglAvailable_();
            if (photoDetectionAvailable) {
                let usedRefinedCrop = false;
                if (profile.enableFaceDetection) {
                    try {
                        await ensureFaceDetectionLoaded_();
                        const faceBox = await detectFaceBox_(imgEl);
                        const band = faceBox ? computeTorsoRectFromFaceBox_(faceBox, fullCanvas.width, fullCanvas.height) : null;
                        if (band) { cropRect = band; usedRefinedCrop = true; personDetectedInPhoto = true; }
                    } catch (e) { /* non-fatal -- fall back to coco-ssd below */ }
                }

                if (!usedRefinedCrop && profile.enableObjectDetection) {
                    try {
                        await ensureObjectDetectionLoaded_();
                        const box = await detectPersonBox_(imgEl);
                        if (box) { cropRect = computeTorsoRectFromPersonBox_(box, fullCanvas.width, fullCanvas.height); personDetectedInPhoto = true; }
                    } catch (e) { /* non-fatal -- use the whole photo */ }
                }

                // Same person-first rule as the live pipeline: no person in the
                // photo means it's not a runner wearing a bib — refuse to OCR it
                // rather than reading a car plate / poster / random text.
                if (detectionMode !== 'bibOnly' && !personDetectedInPhoto) {
                    return { error: 'noPerson', quality };
                }
            }

            const workingCanvas = document.createElement('canvas');
            workingCanvas.width = Math.max(1, Math.round(cropRect.w));
            workingCanvas.height = Math.max(1, Math.round(cropRect.h));
            workingCanvas.getContext('2d').drawImage(fullCanvas, cropRect.x, cropRect.y, cropRect.w, cropRect.h, 0, 0, workingCanvas.width, workingCanvas.height);

            const finalSourceCanvas = await applyTextDetectionCrop_(workingCanvas, profile);

            const MIN_DIMENSION = 800;
            const scale = Math.max(1, MIN_DIMENSION / Math.max(finalSourceCanvas.width, finalSourceCanvas.height));
            const outW = Math.round(finalSourceCanvas.width * scale);
            const outH = Math.round(finalSourceCanvas.height * scale);
            const outCanvas = document.getElementById('bibScannerCanvas');
            outCanvas.width = outW; outCanvas.height = outH;
            const octx = outCanvas.getContext('2d');
            octx.drawImage(finalSourceCanvas, 0, 0, outW, outH);
            applyGrayscaleThreshold_(octx, outW, outH);
            return { canvas: outCanvas, quality };
        }

        function handleBibScannerFileSelected_(event) {
            const file = event.target.files && event.target.files[0];
            if (!file) return;

            setBibScannerStatus_('🔎 Reading photo...');
            const img = new Image();
            img.onload = async () => {
                try {
                    const result = await runDetectionPipelineOnImage_(img);
                    if (result.barcodeDigits) {
                        acceptOcrReading_(result.barcodeDigits, `✅ Barcode/QR ${result.barcodeDigits} detected — recording…`);
                        return;
                    }
                    if (result.error) {
                        setBibScannerStatus_(result.error === 'noPerson'
                            ? '🧍 No person detected in that photo — the bib must be worn by a runner. Take a photo of the runner wearing the bib.'
                            : (QUALITY_ERROR_MESSAGES[result.error] || '❌ Could not process that photo — try another.'));
                        return;
                    }
                    const { text, confidence } = await runOcrOnCanvas_(result.canvas);
                    const digits = cleanOcrDigits_(text);
                    if (!digits) {
                        setBibScannerStatus_('❌ No number recognized in that photo — try another.');
                        return;
                    }
                    if (!isValidConfiguredBib_(digits)) {
                        setBibScannerStatus_(`🚫 "${digits}" has no numeric BIB component — try another photo.`);
                        return;
                    }
                    if (confidence < OCR_MIN_CONFIDENCE) {
                        setBibScannerStatus_(`⚠️ Low confidence (${Math.round(confidence)}%) for "${digits}" — take another photo or enter it manually.`);
                        return;
                    }
                    acceptOcrReading_(digits);
                } catch (err) {
                    setBibScannerStatus_('⚠️ OCR error: ' + err.message);
                }
            };
            img.onerror = () => setBibScannerStatus_('⚠️ Could not read that photo file.');
            const objectUrl = URL.createObjectURL(file);
            img.onload = ((originalOnload) => async function() {
                try { await originalOnload.call(this); }
                finally { URL.revokeObjectURL(objectUrl); }
            })(img.onload);
            img.onerror = ((originalOnerror) => function() {
                try { originalOnerror.call(this); }
                finally { URL.revokeObjectURL(objectUrl); }
            })(img.onerror);
            img.src = objectUrl;
        }

        async function getTesseractWorker_() {
            await ensureTesseractLoaded_();
            if (tesseractWorker_) return tesseractWorker_;
            const generation = ocrResourceGeneration_;
            if (tesseractWorkerPromise_ && tesseractWorkerPromiseGeneration_ !== generation) {
                // A previous camera session is still initialising. Let that caller
                // terminate its worker when it resolves, and start a fresh worker for
                // this session rather than sharing a soon-to-be-cancelled promise.
                tesseractWorkerPromise_ = null;
                tesseractWorkerPromiseGeneration_ = -1;
            }
            if (!tesseractWorkerPromise_) {
                const creation = (async () => {
                    const worker = await Tesseract.createWorker('eng');
                    await worker.setParameters({
                        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
                        tessedit_pageseg_mode: '8'
                    });
                    return worker;
                })();
                tesseractWorkerPromise_ = creation;
                tesseractWorkerPromiseGeneration_ = generation;
                creation.catch(() => {
                    if (tesseractWorkerPromise_ === creation) {
                        tesseractWorkerPromise_ = null;
                        tesseractWorkerPromiseGeneration_ = -1;
                    }
                });
            }
            const pending = tesseractWorkerPromise_;
            const worker = await pending;
            if (generation !== ocrResourceGeneration_) {
                try { await worker.terminate(); } catch (e) { /* cleanup only */ }
                if (tesseractWorkerPromise_ === pending) {
                    tesseractWorkerPromise_ = null;
                    tesseractWorkerPromiseGeneration_ = -1;
                }
                throw new Error('OCR session closed while the engine was starting.');
            }
            tesseractWorker_ = worker;
            return worker;
        }

        async function runTesseractOcr_(canvas) {
            const worker = await getTesseractWorker_();
            const { data } = await worker.recognize(canvas);
            return { text: data.text, confidence: Number(data.confidence) || 0 };
        }

        // Slot for a real ML Kit-style web model. tf.loadGraphModel(url) would
        // load a custom-trained digit-string recognizer here; until one is
        // hosted, this reuses the Tesseract pass (on the same preprocessed crop)
        // so the "experimental" option still returns a real result instead of
        // silently failing.
        async function runTensorFlowOcr_(canvas) {
            await ensureTensorFlowLoaded_();
            // TODO: replace with `const model = await tf.loadGraphModel('<model-url>/model.json');`
            // and real inference once a bib-digit model is trained/hosted.
            return runTesseractOcr_(canvas);
        }

        // PaddleOCR.js recognition. The model does detection + recognition in one
        // pass and can return multiple text regions for a busy scene -- for a
        // tightly-cropped bib-number frame there's normally just one, so results
        // are concatenated in case more than one comes back. Different published
        // versions of @paddlejs-models/ocr have returned the text list under
        // res.text vs res directly, so both shapes are handled defensively rather
        // than assuming one.
        async function runPaddleOcr_(canvas) {
            await ensurePaddleOcrLoaded_();
            const res = await window.ocr.recognize(canvas);
            const textList = Array.isArray(res) ? res : (res && Array.isArray(res.text) ? res.text : (res && res.text ? [res.text] : []));
            const combinedText = textList.join(' ');
            // PaddleOCR's bundled model doesn't expose a per-character confidence
            // score the way Tesseract does, so a fixed "moderate confidence" value
            // is used here to satisfy the same OCR_MIN_CONFIDENCE gate the other
            // engines go through -- treat this engine's readings with a bit more
            // manual double-checking than Tesseract's actual confidence score.
            return { text: combinedText, confidence: combinedText ? 70 : 0 };
        }

        async function runOcrOnCanvas_(canvas) {
            try {
                if (ocrEngine === 'tensorflow') return await runTensorFlowOcr_(canvas);
                if (ocrEngine === 'paddleocr') return await runPaddleOcr_(canvas);
                return await runTesseractOcr_(canvas);
            } catch (primaryError) {
                if (ocrEngine !== 'tesseract') {
                    ocrEngine = 'tesseract';
                    localStorage.setItem('ocrEngine', 'tesseract');
                    const select = document.getElementById('ocrEngineSelect');
                    if (select) select.value = 'tesseract';
                    setBibScannerStatus_('⚠️ Selected OCR engine failed; switched to Tesseract.');
                    return runTesseractOcr_(canvas);
                }
                throw primaryError;
            }
        }

        function noteAutoScanMiss_() {
            autoReadMissStreak_ += 1;
            if (autoReadMissStreak_ >= 2) autoLoggedBibLatch_ = '';
        }

        async function autoRecordScannedBib_(bib, sourceMessage) {
            bib = cleanOcrDigits_(bib);
            if (!bib || autoLogInFlight_) return;
            if (!isSetupComplete_()) {
                setBibScannerStatus_('⚠️ Setup is incomplete — live logging paused.');
                return;
            }
            if (bib === autoLoggedBibLatch_) {
                setBibScannerStatus_(`✅ Bib ${bib} already logged — move to the next runner`);
                return;
            }

            autoLogInFlight_ = true;
            autoLoggedBibLatch_ = bib;
            let cpV = (document.getElementById('checkpoint')?.value || '').trim().toUpperCase();
            let gpsResult;
            try { gpsResult = await resolveGpsBeforeLog_(cpV); }
            catch (_) { gpsResult = { checkpoint: checkpointToken_(cpV), status: 'unverified', acknowledged: false }; }
            if (gpsResult && gpsResult.cancelled) {
                autoLogInFlight_ = false;
                autoLoggedBibLatch_ = '';
                lastAutoScanReading_ = '';
                setBibScannerStatus_('⚠️ GPS checkpoint check cancelled — update Setup before scanning.');
                return;
            }
            cpV = (gpsResult && gpsResult.checkpoint) || checkpointToken_(cpV);
            const getAllRequest = requestLogsForBib_(bib);
            getAllRequest.onsuccess = function(e) {
                const runnerLogs = e.target.result || [];
                const recentDuplicate = runnerLogs.some(log => isRecentSamePassage_(log, bib, cpV));
                if (recentDuplicate) {
                    autoLogInFlight_ = false;
                    lastAutoScanReading_ = '';
                    setBibScannerStatus_(`⏭️ Bib ${bib} was logged recently — move to the next runner`);
                    return;
                }
                const categoryResolution = resolveBibCategory_(bib, runnerLogs, cpV);
                const routeWarning = routeWarningForCandidate_(bib, cpV, runnerLogs);
                if (routeWarning && !confirm(`⚠️ Route check for Bib ${bib}: ${routeWarning.message}

Clarify the previous checkpoint check-in. Log anyway?`)) {
                    autoLogInFlight_ = false;
                    autoLoggedBibLatch_ = '';
                    lastAutoScanReading_ = '';
                    setBibScannerStatus_(`⚠️ Bib ${bib}: clarify previous checkpoint`);
                    announceToScreenReader_(`Route check for bib ${bib}. ${routeWarning.message}`);
                    return;
                }

                setBibScannerStatus_(sourceMessage || `✅ Detected ${bib} — recording…`);
                logEntry(bib, {
                    keepScannerActive: true,
                    routeWarning: routeWarning ? routeWarning.message : '',
                    routeWarningAcknowledged: !!routeWarning,
                    categoryResolution,
                    locationStatus: gpsResult && gpsResult.status || 'unverified',
                    locationAcknowledged: !!(gpsResult && gpsResult.acknowledged),
                    locationDecision: gpsResult && gpsResult.decision || null,
                    onLogged: function(entry) {
                        autoLogInFlight_ = false;
                        lastAutoScanReading_ = '';
                        autoReadMissStreak_ = 0;
                        setBibScannerStatus_(entry && entry.status === 'Location Spam'
                            ? `🚫 Bib ${bib} saved as location spam — excluded from race counts`
                            : `✅ Bib ${bib} logged — move to the next runner`);
                    },
                    onError: function(err) {
                        autoLogInFlight_ = false;
                        autoLoggedBibLatch_ = '';
                        setBibScannerStatus_('⚠️ Could not save bib ' + bib + ': ' + ((err && err.message) || 'local database error'));
                    }
                });
            };
            getAllRequest.onerror = function() {
                autoLogInFlight_ = false;
                autoLoggedBibLatch_ = '';
                setBibScannerStatus_('⚠️ Could not check recent scans. Try again.');
            };
        }

        function acceptOcrReading_(digits, statusMessage) {
            autoRecordScannedBib_(digits, statusMessage || `✅ Detected ${digits} — recording…`);
        }

        // Runs quietly in the background on the device-tier interval (see
        // getOcrDeviceProfile_) while the
        // modal is open. It logs only after the same bib is read twice
        // in a row at or above OCR_MIN_CONFIDENCE; a lone misread frame is ignored.
        const QUALITY_ERROR_MESSAGES = {
            blurry: '📵 Too blurry — hold steady',
            dark: '🔦 Too dark — more light needed',
            bright: '☀️ Glare/too bright — adjust angle',
            noPerson: '🧍 No runner detected — point the camera at the person wearing the bib',
            not_ready: '👀 Scanning...'
        };

        // ── Bib-format validation against the event's Setup config ──────────
        // The final line of defense against reading car plates / signage / any
        // random text: a reading is only accepted if it actually falls inside
        // one of the bib ranges configured on the Setup sheet (e.g. 1001-1378,
        // V8301-V8348). Reuses the exact same category matcher the rest of the
        // app uses for laps/pace, so "valid" here always agrees with what the
        // dashboard would categorize. If the config hasn't synced yet (fresh
        // offline install), validation is skipped rather than blocking scans.
        function isValidConfiguredBib_(value) {
            // Last-minute, out-of-range and letters-only identifiers are valid
            // operational records. Unmatched values are saved as Uncategorized.
            return !!normalizeBibOriginal_(value);
        }

        async function autoScanTick_() {
            if (autoScanBusy_ || autoLogInFlight_) return;
            autoScanBusy_ = true;
            try {
                const result = await runFullDetectionPipeline_();
                if (result.barcodeDigits) {
                    autoReadMissStreak_ = 0;
                    autoRecordScannedBib_(result.barcodeDigits, `✅ Barcode/QR ${result.barcodeDigits} detected — recording…`);
                    return;
                }
                if (result.error) {
                    lastAutoScanReading_ = '';
                    noteAutoScanMiss_();
                    setBibScannerStatus_(QUALITY_ERROR_MESSAGES[result.error] || '👀 Scanning…');
                    return;
                }

                const { text, confidence } = await runOcrOnCanvas_(result.canvas);
                const digits = cleanOcrDigits_(text);

                if (!digits || digits.length < OCR_MIN_DIGITS || confidence < OCR_MIN_CONFIDENCE) {
                    lastAutoScanReading_ = '';
                    noteAutoScanMiss_();
                    setBibScannerStatus_('👀 Scanning…');
                    return;
                }

                if (!isValidConfiguredBib_(digits)) {
                    lastAutoScanReading_ = '';
                    noteAutoScanMiss_();
                    setBibScannerStatus_(`🚫 "${digits}" has no numeric BIB component — ignoring`);
                    return;
                }

                autoReadMissStreak_ = 0;
                if (digits === autoLoggedBibLatch_) {
                    setBibScannerStatus_(`✅ Bib ${digits} already logged — move to the next runner`);
                    return;
                }
                if (digits === lastAutoScanReading_) {
                    autoRecordScannedBib_(digits);
                } else {
                    lastAutoScanReading_ = digits;
                    setBibScannerStatus_(`👀 Reading ${digits}… hold steady for auto log`);
                }
            } catch (err) {
                noteAutoScanMiss_();
                lastAutoScanReading_ = '';
                setBibScannerStatus_('⚠️ OCR paused: ' + ((err && err.message) || 'scanner error'));
            } finally {
                autoScanBusy_ = false;
            }
        }

        /* ════════════════════════════════════════════════════════════════════
           FINAL EVENT LISTENER REGISTRATIONS
           ════════════════════════════════════════════════════════════════════ */

        // Bib submission is handled by #bibEntryForm, so both the large LOG button
        // and the mobile keyboard's Enter/Go key use the same one-tap code path.
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { const el = document.getElementById('settingsModal'); if (el && !el.classList.contains('hidden')) closeSettings(e); } });
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { const el = document.getElementById('directorCustomizeModal'); if (el && !el.classList.contains('hidden')) closeDirectorCustomize(e); } });
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && isDirectorModeOpen) closeDirectorMode(); });
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { const el = document.getElementById('safetyLogView'); if (el && !el.classList.contains('hidden')) closeSafetyLog(); } });
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { const el = document.getElementById('bibScannerModal'); if (el && !el.classList.contains('hidden')) closeBibScanner(); } });
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { const el = document.getElementById('exportScopeModal'); if (el && !el.classList.contains('hidden')) closeExportScopePrompt_(); } });
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { const el = document.getElementById('incidentModal'); if (el && !el.classList.contains('hidden')) closeIncidentModal_(); } });
