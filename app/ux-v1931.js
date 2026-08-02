/* Race Bib Logger v19.3.1 — non-invasive UI/UX enhancement layer.
 * Loaded after the operational modules so it can improve presentation without
 * changing record formats, sync contracts, or race calculations.
 */
(() => {
  'use strict';

  const VERSION = '19.3.1';
  const DIRECTOR_LABEL_MS = 5000;
  let directorHintTimer = 0;
  let directorExitArmedUntil = 0;
  let minimalWakeLock = null;

  function byId(id) { return document.getElementById(id); }
  function storageGet(key) { try { return localStorage.getItem(key); } catch (_) { return null; } }
  function storageSet(key, value) { try { localStorage.setItem(key, value); } catch (_) { /* storage unavailable */ } }
  function isTextEntry(element) {
    return !!element && /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName) || !!element?.isContentEditable;
  }

  function vibrate(pattern) {
    try {
      if (navigator.vibrate && storageGet('vibrateEnabled') !== 'false') navigator.vibrate(pattern);
    } catch (_) { /* unsupported or blocked */ }
  }

  function showDirectorToolbarHint(label, durationMs = DIRECTOR_LABEL_MS) {
    const hint = byId('directorToolbarHint');
    if (!hint) return;
    const clean = String(label || '').trim();
    if (!clean) return;
    hint.textContent = clean;
    hint.classList.add('is-visible');
    clearTimeout(directorHintTimer);
    directorHintTimer = window.setTimeout(() => hint.classList.remove('is-visible'), Math.max(1200, Number(durationMs) || DIRECTOR_LABEL_MS));
  }

  function showSafetyToolbarHint(label, durationMs = 2400) {
    const hint = byId('safetyToolbarHint');
    const clean = String(label || '').trim();
    if (!hint || !clean) return;
    hint.textContent = clean;
    hint.classList.add('is-visible');
    clearTimeout(showSafetyToolbarHint.timer);
    showSafetyToolbarHint.timer = window.setTimeout(() => hint.classList.remove('is-visible'), Math.max(1000, Number(durationMs) || 2400));
  }
  showSafetyToolbarHint.timer = 0;
  window.showSafetyToolbarHint_ = showSafetyToolbarHint;

  function toolbarLabel(elementId, temporaryLabel) {
    const element = byId(elementId);
    if (!element) return '';
    return String(temporaryLabel || element.dataset.fullLabel || element.getAttribute('aria-label') || '').trim();
  }

  function installStableDirectorToolbar() {
    // Preserve the earlier five-second label requirement without changing button width.
    // The label appears as an overlay, so the command bar never pushes off-screen.
    window.revealDirectorToolbarLabel_ = function revealDirectorToolbarLabelV193(elementId, temporaryLabel, durationMs = DIRECTOR_LABEL_MS) {
      showDirectorToolbarHint(toolbarLabel(elementId, temporaryLabel), durationMs);
    };

    window.directorCustomizeAction_ = function directorCustomizeActionV193(event) {
      event?.preventDefault?.();
      showDirectorToolbarHint('Customize command view');
      if (typeof window.openDirectorCustomize === 'function') window.openDirectorCustomize(event);
    };

    window.directorRefreshAction_ = function directorRefreshActionV193(event) {
      event?.preventDefault?.();
      showDirectorToolbarHint('Refreshing race data…');
      vibrate(12);
      if (typeof window.pullServerRecords === 'function') window.pullServerRecords();
      if (typeof window.attemptSync === 'function') window.attemptSync();
    };

    window.directorExitAction_ = function directorExitActionV193(event) {
      event?.preventDefault?.();
      const button = byId('directorExitButton');
      const now = Date.now();
      if (now < directorExitArmedUntil) {
        directorExitArmedUntil = 0;
        button?.classList.remove('is-armed');
        showDirectorToolbarHint('Leaving Race Command View', 1200);
        if (typeof window.closeDirectorMode === 'function') window.closeDirectorMode();
        return;
      }
      directorExitArmedUntil = now + DIRECTOR_LABEL_MS;
      button?.classList.add('is-armed');
      button?.setAttribute('aria-label', 'Exit armed. Tap again within five seconds to leave Race Command View.');
      showDirectorToolbarHint('Tap Exit again to leave', DIRECTOR_LABEL_MS);
      window.setTimeout(() => {
        if (Date.now() >= directorExitArmedUntil) {
          button?.classList.remove('is-armed');
          button?.setAttribute('aria-label', 'Exit Director Mode. Tap once to arm, tap again to exit.');
        }
      }, DIRECTOR_LABEL_MS + 50);
    };
  }

  function installDirectorNavigation() {
    const root = byId('directorModeView');
    const backToTop = byId('directorBackToTop');
    if (!root || !backToTop) return;

    backToTop.addEventListener('click', () => {
      root.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      showDirectorToolbarHint('Top of command view', 1400);
    });
    root.addEventListener('scroll', () => backToTop.classList.toggle('is-visible', root.scrollTop > 520), { passive: true });
  }

  function installWidgetHelpToggles() {
    document.querySelectorAll('#directorWidgetsGrid [data-widget]').forEach(section => {
      const header = section.firstElementChild;
      const description = header?.querySelector('p');
      if (!header || !description || header.querySelector('.widget-help-button')) return;
      description.classList.add('widget-help-text');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'widget-help-button';
      button.textContent = 'i';
      button.setAttribute('aria-label', 'Show or hide widget explanation');
      button.setAttribute('aria-expanded', 'false');
      button.addEventListener('click', event => {
        event.stopPropagation();
        const open = section.classList.toggle('show-widget-help');
        button.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      const controls = header.querySelector('.widget-width-controls');
      header.insertBefore(button, controls || null);
    });
  }

  function installMapFullscreen() {
    const widget = byId('widget-map');
    const header = widget?.firstElementChild;
    if (!widget || !header || header.querySelector('.map-fullscreen-button')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'widget-help-button map-fullscreen-button';
    button.textContent = '⛶';
    button.setAttribute('aria-label', 'Open GPS map full screen');
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', event => {
      event.stopPropagation();
      const full = widget.classList.toggle('map-is-fullscreen');
      if (full) document.body.classList.add('overflow-hidden');
      else if (byId('directorModeView')?.classList.contains('hidden')) document.body.classList.remove('overflow-hidden');
      button.textContent = full ? '✕' : '⛶';
      button.setAttribute('aria-pressed', full ? 'true' : 'false');
      button.setAttribute('aria-label', full ? 'Close full-screen GPS map' : 'Open GPS map full screen');
      showDirectorToolbarHint(full ? 'GPS map full screen' : 'GPS map restored', 1600);
      window.setTimeout(() => window.dispatchEvent(new Event('resize')), 180);
    });
    const controls = header.querySelector('.widget-width-controls');
    header.insertBefore(button, controls || null);
  }

  function updateMinimalActiveTarget() {
    const pill = byId('minimalActiveTargetPill');
    const wrap = byId('minimalBibDisplayWrap');
    const wakeStatus = byId('minimalWakeStatus');
    if (pill) pill.textContent = wrap?.classList.contains('is-active') ? 'BIB' : 'REMARK';
    if (wakeStatus && !('wakeLock' in navigator)) wakeStatus.textContent = 'Keep screen awake manually';
  }

  async function requestMinimalWakeLock() {
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') {
      updateMinimalActiveTarget();
      return;
    }
    try {
      if (minimalWakeLock) return;
      minimalWakeLock = await navigator.wakeLock.request('screen');
      const status = byId('minimalWakeStatus');
      if (status) status.textContent = 'Screen kept awake';
      minimalWakeLock.addEventListener('release', () => {
        minimalWakeLock = null;
        const current = byId('minimalWakeStatus');
        if (current) current.textContent = 'Screen awake';
      });
    } catch (_) {
      const status = byId('minimalWakeStatus');
      if (status) status.textContent = 'Keep screen awake manually';
    }
  }

  async function releaseMinimalWakeLock() {
    try { await minimalWakeLock?.release?.(); } catch (_) { /* already released */ }
    minimalWakeLock = null;
  }

  function minimalViewIsOpen() {
    const view = byId('minimalBibModeView');
    return !!view && !view.classList.contains('hidden');
  }

  function installMinimalModeEnhancements() {
    const view = byId('minimalBibModeView');
    const bibWrap = byId('minimalBibDisplayWrap');
    const remarkShell = byId('minimalRemarkShell');
    if (!view) return;

    view.addEventListener('pointerdown', event => {
      const target = event.target.closest('.minimal-key, .minimal-bib-actions button, .minimal-backspace-btn, .minimal-keyboard-tab');
      if (!target) return;
      vibrate(target.id === 'minimalBibLogButton' ? 24 : 8);
    }, { passive: true });

    const observer = new MutationObserver(() => {
      updateMinimalActiveTarget();
      if (minimalViewIsOpen()) requestMinimalWakeLock();
      else releaseMinimalWakeLock();
    });
    observer.observe(view, { attributes: true, attributeFilter: ['class'] });
    if (bibWrap) observer.observe(bibWrap, { attributes: true, attributeFilter: ['class'] });
    if (remarkShell) observer.observe(remarkShell, { attributes: true, attributeFilter: ['class'] });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && minimalViewIsOpen()) requestMinimalWakeLock();
      else if (document.visibilityState !== 'visible') releaseMinimalWakeLock();
    });
    updateMinimalActiveTarget();
  }

  function installSafetyToolbar() {
    const view = byId('safetyLogView');
    if (!view) return;
    view.addEventListener('pointerdown', event => {
      const control = event.target.closest('.safety-icon-action');
      if (control) vibrate(8);
    }, { passive: true });
    if ('MutationObserver' in window) {
      new MutationObserver(() => {
        if (view.classList.contains('hidden')) byId('safetyToolbarHint')?.classList.remove('is-visible');
      }).observe(view, { attributes: true, attributeFilter: ['class'] });
    }
  }

  function installSafetyScrollHint() {
    const viewport = byId('safetyTableViewport');
    if (!viewport || byId('safetyScrollHint')) return;
    const hint = document.createElement('div');
    hint.id = 'safetyScrollHint';
    hint.className = 'safety-scroll-hint';
    hint.textContent = 'BIB stays pinned • swipe sideways for more columns';
    viewport.parentNode?.insertBefore(hint, viewport);
    const hide = () => {
      if (viewport.scrollLeft > 12) {
        hint.classList.add('is-hidden');
        storageSet('safetyScrollHintSeen_v193', '1');
      }
    };
    if (storageGet('safetyScrollHintSeen_v193') === '1') hint.classList.add('is-hidden');
    viewport.addEventListener('scroll', hide, { passive: true });
  }

  function installDirectorKeyboardShortcuts() {
    document.addEventListener('keydown', event => {
      const root = byId('directorModeView');
      if (!root || root.classList.contains('hidden') || isTextEntry(event.target)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        window.directorExitAction_?.(event);
      } else if (event.shiftKey && event.key.toLowerCase() === 'r') {
        event.preventDefault();
        window.directorRefreshAction_?.(event);
      } else if (event.shiftKey && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        window.directorCustomizeAction_?.(event);
      }
    }, true);
  }

  function installAppModeObserver() {
    const director = byId('directorModeView');
    if (!director || !('MutationObserver' in window)) return;
    new MutationObserver(() => {
      if (!director.classList.contains('hidden')) {
        window.requestAnimationFrame(() => {
          installWidgetHelpToggles();
          installMapFullscreen();
        });
      } else {
        directorExitArmedUntil = 0;
        byId('directorExitButton')?.classList.remove('is-armed');
        byId('directorBackToTop')?.classList.remove('is-visible');
        byId('directorToolbarHint')?.classList.remove('is-visible');
        const mapWidget = byId('widget-map');
        mapWidget?.classList.remove('map-is-fullscreen');
        const mapButton = mapWidget?.querySelector('.map-fullscreen-button');
        if (mapButton) {
          mapButton.textContent = '⛶';
          mapButton.setAttribute('aria-pressed', 'false');
          mapButton.setAttribute('aria-label', 'Open GPS map full screen');
        }
      }
    }).observe(director, { attributes: true, attributeFilter: ['class'] });
  }

  function init() {
    document.documentElement.dataset.uxVersion = VERSION;
    installStableDirectorToolbar();
    installDirectorNavigation();
    installWidgetHelpToggles();
    installMapFullscreen();
    installMinimalModeEnhancements();
    installSafetyToolbar();
    installSafetyScrollHint();
    installDirectorKeyboardShortcuts();
    installAppModeObserver();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
