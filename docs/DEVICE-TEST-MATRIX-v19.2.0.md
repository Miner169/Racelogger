# Physical Device Test Matrix — v19.2.0

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

## Core command workflows

- Open Director Mode online, offline, and after a cold restart.
- Confirm all v19.2 widgets appear in Customize.
- Hide/show, reorder, change width, resize height, and reload; confirm preferences persist.
- Verify Arrival Forecast 10/20/30 labels and controlled traffic estimates.
- Verify heatmap 60/120/240 windows, horizontal scrolling, sticky checkpoint column, and empty state.
- Acknowledge and resolve COT alerts; reload and verify resolver/time/note.
- Create a missing-runner case offline; add calls/searches/sighting; reconnect and verify one synchronized record.
- Create/acknowledge/resolve incidents and verify timers, owner, destination, and resolution.
- Verify route skip, reverse, impossible-speed, and approved-exception examples.
- Mark DNS, DNF, withdrawn, and medical statuses and verify totals.
- Verify KM/category finish grouping and behavior when pace data is absent.
- Create/update medical, transport, and supply records offline and online.
- Generate/copy/download shift handover.
- Export post-race HTML and JSON and open both files on another device.

## GPS and device health

- GPS allowed, denied, approximate, temporarily unavailable, and stale.
- Verify latest PWA marker, checkpoint marker, and recent trail.
- Verify battery/charging, online/effective type, queue, oldest queue age, GPS age/accuracy, last sync.
- Confirm no third-party map-tile requests occur.
- Confirm map/table remain usable with 1, 10, 30, and 100 reporting devices.

## Weather

- Manual normal values.
- Heat warning, wind warning, rain warning, lightning critical threshold.
- Provider alert text.
- Stale observation.
- Empty sheet, malformed provider JSON, HTTP error, timeout, and recovery to manual values.
- Confirm event emergency instructions remain visible/available offline.

## Network and synchronization

- Fully offline, 2G/3G simulation, high latency, packet loss, intermittent Wi-Fi, captive portal.
- Batch multiple CommandOps records and reconnect.
- Edit the same record from two devices and verify newer unsynchronized local edits are not silently overwritten.
- Start a test new event and confirm old CommandOps are rejected/cleared rather than reintroduced.
- Verify exact queue summary and server reconciliation after recovery.

## Accessibility and usability

- Large text / browser zoom at 200%.
- Reduced motion.
- Screen reader labels for buttons and status changes.
- Keyboard navigation and visible focus.
- Touch targets with wet/gloved use where relevant.
- High glare and dark environments.
- Colour-independent status comprehension.

## Load and soak

- Two-hour multi-device soak with continuous scans, alerts, device health, and Director refresh.
- At least 10 simultaneous logging devices and two Director devices in a test environment.
- Monitor Apps Script execution failures, lock contention, Sheets write rate, memory growth, battery drain, queue growth, and report generation time.

Do not approve race-day deployment until all mandatory rows pass or have a documented operational workaround accepted by the race director and safety lead.
