# Interactive Director map — v19.3.5

Director Mode uses a locally packaged slippy-map renderer with OpenStreetMap raster tiles. It requires no Google Cloud project, API key, Map ID or user-entered credential.

## What is plotted

- Configured `CheckpointGPS` coordinates as checkpoint/station markers.
- When a checkpoint has no configured coordinate, its position is inferred from the median coordinates of GPS-tagged records logged at that checkpoint.
- Latest PWA coordinates from geotagged BIB logs.
- Newer DeviceHealth coordinates when a device reports location while no runner is being logged.
- Up to the latest 30 reported points per PWA as a movement trail.
- Marker popups with checkpoint, volunteer, GPS age, accuracy, battery, queue, online status and last-sync age when available.

## Controls

- Drag with one finger or mouse to pan.
- Pinch, mouse wheel or +/− controls to zoom.
- Press ◎ to fit every checkpoint and PWA marker.
- Tap a checkpoint or PWA marker for details.
- Use the Director widget full-screen control for a larger map.

## Connectivity

The JavaScript renderer is packaged locally. OpenStreetMap base tiles require connectivity. When tiles cannot load, the coordinate surface, markers, trails, popups and zoom/pan controls remain present with a tile-status message.

The app requests only visible viewport tiles and does not implement prefetching, area downloads or offline tile scraping.
