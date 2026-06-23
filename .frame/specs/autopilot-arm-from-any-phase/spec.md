# Autopilot arm-from-any-phase

## Problem

Today the **Auto** toggle is rendered inline next to *Implement Next Task*
in `specSection.js` — it only becomes reachable once the spec is at
`tasks_generated`/`implementing` *and* a lane is attached. So a user who
already knows "this spec should run on autopilot end-to-end" has no way
to express that intent during the Spec or Plan phase, and no way to
mid-flight escalate to autopilot from a phase where the toggle isn't
rendered.

Real example: `we-should-be-able-to-modify-specs-add-to-tasks-e` was
intended to run on autopilot from the moment tasks were generated.
There was no UI affordance to say "queue autopilot" while the spec was
still at `planned`, so the only path was: click *Break into Tasks* →
wait → flip Auto. Easy to miss; not what was promised.

## Scope

Cover **both moments** users want to enable autopilot:

1. **Pre-arm during planning.** A "Run on autopilot once tasks are ready"
   checkbox surfaced on:
   - The **New Spec** modal (`specPanel.js`)
   - The orange **Next step** card visible during Spec / Plan / Tasks
     phases (`specSection.js`)

   Persists as `auto_on_tasks: true` in
   `.frame/specs/<slug>/autopilot.json`. Idles until
   `phase === 'tasks_generated'` AND a lane is attached, then triggers
   the existing autopilot loop.

2. **Header-level Auto toggle visible from any phase.** Mirror (or
   move) the *Auto* button into the always-visible spec header next
   to the title/slug — same toggle, same persistence (`enabled: true`
   in `autopilot.json`). Reachable while the spec is at any phase so
   the user can escalate to autopilot at any moment after a task
   lands.

Both flags write to the same `autopilot.json`. The autopilot loop is
already idempotent — extending its trigger condition is the only
behavioural change needed in `autopilot.js`.

## Out of scope

- Autopilot for `/spec.plan` or `/spec.tasks` phase transitions —
  remains manual per `docs/AUTOPILOT.md` design (audit log + caps
  are per-task).
- Project Autopilot UI changes — the project-scoped toggle already
  exists at the lane-board level. Pre-arm semantics could be added
  to it later, but that's a separate spec.
- Cost-budget UI surfacing — `budget_usd` stays advisory.

## Constraints

- `autopilot.json` shape is already public (read by `autopilot.js`,
  `autopilot.config.js`); add the `auto_on_tasks` field additively,
  default `false`, do not break existing files.
- "Graceful stop" rule (AUTOPILOT.md rule 1) still applies — pre-arm
  cannot bypass the graceful-stop contract.
- Pre-armed autopilot still requires a lane attached. If the user pre-
  arms but never attaches a lane, the loop never fires; surface that
  state as a passive hint ("Auto on tasks · no lane attached") rather
  than auto-attaching, since lane choice is the user's call.

## Open questions

1. **Header toggle: move or mirror?** Moving the *Auto* button to the
   header simplifies the mental model but breaks muscle memory for
   users who currently flip it next to *Implement Next Task*.
   Mirroring (two affordances, same state) is safer but adds visual
   noise. **Working stance:** mirror; deprecate the inline one in a
   later pass if it proves redundant.

2. **Should `auto_on_tasks` survive Stop?** When the user gracefully
   stops a running autopilot, should the pre-arm flag remain `true`
   (so the next dispatch resumes) or clear (so Stop means stop)?
   **Working stance:** clear — Stop is Stop; user can re-arm.

3. **New Spec modal placement.** Checkbox below the description, or
   in a small footer row next to Cancel/Create? **Working stance:**
   below description, with helper text "Frame will run autopilot
   as soon as tasks are generated and a lane is attached."

## Related

- `we-should-be-able-to-modify-specs-add-to-tasks-e` — the spec that
  surfaced this gap.
- `autopilot-runner` (done) — implemented the project-scoped Auto;
  this spec extends the spec-scoped affordance surface only.
- `docs/AUTOPILOT.md` — the contract this spec respects.
