# Race Bib Logger v19.2.0 — Command-Centre Operations

## Purpose

v19.2.0 expands Director Mode from monitoring into an offline-capable command workflow. It adds forecasts, capacity and logistics boards, runner-safety ownership, route anomaly visibility, shift handover, and post-race reporting while retaining the v19.0.0 Racelog A:AC schema.

## Implemented

### Arrival and checkpoint demand

- **Arrival Surge Forecast** estimates expected runner volume at each checkpoint over the next **10, 20, and 30 minutes**.
- Forecast rows include estimated scans per minute, trend, and confidence.
- The server model compares recent traffic with the preceding period; a local fallback is used when a server summary is unavailable.
- **Checkpoint Load Heatmap** displays rolling scans by checkpoint across 60, 120, or 240 minutes.
- Heatmap cells scale relative to the busiest cell, and the checkpoint column remains visible while scrolling.

### Runner safety and route integrity

- **COT Risk Funnel** groups runners into Safe, Approaching, Critical, Overdue, Acknowledged, and Resolved.
- Acknowledged COT alerts can be resolved from Director Mode with resolver, time, and a required resolution note.
- **Missing Runner Workflow** supports owner assignment, contact-attempt count, search-action count, sighting notes, status, and resolution.
- **Route Anomaly Diagram** highlights inferred skipped checkpoints, reverse progress, travel speeds above the configured operational sanity threshold, and approved route exceptions.
- **Incident Ownership and Timers** show owner, time to acknowledgement, active duration, destination, and resolution workflow.
- **DNS / DNF / Withdrawal / Medical** totals are based on explicit Safety Log statuses; DNS/DNF are not inferred from absence.

### Finish and resource planning

- **Finish Projection** groups by full KM and category label, showing seen runners, finished runners, near-term projected finishes, and estimated finish windows when pace data is available.
- **Medical Capacity Board** tracks teams/resources, vehicle or call sign, active cases, capacity, destination, availability, owner, and notes.
- **Sweep & Transport Tracking** tracks resources, pickup requests, capacity, passengers, destination/route, status, owner, and notes.
- **Checkpoint Supply Status** tracks water, food, ice, lighting, radios, medical stock, status, and resupply request/ETA.

### Weather and device awareness

- **Weather Risk Panel** supports a manual `WeatherRisk` sheet or an optional authorized HTTPS JSON provider configured through `WEATHER_PROVIDER_URL`.
- Configurable thresholds cover heat, wind, rain intensity, and nearest lightning distance.
- The panel distinguishes normal, warning, critical, stale/unavailable, and provider alert information; the event emergency plan remains authoritative.
- The **enhanced device map layer** adds battery, charging state, connectivity/effective network type, pending queue, oldest queue age, GPS age/accuracy, and last synchronization beside each PWA.

### Command continuity and reporting

- **Shift Handover Summary** consolidates active incidents, missing runners, quiet/stale devices, pending queues, upcoming COT alerts, and supply attention. It can be regenerated, copied, or downloaded.
- **Post-Race Command Report** exports HTML and JSON containing:
  - complete chronological command timeline;
  - checkpoint performance;
  - incidents and resolution timings;
  - COT outcomes;
  - safety notes;
  - command operations;
  - device health and GPS data;
  - weather state;
  - integrity and reconciliation snapshots.

### Offline and synchronization behavior

- Command records save locally first and remain editable without connectivity.
- Pending CommandOps records synchronize in an operational batch when online.
- Server-returned records merge without overwriting newer unsynchronized local edits.
- CommandOps are tied to the event epoch. A stale event epoch is rejected by the server, preventing previous-event operational records from being reintroduced after a reset.

## Data and sheet compatibility

- **Racelog remains A:AC. No Racelog migration is required.**
- v19.2.0 adds the `CommandOps` and `WeatherRisk` auxiliary sheets.
- Existing auxiliary sheets are extended:
  - `Incidents` adds acknowledgement, resolution, call/search, sighting, and destination fields.
  - `DeviceHealth` adds connectivity and latest GPS-health fields.
  - `COTAlerts` adds resolved state, resolver, resolution timestamp, and resolution note.
- Existing rows are retained when headers are extended.

## Architecture

- New command workflows are isolated in `app/director-ops-v192.js`.
- `app/main.js` retains the established runtime and exposes the required compatibility bridge.
- New widgets participate in Director customization, ordering, width controls, resizing, empty-state handling, and service-worker caching.
- Typed JSDoc contracts and centralized constants were extended for command operations and weather risk.

## Validation completed

- JavaScript syntax checks passed for the front-end modules and service worker.
- `Code.gs` passed a Node syntax parse after being copied to a temporary `.js` file.
- Deployment asset validation passed.
- Integrity, SHA-256 parity, FNV fallback parity, and static integration tests passed.

## Field validation still required

Automated local checks do not prove native installed iOS/Android PWA behavior, live Apps Script/Google Sheets concurrency, real GPS accuracy, authorized weather-provider behavior, poor-network recovery, browser accessibility, or multi-device race load. Complete `docs/DEVICE-TEST-MATRIX-v19.2.0.md` before race-day deployment.
