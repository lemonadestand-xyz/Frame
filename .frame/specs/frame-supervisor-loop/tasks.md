# Tasks — Frame supervisor loop

- T01 · Create `src/main/supervisorClaudeRunner.js` wrapping `claude -p --output-format json --max-turns 1` with a `runClaudeJson(prompt, {model})` API + timeout + fixture-replayable test
- T02 · Create `src/main/supervisorPromptBuilder.js` exposing `buildClassifierPrompt(...)` and `buildCriticPrompt(...)`; snapshot tests
- T03 · Implement `src/main/supervisorPolicy.js` (pure hard-policy fast path) with `decideFastPath({status, tasks, lane, profile, audit})`; full branch coverage tests
- T04 · Implement `src/main/supervisorClassifier.js` (`classifyNextStep`) combining policy → LLM → re-classify on RESEARCH evidence (cap 1); tests with mocked `runClaudeJson`
- T05 · Implement `src/main/supervisorCritic.js` with the `is_terminal_message` short-circuit ported from supervisor bug #44 fix, iteration cap, warnings demotion; tests
- T06 · Implement `src/main/supervisorLoop.js` per-spec loop (snapshot → policy → classifier → dispatch → audit → wait); reuses `autopilot._executeTurn` for IMPLEMENT
- T07 · Implement `src/main/supervisorRegistry.js` (process-global map, cross-project iteration, state-change events); `LIST_CROSS_PROJECT_SUPERVISORS` IPC
- T08 · Add `src/main/supervisorAudit.js` and write `.frame/specs/<slug>/supervisor-audit.jsonl` per tick; mirror to legacy `autopilot-events.jsonl` for back-compat with the Audit tab
- T09 · Add `SUPERVISOR_START` / `SUPERVISOR_STOP` / `SUPERVISOR_STATE` IPC channels; wire renderer's Auto toggle to start a supervisor when `supervisor.json.mode === "supervisor"`
- T10 · Extend `src/renderer/autopilotPill.js` to render the supervisor's current route + confidence; supervisor verdict visible in the Audit tab
- T11 · End-to-end test in `src/__tests__/supervisorLoop.test.js` driving a spec at `phase=specified` through to `done` with `FakeWorker` + `FakeMemoryBackend` + mocked Haiku; assert audit log + final phase + zero stalls
- T12 · Update `AGENTS.md` with a "Supervisor Loop" section and append `outcome.md` per Frame convention
