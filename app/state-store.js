/* Tiny observable store used by v19 operational surfaces. */
(function (global) {
  'use strict';

  function createStore(initialState) {
    let state = Object.freeze(Object.assign({}, initialState || {}));
    const listeners = new Set();
    return Object.freeze({
      getState: function () { return state; },
      setState: function (patch) {
        const nextPatch = typeof patch === 'function' ? patch(state) : patch;
        state = Object.freeze(Object.assign({}, state, nextPatch || {}));
        listeners.forEach(function (listener) {
          try { listener(state); } catch (error) { console.error('RaceState listener failed', error); }
        });
        return state;
      },
      subscribe: function (listener) {
        if (typeof listener !== 'function') return function () {};
        listeners.add(listener);
        return function () { listeners.delete(listener); };
      }
    });
  }

  global.RaceState = createStore({
    queueSummary: { logs: 0, incidents: 0, safetyNotes: 0, acknowledgements: 0, checkpointStatuses: 0, total: 0 },
    serverReconciliation: null,
    clockBlocked: false,
    recovery: null,
    lastError: null
  });
})(window);
