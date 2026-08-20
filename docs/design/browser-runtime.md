# Browser runtime

## Ownership

`BrowserProfile` is the lifecycle boundary. It owns one Camoufox persistent context, one unique user-data directory, one proxy/fingerprint configuration, one `DisplaySession`, and all page slots configured under it. Duplicate normalized user-data paths are rejected before launch.

On Linux, each visible profile starts its own Xvfb and x11vnc pair. Camoufox receives that display through `virtual_display`. The HTTP server exposes VNC through a profile-addressed WebSocket, so no VNC port is published on the host.

## Page slots

Each site entry expands to `pages` PageSlot objects. A slot owns one Playwright Page and uses this state machine:

`idle -> reserved -> running -> idle`

Failures transition through `recovering`; three consecutive request failures trigger page recovery, and a failed recovery moves the slot to `offline`. Reservation is a synchronous compare-and-set operation. Only the holder of the reservation token may run or release a slot.

## Scheduling

The runtime filters by canonical site/model support and health, orders idle slots by last-used time, and atomically reserves the first available slot. When compatible slots are busy, requests wait on a runtime notification until `requestTimeoutMs`. Retryable failures use a different compatible slot when available. A profile restart only rebuilds that profile and its slots.

## Diagnostics

Profile, display, site, slot, task, failure count, and last error are exposed through the admin runtime snapshot. Prompt bodies, cookies, credentials, and page storage are never included.

`GET /health` exposes only readiness, config version, uptime, safe-mode state, and aggregate capacity. `GET /admin/diagnostics` is the authenticated maintenance snapshot. A site check atomically reserves one page in an exact profile/site pair and observes its sanitized URL, title, and model-cache state without generating content. A real probe also targets one exact profile/site pair and never fails over to another profile, so proxy and account acceptance results stay attributable.
