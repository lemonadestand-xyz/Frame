# Plan — Autopilot runner

## Architecture

### Reuse map (what already exists)

- `src/main/specManager.js:760` — `BUILD_SPEC_COMMAND_FILE` IPC handler:
  `buildSpecCommandFile({ projectPath, slug, command })` writes the runtime prompt
  file and returns `{ promptPath, readInstruction }`. Autopilot calls this on every
  loop turn — same path the manual button takes.
- `src/main/specManager.js:120-124` — `writeStatus(projectPath, slug, patch)`.
- `src/main/specManager.js:212` — `reconcilePhase(projectPath, slug)`. Autopilot
  calls this after every turn so phase flips happen automatically.
- `src/main/orchestrationManager.js:634-653` — exports `findFootprintConflict`
  (used for cross-spec scheduling), `assignSpecs`, `getState`, `rehydrate`.
- `src/renderer/agentDispatch.js:293-343` — `dispatchSpecCommand({ projectPath,
  slug, command })`. The renderer-side primitive that actually opens / continues a
  lane. Autopilot needs the *main-process* equivalent (see below) because the loop
  driver lives in main.
- `src/renderer/specSection.js:210` — where the "Implement Next Task" button lives.
  We add the "Auto" toggle here.
- `src/shared/ipcChannels.js` — existing IPC channel registry. New autopilot
  channels go here.
- `tasks.json` at project root — autopilot reads this to count pending tasks per
  spec (filtered by `source === "spec:<slug>:T<n>"`).

### The autopilot module

New main-process module `src/main/autopilot.js`:

```
src/main/autopilot.js
  startAutopilot({ projectPath, scope, slug?, caps? }) -> { runId }
  stopAutopilot({ projectPath, runId }) -> void
  getAutopilotState(projectPath) -> { activeRuns: [{runId, scope, slug, phase, ...}] }
  // internal:
  _runSpecLoop(run, caps)          — per-spec turn loop
  _runProjectLoop(run, caps)       — cross-spec scheduling loop
  _executeTurn(run)                — one BUILD + dispatch + wait-for-idle cycle
  _readPendingCount(projectPath, slug)
  _readCaps(projectPath, slug)     — spec → project → global merge
  _writeDiagnosticAppendix(run, lastTurnDiag) — adds the retry hint to the prompt file
```

State held in module-scope `Map<projectPath, AutopilotRun[]>`. One run per project
when scope=`project`; one run per spec when scope=`spec`. Up to N concurrent
runs per project (cross-spec parallelism — bounded by footprint guard).

### Turn-completion signal

This is the design's load-bearing question. Two options the plan-phase agent should
pick between based on what's actually wired in the codebase:

**Option A — tasks.json mtime watch.** Autopilot dispatches a turn, then watches
`<projectPath>/tasks.json` for an mtime change AND the lane terminal going idle
(same idle signal `orchestrationManager.pollStatuses` at line 451 already derives).
Pros: zero new contract with the agent. Cons: relies on `spec.implement.md`
template's existing "mark task completed by editing tasks.json" instruction
landing reliably.

**Option B — turn-completion sentinel file.** Modify the runtime prompt to also
write `.frame/runtime/autopilot/<runId>/turn-<n>.done` at the end of a turn.
Watch for that file. Pros: explicit; debuggable. Cons: requires modifying the
prompt template OR injecting an appendix every turn.

**Recommended: Option A first.** It's reuse-only and matches how the human user
already evaluates "did the turn land?" If it proves unreliable, escalate to Option
B in a follow-up spec — don't bake it into the canonical template up-front.

### Cross-spec scheduler

```js
async function _runProjectLoop(run, caps) {
  while (!run.stopRequested) {
    const specs = await listProjectSpecs(run.projectPath)
      .filter(s => ['tasks_generated', 'implementing'].includes(s.phase))
      .filter(s => pendingCount(s) > 0)
      .filter(s => s.slug !== currentlyRunning(run.projectPath))

    if (!specs.length) {
      if (anyRunning(run.projectPath)) { await waitForAnyToFinish(); continue }
      break  // project done
    }

    const next = specs.find(s => !orchestration.findFootprintConflict(
      run.projectPath, s.slug, currentlyRunningSlugs(run.projectPath)
    ))
    if (!next) { await waitForAnyToFinish(); continue }

    spawnSubRun({ scope: 'spec', slug: next.slug, caps })
  }
}
```

`findFootprintConflict` is the existing code-enforced guard; we call it
read-only. Specs without a `## Footprint` block are treated as conflicting with
*everything* (safe default), so users must declare footprints to get parallelism.

### Failure-recovery policy

```js
async function _executeTurn(run) {
  const beforePending = readPendingCount(run.projectPath, run.slug)
  const promptPath = buildSpecCommandFile({
    projectPath: run.projectPath, slug: run.slug, command: 'spec.implement'
  })

  // Inject diagnostic appendix on retries
  if (run.consecutiveNoProgress > 0) {
    appendDiagnosticToPrompt(promptPath, run.lastTurnDiag)
  }

  await dispatchAndWait(run)  // returns when lane idle + tasks.json stable

  const afterPending = readPendingCount(run.projectPath, run.slug)
  if (afterPending < beforePending) {
    run.consecutiveNoProgress = 0
    reconcilePhase(run.projectPath, run.slug)
    return 'progress'
  }

  run.consecutiveNoProgress += 1
  run.lastTurnDiag = `Pending count was ${beforePending}, still ${afterPending}`

  if (run.consecutiveNoProgress > caps.max_turns_per_task) {
    return 'escalate'  // pause loop, notify user
  }
  return 'retry'
}
```

The "diagnostic appendix" is plain text appended to the runtime prompt file (NOT
to the template). It tells the agent: "your last attempt didn't reduce the pending
count — re-read the task, identify why, propose a different approach." This is the
"try a different approach" guardrail from the user's clarification.

### Budget gate

If `caps.budget_usd` is set, autopilot consults the lane's reported cost (Frame
already tracks Claude usage — `tasks.json` was M'd in initial gitStatus because of
that subsystem). Before dispatching each turn, sum the project's spend since the
run started; if `>= budget_usd`, stop the loop and surface `⏸ Budget reached`.

**Where the cost number comes from is plan-time follow-up.** If Frame doesn't
already expose a per-run spend signal in the main process, this gate degrades to a
turn-count proxy (`max_total_turns`). Don't fabricate a cost source.

### UI surface

**Renderer changes (minimal):**

- `src/renderer/specSection.js` — add `<button>` next to "Implement Next Task" with
  data-attr `data-action="toggle-autopilot"`. Click → IPC
  `AUTOPILOT_START`/`AUTOPILOT_STOP` with `{scope: 'spec', slug}`.
- New tiny module `src/renderer/autopilotPill.js` — renders the
  `🤖 Auto · N/M · turn K` pill in the existing spec card header. Subscribes to
  `AUTOPILOT_STATE` IPC events.
- `src/renderer/projectHome.js` (or equivalent — locate at plan time) — add the
  project-scoped Autopilot toggle.

**IPC channels (new in `src/shared/ipcChannels.js`):**
- `AUTOPILOT_START` (renderer → main)
- `AUTOPILOT_STOP` (renderer → main)
- `AUTOPILOT_STATE` (main → renderer, broadcast)
- `AUTOPILOT_GET` (renderer → main, request current state)

### Configuration loading

```js
function _readCaps(projectPath, slug) {
  const specCaps = readJSONSafe(`${projectPath}/.frame/specs/${slug}/autopilot.json`)
  const projCaps = readJSONSafe(`${projectPath}/.frame/autopilot.json`)
  const globalCaps = settings.get('autopilot.defaults', DEFAULTS)
  return { ...DEFAULTS, ...globalCaps, ...projCaps, ...specCaps }
}

const DEFAULTS = {
  max_turns_per_task: 3,
  max_total_turns: 50,
  budget_usd: null,
  pause_on_phase_transition: [],
  stop_on_explicit_error: true,
}
```

Settings store: reuse Frame's existing settings module (locate at plan time —
likely `src/main/settingsManager.js` or similar).

### Persistence + crash recovery

`Map<projectPath, AutopilotRun[]>` is in-memory only. If Frame crashes mid-loop,
autopilot does NOT auto-resume — the user must explicitly restart. (Safer default;
auto-resume is a follow-up.) The persistence model matches `orchestrationManager`'s
existing `rehydrate()` so we don't introduce a new pattern.

---

## Files

**New**
- `src/main/autopilot.js` — the driver module
- `src/main/autopilot.config.js` — caps loader + DEFAULTS export
- `src/main/autopilot.signals.js` — turn-completion detection (tasks.json watch + lane-idle)
- `src/renderer/autopilotPill.js` — the spec-card pill
- `src/renderer/autopilotToggle.js` — the shared toggle button component
- `src/__tests__/autopilot.test.js` — unit + integration coverage per success criteria §8
- `.frame/specs/autopilot-runner/outcome.md` (appended per Frame convention)

**Modified**
- `src/main/specManager.js` — export `readPendingCount(projectPath, slug)` helper (split out from existing internal logic) so autopilot can reuse without forking task-parsing rules
- `src/main/orchestrationManager.js` — export `findFootprintConflict` if it isn't already on the public surface (it's referenced in line 634-653 — verify before duplicating)
- `src/shared/ipcChannels.js` — add `AUTOPILOT_*` channels
- `src/renderer/specSection.js` — add "Auto" toggle next to "Implement Next Task" button
- `src/renderer/projectHome.js` (or actual file — locate at plan time) — add project-scoped Autopilot toggle
- `src/preload/index.js` (or actual preload) — expose `AUTOPILOT_*` IPC bridges
- `docs/AUTOPILOT.md` (new) — short user-facing doc: how to enable, what caps mean, recovery behavior

---

## Footprint

- src/main/autopilot.js
- src/main/autopilot.config.js
- src/main/autopilot.signals.js
- src/main/specManager.js
- src/main/orchestrationManager.js
- src/shared/ipcChannels.js
- src/preload/index.js
- src/renderer/autopilotPill.js
- src/renderer/autopilotToggle.js
- src/renderer/specSection.js
- src/renderer/projectHome.js
- src/__tests__/autopilot.test.js
- docs/AUTOPILOT.md
- .frame/specs/autopilot-runner/outcome.md

(Frame meta files `tasks.json`, `STRUCTURE.json`, `PROJECT_NOTES.md`, `AGENTS.md` are explicitly excluded from footprint per Frame convention.)

---

## Dependencies

- No new npm dependencies. Reuses Electron IPC, `fs.watch` (or `chokidar` if Frame
  already uses it — confirm before adding), and the existing `BUILD_SPEC_COMMAND_FILE`
  + `dispatchSpecCommand` plumbing.
- **Hard dependency on `orchestrationManager.findFootprintConflict` being callable
  read-only.** Verify it doesn't mutate state when called outside a real dispatch.
  If it does, refactor a pure helper out of it (`canDispatch(slugs[]) -> conflicts[]`)
  as part of T03.
- **Soft dependency on Frame's cost-tracking subsystem.** If it doesn't expose a
  per-run spend number, the budget cap degrades to a turn-count proxy and the
  follow-up note in `outcome.md` flags the gap.

---

## Sequencing

1. **Config loader + types.** `src/main/autopilot.config.js` + the run/caps types.
   Pure, no I/O beyond `readJSONSafe`. Unit tests for the three-tier merge order.

2. **Pending-task reader + phase reconciler reuse.** Extract `readPendingCount` from
   `specManager.js` (if it isn't already there) and ensure `reconcilePhase` is callable
   from autopilot without side effects beyond the target spec.

3. **Footprint-conflict pure helper.** Verify `findFootprintConflict` is safe to call
   read-only from autopilot. If not, refactor a pure helper out as the smallest
   possible change to `orchestrationManager.js`.

4. **Turn-completion signal.** `src/main/autopilot.signals.js` — Option A first
   (tasks.json mtime + lane idle). Unit-test against fixtures simulating a turn that
   reduces pending count and a turn that doesn't.

5. **Per-spec loop.** `_runSpecLoop` + `_executeTurn` in `autopilot.js`. Wire to
   `BUILD_SPEC_COMMAND_FILE` and the dispatch primitive. Unit tests cover happy-path
   loop, no-progress retry with diagnostic appendix, escalate-after-retries pause.

6. **IPC channels + state broadcast.** Add `AUTOPILOT_*` to `ipcChannels.js` and
   handlers in `autopilot.js`. Preload bridge. Renderer can now ask main to
   start/stop and subscribe to state.

7. **Spec-card UI.** "Auto" toggle in `specSection.js` + `autopilotPill.js`. Manual
   smoke-test: spec with 3 tasks runs to completion without clicks.

8. **Cross-spec loop.** `_runProjectLoop` consuming `findFootprintConflict`. Project-
   home toggle. Smoke-test: 3 specs (2 overlapping, 1 independent) sequence
   correctly with the independent one running in parallel.

9. **Budget gate.** Wire to whatever cost signal Frame exposes. If none, ship the
   turn-count proxy and add the gap to `outcome.md`. Add a clear inline TODO in
   `autopilot.js` so the gap is discoverable in code.

10. **Docs + outcome.** `docs/AUTOPILOT.md` (≤1 page: enable, caps, recovery
    behavior, when NOT to use it). Append `outcome.md` per Frame convention. Run
    full Jest suite for regression — `specManager`, `orchestrationManager`, and lane
    dispatch tests must all still pass.
