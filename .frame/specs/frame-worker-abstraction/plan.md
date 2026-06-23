# Plan — Frame worker abstraction (WorkerInterface refactor)

## Architecture

### Shared types — `src/shared/workerTypes.js`

```js
// WorkerEvent
{ kind: 'progress' | 'tool_use' | 'decision' | 'done' | 'error',
  ts: ISO,
  payload: {...} }

// SessionHandle
{ sessionId: string|null, terminalId: string, tool: string,
  model: string|null, workdir: string }

// TaskResult
{ status: 'done' | 'failed' | 'awaiting_human',
  summary: string, costUsd: number|null, sessionId: string|null }

// Posture enum
const Posture = Object.freeze({ CAUTIOUS: 'cautious',
                                DEFAULT: 'default',
                                DANGEROUSLY_SKIP: 'dangerously_skip' });
```

Field shapes mirror `supervisor/types.py` 1:1 so future supervisor-Frame
interop reads identically.

### Base interface — `src/main/workers/types.js`

```js
class WorkerInterface {
  static name = '';

  // Spawn the underlying CLI; return SessionHandle synchronously usable.
  async start({ task, ctx, posture }) { throw new Error('abstract'); }

  // AsyncIterator of WorkerEvent over the lane's lifetime.
  async *events(session) { throw new Error('abstract'); }

  // Resolve a DECISION event pending on the worker.
  async answer(session, decisionId, reply) { throw new Error('abstract'); }

  // Re-run the same session with corrective instructions; returns TaskResult.
  async revise(session, instructions) { throw new Error('abstract'); }

  async stop(session) { throw new Error('abstract'); }
}
```

### Registry — `src/main/workers/registry.js`

```js
const REGISTRY = new Map();
function register(name, ctor) { REGISTRY.set(name, ctor); }
function getWorker(name) {
  const C = REGISTRY.get(name);
  if (!C) throw new Error(`unknown worker: ${name}`);
  return new C();
}
function listWorkers() { return [...REGISTRY.keys()]; }
```

On main-process boot, `src/main/workers/index.js` registers
`claude_code`, `codex`, `gemini`, and (in test env) `fake`.

### Concrete implementations

Each lives in its own file under `src/main/workers/`. Each is a thin
adapter over the existing main-process code paths:

- **`claudeCodeWorker.js`** wraps `aiToolManager`'s claude-code spawn
  args + `terminalManager`/`agentDispatch` event parsing. The
  AsyncIterator is implemented via a pull-queue fed by the existing
  `TERMINAL_OUTPUT_ID` event listener.
- **`codexWorker.js`** wraps the codex path equivalently.
- **`geminiWorker.js`** wraps the gemini path equivalently.
- **`fakeWorker.js`** emits a deterministic event sequence —
  `progress` → `tool_use` × N → `done`. Used in tests.

Each worker owns its own decision-detection heuristic (different tools
emit differently). For claude-code that's the regex/keyword set already
in `agentDispatch.js`; for codex/gemini we start with a permissive
"ends in '?'" rule and tighten over time.

### Existing `agentDispatch.js` becomes a shim

`agentDispatch` keeps its renderer-facing surface (the IPC handlers, the
spec-lane info map). Internally, every spawn route is replaced with:

```js
const worker = workers.getWorker(toolName);
const session = await worker.start({task, ctx, posture});
// expose `session.terminalId` to renderer the same way as today
for await (const ev of worker.events(session)) {
  // forward to the existing event bus
}
```

No renderer-facing change. The IPC channels `START_LANE`,
`DISPATCH_TO_LANE`, `CHECK_AI_TOOL_AVAILABLE` keep their shapes.

### Bridging callback world ↔ AsyncIterator

A small helper at `src/main/workers/_eventQueue.js`:

```js
class EventQueue {
  constructor() { this._buf = []; this._waiters = []; this._closed = false; }
  push(ev) { /* enqueue, wake waiter */ }
  close() { /* drain */ }
  async *[Symbol.asyncIterator]() { /* yield from buffer/wait */ }
}
```

This is the bridge from Frame's existing IPC-event listeners to the
AsyncIterator contract. Same pattern Node uses internally for streams.

---

## Files

**New**
- `src/shared/workerTypes.js` — WorkerEvent / SessionHandle / TaskResult / Posture
- `src/main/workers/types.js` — `WorkerInterface` base
- `src/main/workers/registry.js` — registry singleton
- `src/main/workers/index.js` — registers built-in workers at boot
- `src/main/workers/_eventQueue.js` — callback ↔ AsyncIterator bridge
- `src/main/workers/claudeCodeWorker.js`
- `src/main/workers/codexWorker.js`
- `src/main/workers/geminiWorker.js`
- `src/main/workers/fakeWorker.js`
- `src/__tests__/workers.test.js` — registry + each worker's contract
- `.frame/specs/frame-worker-abstraction/outcome.md`

**Modified**
- `src/main/aiToolManager.js` — extract the per-tool spawn args into helpers each worker can call; no behaviour change
- `src/renderer/agentDispatch.js` — route through `workers.getWorker(toolName)` instead of switching inline (renderer-facing surface unchanged)
- `src/main/index.js` — `require('./workers')` early to populate the registry
- `STRUCTURE.json` — auto-updated
- `AGENTS.md` — add "Workers" section

---

## Footprint

- src/shared/workerTypes.js
- src/main/workers/types.js
- src/main/workers/registry.js
- src/main/workers/index.js
- src/main/workers/_eventQueue.js
- src/main/workers/claudeCodeWorker.js
- src/main/workers/codexWorker.js
- src/main/workers/geminiWorker.js
- src/main/workers/fakeWorker.js
- src/__tests__/workers.test.js
- src/main/aiToolManager.js
- src/renderer/agentDispatch.js
- src/main/index.js

---

## Dependencies

None. AsyncIterator is native ES2018+ (Node 12+, current target).

---

## Sequencing

1. **Shared types.** `src/shared/workerTypes.js` with the four type stubs + `Posture` enum. No callers yet.
2. **`WorkerInterface` base + registry.** `src/main/workers/{types,registry,index}.js`. Empty registry at first; `getWorker` throws on unknown.
3. **EventQueue bridge.** `src/main/workers/_eventQueue.js` + test. The bridge is the keystone — get it right or the whole abstraction is awkward.
4. **`FakeWorker`.** Implements the full contract with a canned event sequence. Used by `workers.test.js` to validate the registry + iterator semantics end-to-end with no real CLI.
5. **`ClaudeCodeWorker`.** Wraps the existing claude-code spawn path. Verify existing autopilot tests pass after `agentDispatch` routes through it.
6. **`CodexWorker` + `GeminiWorker`.** Same shape; minimal heuristic for decision detection.
7. **`agentDispatch` shim.** Replace internal switch-on-tool with `workers.getWorker(toolName)`. Existing IPC channels keep their signatures.
8. **Full test sweep.** `npx jest` — must be entirely green.
9. **Docs + outcome.** AGENTS.md "Workers" section explaining how to add a new tool; append outcome.md.
