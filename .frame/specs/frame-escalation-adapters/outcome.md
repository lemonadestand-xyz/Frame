# Outcome — Frame escalation adapters

## T01 — Adapter protocol

Shipped `src/main/adapters/types.js` with the abstract `EscalationAdapter` base (`present` / `awaitResponse` both throw `abstract` when not overridden) and the `Escalation` JSDoc shape. Mirrors `supervisor/adapters/__init__.py:40-67`.

_Captured: 2026-06-22 · 1 file change_

---

## T02 — Adapter registry

Shipped `src/main/adapters/registry.js`. `buildAdapters(profile, hooks)` always returns at least `{ui}`. `routeAdapter(adapters, escalation, profile)` resolves the role's channel from `profile.roles[].channel` and falls back to UI when the channel adapter is missing.

_Captured: 2026-06-22 · 1 file change_

---

## T03 — UIAdapter

Shipped `src/main/adapters/uiAdapter.js`. Writes escalation JSON to `.frame/specs/<slug>/escalations/<id>.json`, fires `SUPERVISOR_ESCALATION_OPEN` via injected `emit` callback (decoupled from Electron's ipcMain for testability), resolves the `present` promise when the matching answered event fires via the injected `onAnswered` registration. On answer, moves the file to `escalations/answered/<id>.json` and includes `answer` + `answeredBy` + `answeredAt`.

_Captured: 2026-06-22 · 1 file change_

---

## T06 — Tests

`src/__tests__/uiAdapter.test.js`. 2/2 passing: full present → emit → store-on-disk → handler-fires → resolve → file-moved-to-answered round-trip, and rejection on missing required fields.

_Captured: 2026-06-22 · 1 file change_

---

## Pending (UI session)

- **T04 — IPC channels** in `src/shared/ipcChannels.js` for `SUPERVISOR_ESCALATION_OPEN` / `SUPERVISOR_ESCALATION_ANSWERED`. The UIAdapter is already decoupled — it takes `emit` and `onAnswered` hooks — so wiring them to the real ipcMain in `main/index.js` is the only step.
- **T05 — Escalation modal renderer** (`src/renderer/escalationModal.js` + CSS).
- **T07 — Supervisor wiring** to call `routeAdapter(...).present(...)` on ESCALATE. The supervisor loop already calls `executors.presentEscalation` (see `supervisorLoop.js` ESCALATE branch); we just need to bind that executor to the UIAdapter via the registry.
- **T08/T09 — Slack/Email stubs** (v2 opt-in).
- **T10 — AGENTS.md "Escalation" section**.

The headless adapter is complete; the renderer modal + IPC bridge is the remaining work to make it visible to the user.

_Captured: 2026-06-22 · status note_

---

## T08 — Slack adapter (opt-in stub)

Shipped `src/main/adapters/slackAdapter.js`. Opt-in via `profile.escalation.slack.webhook_url`. POSTs a Block Kit message (header + drafted question + suggested-answer section + per-option action buttons + context footer pointing at the callback) to the configured webhook. Spins up a localhost-only callback server on `escalation.slack.callback_port` (default 7333) via Node stdlib `http`. Failure modes — missing webhook URL, no fetch implementation, server bind error, webhook non-2xx — all delegate to the injected `fallback` UIAdapter so the supervisor loop never stalls.

Wired into `adapters/registry.js`'s `buildAdapters`: registers only when `profile.escalation.slack.webhook_url` is set, and passes `reg.ui` as the fallback. `src/__tests__/slackAdapter.test.js` covers Block Kit shape, HTML escaping, the three fallback paths (missing URL / POST 500 / server bind EADDRINUSE), the success callback resolving on `_testAnswer`, and the HTTP callback handler accepting POST `{decisionId, reply}` and rejecting non-POST with 405. 9/9 tests passing.

`src/__tests__/adapterRegistry.test.js` (new) exercises opt-in registration semantics: UI always; Slack only with `webhook_url`; Email only with `to`; fallback adapter is the UI adapter.

_Captured: 2026-06-22 · 3 file changes (slackAdapter.js, registry.js delta, slackAdapter.test.js, adapterRegistry.test.js)_

---

## T09 — Email adapter (opt-in stub)

Shipped `src/main/adapters/emailAdapter.js`. Opt-in via `profile.escalation.email.to`. Writes one RFC 5322-compliant `.eml` file per escalation under `<projectPath>/.frame/runtime/email-drafts/<id>.eml`. Headers include `From / To / Subject (RFC 2047 wrapped if non-ASCII) / Date / Message-ID / MIME-Version` plus `X-Frame-*` extension headers carrying slug / category / escalation id. Body has the drafted question, the suggested answer (when present), options list, spec + task metadata, and a "Reply and re-import via Frame" footer. Message-IDs use `crypto.randomBytes` so each escalation gets a unique RFC-conformant id.

Response detection is deferred to v3 (would need IMAP polling). The `present` promise stays open until something external calls `_testAnswer(id, reply)` — the supervisor loop can be re-prompted via the existing UIAdapter answered IPC for now. Disk failures delegate to the fallback UIAdapter. `src/__tests__/emailAdapter.test.js` covers header shape, uniqueness of `Message-ID` across escalations, RFC-2047 wrapping of non-ASCII subjects, the on-disk write, and both fallback paths (missing `to`, missing `projectPath`). 6/6 tests passing.

_Captured: 2026-06-22 · 2 file changes (emailAdapter.js, emailAdapter.test.js + registry.js delta)_

---

## T10 — AGENTS.md Escalation section

Added an "Escalation" section to `AGENTS.md` covering: the `EscalationAdapter` contract from `src/main/adapters/types.js` + the `Escalation` JSDoc shape, the registry's `buildAdapters` opt-in semantics and `routeAdapter` channel fallback, the three built-in adapters (UI always-on, Slack via `profile.escalation.slack.webhook_url`, Email via `profile.escalation.email.to`) with their on-disk artefacts and fallback paths, the end-to-end escalation modal flow (loop → executor → UIAdapter → IPC → renderer modal → answered → resolve), and an "Adding a new adapter" recipe. Documents the always-fall-back-to-UI rule for Slack and Email so the supervisor loop never stalls on missing external dependencies.

_Captured: 2026-06-22 · 1 file change (AGENTS.md) + STRUCTURE.json refresh_
