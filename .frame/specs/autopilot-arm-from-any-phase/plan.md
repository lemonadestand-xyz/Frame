# Plan — Autopilot arm-from-any-phase

## Architecture

### Two mechanics, one persistence file

The spec asks for two distinct affordances. They land on different
mechanics in code but share the same JSON file
(`.frame/specs/<slug>/autopilot.json`):

| Affordance | Mechanic | Persistence |
| --- | --- | --- |
| **Pre-arm during planning** | New `auto_on_tasks` field, watcher fires `startAutopilot` on phase transition | `autopilot.json.auto_on_tasks: true` |
| **Header-level mid-flight toggle** | Reuse `renderAutopilotToggle` in a second DOM location | None (already-existing run/stop lifecycle) |

Autopilot today has **no persistent `enabled` flag** — `startAutopilot`
creates an in-memory run, `stopAutopilot` ends it. So "mirror the toggle
in the header" is purely a render-it-twice change; it does not introduce
a new state machine. This is important: the working-stance answer in
spec.md §Open #1 (mirror, don't move) collapses to "render the same
component in `specSection.js`'s header in addition to the existing
Next-step card slot."

The pre-arm mechanic, by contrast, is genuinely new persistence and
needs a phase-transition watcher.

### `auto_on_tasks` shape

`.frame/specs/<slug>/autopilot.json` already exists as the spec-tier
caps file read by `autopilot.config.readCaps`. We add one optional
field:

```json
{
  "max_turns_per_task": 3,
  "auto_on_tasks": true
}
```

- Default `false` (absent = false).
- Only meaningful at the spec tier — there is no project-wide or global
  "pre-arm everything." Adding it at project tier would surprise users
  who created the project before the field existed.
- `readCaps` already merges the spec tier last, so the field flows
  through with no schema work; we just expose it via a thin getter for
  callers that don't want the whole caps blob.

### The arm trigger

`specManager.reconcilePhase` is the single function that promotes a
spec's phase (called from `writeSpecDoc`, `addSpecTask`,
`removeSpecTask`, and the fs.watch debounce). We hook the transition
to `tasks_generated`:

```js
// in reconcilePhase, after writeStatus on phase change
if (newPhase === 'tasks_generated' && status.phase !== 'tasks_generated') {
  const armed = autopilot.readAutoOnTasks(projectPath, slug);
  if (armed) emitArmRequest(projectPath, slug);
}
```

`emitArmRequest` is a thin wrapper that pushes IPC
`AUTOPILOT_ARM_REQUEST` to the renderer. **Main does not start the run
itself** because lane attachment lives in the renderer (the
`terminalAssignments` map managed by `laneBoard`/`agentDispatch`). The
renderer handler:

1. Looks up the terminalId attached to this slug.
2. If found → calls `autopilotClient.start({ projectPath, slug,
   scope: 'spec', terminalId })`.
3. If not found → leaves the spec in an "armed, waiting for lane"
   visual state (small chip next to the Auto toggle: "Auto on tasks ·
   no lane attached"). The chip is reactive: if the user later
   attaches a lane, `agentDispatch`'s assign hook re-checks
   `auto_on_tasks` and starts the run.

This split keeps autopilot.js free of lane plumbing and matches the
existing "main owns runs, renderer owns lane assignments" boundary.

### Stop clears auto_on_tasks (working stance §Open #2)

`stopAutopilot` is the natural place. After marking `stopRequested =
true`, also call `autopilot.writeAutoOnTasks(projectPath, slug, false)`
when the scope is `spec`. Stop means stop; the user can re-arm
afterwards. This avoids the surprise loop where a user hits Stop, the
spec stays at `tasks_generated`, and Frame silently re-arms.

### Renderer surfaces

Three touchpoints, all wired through the same `auto_on_tasks` value:

1. **New Spec modal** (`specPanel.js`) — checkbox below the
   description (per working stance §Open #3). State accumulates into a
   local `autoOnTasks` var, passed into `CREATE_SPEC`'s `opts`.
   `specManager.createSpec` writes `autopilot.json` only if the box
   was ticked (don't pollute the dir with a no-op JSON otherwise).
   Helper text: "Frame will run autopilot as soon as tasks are
   generated and a lane is attached."

2. **Next-step card** (`specSection.js`) — when the spec is at Spec /
   Plan / Tasks phase, the orange action card shows a small checkbox
   below the primary CTA: "Run autopilot once tasks are generated."
   Reactive: ticking calls `SET_AUTO_ON_TASKS`, the value persists
   immediately so a page reload preserves intent.

3. **Header-level Auto toggle** (`specSection.js`) — render
   `renderAutopilotToggle` in the spec header next to the title/slug,
   in addition to its existing slot. Same component, same handlers, no
   new state. CSS scopes the header instance to a smaller, chip-style
   variant so it doesn't dominate the header.

The Next-step card checkbox is the most discoverable for the
"plan-time intent" workflow; the header toggle is the discoverable
mid-flight escalator. Both writing to the same flag means a user who
ticked the modal sees the checkbox already on in the Next-step card,
and the header toggle reflects whether a run is live.

### What runtime prompts pick up

Nothing. Pre-arm is a renderer-driven start of the existing
`/spec.implement` loop; no template changes. The
`AUTOPILOT_ARM_REQUEST` IPC is a fire-and-forget push event.

### Failure modes + telemetry

- **Pre-armed but no lane ever attached.** Loop never fires; passive
  chip is the only signal. No timeout — user can attach whenever.
- **Pre-armed, lane attached, but tasks have zero pending.** The
  existing `_runSpecLoop` already handles this (`pending === 0 →
  status='done'`); no change.
- **Audit log.** Add a new `event: 'armed'` record to
  `.frame/specs/<slug>/autopilot-events.jsonl` when the arm fires, so
  users can see in the Audit tab *why* a run started without a click.

### What this spec deliberately does NOT touch

- `/spec.plan` and `/spec.tasks` autopilot — out of scope per spec.md.
- Project-scoped pre-arm — out of scope; only spec tier.
- `budget_usd` cost gates — unchanged.
- The graceful-stop contract — preserved (`stopRequested` flag,
  current-turn finishes).

---

## Files

**New**
- `src/__tests__/autopilot.intent.test.js` — unit tests for `readAutoOnTasks` / `writeAutoOnTasks` + the reconcilePhase arm hook
- `.frame/specs/autopilot-arm-from-any-phase/outcome.md` — appended during implementation per Frame convention

**Modified**
- `src/main/autopilot.config.js` — add `readAutoOnTasks(projectPath, slug)` + `writeAutoOnTasks(projectPath, slug, value)` helpers (additive; no caps shape change)
- `src/main/specManager.js` — accept `auto_on_tasks` in `createSpec` opts; in `reconcilePhase`, on transition to `tasks_generated`, emit ARM request when armed
- `src/main/autopilot.js` — emit `AUTOPILOT_ARM_REQUEST` IPC helper; in `stopAutopilot`, clear `auto_on_tasks` on spec-scope stop; append `event: 'armed'` to audit log when arm fires
- `src/main/index.js` — register `SET_AUTO_ON_TASKS` IPC handler
- `src/shared/ipcChannels.js` — add `SET_AUTO_ON_TASKS`, `AUTOPILOT_ARM_REQUEST`
- `src/renderer/autopilotClient.js` — subscribe to `AUTOPILOT_ARM_REQUEST`; resolve terminalId from lane state and call `start(...)` or surface the "no lane" chip
- `src/renderer/specPanel.js` — checkbox in New Spec modal; pass `auto_on_tasks` through `CREATE_SPEC` opts
- `src/renderer/specSection.js` — checkbox in Next-step card; render `renderAutopilotToggle` in spec header
- `src/renderer/styles/components/panels.css` — checkbox styling + header-variant Auto toggle (smaller chip form)

---

## Footprint

- src/__tests__/autopilot.intent.test.js
- src/main/autopilot.config.js
- src/main/specManager.js
- src/main/autopilot.js
- src/main/index.js
- src/shared/ipcChannels.js
- src/renderer/autopilotClient.js
- src/renderer/specPanel.js
- src/renderer/specSection.js
- src/renderer/styles/components/panels.css

---

## Dependencies

None. All wiring uses existing IPC infrastructure, `autopilot.config`'s
existing JSON read/write pattern, and the already-shipped
`renderAutopilotToggle` component.

---

## Sequencing

1. **Persistence helpers.** Add `readAutoOnTasks` + `writeAutoOnTasks`
   to `autopilot.config.js`. Unit tests cover the default-false path,
   round-trip read/write, merge-into-existing-caps preservation (don't
   clobber `max_turns_per_task` when toggling the flag), and graceful
   read of a malformed JSON file.

2. **IPC channels.** Add `SET_AUTO_ON_TASKS` and
   `AUTOPILOT_ARM_REQUEST` to `src/shared/ipcChannels.js`. Register the
   `SET_AUTO_ON_TASKS` handler in `index.js` (or `autopilot.js`'s
   `setupIPC`). Push-only channel for the ARM request — no return
   value needed.

3. **createSpec passthrough.** Extend `specManager.createSpec` opts to
   accept `auto_on_tasks: boolean`. When true, call
   `writeAutoOnTasks` after `writeStatus`. Don't write the JSON when
   the flag is absent or false — keeps the spec dir clean for users
   who never opt in.

4. **New Spec modal checkbox.** Add the labelled checkbox in
   `specPanel.js`'s modal markup, wire it into the submit handler,
   pass through to `CREATE_SPEC`. Verify the field round-trips by
   creating a test spec from the modal and reading `autopilot.json`.

5. **Next-step card checkbox.** In `specSection.js`, render a small
   checkbox in the orange Next-step card during Spec/Plan/Tasks
   phases. Wire `change` to call `SET_AUTO_ON_TASKS`. Initial state
   reads from `readAutoOnTasks`. Hide on `tasks_generated` and beyond
   (the flag is moot once tasks exist — the header Auto toggle takes
   over).

6. **Phase-transition arm hook.** In `specManager.reconcilePhase`,
   after the phase write, if `newPhase === 'tasks_generated'` and
   `readAutoOnTasks` returns true, call the new
   `autopilot.emitArmRequest(projectPath, slug)`. Verify with a
   scripted spec promotion that the IPC event fires.

7. **Renderer ARM consumer.** In `autopilotClient.js`, subscribe to
   `AUTOPILOT_ARM_REQUEST`. On receipt, look up the slug's attached
   terminalId via the existing lane-state accessor; if present, call
   `start({...})`. If absent, dispatch a custom event the
   `specSection.js` header listens to and shows a "Auto on tasks ·
   no lane attached" chip.

8. **Header-level Auto toggle mirror.** In `specSection.js`'s render,
   render `renderAutopilotToggle` into the header slot in addition to
   its current slot. Add a CSS class so the header variant renders as
   a compact chip. No new state — just a second mount of the same
   component bound to the same scope/slug.

9. **Stop clears auto_on_tasks.** In `autopilot.stopAutopilot`, when
   the scope is `spec`, call `writeAutoOnTasks(projectPath, slug,
   false)` after marking `stopRequested`. Add an audit `event:
   'armed'` record when the arm fires (per Architecture §Failure
   modes).

10. **Lane-attach re-check.** In `agentDispatch.js` (or whichever
    module finalises a lane → spec assignment), after assignment
    succeeds, re-read `readAutoOnTasks` and, if the spec is already
    at `tasks_generated`, fire the arm. This covers the
    "pre-armed → tasks generated → no lane → user attaches later"
    flow without needing a polling watcher.

11. **CSS polish.** Style the checkbox in the modal + Next-step card
    consistently with existing `spec-modal-field-*` classes. Add the
    header-variant Auto toggle styles in `panels.css`.

12. **Manual smoke test.** Walk through:
    (a) Create spec with checkbox ticked → write spec.md, plan.md,
        click Break into Tasks → autopilot starts immediately when a
        lane is attached.
    (b) Toggle the Next-step card checkbox on an existing
        `planned`-phase spec → advance to `tasks_generated` →
        autopilot starts.
    (c) Header toggle: from any phase, flip Auto on while tasks
        exist → run starts. Hit Stop → run ends, `auto_on_tasks`
        clears.
    (d) Pre-arm without lane → spec shows the "no lane" chip; attach a
        lane → run starts automatically.

13. **Outcome.** Append `outcome.md` per Frame convention.
