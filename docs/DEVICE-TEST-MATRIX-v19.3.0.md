# Physical Device Test Matrix — v19.3.0

Record device model, OS/browser version, build, date, tester, pass/fail, screenshots, and defect ID for every row.

## Platforms

| Platform | Required coverage |
|---|---|
| Recent iPhone | Current iOS Safari and installed PWA |
| Older supported iPhone | Safari and installed PWA under memory pressure |
| Recent Android | Chrome and installed PWA |
| Low-memory Android | Chrome/PWA with background eviction testing |
| Tablet | Portrait and landscape Director Mode |
| Desktop command station | Chrome/Edge/Safari as applicable, large display and keyboard |

## Quick Entry and synchronization

- Enter configured and unconfigured BIBs; unconfigured BIBs must log without a prompt and appear in Reconciliation.
- Trigger a duplicate and verify previous checkpoint, device, volunteer, elapsed time, Log anyway, and Cancel.
- Trigger a route exception and verify a reason remains mandatory.
- Queue BIBs offline; header shows only pending BIB count, not incident/safety/acknowledgement totals.
- Reconnect through high latency, packet loss, intermittent Wi-Fi, and captive-portal conditions.
- Test against the new v19.3.0 Apps Script deployment.
- In staging only, test against the previous successful response shape without checksum fields; confirm no false permanent Sync Issue.
- Return an explicit bad checksum acknowledgement; confirm the batch remains queued and the mismatch is surfaced.
- Confirm server reconciliation count after recovery.

## Runner Safety Log

- Sort BIB ascending and descending.
- Sort Last Seen newest-first and oldest-first.
- Scroll horizontally and confirm the BIB column remains frozen.
- Test 1–3 digit BIBs, 4–6 digit BIBs, and long alphanumeric BIBs.
- Confirm the frozen column stays compact and expands only as needed.
- Test route/collision badges in the frozen column.
- Test large text and browser zoom at 200%.

## Director Mode

- Confirm these widgets are absent: incident timeline, incident board, missing runner, medical capacity, sweep/transport, weather risk, checkpoint supplies.
- Confirm Arrival Forecast, heatmap, COT funnel, route anomalies, finish projection, outcomes, checkpoint health, handover, post-race report, and GPS map remain available.
- Hide/show, reorder, resize, and reload retained widgets; confirm preferences persist.
- Verify Arrival Forecast 10/20/30 labels and controlled traffic estimates.
- Verify heatmap 60/120/240 windows, horizontal scrolling, sticky checkpoint column, and empty state.
- Acknowledge and resolve COT alerts; reload and verify resolver/time/note.
- Verify route skip, reverse, impossible-speed, and approved-exception examples.
- Mark DNS, DNF, withdrawal, and medical statuses and verify totals.
- Verify KM/category finish grouping and behavior when pace data is absent.
- Generate/copy/download shift handover.
- Export post-race HTML and JSON and open both files on another device.

## Google Maps and GPS

- Configure the restricted production browser key through Apps Script properties.
- Test a local per-device key override, then remove it and confirm server-key fallback.
- GPS allowed, denied, approximate, temporarily unavailable, and stale.
- Verify Google street tiles render; no grid-only fallback remains.
- Drag/pan with one finger or mouse.
- Pinch and mouse-wheel zoom.
- Test map-type, Street View, fullscreen, scale, and zoom controls.
- Verify checkpoint markers, PWA markers, detail popups, marker age states, and recent trails.
- Verify battery/charging, connection, queue, GPS age/accuracy, and last sync under the map.
- Test invalid key, blocked referrer, API-disabled, quota error, and offline behavior.
- Confirm map failure never blocks BIB entry or synchronization.
- Test 1, 10, 30, and 100 reporting devices.

## Accessibility and usability

- Large text / browser zoom at 200%.
- Reduced motion.
- VoiceOver and TalkBack labels for controls and status changes.
- Keyboard navigation and visible focus.
- Wet/gloved touch use where relevant.
- High-glare and dark environments.
- Colour-independent status comprehension.

## Load and soak

- Two-hour multi-device soak with continuous BIB scans, COT alerts, device health, and Director refresh.
- At least 10 simultaneous logging devices and two Director devices in a test environment.
- Monitor Apps Script execution failures, lock contention, Sheets write rate, memory growth, battery drain, queue growth, Google Maps quota, and report generation time.

Do not approve race-day deployment until all mandatory rows pass or have a documented operational workaround accepted by the race director and safety lead.

## v19.3.0 UI/UX acceptance additions

| Area | Scenario | Expected result |
|---|---|---|
| Quick Entry | 390 × 844 portrait | Full numeric keypad, Clear, LOG, and status fit with no overlap. |
| Quick Entry | Switch BIB ↔ Remark | Active target pill updates immediately; phone keyboard stays closed. |
| Quick Entry | Screen remains open | Wake Lock status updates accurately; failure never blocks entry. |
| Quick Entry | Rapid 30-BIB sequence | Haptics remain brief, taps are not dropped, and success confirmation never covers keys. |
| Main Entry | Focus BIB field | OCR/keyboard tools appear without shifting the entered BIB unexpectedly. |
| Success feedback | Log numeric and long alphanumeric BIBs | Compact toast shows the correct BIB and checkpoint and clears quickly. |
| Director phone | 390–430 px width | Exit, sync, customize, and refresh all remain visible with no horizontal page scroll. |
| Director command labels | Tap each toolbar icon | Floating label is readable for about five seconds; button widths remain unchanged. |
| Director navigation | Scroll and tap section chips | Active chip follows viewport and tap scrolls to the chosen visible section. |
| Director map | Enter/exit full screen | Map remains draggable/zoomable and returns to its widget without a blank canvas. |
| Director keyboard | Shift+R, Shift+C, Escape | Refresh, Customize, and guarded Exit work when focus is not in a form control. |
| Safety Log | Short and long BIBs | Frozen BIB column remains narrow for short labels and expands only as needed. |
| Safety Log | Horizontal swipe | BIB stays pinned and one-time swipe hint disappears after use. |
| Accessibility | Keyboard navigation | Every actionable control has a visible focus ring. |
| Accessibility | Reduced Motion | New transitions and smooth scrolling are suppressed. |
| Mobile dialogs | Duplicate/recovery/customize | Dialog appears as a reachable bottom sheet and respects the bottom safe area. |
