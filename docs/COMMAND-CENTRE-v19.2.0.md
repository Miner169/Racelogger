# Command Centre Guide — v19.2.0

## Recommended widget order during a live event

1. At a Glance / Operations Monitor
2. COT Risk Funnel
3. Incident Board
4. Missing Runner Workflow
5. GPS Recording Map and enhanced device layer
6. Arrival Forecast
7. Checkpoint Load Heatmap
8. Route Anomaly Diagram
9. Medical Capacity
10. Sweep & Transport
11. Checkpoint Supplies
12. Weather Risk
13. Finish Projection
14. Outcomes
15. Shift Handover
16. Post-Race Report

Use **Customize** to hide low-priority widgets and save role-specific layouts on each command device.

## Forecast interpretation

- **10 minutes** is the immediate staffing horizon.
- **20 minutes** supports replenishment and queue preparation.
- **30 minutes** supports transport, medical positioning, and shift planning.
- Trend and confidence should be read together. A rising forecast with low confidence is a prompt to observe, not proof of a surge.

## Safety workflow

- Acknowledge an alert or incident only when a named person assumes responsibility.
- Keep the item open while action is in progress.
- Record calls, searches, sightings, destination, and owner as they occur.
- Resolve only after entering a meaningful outcome or handover note.
- Approved route exceptions should use a structured exception reason so they remain visible but are not treated as unexplained anomalies.

## Resource boards

- Keep each medical or transport resource as a separate record.
- Use a stable call sign/name so handovers do not create duplicate resources.
- Update capacity and active cases/passengers after every dispatch.
- Use checkpoint supply statuses consistently: Good, Watch, Low, Critical, Resupply requested, Resupply en route.

## Weather panel

- Manual values are read from `WeatherRisk` row 2.
- An approved provider can be configured using `WEATHER_PROVIDER_URL` in Apps Script Properties.
- Test the endpoint before event day and retain a manual fallback.
- The panel does not replace the official event emergency plan, lightning protocol, or local authority warnings.

## Handover and reporting

Generate a handover before every shift change and whenever command ownership moves. Confirm that active incidents, missing runners, quiet devices, queues, COT alerts, and supply issues match the verbal handover.

Generate the post-race report only after final synchronization and reconciliation. Archive both HTML and JSON: HTML is human-readable; JSON preserves structured data for later analysis.
