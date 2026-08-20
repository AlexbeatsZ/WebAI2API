# Proxy routing

## Production boundary

Browser profiles are the proxy isolation boundary. A proxy belongs to one profile and is passed only to that profile's Camoufox process. WebAI2API must not change the host system proxy, Docker daemon proxy, container-wide proxy environment, or another service's routing.

## Server policy

- The normal server route is `host.docker.internal:7897`.
- Port `17897` is an expensive route pinned to the Los Angeles exit `lax2-vless-wangda-base` and is not a default route.
- Initial startup and acceptance use `7897`.
- Only evidence of repeated Google login interruption, TLS/EOF failures, or failed avatar/authentication resource loading justifies testing `17897`.
- If the expensive route is needed, use it only on an isolated Google browser profile containing Gemini and AI Studio. ChatGPT profiles and all unrelated traffic remain on their existing route.
- Record the before/after probe result. Revert the profile to `7897` when the special route is no longer needed.

Per-site proxy overrides are intentionally unsupported because pages in one persistent browser context share network state. Split a browser profile when sites need different routes.
