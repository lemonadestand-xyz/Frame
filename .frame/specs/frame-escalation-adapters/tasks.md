# Tasks — Frame escalation adapters

- T01 · Create `src/main/adapters/types.js` with the abstract `EscalationAdapter` base + the `Escalation` shape JSDoc
- T02 · Create `src/main/adapters/registry.js` exposing `buildAdapters(profile)` (always returns at least `{ui}`) and `routeAdapter(adapters, escalation, profile)`
- T03 · Implement `src/main/adapters/uiAdapter.js` — file write to `.frame/specs/<slug>/escalations/<id>.json`, IPC `SUPERVISOR_ESCALATION_OPEN`, `awaitResponse` Promise resolved by `SUPERVISOR_ESCALATION_ANSWERED`, archive move to `answered/`
- T04 · Add `SUPERVISOR_ESCALATION_OPEN` / `SUPERVISOR_ESCALATION_ANSWERED` IPC channels to `src/shared/ipcChannels.js`; register handlers in `src/main/index.js`
- T05 · Add `src/renderer/escalationModal.js` (non-blocking floating modal with question + suggested-answer chip + options buttons + free-text answer + accept/submit/skip actions); CSS in `src/renderer/styles/components/escalation.css`
- T06 · Add `src/__tests__/uiAdapter.test.js` + `src/__tests__/adapterRegistry.test.js` exercising registry build, role-based routing with profile, fall-back to UI when channel missing
- T07 · Wire supervisor → adapter dispatch in `src/main/supervisorLoop.js` on ESCALATE; persist answer back into `spec.md` / `plan.md` as an "Answered (date): ..." block (mirrors child A spec §7 working stance)
- T08 · Stub `src/main/adapters/slackAdapter.js` (v2 opt-in) — Block Kit message via webhook + localhost callback server (`escalation.slack.callback_port`); falls back to UI on webhook failure
- T09 · Stub `src/main/adapters/emailAdapter.js` (v2) — drafts an `.eml` file in `.frame/runtime/email-drafts/` for manual send; response detection deferred to v3
- T10 · Update `STRUCTURE.json`, add an "Escalation" section to `AGENTS.md`, append `outcome.md` per Frame convention
