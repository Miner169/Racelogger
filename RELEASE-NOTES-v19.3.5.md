# Race Bib Logger v19.3.5

## Fixed in this release

### Quick BIB Entry on iPhone/iPad

- Pressing **ABC** now focuses the hidden native BIB input synchronously, so the phone keyboard opens from the same tap instead of requiring a second tap on the BIB field.
- The inline **LOG** button now handles iOS `touchstart`, mouse/pointer fallback, keyboard activation, and duplicate synthetic events safely.
- Before submission, the visible native value is committed back to the main BIB field.
- One LOG tap closes the keyboard programmatically, starts the normal duplicate/GPS/logging flow, and reopens the native keyboard afterward when Quick Entry is still active.
- The existing duplicate, route, GPS, IndexedDB, sync, audit, and error-handling paths remain the single source of truth.

### Runner Safety Log

- Roster sizes up to 600 runners now render normally instead of using table spacer rows.
- This removes the large Safari/iOS blank band above the first runner.
- Larger events retain virtual rendering, but zero-height spacer rows are omitted and explicitly exempted from text-scale row heights.
- Horizontal scrolling no longer repeatedly rebuilds a normal-size roster.

### Director Mode header

- **RACE COMMAND VIEW** is shown in full on a 390 px-wide screen.
- Toolbar controls remain in the same compact row using smaller, consistent touch targets.
- The header remains slimmer than the earlier two-row mobile layout.

### API-key-free GPS map

- Director Mode uses the packaged OpenStreetMap slippy-map renderer and never requests a Google Maps browser key.
- PWA markers, trails, pan, pinch, wheel/button zoom, fit-all and popups remain available.
- When `CheckpointGPS` is not configured, checkpoint positions are inferred from the median GPS coordinates recorded at each named checkpoint.
- Old Google Maps placeholder text has been removed from the active UI/runtime.

### PWA update reliability

- The service worker cache has moved to `v19-3-5-r1`.
- JavaScript, CSS, manifest and service-worker URLs are versioned to bypass the old cache-first runtime entries.
- Same-origin application scripts/styles now use the shell's network-first update path.
- The service worker registers with `updateViaCache: "none"` and requests an update.

## Data compatibility

- No Racelog column migration is required.
- No record schema, UID, checksum, duplicate, GPS or synchronization contract was changed.
