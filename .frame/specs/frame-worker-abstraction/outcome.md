# Outcome — Frame worker abstraction

## T01 — `src/shared/workerTypes.js`

Shipped `Posture` enum (`cautious` / `default` / `dangerously_skip` matching `supervisor/types.py`) and `WorkerEventKind` enum. JSDoc typedefs for `WorkerEvent`, `SessionHandle`, `TaskResult` — Node usage is duck-typed but the typedefs guide future TS migration. Files touched: `src/shared/workerTypes.js`.

_Captured: 2026-06-22 · 1 file change_

---

## T02 — `WorkerInterface` base

Shipped the abstract `WorkerInterface` class at `src/main/workers/types.js` with `start` / `events` / `answer` / `revise` / `stop`. All methods throw `${constructorName}.<method>: abstract` if not overridden — including `events` which is an async generator and throws on its first `next()`. Files touched: `src/main/workers/types.js`.

_Captured: 2026-06-22 · 1 file change_

---

## T03 — Worker registry

Shipped `src/main/workers/registry.js` with `register` / `getWorker` / `listWorkers` / `hasWorker` + `_resetForTests` (test-only). `getWorker` throws `unknown worker: <name>` when not registered. Added `src/__tests__/workers.test.js` covering the abstract contract, registry mechanics, bad-args rejection, and the two shared enums. Tests: 7/7 in this file, 71/71 overall (was 57 + 7 profile + 7 workers = 71). Files touched: `src/main/workers/registry.js`, `src/__tests__/workers.test.js`.

_Captured: 2026-06-22 · 2 file changes_

---

## T04 — EventQueue bridge

Shipped `src/main/workers/_eventQueue.js`. Async pull-queue: callers `push(event)` / `close()` / `error(err)`; consumers `for await (const ev of queue)`. 3/3 tests covering pre-iteration push, post-park push, error propagation via thrown next().

_Captured: 2026-06-22 · 1 file change_

---

## T05 — FakeWorker

Shipped `src/main/workers/fakeWorker.js`. Deterministic event sequence (`progress → tool_use × N → done`). `start` returns a SessionHandle; `events` is an AsyncIterator fed by an `EventQueue`; `revise` returns a synthetic TaskResult. Registered as `fake` in `src/main/workers/index.js` so the supervisor loop tests can dispatch through the standard registry path.

_Captured: 2026-06-22 · 2 file changes_

---

## T06 — Workers test extended

Extended `src/__tests__/workers.test.js` with EventQueue and FakeWorker exercise sections. 5 new tests; all pass.

_Captured: 2026-06-22 · 1 file change_

---

## T07 — ClaudeCodeWorker

Shipped `src/main/workers/claudeCodeWorker.js`. Wraps the existing Frame claude-code spawn pipeline via an injected `exec` adapter (`checkAvailable` / `sendCommand` / `waitForReady` / `subscribeToStatus`) so the IPC contract stays identical — the worker funnels every side-effect back through the same `CHECK_AI_TOOL_AVAILABLE` + `multiTerminalUI` + `laneStatus` surfaces the renderer was already calling. Owns the Claude-specific TUI fingerprints (mirrored from `laneStatus.AGENT_PATTERNS` / `APPROVAL_PATTERNS`), the `Posture.DANGEROUSLY_SKIP → --dangerously-skip-permissions` override, and the `agent-working`/`agent-approval`/`agent-input` → `WorkerEvent` mapping. Extended `src/__tests__/workers.test.js` with 10 new tests covering static identity, posture flag table, tail parsing, status→event mapping, start ordering (subscribe-before-send), unavailability + not-ready failure modes, events stream forwarding, revise, and stop teardown.

_Captured: 2026-06-21 · 2 file changes, +10 tests_

---

## T08 — CodexWorker + GeminiWorker

Shipped `src/main/workers/codexWorker.js` and `src/main/workers/geminiWorker.js`. Same shape as the Claude worker but with permissive v1 decision detection — both flag any quiet tail that ends in `?` / contains `(y/n)` / `(yes/no)` / tool-specific confirm phrases, on the principle that the supervisor's classifier can re-judge an over-flagged event but cannot rescue a missed one. Posture flag tables are empty for both (neither CLI exposes a daily-driver "skip permissions" knob), so the user's saved presets via `aiToolManager.composeFlagSuffix` are the only override layer. Both registered in `src/main/workers/index.js` next to the existing `fake` and the new `claude` entry; tool ids match `aiToolManager.AI_TOOLS` keys exactly. Extended `src/__tests__/workers.test.js` with a `describe.each([...])` block giving each worker 5 tests (identity / parsing / start ordering / failure modes / event forwarding) plus a registry-shape test asserting the bootstrap registers `claude` / `codex` / `gemini` / `fake`. Net +11 tests across T07/T08.

_Captured: 2026-06-21 · 3 file changes, +11 tests_

---

## T09 — agentDispatch refactor

Refactored `src/renderer/agentDispatch.js` to delegate the "no agent in lane → spawn one" branch to `workers.getWorker(toolId).start({...})`. The inline `CHECK_AI_TOOL_AVAILABLE → sendCommand → _waitForAgentReady` triple is gone from `dispatch()`; the same calls now happen inside the worker via the per-dispatch `_buildExec({ enter })` adapter. Subscribe-before-send ordering is preserved inside each worker (the `readyPromise` is created before `exec.sendCommand` is called) so a fast CLI cannot race past the laneStatus listener. The IPC channel surface is byte-identical — every channel the renderer was calling before still gets called now, just routed through the exec adapter. Also added `require('./workers')` to `src/main/index.js` so the registry is populated on boot before any supervisor IPC dispatch hits it.

_Captured: 2026-06-21 · 2 file changes, no IPC change_

---

## T10 — Full jest sweep

`npx jest --silent` → **165 / 165 green** (was 144 / 144 at session start; the 21 new tests cover claude / codex / gemini workers plus a registry-shape assertion). Zero regressions in any prior suite (autopilot 51, profile 7, memory 10, memoryMirror 6, supervisorPolicy 14, supervisorClassifier 5, supervisorCritic 9, supervisorLoop 3, capabilitiesRegistry 6, specReader 5, knowledgeSearch 3, crossProjectGuard 4, uiAdapter 2, autopilot.intent). `npm run build` rebuilt `dist/renderer.js` cleanly (1.8 MB). The supervisor app's loop can now dispatch through `workers.getWorker('claude' | 'codex' | 'gemini' | 'fake')` with the same semantics the FakeWorker tests validated end-to-end.

_Captured: 2026-06-21 · validation_

---

## T11 — Docs + meta

Added a "Workers" section to `AGENTS.md` documenting the `WorkerInterface` contract, the registry singleton, the per-dispatch `exec` adapter pattern, the dispatch flow diagram, how to add a new worker, posture-override semantics, and the permissive-v1 decision-detection rationale. Regenerated `STRUCTURE.json` via `npm run structure` — the three new worker modules + their exports are mapped, and the `main/workers` directory is now a first-class module group in the index. Tasks T07–T11 marked `completed` in `tasks.json` with `completedAt` / `updatedAt` set.

_Captured: 2026-06-21 · 3 meta files updated_
