# Goal

Deliver WebAI2API v4 as a product-grade, OpenAI-compatible browser automation gateway with canonical site/model IDs, isolated browser profiles, atomic page-slot concurrency, AI Studio Chat Playground support, and a dark operations console.

# Current State

- Repository: `AlexbeatsZ/WebAI2API`, branch `codex/webai2api-v4`, based on upstream `beac6c9`.
- Production uses a CI-built, immutable v4 GHCR digest from `codex/webai2api-v4` with strict v4 configuration; Compose never uses a floating tag. Verify the active digest with `docker inspect webai-2api`. The pre-v4 rollback image is `sha256:c8b3ee330c7627d95a740f51f8119a9f16b3bcc93eb189a44bfbf6dbb6a74d20`; the verified full backup is `C:\Users\Meta\Project\Scripts\Docker\web2api-backups\pre-v4-20260821-030648` on the server.
- v4 intentionally rejects legacy `backend.pool.instances/workers` configuration after the migration tool has produced `version: 4` configuration.
- Persistent browser profile directories must never be deleted or shared by two browser processes.
- The v4 runtime, canonical API, AI Studio/Gemini drivers, migration command, profile-scoped VNC, operations console, Docker/CI files, and automated tests are implemented and pushed.
- Stable maintenance surfaces include public sanitized readiness, authenticated diagnostics, exact profile/site checks and probes, model refresh, profile restart, and profile-scoped VNC.
- Twenty-one automated tests pass, CI publishes immutable images, and the deployed console has been exercised at desktop and 390x844. Closed mobile navigation is removed from the focus order and returns focus to its trigger. The local Docker daemon cannot currently reach Debian package mirrors, so CI and the production host remain the image-build gates.
- Current live acceptance findings: ChatGPT's exact probe, OpenAI-compatible non-streaming response, and SSE response return the expected text. Restarting the Google profile while ChatGPT generates leaves ChatGPT successful and returns with all six slots healthy and idle. On port 7897 Gemini and AI Studio explicitly return `region_unavailable`; AI Studio classifies the redirect in about six seconds. Port 17897 is not active in the server's current mihomo process and must not be selected until it is reachable from the container.

# Active Work

- Keep production on port 7897 until the isolated 17897 listener is active and container-reachable.
- After explicit approval to change the server's Clash Verge user network configuration, activate the dedicated 17897 listener, remove the redundant `chatgpt-web` page from `meta`, and route only `gemini-web` and `ai-studio` in that profile through 17897. ChatGPT, Docker, the host, and the global proxy remain on 7897.
- Complete live Gemini and AI Studio text/image plus two-by-two four-way concurrency acceptance on the dedicated route.

# Build / Run / Test

- Install: `pnpm install --frozen-lockfile` and `pnpm --dir webui install --frozen-lockfile`.
- Unit tests: `pnpm test`.
- UI build: `pnpm --dir webui build`.
- Production build: `docker build -t webai2api:v4 .`.
- Migrate config: `pnpm migrate-config -- --input data/config.yaml --output data/config.v4.yaml --dry-run`.

# Design Index

- `docs/design/browser-runtime.md`: profile, display, slot lifecycle, scheduling, and recovery invariants.
- `docs/design/site-drivers.md`: canonical model IDs, driver contract, message compilation, and discovery.
- `docs/design/operations-console.md`: information architecture, visual tokens, copy, responsive behavior, and auth state.
- `docs/design/proxy-routing.md`: profile-scoped routing and the narrow fallback policy for the expensive Google route.

# Durable Lessons

- Busy counters are observations, not locks. A page must be synchronously reserved before any asynchronous work starts.
- A browser profile owns one user-data directory, proxy, fingerprint, process, and display. Page slots may share that process but never a page.
- Website output categories must not alter conversation parsing. The complete ordered message history is compiled before driver dispatch.
- Reasoning text is not proof that a web mode was selected; selector actions and page state must be observable in diagnostics.
- A successful webpage response does not prove a legacy network observer still matches. Response extraction must tolerate endpoint changes and use a stable, new-assistant DOM result as a bounded fallback.
- Delayed close events from a replaced browser context must be ignored by the new context. Recovery callbacks require identity checks, not only a mutable `closing` flag.
