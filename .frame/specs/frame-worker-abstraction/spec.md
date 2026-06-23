# Frame worker abstraction — WorkerInterface refactor

> **What we're building:** Refactor `src/renderer/agentDispatch.js` + the related main-process pieces behind a clean `WorkerInterface` contract (`start`, `events`, `answer`, `revise`) mirroring `supervisor/types.py:230-239`. Existing claude-code / codex / gemini paths land as `*Worker` implementations of the same interface. Pure refactor — no behaviour change, no UI change. Child F of `frame-parity-with-supervisor`; can land in parallel with B/C.

---

## Background

Supervisor reference:
- **`WorkerInterface` protocol** at `supervisor/types.py:230-239`:
  ```python
  class WorkerInterface(Protocol):
      async def start(self, task: Task, ctx: ContextBundle,
                      posture: Permission) -> SessionHandle: ...
      async def events(self, session: SessionHandle) -> AsyncIterator[WorkerEvent]: ...
      async def answer(self, session: SessionHandle,
                       decision_id: str, reply: str) -> None: ...
      async def revise(self, session: SessionHandle,
                       instructions: str) -> TaskResult: ...
  ```
- **`ClaudeCodeWorker`** at `supervisor/worker/claude_code.py:115-276` — the concrete implementation. All CLI knowledge (spawn args, event parsing, session resume, decision detection) isolated here.
- **`FakeWorker`** at `supervisor/worker/fake.py` — drop-in for demos/tests.
- **Loop uses only `WorkerEvent` + `SessionHandle`** — see `supervisor/loop.py:78-90`. Swapping workers is theoretically zero-friction.

Frame today has tool-specific logic spread across `agentDispatch.js`, `aiToolManager.js`, `aiToolSelector.js`, and parts of `terminalManager.js`. The lane spawn path branches on tool, the event-parsing differs, session resume is per-tool. None of this is wrong — it just isn't abstracted, which means the supervisor loop (child A) would have to know about all three tools.

---

## Problem

1. **Supervisor loop will need to dispatch to a worker, regardless of which tool the lane is running.** Without a stable worker abstraction, child A has to special-case claude-code vs codex vs gemini.
2. **Adding a new worker today is hard.** A new tool (e.g. aider, opencode, …) requires touching at least four files in a non-obvious way.
3. **Tests have nothing clean to mock.** Lane behaviour tests stub random IPC channels instead of substituting a `FakeWorker`.

---

## Goal

### 1. New shared types

`src/shared/workerTypes.js`:
- `WorkerEvent` shape — `{kind, ts, ...payload}` with `kind ∈ {'progress' | 'tool_use' | 'decision' | 'done' | 'error'}`
- `SessionHandle` — `{sessionId, terminalId, tool, model, workdir}`
- `TaskResult` — `{status, summary, costUsd, sessionId}`
- `Posture` enum — `{cautious, default, dangerously_skip}`

These mirror the supervisor's types one-to-one.

### 2. `WorkerInterface` base

`src/main/workers/types.js`:
```js
class WorkerInterface {
  static name = '';
  async start({ task, ctx, posture }) { /* → SessionHandle */ }
  async *events(session) { /* yields WorkerEvent */ }
  async answer(session, decisionId, reply) {}
  async revise(session, instructions) { /* → TaskResult */ }
  async stop(session) {}
}
```

### 3. Per-tool implementations

- `src/main/workers/claudeCodeWorker.js` — wraps the existing `agentDispatch` claude-code path
- `src/main/workers/codexWorker.js` — wraps the codex path
- `src/main/workers/geminiWorker.js` — wraps the gemini path
- `src/main/workers/fakeWorker.js` — for tests; deterministic event sequence

### 4. Registry

`src/main/workers/registry.js` — `getWorker(toolName)` returns the right implementation. The supervisor loop and the existing `agentDispatch` both consume the registry, not the concrete classes.

### 5. Existing call-sites move to the abstraction

`agentDispatch.js` becomes a thin shim that:
- Looks up the worker by tool name via the registry
- Calls `worker.start()` for the spawn
- Reads `worker.events()` for the event stream (replacing the current ad-hoc parsing)

Everything that today depends on tool-specific behaviour reads from the abstraction.

### 6. Tests gain `FakeWorker`

`src/__tests__/agentDispatch.test.js` (if extant) and any future supervisor-loop tests use `FakeWorker` for determinism. No more random IPC mocks.

---

## Non-goals

- **No new tool support in v1.** The refactor only re-homes the existing three tools.
- **No behaviour change.** Lane spawn, event parsing, session resume — all identical in observable behaviour.
- **No UI change.** The tool selector, lane status, agent badges all keep their current shapes. They consume the same data, just from a more structured source.
- **No IPC channel renaming.** Existing channels stay; the abstraction layer is purely main-process.
- **No async-iterator runtime introduction.** If the existing event stream uses callbacks, the abstraction wraps that — we don't force a sweeping `async for` refactor outside the new types.

---

## Constraints

- **Existing tests must pass unchanged.** This is the litmus test for "no behaviour change."
- **No new dependencies.** Everything sits on existing modules.
- **STRUCTURE.json updates** — the new `src/main/workers/` dir becomes a module group in the index.
- **Documented in AGENTS.md.** A "Workers" section explains how to add a new one (instantiate `WorkerInterface`, register in `registry.js`).

---

## Open questions

1. **Event-stream shape: AsyncGenerator vs EventEmitter?** Supervisor uses async iterators (`events(session) -> AsyncIterator`). Frame's existing code is callback/event-emitter heavy. *Working stance:* expose both — implementations are AsyncGenerator under the hood; the registry provides a `.on('event', cb)` convenience wrapper for legacy call-sites.

2. **Session resume contract.** Today `--continue` on the claude-code CLI is the resume mechanism. Codex / Gemini have their own. *Working stance:* `WorkerInterface.start({sessionId})` resumes if `sessionId` is provided, else fresh start.

3. **Posture enum names.** Match supervisor exactly (`cautious` / `default` / `dangerously_skip`) or use Frame's existing naming? *Working stance:* match supervisor — easier porting.

4. **Where does `decision_detection` live in the new world?** Today it's inside `worker/claude_code.py`. *Working stance:* keep it in each worker (heuristics differ per tool's output format).

5. **Should the refactor land behind a feature flag?** *Working stance:* no — it's a no-behaviour-change refactor; flags would just hide regressions.

---

## Success criteria

1. Every existing renderer call that today reaches `agentDispatch` continues to work without changes.
2. Lane spawn for claude-code, codex, and gemini all flow through `worker.start()`.
3. The existing test suite passes (51 autopilot tests + any agent-dispatch tests).
4. A new `FakeWorker` exists and supervisor-loop tests can drive it deterministically.
5. STRUCTURE.json reflects the new `src/main/workers/` group.
6. AGENTS.md has a "Workers" section explaining how to add a new tool.
