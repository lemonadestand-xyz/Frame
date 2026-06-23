# Plan — Frame escalation adapters

## Architecture

### Adapter protocol — `src/main/adapters/types.js`

```js
class EscalationAdapter {
  static channel = '';
  async present(escalation) { throw new Error('abstract'); }
  async awaitResponse(escalationId) { throw new Error('abstract'); }
}

// Escalation:
// { id, slug, taskId, category, draftedQuestion, draftAnswer,
//   options, role, createdAt, answeredAt?, answer?, answeredBy? }
```

### Adapter registry — `src/main/adapters/registry.js`

```js
function buildAdapters(profile) {
  const reg = { ui: new UIAdapter() };  // always present
  const esc = profile?.escalation || {};
  if (esc.slack?.webhook_url) reg.slack = new SlackAdapter(esc.slack);
  if (esc.email?.draft_target) reg.email = new EmailAdapter(esc.email);
  return reg;
}

function routeAdapter(adapters, escalation, profile) {
  // Look up role.channel from profile.roles where role.name === escalation.role
  // Fall back to 'ui' if channel adapter is missing.
  return adapters[role?.channel || 'ui'] || adapters.ui;
}
```

### `UIAdapter` (v1) — `src/main/adapters/uiAdapter.js`

- Writes escalation to `.frame/specs/<slug>/escalations/<id>.json`
- Emits IPC `SUPERVISOR_ESCALATION_OPEN` with the escalation payload
- `awaitResponse` returns a Promise resolved by the matching `SUPERVISOR_ESCALATION_ANSWERED` IPC event
- Persisted answer moves the JSON to `escalations/answered/<id>.json`

### Renderer modal — `src/renderer/escalationModal.js`

- Listens on `SUPERVISOR_ESCALATION_OPEN`
- Renders a non-blocking modal floating over the spec section:
  - Drafted question (bold)
  - Suggested answer + reasoning + confidence chip
  - Options as buttons (if `options[]` is non-empty)
  - Free-text answer textarea
  - Actions: *Accept suggestion* / *Submit answer* / *Skip*
- Submit fires `SUPERVISOR_ESCALATION_ANSWERED` with `{id, answer}`

### `SlackAdapter` (v2, opt-in) — `src/main/adapters/slackAdapter.js`

- Posts Block Kit message via the configured webhook URL
- Each `options[]` becomes a button with `value=<option>`
- Frame spins up a tiny embedded HTTP server (localhost only) at a configurable port (`escalation.slack.callback_port`, default 7333) to receive button-click callbacks
- The server resolves the matching `awaitResponse` Promise
- v2 — implemented but documented as opt-in; if webhook fails, log + fall back to UI

### `EmailAdapter` (v2, opt-in) — `src/main/adapters/emailAdapter.js`

- Stub in v1 — drafts a Gmail message via the existing MCP if available, else writes to `.frame/runtime/email-drafts/<id>.eml` for the user to send manually
- Response detection deferred to v3 (would need IMAP polling)

### Role routing

The profile's `roles[]` (from child B) declares each role's
`channel`. `routeAdapter` looks up the escalation's `role` field,
finds the matching role's channel, returns the adapter for that
channel (or falls back to UI). When the matched channel adapter
isn't enabled, render a banner: "Routing fell back to UI: <role>'s
<channel> adapter not configured."

### Proactivity

- `wait` (default) — must answer; UI modal stays open
- `auto` — auto-accept the `draftAnswer` after dispatch; supervisor proceeds with the answer logged
- `notify` (v2) — surface and proceed after N seconds if no response

### Audit

Each adapter writes one `escalation_presented` event and one
`escalation_answered` event into the existing `supervisor-audit.jsonl`
(from child A). Schema:

```json
{"ts":"...","event":"escalation_presented","escalationId":"...","channel":"ui","role":"chris","category":"dependency"}
{"ts":"...","event":"escalation_answered","escalationId":"...","answer":"...","answeredBy":"chris"}
```

---

## Files

**New**
- `src/main/adapters/types.js`
- `src/main/adapters/registry.js`
- `src/main/adapters/uiAdapter.js`
- `src/main/adapters/slackAdapter.js` *(v2-stubbed, implementation behind feature flag)*
- `src/main/adapters/emailAdapter.js` *(v2-stubbed)*
- `src/renderer/escalationModal.js`
- `src/renderer/styles/components/escalation.css`
- `src/__tests__/uiAdapter.test.js`
- `src/__tests__/adapterRegistry.test.js`
- `.frame/specs/frame-escalation-adapters/outcome.md`

**Modified**
- `src/shared/ipcChannels.js` — add `SUPERVISOR_ESCALATION_OPEN` / `SUPERVISOR_ESCALATION_ANSWERED`
- `src/main/index.js` — register adapters on project open; load from profile
- `src/main/supervisorLoop.js` — call `routeAdapter(...).present(...)` on ESCALATE; await response
- `src/renderer/index.js` — mount escalation modal globally
- `STRUCTURE.json`, `AGENTS.md`

---

## Footprint

- src/main/adapters/types.js
- src/main/adapters/registry.js
- src/main/adapters/uiAdapter.js
- src/main/adapters/slackAdapter.js
- src/main/adapters/emailAdapter.js
- src/renderer/escalationModal.js
- src/renderer/styles/components/escalation.css
- src/__tests__/uiAdapter.test.js
- src/__tests__/adapterRegistry.test.js
- src/shared/ipcChannels.js
- src/main/index.js
- src/main/supervisorLoop.js
- src/renderer/index.js

---

## Dependencies

- Child A (`frame-supervisor-loop`) — supervisor calls `routeAdapter(...).present(...)` on ESCALATE.
- Child B (`frame-project-profiles-and-memory`) — adapter routing reads `profile.roles[].channel`.

No new external deps in v1. v2 SlackAdapter uses Node's stdlib `http` for the callback server.

---

## Sequencing

1. **Protocol + registry.** `types.js` + `registry.js` with `buildAdapters` returning `{ui}` only. No concrete adapters yet.
2. **UIAdapter.** Implement file write + IPC emit + answer-await Promise. Unit-test: presenting an escalation writes the file and the await resolves on the matching answered event.
3. **Escalation IPC channels.** `SUPERVISOR_ESCALATION_OPEN` / `SUPERVISOR_ESCALATION_ANSWERED` registered in `index.js`.
4. **Renderer modal.** `escalationModal.js` mounted at startup; listens on `SUPERVISOR_ESCALATION_OPEN`; submits via `SUPERVISOR_ESCALATION_ANSWERED`. CSS for modal styling.
5. **Role routing.** `routeAdapter` looks up the role's channel from the profile, falls back to UI when missing.
6. **Supervisor wiring.** `supervisorLoop.js` calls `routeAdapter(...).present(escalation)` on ESCALATE, awaits the response, persists the answer back into `spec.md` / `plan.md` (per spec.md "Answered (date): ..." block).
7. **SlackAdapter (v2 opt-in).** Block Kit message + callback server. Behind a feature flag in profile.
8. **EmailAdapter (v2 stub).** Draft writer; response detection deferred.
9. **End-to-end test.** Test a full ESCALATE → modal → answer round-trip with a mocked supervisor loop.
10. **Docs + outcome.** AGENTS.md "Escalation" section; append outcome.md.
