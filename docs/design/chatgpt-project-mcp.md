# ChatGPT Project MCP Conversation

Last updated: 2026-09-13.

## Purpose

The `chatgpt_text` adapter can run in a fixed ChatGPT Project as the browser/model side of AI Decision. In this mode it is a Conversation Module, not a second Brain and not a delivery adapter.

The OpenAI-compatible caller supplies the current OpenClaw user turn. WebAI2API extracts the stable `message_id` only from OpenClaw's marked `Conversation info: ⟦openclaw:ctx⟧` block, adds a `[source-message:<id>]` recovery marker, selects the configured MCP app in the composer, and submits only the current user turn. The Project calls `begin_user_decision`, reads the authoritative Context, and calls `commit_decision`. The exact user reply belongs only in `commit_decision.user_message`.

The assistant page must finish with `NO_REPLY`. WebAI2API returns that text to OpenClaw so automatic source delivery is suppressed. The optional DOM/SSE result and observed `BrainRun ... accepted` tool output are recovery evidence only; they are never parsed as a QQ payload.

## Active Chat state

State lives in `data/chatgpt-project-state.json`, keyed by browser profile. It records the active Project conversation URL, logical day, run count, pending source marker, last source ID, final assistant observation, and whether MCP acceptance was visible. Writes use a same-directory temporary file and rename.

Before pressing Enter, the adapter persists the source marker. A repeated source ID first opens the known Active Chat and reconciles the marker and following assistant response. A visible pending marker is not blindly resubmitted. If the marker is absent after the recovery grace period, resubmission is permitted; core source dedupe and Effect-ID idempotency remain the authoritative duplicate barriers.

Project mode deliberately supports one ChatGPT page per browser profile. More pages would race on one Active Chat and are rejected by configuration validation.

## Rollover modes

- `run_count`: reuse the Active Chat until `maxRunsPerChat`, then start from the Project page.
- `fixed_time`: roll lazily on the first request after the configured logical-day boundary.
- `manual`: reuse indefinitely until the authenticated admin roll endpoint is called.

Manual control uses `POST /admin/runtime/profiles/:profile/chatgpt/conversation/roll`; state is available at the corresponding `GET .../conversation` endpoint.

## UI stability

ChatGPT may inject a workspace member-limit banner after navigation. The adapter looks it up semantically and closes it before composer interaction. If the banner has no usable close control, it hides only that banner in the current page DOM. This prevents late layout shifts from moving click targets without mutating account or workspace settings.

## Required Project instructions

The Project must require the Brain to:

1. read the trusted OpenClaw `Conversation info.message_id` and current wording;
2. call `begin_user_decision(source_message_id, message, source="qq:self")`;
3. read or resume the returned BrainRun as needed;
4. call `commit_decision` once, placing the exact optional user-visible text in `proposal.user_message`;
5. return exactly `NO_REPLY` after acceptance and never echo tool arguments, control JSON, or delivery text.

If MCP is unavailable before acceptance, it must not invent a reply. The browser result is not authoritative delivery.
