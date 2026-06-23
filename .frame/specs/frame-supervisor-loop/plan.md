# Plan — Frame supervisor loop

## Architecture

### Per-spec loop — `src/main/supervisorLoop.js`

One instance per Auto'd spec; keyed in a process-local `Map<slug, SupervisorLoop>`.
Each tick (driven by `setImmediate` after the previous turn's lane-idle):

1. **Snapshot** — read `status.json`, `tasks.json` rows (via `specManager.collectSpecTasks`), recent `supervisor-audit.jsonl` lines, lane state from `agentDispatch.getSpecLaneInfo`.
2. **Hard-policy fast path** — see below.
3. **LLM-judged classifier** — `classifyNextStep(...)`; returns `{route, action, reasoning, confidence, draftedQuestion?}`.
4. **Dispatch** — translate verdict to concrete action.
5. **Wait for lane-idle + watch debounce** — same primitives as `autopilot.js`.
6. **Loop.**

### Hard-policy fast path — `src/main/supervisorPolicy.js`

Mirrors `supervisor/classifier/policy.py:29-64`. Order:

1. **Stop conditions** — phase==='done', user pressed Pause, footprint conflict with another in-flight spec → `WAIT` (footprint) or `DONE`/`PAUSED`.
2. **Lane required** — no lane attached → `WAIT` with banner "attach a Frame to enable".
3. **Explicit cost ceiling** — profile.policy.cost_ceiling_usd reached (advisory until cost telemetry lands).
4. **Phase-specific gates:**
   - `phase==='specified'` + spec.md has `## Open Questions` block with unanswered entries → `ESCALATE` with question.
   - `phase==='planned'` + plan.md missing `## Footprint` → `ESCALATE`.
   - `phase==='tasks_generated'` or `implementing` + undone count > 0 + lane attached → `IMPLEMENT`.
   - `phase==='tasks_generated'` or `implementing` + undone count === 0 → `CRITIC` (or skip to ADVANCE if critic disabled).
   - `phase==='specified'` + no open questions → `ADVANCE` to plan.
   - `phase==='planned'` + footprint present → `ADVANCE` to tasks.
5. **Else** → fall through to LLM classifier.

### LLM classifier — `src/main/supervisorClassifier.js`

```js
async classifyNextStep({spec, status, tasks, lane, audit, profile, evidence}) {
  // Build a compact prompt from the spec.md head, current phase,
  // last 5 audit entries, and any evidence the capability registry
  // accumulated this tick.
  const prompt = buildClassifierPrompt({...});
  // Invoke Haiku via `claude -p --output-format json --max-turns 1`.
  const raw = await runClaudeJson(prompt, {model: 'claude-haiku-4-5'});
  // Parse → {route, action, reasoning, confidence, draftedQuestion}
  // If parse fails or confidence < THRESHOLD (0.65), demote to ESCALATE.
  return parsed;
}
```

Routes: `'advance' | 'implement' | 'research' | 'escalate' | 'critic' | 'done'`.
`'research'` triggers capability registry (child C); evidence is appended and
the classifier re-runs in the same tick (max 1 re-classification per tick).

### Critic — `src/main/supervisorCritic.js`

Ports `supervisor/loops/self_revision.py:77-89` + the bug-#44 fix (port the
`is_terminal_message` short-circuit; do NOT depend on supervisor's
`engine-fix-decision-overdetection` landing first). After every task lands
(detected via `tasks.json` mtime + status diff), the critic:

1. Reads the outcome.md entry for the task (last entry).
2. Reads the footprint diff (files modified vs spec's `## Footprint`).
3. If `is_terminal_message(outcomeEntry)` short-circuits → `Critique(passed=true)`.
4. Otherwise invokes Haiku with `_CRITIQUE_PROMPT` style; returns `{passed, issues, correctiveInstructions, warnings}`.
5. On `passed=false`: dispatches a corrective revision turn; iteration counter +1.
6. On iteration cap hit: ESCALATE with `"T<n> did not ship — review"`.

### Dispatch actions

- **ADVANCE** — build the next runtime prompt via `specManager.buildSpecCommandFile`, dispatch to the lane, wait for lane-idle + watcher to promote phase.
- **IMPLEMENT** — same as existing `autopilot.js` per-turn flow; reuses the runtime prompt + no-progress diagnostic. Supervisor wraps the existing loop's `_executeTurn` rather than re-implementing.
- **CRITIC** — invokes `supervisorCritic.critique(task)`; on revise dispatches corrective revision turn.
- **ESCALATE** — calls `escalationAdapter.present(escalation)` from child E (if landed) else writes to `.frame/specs/<slug>/escalations/<id>.json` and pauses.
- **RESEARCH** — calls `capabilities.runAll(registry, question, ctx, profile)` from child C, accumulates evidence, re-classifies once.
- **DONE** — sets `phase='done'`, emits audit event, closes loop.
- **WAIT** — sleeps for the watch-debounce interval, then re-ticks.

### Cross-project mode — `src/main/supervisorRegistry.js`

A second loop above the per-spec ones. Iterates over every open Frame
project; for each project iterates over `listSpecs(projectPath)`; for each
spec checks `supervisor.json.enabled`; if true ensures a per-spec
SupervisorLoop is running. Applies a project-pair footprint guard
(opportunistic — only warns, doesn't block — per spec.md non-goals on
external sources).

Child D (cross-project UI) reads `supervisorRegistry.getAcrossProjects()`.

### Per-spec config — `.frame/specs/<slug>/supervisor.json`

```json
{
  "enabled": true,
  "mode": "supervisor",
  "confidence_threshold": 0.65,
  "iteration_cap": 2,
  "auto_advance_phases": ["specified", "planned"],
  "capabilities": []
}
```

Defaults are baked into `supervisorLoop.js`; the file is optional.
`mode: "autopilot-legacy"` falls back to the existing implement-only loop.

### Audit — `.frame/specs/<slug>/supervisor-audit.jsonl`

```json
{"ts":"...","tick":N,"phase":"...","route":"implement",
 "actionKind":"implement_turn","reasoning":"...","confidence":0.82,
 "beforeUndone":4,"afterUndone":3}
```

Co-exists with the existing `autopilot-events.jsonl` (renamed in v2; v1
writes to both for back-compat with the Audit tab).

### IPC

- `SUPERVISOR_START` (renderer → main) — wraps existing Auto toggle
- `SUPERVISOR_STOP` (graceful)
- `SUPERVISOR_STATE` (push on tick) — replaces `AUTOPILOT_STATE`
- `LIST_CROSS_PROJECT_SUPERVISORS` (for child D)

---

## Files

**New**
- `src/main/supervisorLoop.js` — per-spec loop
- `src/main/supervisorPolicy.js` — hard-policy fast path
- `src/main/supervisorClassifier.js` — Haiku-backed LLM router
- `src/main/supervisorCritic.js` — outcome critic (with `is_terminal_message`)
- `src/main/supervisorRegistry.js` — process-global registry, cross-project mode
- `src/main/supervisorPromptBuilder.js` — builds classifier + critic prompts
- `src/main/supervisorAudit.js` — writes audit JSONL
- `src/main/supervisorClaudeRunner.js` — wraps `claude -p --output-format json --max-turns 1`
- `src/__tests__/supervisorPolicy.test.js`
- `src/__tests__/supervisorClassifier.test.js` — with mocked `runClaudeJson`
- `src/__tests__/supervisorCritic.test.js`
- `src/__tests__/supervisorLoop.test.js` — end-to-end with FakeWorker + FakeMemory
- `.frame/specs/frame-supervisor-loop/outcome.md`

**Modified**
- `src/main/autopilot.js` — supervisor wraps this rather than replaces; legacy mode unchanged
- `src/main/index.js` — wire up supervisor registry + IPC
- `src/shared/ipcChannels.js` — add the 4 channels above
- `src/renderer/specSection.js` — Auto toggle now starts a supervisor (not just autopilot)
- `src/renderer/autopilotPill.js` — show supervisor verdict (route + confidence)
- `STRUCTURE.json`, `AGENTS.md` — supervisor section

---

## Footprint

- src/main/supervisorLoop.js
- src/main/supervisorPolicy.js
- src/main/supervisorClassifier.js
- src/main/supervisorCritic.js
- src/main/supervisorRegistry.js
- src/main/supervisorPromptBuilder.js
- src/main/supervisorAudit.js
- src/main/supervisorClaudeRunner.js
- src/__tests__/supervisorPolicy.test.js
- src/__tests__/supervisorClassifier.test.js
- src/__tests__/supervisorCritic.test.js
- src/__tests__/supervisorLoop.test.js
- src/main/autopilot.js
- src/main/index.js
- src/shared/ipcChannels.js
- src/renderer/specSection.js
- src/renderer/autopilotPill.js

---

## Dependencies

- `claude` CLI on PATH — already required by lane spawn.
- Built on top of:
  - Child B (`frame-project-profiles-and-memory`) — reads `ProjectProfile` for policy
  - Child C (`frame-capabilities-registry`) — for the RESEARCH route
  - Child F (`frame-worker-abstraction`) — supervisor dispatches via `WorkerInterface`
- Bug #44 fix `is_terminal_message` is ported INLINE in `supervisorCritic.js` so this spec doesn't block on the supervisor child spec landing.

---

## Sequencing

1. **Claude runner.** `supervisorClaudeRunner.js` wrapping `claude -p --output-format json --max-turns 1`. Returns parsed JSON or throws. Unit-test against a recorded fixture.
2. **Prompt builder.** `supervisorPromptBuilder.js` with `buildClassifierPrompt` + `buildCriticPrompt`. Test inputs/outputs against snapshot.
3. **Hard-policy fast path.** `supervisorPolicy.js` — pure function, no IO. Tests cover every branch in the architecture list above.
4. **LLM classifier.** `supervisorClassifier.js` — combines policy first, LLM second, evidence re-classify capped at 1. Tests with mocked `runClaudeJson`.
5. **Critic.** `supervisorCritic.js` with `is_terminal_message` short-circuit ported from the supervisor's bug #44 fix; iteration cap; warnings demotion. Tests.
6. **Per-spec loop.** `supervisorLoop.js` — wires policy + classifier + dispatch + audit; uses existing `autopilot._executeTurn` for the IMPLEMENT dispatch action.
7. **Registry + cross-project mode.** `supervisorRegistry.js` — process-global map; cross-project iteration; emits state-change events.
8. **IPC + audit.** Wire `SUPERVISOR_*` channels; `supervisor-audit.jsonl` writes; supervisor pill in renderer.
9. **Renderer wiring.** Auto toggle starts supervisor instead of legacy autopilot when `supervisor.json.mode === "supervisor"`.
10. **End-to-end test.** `supervisorLoop.test.js` drives a spec at `phase=specified` through to `done` using `FakeWorker` + `FakeMemoryBackend` + mocked Haiku.
11. **Docs + outcome.** AGENTS.md supervisor section; append outcome.md.
