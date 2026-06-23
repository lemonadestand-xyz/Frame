# Tasks — Autopilot runner

- T01 · Implement `src/main/autopilot.config.js` with the three-tier caps loader (spec → project → global), DEFAULTS export, and `readJSONSafe` helper; unit-test the merge order in `src/__tests__/autopilot.test.js`
- T02 · Export `readPendingCount(projectPath, slug)` from `src/main/specManager.js` (split out from existing internal logic, no behavioural change) and confirm `reconcilePhase` is callable from autopilot without unintended side effects
- T03 · Verify `findFootprintConflict` in `src/main/orchestrationManager.js` is safe to call read-only; if it mutates state, refactor a pure `canDispatch(projectPath, slug, runningSlugs[])` helper out and re-export
- T04 · Implement `src/main/autopilot.signals.js` (Option A: tasks.json mtime watch + lane-idle detection); unit-test against fixtures simulating progress and no-progress turns
- T05 · Implement `_runSpecLoop` + `_executeTurn` in `src/main/autopilot.js`, including the diagnostic-appendix injection on retry and the escalate-after-N-retries pause; unit-test the three outcomes (progress, retry, escalate)
- T06 · Add `AUTOPILOT_START`, `AUTOPILOT_STOP`, `AUTOPILOT_STATE`, `AUTOPILOT_GET` channels to `src/shared/ipcChannels.js`, wire handlers in `autopilot.js`, and expose bridges in `src/preload/index.js`
- T07 · Add the "Auto" toggle button next to "Implement Next Task" in `src/renderer/specSection.js` and the `🤖 Auto · N/M · turn K` pill component in `src/renderer/autopilotPill.js`; smoke-test a 3-task spec running to completion with zero clicks
- T08 · Implement `_runProjectLoop` in `autopilot.js` using `findFootprintConflict` for parallel-safe selection; add the project-level Autopilot toggle to the project home view (locate the exact renderer file at task-start time)
- T09 · Wire the budget gate to whatever per-run cost signal Frame exposes; if no cost signal exists, ship a `max_total_turns` turn-count proxy and add an inline TODO + outcome.md callout flagging the gap
- T10 · Write `docs/AUTOPILOT.md` (≤1 page: enable, caps, failure recovery, when not to use), run the full Jest suite for regressions in specManager / orchestrationManager / lane dispatch, and append `outcome.md` per Frame convention
