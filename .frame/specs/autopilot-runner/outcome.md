# Outcome — Autopilot runner

## T01 — Autopilot config loader (three-tier caps merge)

Shipped `src/main/autopilot.config.js` with `DEFAULTS` (frozen), `readJSONSafe`, and `readCaps({ projectPath, slug, globalCaps })` resolving spec > project > global > DEFAULTS. Kept it Electron-free and injected `globalCaps` instead of calling `userSettings` directly so the loader stays unit-testable. Bootstrapped the repo's first test harness — added `jest@^29.7.0` as a devDependency, a `test` script, and a `jest` config in `package.json` (plan.md said "no new npm deps" but every task assumed Jest already existed; user approved adding it as part of T01). 15 specs in `src/__tests__/autopilot.test.js` cover merge precedence, null-overrides-number, corrupt/non-object JSON, argument validation, and DEFAULTS shape — all green.

Followup: T02–T10 can now rely on `npm test`; consider extending Jest config (coverage, watch) when the suite grows.

_Captured: 2026-06-21T21:56:08.111Z · 4 file change(s)_

---

## T02 — `readPendingCount` + `reconcilePhase` exposed for autopilot

Added `readPendingCount(projectPath, slug)` to `src/main/specManager.js` as a thin reuse of `tasksManager.loadTasks` + the existing `collectSpecTasks` filter, and re-exported it alongside `reconcilePhase`. Confirmed `reconcilePhase` is side-effect-safe for autopilot: it only reads the target spec's `status.json`, derives the new phase via `derivePhase` (pure), and writes back via `writeStatus`, which touches a single file with no IPC broadcast or watcher kick. Tests in `src/__tests__/autopilot.test.js` cover the spec-prefix filter, status filtering, cross-spec isolation, and missing-arg guards (3 new specs, all green).

_Captured: 2026-06-21T22:01:00.000Z · 3 file change(s)_

---

## T03 — Pure `findFootprintConflictAmong` helper extracted

Confirmed `findFootprintConflict(slug, footprint)` was read-only over `session.workers`. Extracted the matching loop into a pure `findFootprintConflictAmong(slug, footprint, candidates)` so autopilot's cross-spec scheduler (T08) can pass its own in-flight list without depending on orchestration-session state. The original session-bound function now just maps its workers into candidates and delegates; behaviour is unchanged. Re-exported `findFootprintConflict`, `findFootprintConflictAmong`, and `footprintsOverlap` from `orchestrationManager.js`. 6 new pure tests in `autopilot.test.js`.

_Captured: 2026-06-21T22:05:00.000Z · 2 file change(s)_

---

## T04 — Turn-completion signals (Option A: mtime + lane-idle)

Shipped `src/main/autopilot.signals.js` exposing `tasksJSONMtime(projectPath)` and `waitForLaneIdle({ getLastOutputAt, now, idleMs, pollMs, timeoutMs, sleepFn })`. Kept them as separate primitives (not a single "did the turn land?" oracle) so the loop's progress/no-progress decision stays in `autopilot.js` where retries are handled. `idleMs` defaults to 20000 ms to match `orchestrationManager.IDLE_MS`; sleep/now are injectable so tests don't burn wall-clock. 6 specs cover mtime read, idle-on-quiet-lane, timeout-on-active-lane, null-output grace, and missing-arg guard.

_Captured: 2026-06-21T22:10:00.000Z · 3 file change(s)_

---

## T05 — Per-spec loop with diagnostic retries + escalate-after-N

Shipped `src/main/autopilot.js`: `startAutopilot`, `stopAutopilot`, `getAutopilotState`, `setStateListener`, `_executeTurn`, `_runSpecLoop`. Every external side effect (lane dispatch, prompt staging, pending-count read, phase reconcile, idle wait, prompt-file append) goes through an injectable `deps` object — default deps wire to `specManager` + `ptyManager`, but tests inject fakes and don't touch a PTY. Diagnostic appendix is appended to the per-turn runtime prompt file (not the canonical template) only on retry; loop pauses once `consecutiveNoProgress > caps.max_turns_per_task` with `pausedReason: 'max_turns_per_task'`, and exits cleanly as `stopped` when `stopAutopilot` flips the flag mid-loop. 10 new tests cover progress, retry+diagnostic, escalate, staging-error, dispatch-error, graceful stop, already-complete spec, `max_total_turns` cap, and state-listener emission.

Followup: cross-spec `_runProjectLoop` (T08) and the budget gate (T09) deliberately left no-ops in this file — `scope: 'project'` returns a run record but doesn't loop yet.

_Captured: 2026-06-21T22:18:00.000Z · 3 file change(s)_

---

## T06 — IPC channels + main wiring

Added `AUTOPILOT_START`, `AUTOPILOT_STOP`, `AUTOPILOT_GET`, `AUTOPILOT_STATE` to `src/shared/ipcChannels.js`. `autopilot.js` now exports `init(window)` + `setupIPC(ipcMain)`; init installs a state listener that pushes `AUTOPILOT_STATE` to the renderer on every transition. `src/main/index.js` requires + wires `autopilot.setupIPC` and `autopilot.init(window)` alongside the other managers. Plan deviation: there is no `src/preload/index.js` in this repo (`nodeIntegration: true`, `contextIsolation: false`) so the renderer can call `ipcRenderer.invoke(IPC.AUTOPILOT_*)` directly — no preload bridges needed.

_Captured: 2026-06-21T22:24:00.000Z · 3 file change(s)_

---

## T07 — "Auto" toggle + status pill in spec section

Added `src/renderer/autopilotClient.js` (singleton state cache + IPC adapter — subscribes to `AUTOPILOT_STATE`, exposes `getRunFor` / `start` / `stop` / `onChange`), `src/renderer/autopilotToggle.js` (renders the "Auto" button + attaches its start/stop click handler), and `src/renderer/autopilotPill.js` (pure renderer for the `🤖 Auto · N/M tasks done · turn K`, `⏸ Auto-paused`, and `⚠ Auto · error` variants). Wired the toggle into the `spec.implement` action bar in `specSection.js` (split out a `.spec-next-action-buttons` flex row so the toggle sits next to the existing button), put the pill in the spec-detail header meta, and added a per-viewport `autopilotClient.onChange` subscription so transitions trigger a re-render. CSS added to `panels.css`. Smoke test deferred — running a 3-task spec end-to-end requires an Electron window and a live PTY-attached Claude lane, which can't be driven from a CLI; the IPC + loop are covered by the existing 40 jest specs and `npm run build` succeeds.

Followup: smoke test with a real lane is the next manual verification step; T08 (cross-spec) will reuse `autopilotToggle.js` for the project-home toggle.

_Captured: 2026-06-21T22:38:00.000Z · 6 file change(s)_

---

## T09 — Budget gate (turn-count proxy + documented cost gap)

`max_total_turns` (default 50) is the hard guardrail. Audited Frame's cost surface: `claudeUsageManager` exposes only Anthropic's 5-hour and 7-day `utilization` percentages from `/api/oauth/usage`, never a per-message USD figure — there is no signal to sum against `caps.budget_usd`. Setting `budget_usd` now logs a one-time warning and the loop's pause reason flips from `max_total_turns` to `budget_proxy_turns` so audit logs can distinguish the two modes. Inline TODO(autopilot-runner T09) in `_runSpecLoop` documents the gap at the call site.

Followup: when Frame gains a per-run cost signal (e.g. by accumulating `$ai_generation` cost properties from each turn), wire it into the same gate and remove the TODO.

_Captured: 2026-06-21T23:00:00.000Z · 1 file change(s)_

---

## T08 — Cross-spec project loop + lane-board toggle

Implemented `_runProjectLoop(run, deps)` in `autopilot.js`. The renderer hands main a `terminalAssignments: { slug → terminalId }` map at start time; the loop lists project specs, filters to `tasks_generated`/`implementing` with pending tasks AND a known assignment, and uses the pure `findFootprintConflictAmong` helper from T03 against currently in-flight sub-runs to pick the next safe spec. Sub-runs reuse the same per-spec primitive (`startAutopilot({ scope: 'spec', ... })`), so each sub gets its own audit log and respects all the same caps. `max_parallel_specs` defaults to 2; project-level cap defaults inherit from `DEFAULTS`. Specs without an attached Frame are skipped (not failed), surfaced in the project-level audit log. Graceful stop cascades: setting `stopRequested` on the project run stops the loop after the current iteration, then calls `stopAutopilot` on every child run id. Project loop poll interval is injectable as `caps._projectPollMs` so tests run sub-second.

Renderer: `renderProjectAutopilotToggle({ projectPath })` added to `autopilotToggle.js` (collects `getSpecLaneInfo(slug).terminalId` for every listed spec at click time). `laneBoard._renderProjectActions(projectPath)` injects the toggle + a live state pill above the lane grid and subscribes to `autopilotClient.onChange` so the pill stays current without re-rendering the whole board. CSS in `panels.css`.

3 new tests cover the cross-spec footprint guard (A/B share `src/shared.js`, C is independent — all three complete), terminal-assignment skip, and graceful stop cascading from project → sub. 51 total, all green.

_Captured: 2026-06-21T23:30:00.000Z · 5 file change(s)_

---

## Bonus — UI: per-task audit trail + spec/plan/tasks editing + add/remove pending tasks

Outside the spec's original scope but bundled into this cycle for the user's testing phase:

- **Per-turn audit log.** `autopilot.js` now appends a JSONL record per transition to `.frame/specs/<slug>/autopilot-events.jsonl` (run-started, every turn with before→after pending counts + outcome + retry attempt, run-completed/failed/paused/stopped). New `readAuditEvents` reader + `AUTOPILOT_AUDIT` IPC. Renderer adds an **Audit** tab to the spec section that loads and re-renders the log on every transition.
- **Inline doc editing.** New IPC `WRITE_SPEC_DOC` overwrites `spec.md` / `plan.md` / `tasks.md` from the UI. Saving `tasks.md` re-runs `syncTasksFromMarkdown` so new markdown rows become pending tasks immediately. Renderer shows an "Edit <doc>.md" button on each markdown tab and swaps in a textarea + Save/Cancel.
- **Add / remove pending tasks from the UI.** New IPCs `ADD_SPEC_TASK` (appends `- T<n+1> · <title>` to `tasks.md` and `syncTasksFromMarkdown` upserts it) and `REMOVE_SPEC_TASK` (refuses to delete anything that isn't `pending`). Renderer: a trash button on pending rows, a "+ Add" input row at the bottom of the Tasks tab.

8 new specManager / autopilot tests cover the edit helpers and the audit emission round-trip (48 total, all green). CSS in `panels.css`. `npm run build` clean.

Followup: surfacing the diagnostic-appendix text itself in the Audit tab (currently we only flag that it fired) would make the "tried a different approach" decisions explicit — useful for the user's first real-task pass.

_Captured: 2026-06-21T23:00:00.000Z · 7 file change(s)_

---

## T10 — Docs + final regression

`docs/AUTOPILOT.md` written (≤1 page: enable, caps table, three-tier override order, `budget_usd` gap note, failure-recovery flow, when NOT to use, file map). Final `npm run build` clean (1.7 MB renderer bundle). Final `npx jest` green: 48 tests across 12 describe blocks covering config merge, `readJSONSafe`, `readPendingCount`, `findFootprintConflictAmong`, signals, the per-spec loop (progress / retry-with-diagnostic / escalate / staging-error / dispatch-error / graceful-stop / already-complete / max-total-turns cap), state listener, audit log round-trip, and the new specManager edit helpers. Spec is implementation-complete to the line the user agreed to (per-spec autopilot + UI editing + audit). **T08 (cross-spec project loop) is the one task left pending — deferred by mutual agreement.**

Recommend marking the spec phase `done` in `.frame/specs/autopilot-runner/status.json` once T08 is accepted as scope-cut, or leaving phase `implementing` until cross-spec lands.

_Captured: 2026-06-21T23:00:00.000Z · 1 file change(s)_

---
