# v19.3.1 implementation status

## Complete

- Compact single-row Runner Safety Log toolbar.
- Icon-only safety status, sync, incident, and exit actions with accessible labels.
- Compact roster loading/error state.
- Director section-chip navigation removed.
- Director vertical auto-scroll regression removed.
- Single right-side back-to-top button retained.
- Director toolbar emoji replaced with normalized vector icons.
- Director sync-status glyph reduced.
- Setup action aligned to the summary/readiness control height.
- UI overrides extracted to `app/ux-v1931.css`.
- Service-worker and deployment asset validation updated.
- Unit, checksum-parity, FNV-parity, asset, JavaScript syntax, and static integration tests passing.

## Unchanged

- Racelog A:AC schema.
- Google Apps Script action contracts.
- Offline record formats and checksums.
- Duplicate, unknown-BIB, route-exception, reconciliation, and clock-drift logic.
- Google Maps API-key requirements.

## Physical validation still required

- Installed iPhone PWA with normal and enlarged system text.
- Android PWA with gesture navigation and low memory.
- Director scrolling during live refreshes and long-duration operation.
- Safety full-event synchronization on a production-sized roster.
- Real Google Maps pan, pinch zoom, markers, and trails.
