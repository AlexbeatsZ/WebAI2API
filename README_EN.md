# WebAI2API

[简体中文](README.md) | English

WebAI2API operates signed-in AI websites through isolated browser profiles and exposes an OpenAI-compatible chat API.

Each browser profile owns one login directory, fingerprint, proxy, process, virtual display, and VNC session. A profile can host multiple sites and multiple page slots per site. Every slot processes one request at a time; adding profiles provides account, proxy, and failure isolation.

## Docker

```bash
docker compose up -d
```

The default Compose file uses `ghcr.io/alexbeatsz/webai2api:4.0.0`, publishes the console and API on port 3000, and persists everything under `./data`.

## Configuration

```yaml
version: 4
runtime:
  scheduling: least_loaded
  queueBuffer: 2
  requestTimeoutMs: 120000

browserProfiles:
  - id: google-main
    name: Google
    userDataDir: camoufoxUserData_Google
    proxy:
      enabled: false
    sites:
      - id: gemini-web
        pages: 2
      - id: ai-studio
        pages: 2
```

No two profiles may share a `userDataDir`. Use the console's Live browser page to sign in and resolve verification prompts.

v3 `instances`/`workers` configurations require an explicit migration:

```bash
npm run migrate-config -- --input data/config.yaml --output data/config.v4.yaml --dry-run
npm run migrate-config -- --input data/config.yaml --output data/config.v4.yaml --write
```

The command never overwrites its output or moves browser data.

## API

Fetch canonical model IDs from `GET /v1/models`. Requests must provide an exact site-qualified ID such as `gemini-web/gemini-3.1-pro` or `ai-studio/gemini-3.1-pro`.

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"model":"ai-studio/gemini-3.1-pro","messages":[{"role":"user","content":"Hello"}],"stream":true}'
```

The complete role order and conversation history are preserved. AI Studio receives system messages through System Instructions. Image inputs use OpenAI `image_url` content blocks with Base64 Data URLs.

## Development

```bash
pnpm install
pnpm --dir webui install
npm run init
npm test
pnpm --dir webui build
npm start
```

Leaving `server.auth` empty disables authentication for both the API and console. Only do this on a trusted network.

## License

[MIT](LICENSE)
