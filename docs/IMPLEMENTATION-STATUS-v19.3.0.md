# v19.3.0 implementation status

## Completed in this release

- Added a dedicated `app/ux-v193.js` enhancement layer without changing record formats or server actions.
- Rebuilt the mobile Director toolbar as four stable, equal-width icon controls.
- Moved five-second command labels into a floating overlay to eliminate toolbar layout shift.
- Preserved two-tap Exit confirmation and added Director keyboard shortcuts.
- Added visible-section navigation, active-section tracking, and Back to Top.
- Added compact widget help toggles and full-screen Google GPS map presentation.
- Added explicit BIB/Remark target indication to minimalist entry.
- Added Screen Wake Lock support and non-blocking status reporting.
- Added optional haptic feedback to minimalist controls.
- Rebalanced the 390 × 844 Quick Entry layout so keypad and actions do not overlap.
- Added compact BIB/checkpoint success confirmation instead of the large centered overlay.
- Added Safety Log horizontal-swipe guidance while retaining the measured frozen BIB width.
- Added focus-visible styling, reduced-motion support, safe-area handling, and mobile bottom-sheet dialogs.
- Rotated service-worker caches and extended deployment/static validation for the new UI module.

## Preserved from v19.2.1

- Silent unknown-BIB logging and reconciliation flags
- Detailed duplicate review
- Route-sequence exception reasons
- Offline queue, checksums, retry/backoff, and reconciliation
- COT alerts, arrival forecast, heatmap, route anomalies, finish projection, outcome totals, checkpoint health, handover, and reporting
- Interactive Google Maps renderer, checkpoint/PWA markers, trails, zoom, pan, Street View, and map-type controls
- Auto-fitted frozen Safety Log BIB column
- A:AC Racelog schema and existing auxiliary sheets

## Not changed

- Google Sheet schema
- Apps Script endpoint contracts
- Checksum algorithms
- Runner-category calculations
- GPS validation rules
- Duplicate and location-spam lifecycle rules

## Pending physical acceptance

- Installed PWA on recent and older iPhones
- Installed PWA on recent and low-memory Android devices
- Screen Wake Lock behavior across foreground/background transitions
- Haptic feedback settings and device support
- Real GPS markers and trails with production Google Maps credentials
- Live Apps Script current/legacy response testing
- Large text, reduced motion, landscape, and tablet layouts
- Poor-network, offline recovery, and multi-device soak testing
