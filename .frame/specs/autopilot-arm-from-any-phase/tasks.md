# Tasks — Autopilot arm-from-any-phase

- T01 · Add `readAutoOnTasks` + `writeAutoOnTasks` helpers to `autopilot.config.js` with empty-file pruning + cap-preservation merge
- T02 · Add unit tests (`src/__tests__/autopilot.intent.test.js`) covering default-false, round-trip, malformed JSON, and merge-with-existing-caps
- T03 · Add `SET_AUTO_ON_TASKS`, `GET_AUTO_ON_TASKS`, `AUTOPILOT_ARM_REQUEST` channels to `src/shared/ipcChannels.js`
- T04 · Wire `SET_AUTO_ON_TASKS` and `GET_AUTO_ON_TASKS` handlers in `autopilot.setupIPC`
- T05 · Extend `specManager.createSpec` to accept `auto_on_tasks` opt and persist via the new helper
- T06 · Add the arm hook in `specManager.reconcilePhase` — on transition to `tasks_generated` + armed, call `autopilot.emitArmRequest`
- T07 · Add `autopilot.emitArmRequest` — appends an `event: 'armed'` audit record and pushes `AUTOPILOT_ARM_REQUEST` to the renderer
- T08 · `stopAutopilot` clears `auto_on_tasks` on graceful spec-scope stop (working-stance answer to spec.md §Open #2)
- T09 · `autopilotClient` subscribes to `AUTOPILOT_ARM_REQUEST`, calls `start` when a lane is attached, falls back to a pending-arm queue and a `autopilot-arm-pending` DOM event when not
- T10 · `agentDispatch.dispatchSpec` calls `autopilotClient.consumeArmIfPending` after a successful lane assignment to drain the pending-arm queue
- T11 · `specPanel.js` New Spec modal: pre-arm checkbox, pass `auto_on_tasks` through `CREATE_SPEC` opts
- T12 · `specSection.js` UI: Next-step card pre-arm checkbox (Spec/Plan/Tasks phases), always-visible header-level Auto toggle, "no lane attached" passive chip, plus matching styles in `panels.css`
