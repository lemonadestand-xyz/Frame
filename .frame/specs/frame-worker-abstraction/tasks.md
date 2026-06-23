# Tasks — Frame worker abstraction

- T01 · Create `src/shared/workerTypes.js` with `WorkerEvent` / `SessionHandle` / `TaskResult` shape JSDoc + `Posture` enum (`cautious` / `default` / `dangerously_skip`)
- T02 · Create `src/main/workers/types.js` with the abstract `WorkerInterface` base class (start / events / answer / revise / stop) — all methods throw `'abstract'` if not overridden
- T03 · Create `src/main/workers/registry.js` (`register` / `getWorker` / `listWorkers`) and `src/main/workers/index.js` that registers built-in workers on require
- T04 · Create `src/main/workers/_eventQueue.js` — async pull-queue bridging callback events to AsyncIterator; add `src/__tests__/eventQueue.test.js`
- T05 · Implement `src/main/workers/fakeWorker.js` emitting a deterministic `progress → tool_use × N → done` sequence for tests
- T06 · Add `src/__tests__/workers.test.js` exercising the registry + the FakeWorker contract end-to-end (start, events iteration, answer, revise, stop)
- T07 · Implement `src/main/workers/claudeCodeWorker.js` wrapping the existing claude-code spawn + event-parsing path via `EventQueue`
- T08 · Implement `src/main/workers/codexWorker.js` and `src/main/workers/geminiWorker.js` with the equivalent spawn paths and a permissive decision-detection heuristic
- T09 · Refactor `src/renderer/agentDispatch.js` to route every spawn through `workers.getWorker(toolName)`; keep all IPC channel signatures unchanged
- T10 · Run the full test suite (`npx jest`); zero regressions allowed (autopilot 51/51 + specManager + every other existing test stays green)
- T11 · Update `STRUCTURE.json` + add a "Workers" section to `AGENTS.md` explaining the contract and how to register a new worker; append `outcome.md` per Frame convention
