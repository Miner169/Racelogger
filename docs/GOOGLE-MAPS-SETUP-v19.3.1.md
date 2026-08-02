# Google Maps setup — v19.3.1

The Director GPS widget uses the Google Maps JavaScript API. The release does not contain an API key.

## Recommended setup

1. Select or create a Google Cloud project.
2. Enable **Maps JavaScript API**.
3. Create a browser API key.
4. Add an application restriction for the exact PWA hostname/referrer.
5. Add an API restriction allowing only **Maps JavaScript API**.
6. In Apps Script, open **Project Settings → Script Properties** and add:
   - `GOOGLE_MAPS_BROWSER_API_KEY`
   - optional: `GOOGLE_MAPS_MAP_ID`
7. Deploy a new Apps Script Web App version.
8. Open the PWA, run the cloud connection test, and then press **Test Google Maps**.

## Per-device override

PWA Settings also accepts a browser key and optional Map ID. A local value overrides the server-provided value. This can be useful for staging, but server-managed configuration is easier to maintain across many race devices.

## Security

- Use a browser key, not a server-secret key.
- Restrict the key to the exact production hostname/referrer.
- Restrict it to Maps JavaScript API.
- Use separate keys for production and testing.
- Review billing and quota alerts before race day.

## Failure behaviour

A missing, invalid, blocked, or offline map does not block BIB logging. The Director widget shows an actionable error while the rest of the PWA remains operational.
