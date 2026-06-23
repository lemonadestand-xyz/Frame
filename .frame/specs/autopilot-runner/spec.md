# Autopilot runner — drive a spec (or a project's specs) to completion without manual clicks

> **What we're building:** A code-driven loop inside Frame that takes over the role
> currently played by the human clicking "Implement Next Task" — repeatedly invoking
> `/spec.implement` on a single spec until its tasks are exhausted, then (optionally)
> auto-advancing to the next parallel-safe spec in the project. Same prompt the user
> would have triggered; same lane the user would have watched. Just no click between
> turns.

---

## Background — what this builds on

Frame already ships every primitive this feature needs:

- `src/main/specManager.js:760` — `BUILD_SPEC_COMMAND_FILE` IPC writes
  `.frame/runtime/prompts/<slug>__spec.implement.md` and returns a short
  read-instruction; this is the exact mechanism the "Implement Next Task" button uses.
- `src/renderer/agentDispatch.js:293-343` — `dispatchSpecCommand()` opens or continues
  a lane in the current project tab.
- `src/main/specManager.js:120-124` — `writeStatus()` updates `.frame/specs/<slug>/status.json`.
- `src/main/specManager.js:212` — `reconcilePhase()` auto-advances
  `draft → specified → planned → tasks_generated`; task statuses drive
  `implementing → done`.
- `src/main/orchestrationManager.js:634-653` — exports `assignSpecs`, `mergeWorker`,
  and the **footprint conflict guard** that already refuses to dispatch a spec whose
  declared footprint overlaps an in-flight spec. We piggyback on this for "next
  parallel-safe spec" selection.

What's **missing**: a driver in the main process that ticks the loop. Today the
conductor is itself a Claude lane reading `CONDUCTOR.md` — autonomy by prompt, not
by code. The user reports this as the friction point: clicking "Implement Next Task"
ten times for a ten-task spec.

The reference implementation lives in the user's supervisor app:
`autonomous-supervisor/supervisor/scripts/self-build/queue_runner.py` — a fully
autonomous loop with parallelism caps, `depends_on` enforcement, and budget
ceilings via `supervisor/types.py:Budgets.spend_ceiling_task_usd` /
`_day_usd`. We borrow the *shape* (loop + bounded retries + budget gate), not the
code (Python in a Python repo doesn't port).

---

## Problem

1. **Manual clicking is the bottleneck.** A spec with 10 well-defined tasks shouldn't
   need 10 user clicks to ship. The spec already answers "what's next?" — Frame just
   doesn't act on that answer.
2. **No graceful failure handling between turns.** Today if a `/spec.implement` turn
   ends inconclusively (task still pending, or an error in the agent's output), the
   user has to notice, diagnose, and re-prompt. There's no policy that says "the last
   attempt didn't land — try a different approach before halting."
3. **No way to chain specs.** Even when a spec is done, the user has to manually
   navigate to the next one and click again. Cross-spec autonomy exists only as the
   `CONDUCTOR.md`-driven Claude lane in `orchestrationManager`, which is heavyweight
   and not what most users reach for.
4. **No budget guardrail.** Nothing prevents an autonomous loop from spending unboundedly
   if the user steps away. The supervisor solved this with `spend_ceiling_task_usd`
   and `spend_ceiling_day_usd`; Frame has no equivalent.

---

## Goal

### 1. Per-spec autopilot loop

A new main-process module (`src/main/autopilot.js`) exposes
`startAutopilot({ projectPath, scope: 'spec', slug, caps })`. When started, it:

1. Calls `BUILD_SPEC_COMMAND_FILE` for `spec.implement` on the target spec
2. Waits for the lane to finish a turn (signal TBD in plan.md — likely lane terminal
   idle + tasks.json mtime change)
3. Reads tasks.json to count pending tasks for the spec
4. If pending count decreased → continue loop
5. If pending count is 0 → stop (success), call `reconcilePhase` to flip phase to `done`
6. If pending count unchanged → enter failure-recovery (see §3 below)

### 2. Cross-spec autopilot loop

`startAutopilot({ projectPath, scope: 'project', caps })`. After a spec completes:

1. Read all `.frame/specs/*/status.json` in the project
2. Filter to specs with `phase ∈ {tasks_generated, implementing}` and pending tasks > 0
3. For each candidate, call `orchestrationManager.findFootprintConflict()` against
   currently-running specs
4. Pick the first conflict-free spec → start a per-spec autopilot loop for it
5. If no candidate is conflict-free → wait for a running spec to finish, then re-check
6. If no candidates remain → stop, surface "project autopilot complete"

The conflict guard is reused unmodified — autopilot is a **client** of
`orchestrationManager`, not a replacement.

### 3. Failure recovery without halting

When a `spec.implement` turn ends with no progress (pending count unchanged):

1. **Retry with diagnostic prompt** — invoke `spec.implement` again with an extra
   appendix in the runtime prompt: "Your previous attempt did not change the
   pending-task count. Re-read the task you tried, identify why it didn't land, and
   propose a different approach. Do not retry the same approach."
2. **Bounded** — at most 2 such retries per task before the loop pauses for human input
   (mirrors `supervisor/loop.py:_handle_decision`'s escalate-after-retries pattern).
3. **Distinct from outright errors** — if the lane terminates with a non-zero exit
   or the agent reports an explicit blocker, that's a single escalate (no retry),
   surfaced via a Frame notification.

### 4. Configurable caps at spec / project / global tiers

Read in this order, first hit wins:

1. **Spec-level**: `.frame/specs/<slug>/autopilot.json` (or `autopilot:` block in
   `plan.md` frontmatter — plan.md choice deferred to plan-time)
2. **Project-level**: `.frame/autopilot.json`
3. **Global**: Frame's settings store under `autopilot.defaults`

Shape (all fields optional, sensible defaults):
```json
{
  "max_turns_per_task": 3,
  "max_total_turns": 50,
  "budget_usd": null,
  "pause_on_phase_transition": ["tasks_generated→implementing"],
  "stop_on_explicit_error": true
}
```

`budget_usd: null` means "no budget cap" (current default behaviour — explicit opt-in
to caps so we don't break trust).

### 5. UI surface (minimal)

- **Spec Implement panel:** add an "Auto" toggle next to "Implement Next Task". Toggle
  ON → start spec-scoped autopilot for THIS spec; toggle OFF → stop the loop after
  the current turn finishes (never mid-turn — that's a hard rule).
- **Project home / sidebar:** add an "Autopilot" toggle scoped to the whole project.
  Same on/off semantics.
- **Status pill on the spec card:** while autopilot is running, show
  `🤖 Auto · N/M tasks done · turn K` in the existing spec card header.

No new full-screen views, no settings dialog redesign. Reuse existing components.

---

## Non-goals

- **No cross-project autopilot.** That's the supervisor app's job per the
  `supervisor-as-the-intake-funnel-cross-project-or` meta-spec. Autopilot is single-
  project only.
- **No daemon mode.** Autopilot runs while Frame is open, in the user's session. If
  Frame closes, autopilot stops. (Background daemon is a follow-up if needed.)
- **No model selection or routing.** Autopilot uses whatever lane the user already
  configured. Switching to a cheaper model for cost reasons is a separate spec.
- **No spec drafting.** Autopilot only drives `/spec.implement`. The earlier lifecycle
  steps (`/spec`, `/spec.plan`, `/spec.tasks`) still require human kickoff. (Phase
  transitions WITHIN implementation — e.g., `tasks_generated → implementing` — are
  driven automatically; phase transitions UPSTREAM of implementation are out of scope.)
- **No replacement of `orchestrationManager`'s conductor.** Autopilot coexists; the
  conductor remains available for users who want the lane-based orchestration UX.
- **No edits to `spec.implement.md` template.** The diagnostic-retry appendix is
  added at runtime by autopilot when writing the prompt file; the canonical template
  stays clean.

---

## Success criteria

1. Starting spec-scoped autopilot on a freshly-generated spec with N pending tasks
   results in all N tasks ending `completed` with no user clicks between turns.
2. Failure-recovery: artificially fail one task (mock the agent to no-op once);
   autopilot detects the no-progress turn, re-prompts with the diagnostic appendix,
   and the next turn lands the task. Total: 2 turns instead of 1, zero human input.
3. After 2 failed diagnostic retries on the same task, autopilot pauses and surfaces
   a clear notification + the spec card pill flips to `⏸ Auto-paused · needs review`.
4. Cross-spec: project-scoped autopilot on a project with 3 specs (2 with overlapping
   footprints, 1 independent) runs the independent spec in parallel with one of the
   other two, then runs the remaining one after one of the parallel specs finishes.
5. Budget cap of $5 set at spec level stops the loop cleanly when reached, leaving
   the spec in a consistent state (no half-edited files, no orphan lock).
6. Autopilot stop is graceful — the in-flight turn always completes before the loop
   exits; tasks.json is never left in a torn state.
7. The "Implement Next Task" button still works exactly as it does today when
   autopilot is OFF (zero regression to the manual flow).
8. Jest covers: per-spec happy-path loop, no-progress retry, post-retry escalate,
   cross-spec footprint-aware selection, budget cap, graceful stop.
