# Physical-device test matrix — v19.3.3

| Area | Recent iPhone PWA | Older iPhone | Android PWA | Tablet | Desktop |
|---|---|---|---|---|---|
| Large 123 Quick keypad fits without overlap | Required | Required | Required | Required | Required |
| ABC opens native keyboard; 123 returns to keypad | Required | Required | Required | Required | Required |
| BIB spaces rejected with red feedback | Required | Required | Required | Required | Required |
| Duplicate dialog remains fully visible in Quick Entry | Required | Required | Required | Required | Required |
| Last 4 repeat colours match main screen | Required | Required | Required | Required | Required |
| OCR/keyboard controls hidden until BIB focus | Required | Required | Required | Required | Required |
| Scan History header remains compact | Required | Required | Required | Required | Required |
| Director header remains slim and scroll stays stable | Required | Required | Required | Required | Required |
| Google map pan/pinch/wheel zoom | Required | Recommended | Required | Required | Required |
| Offline logging and reconnect synchronization | Required | Required | Required | Required | Required |
| Service-worker update from v19.3.1/v19.3.2 | Required | Required | Required | Required | Required |

Also test reduced motion, large text, landscape orientation, poor connectivity, low-memory Android, GPS denied, GPS stale, and multiple devices synchronizing concurrently.
