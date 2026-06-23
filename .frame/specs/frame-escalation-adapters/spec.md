# Frame escalation adapters — UI, Slack, Email

> **What we're building:** First-class escalation surface in Frame: the supervisor loop emits `{slug, taskId, category, draftedQuestion, draftAnswer, options}`, and the active adapter renders it as a modal in the UI (v1), optionally fans out to Slack and Email per profile config (v2). Mirrors the supervisor's `adapters/` directory (`MobileApiAdapter` / `SlackAdapter` / `EmailAdapter`). Child E of `frame-parity-with-supervisor`; depends on A (`frame-supervisor-loop`).

---

## Background

Supervisor reference:
- **`ConsoleAdapter`** at `supervisor/adapters/__init__.py:40-67` — working today; prints role-formatted escalation and auto-approves drafted answer when unattended.
- **`MobileApiAdapter`** at `supervisor/adapters/mobile_api.py:24-44` — stubbed; PR-4 will implement FastAPI endpoints. Parks escalations in dict, futures resolve on response.
- **`SlackAdapter`** at `supervisor/adapters/slack.py:18-32` — stubbed; PR-4 will reuse checkmate-automation Block Kit patterns; Button clicks resolve futures.
- **`EmailAdapter`** at `supervisor/adapters/email.py:16-29` — stubbed; PR-4 will create Gmail drafts for async judgment.
- **Used in run loop** at `supervisor/loop.py:159-177` — `adapter.present()` enqueues; `adapter.await_response()` blocks the task until human responds; resume continues from same tick.

Frame today has the autopilot pause states (`pausedReason`) but no first-class escalation primitive — pauses are diagnostics, not interactive surfaces.

---

## Problem

1. **No drafted-question surface.** When the supervisor loop returns ESCALATE with a drafted question + suggested answer, there's nowhere to render it. Today the loop would just pause with `pausedReason: 'escalate'` and the user has to read audit logs to know what's blocking.
2. **No fan-out.** Even when Frame is closed, the user might want a Slack ping for high-priority escalations. No mechanism today.
3. **No role routing.** The supervisor's `policy.roles` declares who has authority over which categories. Frame's escalation surface should route to the right role's channel — UI for `chris`, Slack for `team`, email for async.

---

## Goal

### 1. Adapter protocol

```js
// src/main/adapters/types.js
class EscalationAdapter {
  static channel = '';
  async present(escalation) {
    // store the escalation, surface it through this channel
  }
  async awaitResponse(escalationId) {
    // resolve when user responds
  }
}

// Escalation shape:
// {
//   id, slug, taskId, category,
//   draftedQuestion: string,
//   draftAnswer: string,
//   options: string[],         // multi-choice answers, if applicable
//   role: string,              // which role to route to
//   createdAt: ISO string,
//   answeredAt?: ISO string,
//   answer?: string,
//   answeredBy?: string,
// }
```

### 2. `UIAdapter` (v1, MUST ship)

`src/main/adapters/uiAdapter.js`:
- Stores escalation in `.frame/specs/<slug>/escalations/<id>.json`
- Fires IPC event `SUPERVISOR_ESCALATION_OPEN`
- Renderer listens, surfaces a modal on the spec card (`src/renderer/specSection.js` extension):
  - Bold drafted question
  - Suggested answer + reasoning + confidence
  - Multi-choice buttons (if `options[]` present)
  - Free-text answer field
  - "Submit" / "Skip" / "Accept suggestion" actions
- On submit: writes `answer` + `answeredAt` to the JSON, emits `SUPERVISOR_ESCALATION_ANSWERED`, moves the file to `escalations/answered/<id>.json`

### 3. `SlackAdapter` (v2, opt-in via profile)

`src/main/adapters/slackAdapter.js`:
- Enabled when profile sets `escalation.slack.webhook_url` (or similar)
- Posts a Block Kit message with the drafted question + buttons for each `option`
- Click → Slack hits a Frame-hosted webhook endpoint that resolves the await
- Frame ships a tiny embedded HTTP server for the callback (port configurable, defaults to localhost-only)
- v2 follow-up because it requires Slack app setup; v1 leaves the adapter stubbed

### 4. `EmailAdapter` (v2, opt-in via profile)

`src/main/adapters/emailAdapter.js`:
- Enabled when profile sets `escalation.email.draft_target` (e.g. Gmail account)
- Creates a Gmail draft (via existing MCP integration if available, else manual) with the drafted question
- User responds by editing the draft + sending → reply lands in Frame via IMAP polling OR via MCP search
- v2 follow-up

### 5. Role routing

The profile's `roles[]` declares each role's `channel` (`ui` | `slack` | `email`) and which `authority` categories they own. When the supervisor escalates, the adapter routing logic looks up which role owns the category and dispatches through that role's channel. v1: only `ui` channel routes are active; other channels silently fall back to `ui` with a banner.

### 6. Auto-accept on "notify" proactivity

The profile's `roles[].proactivity` can be `auto` (auto-accept the drafted answer, log only), `notify` (surface but proceed after N seconds), or `wait` (must answer). v1 supports `wait` (default) and `auto`. `notify` is a v2 enhancement.

---

## Non-goals

- **No new auth.** Frame's adapters trust the user; no per-channel permissions.
- **No retry/replay machinery for failed deliveries.** If Slack is unreachable, log + fall back to UI adapter.
- **No threading / multi-message conversations.** Each escalation is one question / one answer.
- **No HTML-rich rendering in v1.** UI adapter uses Frame's existing modal styling; Slack uses Block Kit; Email uses plain text.
- **No bot-driven multi-turn negotiation.** v1 is one-shot.

---

## Constraints

- **All adapters implement the same protocol** so the supervisor loop is adapter-agnostic.
- **At least one adapter (UI) is always available** — if the profile is missing or specifies an unavailable channel, fall back to UI with a banner.
- **Escalation files are append-only.** Once answered, the JSON moves to `answered/` and is never modified. Re-asking creates a new id.
- **No long-lived sockets for Slack callback.** Frame opens an HTTP server only when the SlackAdapter is enabled; it shuts down when disabled.
- **Email adapter is opt-in via profile** and stays inert until `email` block is present.

---

## Open questions

1. **Escalation modal: blocking or non-blocking?** *Working stance:* non-blocking — the modal floats; user can keep working in other panels.
2. **What if multiple escalations land at once?** *Working stance:* queue them in the Escalations sub-tab of the cross-project view (child D). Click an Escalations chip in the spec section to see all open ones for that spec.
3. **Where do answered escalations live long-term?** *Working stance:* in `escalations/answered/` per spec. The supervisor classifier (child A) can read this on future ticks to inform "we already settled this."
4. **Slack auth — bot token or webhook?** *Working stance:* webhook for v2; bot token is a follow-up.
5. **Default `proactivity` if not set in profile?** *Working stance:* `wait` (safest — never auto-answer unless explicitly allowed).

---

## Success criteria

1. The supervisor loop's ESCALATE verdict surfaces a modal in Frame within 1s.
2. User can accept the drafted suggestion, pick an option, or write a free-text answer — all three paths resolve the loop's await.
3. Answered escalations move to `escalations/answered/` and the supervisor classifier can read them on next tick.
4. Multiple in-flight escalations queue without blocking each other.
5. If profile specifies a Slack channel for a role and the SlackAdapter is enabled, the same escalation arrives in Slack with response buttons (v2).
6. With no profile or no role authority match, the adapter falls back to UI with a clear banner.
