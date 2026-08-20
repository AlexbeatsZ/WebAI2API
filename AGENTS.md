# Goal

Deliver WebAI2API v4 as a product-grade, OpenAI-compatible browser automation gateway with canonical site/model IDs, isolated browser profiles, atomic page-slot concurrency, AI Studio Chat Playground support, and a dark operations console.

# Current State

- Repository: `AlexbeatsZ/WebAI2API`, branch `codex/webai2api-v4`, based on upstream `beac6c9`.
- Production remains on `foxhui/webai-2api:latest` revision `84729fb` until the v4 migration and smoke tests pass.
- v4 intentionally rejects legacy `backend.pool.instances/workers` configuration after the migration tool has produced `version: 4` configuration.
- Persistent browser profile directories must never be deleted or shared by two browser processes.
- The v4 runtime, canonical API, AI Studio/Gemini drivers, migration command, profile-scoped VNC, operations console, Docker/CI files, and automated tests are implemented locally.
- Automated tests pass and the built console has been exercised at 1440x900 and 390x844. The local Docker daemon cannot currently reach Debian package mirrors; CI and the production host remain the image-build gates.

# Active Work

- Push the implementation so GitHub Actions can verify and publish the v4 image.
- Back up the production Compose directory and all persistent browser data with hashes.
- Run migration dry-run, add the planned Gemini and AI Studio page counts, then deploy the immutable image digest.
- Complete live Gemini, AI Studio, ChatGPT, four-way concurrency, per-profile VNC, restart-isolation, desktop, and narrow-screen acceptance.

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

# Durable Lessons

- Busy counters are observations, not locks. A page must be synchronously reserved before any asynchronous work starts.
- A browser profile owns one user-data directory, proxy, fingerprint, process, and display. Page slots may share that process but never a page.
- Website output categories must not alter conversation parsing. The complete ordered message history is compiled before driver dispatch.
- Reasoning text is not proof that a web mode was selected; selector actions and page state must be observable in diagnostics.
