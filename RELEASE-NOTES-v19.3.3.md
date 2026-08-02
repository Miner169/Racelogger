# Race Bib Logger v19.3.3

## Entry workflow

- Quick BIB Entry always presents the large numeric keypad. The ABC control now opens the device's native keyboard instead of replacing the keypad with a small on-screen alphabet or symbol layout.
- Spaces are rejected from BIB values in normal entry, Quick Entry, pasted content, and physical-keyboard input. A local red feedback message appears for 2.3 seconds.
- Duplicate-passage confirmation is compact, appears above Quick Entry, and no longer asks for a structured duplicate reason. The stored audit code remains `DUPLICATE_CONFIRMED`.
- Quick Entry's Last 4 cards now use the same repeat-frequency colour tokens as the main screen.
- OCR and keyboard-mode controls in normal BIB entry remain hidden until the BIB field or one of those controls has focus.

## Layout refinements

- Scan History Current CP / Global controls and the fixed 20-row limit indicator are slimmer.
- The Setup event-distance summary strip is removed.
- Edit Setup / Lock Setup is vertically aligned with its adjacent readiness and checkpoint summary controls.
- Race Command View uses a lower-profile title and icon rail to preserve vertical space.

## Director Mode

- Shift Handover and Post-Race Command Report widgets and exports are removed.
- Google Maps credentials are no longer accepted from checkpoint-user settings. The client receives the browser key and optional Map ID from the Apps Script deployment configuration.
- The interactive map retains pan, zoom, map-type, checkpoint, PWA, and recent-trail support when the deployment key is configured.

## Compatibility

- No Racelog spreadsheet migration is required.
- Existing record, checksum, synchronization, GPS, safety, reconciliation, COT, and route-exception formats are unchanged.
