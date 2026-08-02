# Race Bib Logger v19.3.4

## Quick BIB Entry

- Adds a compact LOG button beside the BIB backspace control whenever ABC/native-keyboard mode is active.
- Submits on pointer-down, allowing users to log without first dismissing the phone keyboard.
- Keeps the inline and bottom LOG buttons synchronized for disabled and logging states.
- Preserves the existing compact duplicate review inside Quick Entry.

## Director GPS map

- Replaces the Google Maps key-dependent implementation with a built-in OpenStreetMap viewer.
- Requires no API key, Map ID, deployment property, or race-day user input.
- Supports drag/pan, pinch zoom, wheel zoom, +/− controls, fit-all, marker popups, and full-screen presentation.
- Displays configured checkpoints, current PWA/device positions, and up to 30 recent trail points per device.
- Merges DeviceHealth coordinates with geotagged BIB logs so quiet checkpoints can still appear.
- Retains markers and trails over a fallback grid when internet map tiles are unavailable.

## Deployment and compatibility

- App version and service-worker caches are advanced to v19.3.4.
- No Racelog schema migration is required.
- Older backend `mapConfig` fields remain harmlessly compatible but are no longer used for credentials.
