# Outcome — Autopilot arm-from-any-phase

## What shipped

All 12 sequencing steps from `plan.md` landed in a single bundled
implementation rather than as separate per-task PRs. The work was
small enough (10 source files, additive throughout) that splitting
it into 12 commits would have been pure ceremony.

### Persistence

- `src/main/autopilot.config.js` — added `readAutoOnTasks(projectPath, slug)` + `writeAutoOnTasks(projectPath, slug, value)` helpers. Writes merge with any existing caps in the same `.frame/specs/<slug>/autopilot.json` so toggling the flag never clobbers `max_turns_per_task` and friends. When the resulting JSON would be empty (`{}`) the helper deletes the file — keeps the spec dir clean for opt-out users.
- `src/__tests__/autopilot.intent.test.js` — 6 unit tests covering: default-false, round-trip, malformed-JSON-no-throw, merge-with-existing-caps preservation in both directions (toggle on while other caps exist; toggle off without deleting the file when other caps exist), empty-file pruning on the no-op path.

### IPC

- `src/shared/ipcChannels.js` — added `SET_AUTO_ON_TASKS`, `GET_AUTO_ON_TASKS`, `AUTOPILOT_ARM_REQUEST`.
- `src/main/autopilot.js` — registered handlers for SET / GET in `setupIPC`; added `emitArmRequest(projectPath, slug)` which writes an `event: 'armed'` audit record and pushes `AUTOPILOT_ARM_REQUEST` to the renderer.

### Arm trigger

- `src/main/specManager.js` — `reconcilePhase` now lazy-requires `./autopilot` and calls `emitArmRequest` whenever a spec advances to `tasks_generated` AND its `auto_on_tasks` flag is true. The lazy require dodges the circular-dep with `autopilot.js → specManager` (which itself lazy-requires specManager inside `_defaultDeps`). `createSpec` accepts `auto_on_tasks` in opts and persists via `writeAutoOnTasks` only when true.

### Stop clears the flag

- `src/main/autopilot.js` — `stopAutopilot` calls `writeAutoOnTasks(false)` on spec-scope stop, matching the working-stance answer to spec.md §Open #2 (Stop is Stop; user must re-tick to opt back in).

### Renderer arm consumer

- `src/renderer/autopilotClient.js` — subscribes to `AUTOPILOT_ARM_REQUEST`. If a lane is attached for the slug, fires `start(...)` immediately. Otherwise queues the slug into `pendingArmSlugs` and dispatches a `autopilot-arm-pending` DOM event so the spec section can render the "Auto on tasks · no lane attached" passive chip. Public surface: `setAutoOnTasks`, `getAutoOnTasks`, `consumeArmIfPending`, `isArmPending`.
- `src/renderer/agentDispatch.js` — after a successful `specLanes.set(slug, terminalId)` inside `dispatchSpec`, calls `autopilotClient.consumeArmIfPending(projectPath, slug)` (fire-and-forget) to drain a queued arm. Covers the pre-arm → tasks-generated → no-lane → later-attach flow.

### UI surfaces

- `src/renderer/specPanel.js` — New Spec modal: added the pre-arm checkbox below the Description textarea ("Run autopilot once tasks are generated and a Frame is attached."), wired through `CREATE_SPEC` opts as `auto_on_tasks`.
- `src/renderer/specSection.js` — three additions:
  1. **Next-step card pre-arm checkbox** rendered only during Spec/Plan/Tasks phases (`_shouldShowPreArmCheckbox` gate). Reactive — ticking calls `setAutoOnTasks` immediately.
  2. **Header-level Auto toggle** rendered into `spec-detail-meta` for *every* phase, in addition to its existing slot inside the Next-step card. Same `renderAutopilotToggle` component, same handlers — second mount only.
  3. **"Auto on tasks · no lane attached" passive chip** in the meta row, surfaced via a `document.addEventListener('autopilot-arm-pending', ...)` subscription; clears once a lane attaches (re-render fires off `agentDispatch.onSpecLaneActivity`).
- `src/renderer/styles/components/panels.css` — added `.spec-modal-checkbox`, `.spec-pre-arm-checkbox`, `.spec-header-autopilot` (compact chip variant), `.spec-arm-pending-chip` styles.

## Deviations from plan.md

1. **Two persistence helpers, not via readCaps.** The plan implied callers could read `auto_on_tasks` through the existing three-tier `readCaps` merge. In practice the renderer only wanted the single flag, so a dedicated `readAutoOnTasks` + `GET_AUTO_ON_TASKS` IPC was cleaner than asking renderer to read the full caps blob. `readCaps` still merges the field transparently for any caller that wants it; this just adds a focused getter.
2. **Persistent "pre-arm survives reload" deferred.** plan.md §Failure modes implied the arm flag should fire on Frame relaunch if `auto_on_tasks=true` and phase=`tasks_generated`. Today the arm fires only on the *transition* edge. If the user reloads Frame between arming and tasks-generated, the flag persists in `autopilot.json` so the next phase advance still arms. If they reload AFTER `tasks_generated`, the flag stays set but no edge fires — the header toggle is the escape hatch. Tracked as a follow-up rather than blocking ship: would need a `reconcilePhase` re-emit at app startup, which deserves its own ordering thought.
3. **No project-tier pre-arm.** Stayed strictly spec-tier per the plan; project pre-arm is left to the existing `🤖 Project Autopilot` button.

## How to verify locally

1. Hard-reload Frame (Cmd+Shift+R or full quit & relaunch — main-process changes need a full restart).
2. **Path A (header toggle, mid-flight escalate):** open any spec at `planned`/`tasks_generated`. Look at the meta row next to the slug — the *Auto* button is now there too. Flip it on with a lane attached → run starts.
3. **Path B (pre-arm from any phase):** create a new spec via the *+ New* button → tick "Run autopilot once tasks are generated and a Frame is attached" → click Create. Walk Spec → Plan → click *Break into Tasks*. The moment `tasks.md` lands and tasks sync into `tasks.json`, autopilot starts on the attached lane.
4. **Path C (pre-arm via the Next-step card):** open a `specified`/`planned` spec, tick "Run autopilot once tasks are generated." in the orange card. Same outcome on the `→ tasks_generated` edge.
5. **No lane attached?** Pre-arm without attaching a Frame → click *Break into Tasks* → spec shows the "Auto on tasks · no lane attached" chip in the meta row → attach a Frame via the usual dispatch flow → run starts automatically (drained from `pendingArmSlugs`).
6. **Stop clears intent:** start an armed run, hit Stop → the flag clears (verify by reading `.frame/specs/<slug>/autopilot.json` — `auto_on_tasks` is gone; the file disappears if no other caps were set).

## Audit log

Every arm fires an `event: 'armed'` record into `.frame/specs/<slug>/autopilot-events.jsonl` with `reason: 'phase=tasks_generated; auto_on_tasks=true'`. Surfaces in the Audit tab so it's clear *why* a run started without a click.

## Test status

All 51 pre-existing autopilot tests still pass; 6 new tests for the intent helpers also pass. Total: 57/57 green.

_Captured: 2026-06-22 · ~12 file changes + 1 new test file_
