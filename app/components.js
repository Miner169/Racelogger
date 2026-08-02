/* Reusable rendering helpers for new operational UI. */
(function (global) {
  'use strict';

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function statusBadge(label, tone) {
    const safeTone = ['good', 'warn', 'bad', 'neutral'].includes(tone) ? tone : 'neutral';
    return '<span class="v19-status-badge v19-status-' + safeTone + '">' + escapeHtml(label) + '</span>';
  }

  function emptyState(title, detail) {
    return '<div class="v19-empty-state"><strong>' + escapeHtml(title) + '</strong><span>' + escapeHtml(detail || '') + '</span></div>';
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value == null ? '' : String(value);
    return el;
  }

  function setHtml(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html || '';
    return el;
  }

  function show(id, visible) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', visible === false);
    return el;
  }

  global.RaceComponents = Object.freeze({
    escapeHtml: escapeHtml,
    statusBadge: statusBadge,
    emptyState: emptyState,
    setText: setText,
    setHtml: setHtml,
    show: show
  });
})(window);
