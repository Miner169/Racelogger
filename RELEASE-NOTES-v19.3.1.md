# Race Bib Logger v19.3.1

## Focus

v19.3.1 is a focused mobile UI correction release. It keeps the v19.3.0 data model, race calculations, server endpoints, Google Maps integration, duplicate handling, reconciliation, and safety logic.

## Runner Safety Log

- Replaced the multi-row mobile header with one compact command bar.
- Shortened the visible heading to **Safety Log** while preserving the full accessible name.
- Converted synchronization status, full sync, new incident, and exit into four fixed-size icon controls.
- Added a temporary status hint for icon actions instead of permanently consuming vertical space.
- Reduced outer padding and roster-status padding so the runner table and filters begin much sooner.
- Preserved the auto-fitted frozen BIB column and horizontal-scroll hint.

## Director Mode

- Removed the non-working Categories, Standings, At a glance, and other section-navigation chips.
- Removed their IntersectionObserver and `scrollIntoView()` behavior, which was the cause of Director Mode repeatedly moving back toward the top.
- Retained one compact floating up-arrow on the right side after the user scrolls down.
- Replaced oversized emoji toolbar symbols with consistent stroke icons for Exit, Customize, and Refresh.
- Reduced and normalized the synchronization-status glyph.
- Kept the five-second toolbar label hint without changing button widths.

## Setup

- Constrained **Edit Setup / Lock Setup** to the same control height as the readiness and checkpoint summary elements.
- Prevented wrapping and oversized text under the application's large-text modes.
- Kept long checkpoint summaries truncated rather than forcing the button into a tall column.

## Architecture and caching

- Added `app/ux-v1931.css` so the presentation-first HTML remains below the static line-count guard.
- Replaced `app/ux-v193.js` with `app/ux-v1931.js`.
- Bumped service-worker caches to `race-logger-static-v19-3-1-r1` and `race-logger-runtime-v19-3-1-r1`.
- Added static assertions that the broken Director navigation and vertical `scrollIntoView()` behavior do not return.

## Migration

No spreadsheet migration is required.
