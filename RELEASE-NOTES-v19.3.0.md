# Race Bib Logger v19.3.0

## UI and UX refinement release

v19.3.0 keeps the v19.2.1 data model, synchronization contracts, Google Maps integration, duplicate review, route validation, reconciliation, and runner-safety logic. This release concentrates on race-day clarity, touch accuracy, reduced layout shift, and small-screen reliability.

## Quick BIB Entry

- Added an explicit **Entering BIB / Entering Remark** indicator above the entry field.
- Added Screen Wake Lock support where the browser permits it, with a non-blocking status label.
- Retuned the 390 × 844 layout so the full keypad, Clear, LOG, and status line fit without overlap.
- Enlarged numeric touch targets while keeping the BIB preview compact.
- Added short haptic feedback to keypad, tab, backspace, Clear, and LOG interactions when vibration is enabled.
- Improved pressed states, spacing, shadows, safe-area handling, and focus visibility.
- The action row remains in normal flow on compact phones, avoiding keypad obstruction.

## Main logging screen

- Preserved the BIB field as the primary surface and gave LOG a stable, large target.
- Prevented the BIB field from shifting when OCR and keyboard controls become visible.
- Improved focus rings and touch feedback.
- Replaced the large centered success overlay with a compact, non-blocking confirmation showing the logged BIB and checkpoint.
- Reduced success-confirmation duration to keep high-volume entry moving.

## Race Command View

- Reworked the command bar into fixed-size, equal-width controls on phones.
- Button labels now appear in a floating five-second hint instead of expanding the toolbar and pushing controls off-screen.
- Retained the two-tap Exit safeguard.
- Added a horizontally scrollable section navigator for Categories, Standings, Map, COT, forecasts, device health, and other visible widgets.
- Added automatic active-section highlighting while scrolling.
- Added a floating Back to Top control after substantial scrolling.
- Added per-widget information toggles on compact screens to reduce vertical clutter.
- Added a full-screen mode for the interactive Google GPS map.
- Added keyboard shortcuts in Director Mode: **Shift+R** refresh, **Shift+C** customize, and **Escape** arm/confirm exit.
- Improved card elevation, header hierarchy, responsive spacing, and safe-area behavior.

## Runner Safety Log

- Retained the auto-fitted frozen BIB column.
- Added a one-time swipe hint explaining that the BIB remains pinned during horizontal scrolling.
- Improved row scanning with subtle alternating backgrounds and clearer hover/focus states.

## Accessibility and motion

- Added consistent high-visibility `:focus-visible` rings.
- Preserved 44 px minimum touch targets where component-specific sizing does not override them.
- Added reduced-motion handling for the new animations and scrolling effects.
- Converted key mobile dialogs to bottom sheets for better reachability and keyboard avoidance.

## Technical changes

- Added `app/ux-v193.js` as an isolated enhancement layer.
- Added the new module to the service-worker app shell.
- Rotated caches to `race-logger-static-v19-3-0-r1` and `race-logger-runtime-v19-3-0-r1`.
- Updated deployment validation and static integration checks.
- No Racelog or auxiliary-sheet migration is required.

## Validation performed

- Deployment asset validation
- JavaScript syntax checks
- Integrity, checksum-parity, and FNV fallback tests
- Static integration tests
- Isolated headless-browser UX smoke test for the Director toolbar, section navigation, help toggles, map full-screen mode, and error-free initialization
- 390 × 844 Quick Entry viewport fit check
- 430 × 932 Director mobile layout preview

Physical installed-PWA testing on iPhone, Android, tablet, real GPS, live Apps Script, production Google Maps credentials, and weak-network conditions remains required before race-day deployment.
