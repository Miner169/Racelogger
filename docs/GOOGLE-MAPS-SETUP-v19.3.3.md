# Centrally managed Google Maps setup — v19.3.3

The Director map does not request a key from race-day users. `Code.gs` reads deployment-level Apps Script properties and sends the map configuration with normal configuration and Director summary responses.

## One-time deployment configuration

In the bound Apps Script project, open **Project Settings → Script Properties** and add:

- `GOOGLE_MAPS_BROWSER_API_KEY` — required for the interactive Google map
- `GOOGLE_MAPS_MAP_ID` — optional

The browser key should be restricted in Google Cloud to:

- the deployed PWA/site origin; and
- the Maps JavaScript API.

Do not put the key in `index.html`, `localStorage`, Settings UI, source-control secrets, or screenshots. A browser Maps key is delivered to the browser by design, so origin/API restrictions are the security boundary.

When no deployment key is present, Director Mode shows a configuration status instead of asking a checkpoint operator to enter credentials.
