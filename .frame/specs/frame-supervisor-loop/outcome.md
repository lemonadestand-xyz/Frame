# Outcome — Frame supervisor loop

## T01 — Claude runner

Shipped `src/main/supervisorClaudeRunner.js` wrapping `claude -p --output-format json --max-turns 1` with `runClaudeJson(prompt, {model})`, a 30s timeout, and a `setRunner()` / `resetRunner()` test seam so the classifier + critic tests don't spawn the real CLI.

_Captured: 2026-06-22 · 1 file change_

---

## T02 — Prompt builder

Shipped `src/main/supervisorPromptBuilder.js` with `buildClassifierPrompt(...)` and `buildCriticPrompt(...)`. Prompts mirror the supervisor's inline templates at `supervisor/classifier/llm.py:26-51` and `supervisor/loops/self_revision.py:42-61`, extended with phase-transition guidance for Frame's 6-route enum.

_Captured: 2026-06-22 · 1 file change_

---

## T03 — Hard-policy fast path

Shipped `src/main/supervisorPolicy.js` (`decideFastPath`) covering: phase===done, user pause, footprint conflict, no-lane-attached, tasks_generated+undone, undone===0 (critic gate), specified→planned advance with open-question escalation, planned→tasks advance with footprint requirement, draft escalation. Pure function — 14/14 tests in `src/__tests__/supervisorPolicy.test.js`.

_Captured: 2026-06-22 · 2 file changes_

---

## T04 — LLM classifier

Shipped `src/main/supervisorClassifier.js` (`classifyNextStep` + `classifyWithResearch`). Combines policy → LLM verdict → low-confidence-demote → research re-classification (capped at 1). Mocks the runner via `supervisorClaudeRunner.setRunner` in tests. 5/5 tests in `src/__tests__/supervisorClassifier.test.js` covering hard-policy bypass, LLM happy path, confidence demote, runner failure, research re-classification.

_Captured: 2026-06-22 · 2 file changes_

---

## T05 — Critic (with bug #44 fix ported inline)

Shipped `src/main/supervisorCritic.js` with `isTerminalMessage` short-circuit (VERDICT/STATUS/READY/DONE/COMPLETE/SUMMARY/OUTCOME/RESULT markers + markdown summary headers) — bug #44 fix ported INLINE so this spec doesn't block on the supervisor child spec landing. Also: hard footprint-violation pre-check (LLM bypass), `summary_structure`-only demotion to passed-with-warning, runner-failure fallback to pass-with-warning. 9/9 tests in `src/__tests__/supervisorCritic.test.js`.

_Captured: 2026-06-22 · 2 file changes_

---

## T06 — Per-spec SupervisorLoop

Shipped `src/main/supervisorLoop.js`. Each tick: snapshot (status / tasks / lane / docs / audit / profile) → `classifyNextStep` (or `classifyWithResearch` if capabilities registry attached) → dispatch via injected `executors` map → audit. Executors are pluggable so the loop is testable without real lanes/files. Graceful stop checks at every tick boundary; `_stopGracefulPromise` ensures the current tick completes before the next dispatch.

End-to-end test in `src/__tests__/supervisorLoop.test.js`: a spec at `phase=specified` with two pending tasks reaches `phase=done` with both tasks `status=completed` in <100ms (with `tickIntervalMs=1`), without a single user click. Open-question escalation test surfaces a drafted question on the first tick. Graceful-stop test confirms no dispatch fires after `loop.stop()`.

_Captured: 2026-06-22 · 2 file changes_

---

## T07 — Supervisor registry (cross-project foundation)

Shipped `src/main/supervisorRegistry.js`. Process-global `Map<projectPath::slug, SupervisorLoop>`. Public surface: `startSupervisor` / `stopSupervisor` / `pauseAll` / `getSupervisor` / `listAll` / `getAcrossProjects` / `subscribe`. Cross-project orchestration emerges naturally from the same registry — `getAcrossProjects()` returns the snapshot shape the cross-project UI needs (child D's data source).

_Captured: 2026-06-22 · 1 file change_

---

## T11 — End-to-end test (covered by T06's supervisorLoop.test.js)

The three tests in `src/__tests__/supervisorLoop.test.js` constitute the end-to-end validation: spec → done driven autonomously, escalate on open questions, graceful stop. With the FakeWorker registered (`src/main/workers/index.js`) and the classifier mocked via `runner.setRunner`, the loop drives the canonical happy path without touching a real CLI.

_Captured: 2026-06-22 · 0 new file changes (test exists from T06)_

---

## What's still pending (deferred to integration session)

- **T08 — supervisor-audit.jsonl writes** are already happening (see `supervisor-audit.jsonl` written by `_emitAudit` in `supervisorLoop.js`); legacy `autopilot-events.jsonl` mirror not yet added.
- **T09 — IPC channels** for `SUPERVISOR_START` / `SUPERVISOR_STOP` / `SUPERVISOR_STATE` not yet registered in `main/index.js`. Adding them is mechanical wiring — engine is ready to be called.
- **T10 — autopilotPill.js renderer integration** for showing supervisor verdict still pending.
- **T12 — AGENTS.md "Supervisor Loop" section** still pending.

Followup: wire `SUPERVISOR_START` channel in next session; renderer can then attach Auto toggles to the supervisor instead of the legacy autopilot.

_Captured: 2026-06-22 · status note_

---

## T10 — Autopilot pill supervisor verdict

Extended `src/renderer/autopilotPill.js` with a `verdict` third argument and a small `.supervisor-verdict-badge` chip that renders the supervisor's `lastVerdict.route + confidence` (as a percentage) next to the autopilot run summary. When no autopilot run is active but a verdict exists, the badge renders alone so the user can see why the loop is in its current posture without opening the Audit tab.

Wired into `src/renderer/specSection.js`: pulls `supSpecForPill.lastVerdict` off `supervisorClient.getSpecState(projectPath, slug)` (the same cache the existing `onChange` subscription primes), so each tick that emits a new verdict re-renders the badge with no extra IPC. CSS lives in `src/renderer/styles/components/supervisor.css` with route-coloured variants (escalate=red, auto_answer/done=green, research/wait/paused=blue).

13 new tests in `src/__tests__/autopilotPill.test.js` cover both code paths (with-verdict, without-verdict), confidence clamping, HTML escaping of `reasoning`, the verdict-only fallback when run is null, and unknown-route handling. Suite: 218 → 231 green; renderer rebuilt.

_Captured: 2026-06-22 · 4 file changes (autopilotPill.js, specSection.js delta, supervisor.css delta, autopilotPill.test.js)_

---

## T12 — AGENTS.md Supervisor Loop section

Added a "Supervisor Loop" section to `AGENTS.md` covering the per-spec tick anatomy (snapshot → classify → dispatch → audit), the six routes (`auto_answer`, `research`, `escalate`, `advance` / `implement` / `done`, `paused` / `wait`) with their engine file anchors, the audit JSONL location (`.frame/specs/<slug>/supervisor-audit.jsonl`) + JSON shape, and a code example of calling `SUPERVISOR_START` from a script. The section explicitly mentions the graceful-stop rule and the registry's `pauseAll()` semantics so future contributors don't try to shortcut them.

_Captured: 2026-06-22 · 1 file change (AGENTS.md)_
