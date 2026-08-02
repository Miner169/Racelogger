# Interactive Director map — v19.3.4

Director Mode now uses a built-in slippy-map renderer with OpenStreetMap raster tiles. It requires no Google Cloud project, API key, Map ID, or user-entered credential.

## What is plotted

- Configured CheckpointGPS coordinates as checkpoint/station markers.
- Latest PWA coordinates from geotagged BIB logs.
- Newer DeviceHealth coordinates when a device reports location while no runner is being logged.
- Up to the latest 30 reported points per PWA as a movement trail.
- Marker popups with checkpoint, volunteer, GPS age, accuracy, battery, queue, online status, and last-sync age when available.

## Controls

- Drag with one finger or mouse to pan.
- Pinch, mouse wheel, or +/− controls to zoom.
- Press ◎ to fit every checkpoint and PWA marker.
- Tap a checkpoint or PWA marker for details.
- Use the existing Director widget full-screen control for a larger map.

## Connectivity

The JavaScript map renderer is packaged locally and remains available offline. The OpenStreetMap base-map tiles require an internet connection. When tiles cannot load, the app keeps showing a coordinate grid, markers, trails, controls, and an unobtrusive tile-status message.

The app requests only tiles required for the current viewport and does not prefetch or offer offline tile downloads.
