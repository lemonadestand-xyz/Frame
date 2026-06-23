# Autopilot

Autopilot drives `/spec.implement` repeatedly against a single spec until its
pending tasks are exhausted — the same prompt the **Implement Next Task** button
sends, just without a click between turns.

It runs entirely inside the Frame session. There is no daemon, no background
process, and no cross-project orchestration. Close Frame → autopilot stops.

## Enabling

1. Open the spec detail view.
2. Open or attach a Frame (terminal lane) for that spec — autopilot needs an
   existing lane to drive. The Implement Next Task button is the simplest way to
   create one if it doesn't exist yet.
3. Click the **Auto** button next to *Implement Next Task*.

The button flips to **Stop Auto** while a run is active. A pill in the spec
detail header shows the live state:

| Pill | Meaning |
| --- | --- |
| 🤖 Auto · N/M tasks done · turn K | Autopilot is running |
| ⏸ Auto-paused · `<reason>` · needs review | Loop paused; see *Failure recovery* |
| ⚠ Auto · `<reason>` | Loop failed (e.g. dispatch error); needs review |

## Caps

Defaults live in `src/main/autopilot.config.js`:

```json
{
  "max_turns_per_task":       3,
  "max_total_turns":         50,
  "budget_usd":            null,
  "pause_on_phase_transition": [],
  "stop_on_explicit_error": true
}
```

Override in any of three tiers (most specific wins):

1. **Spec** — `.frame/specs/<slug>/autopilot.json`
2. **Project** — `.frame/autopilot.json`
3. **Global** — Frame's `userSettings` key `autopilot.defaults`

### `budget_usd` — known gap

Frame currently exposes only Anthropic's session-window utilization
percentages (5-hour / 7-day) — there is no per-run USD signal we can sum to
enforce a real dollar cap. While that gap exists, setting `budget_usd` is
**advisory**: autopilot will log a warning and rely on `max_total_turns` as
the hard guardrail. The exit reason in that mode is `budget_proxy_turns`
instead of `max_total_turns`, so audit logs can tell them apart later.

## Failure recovery

If a turn lands without reducing the pending-task count, autopilot:

1. Increments the no-progress counter on that run.
2. On the next turn, appends a **diagnostic appendix** to the staged prompt
   file (not the canonical template) — text along the lines of
   *"your previous attempt did not land; identify why and try a different
   approach."*
3. Pauses with `pausedReason: max_turns_per_task` after the no-progress count
   exceeds `caps.max_turns_per_task` (default 3).

Explicit errors (dispatch failure, staging failure) are treated as `failed`
immediately — no retry.

Stop is **always graceful**: clicking *Stop Auto* sets a flag the loop reads
between turns. The in-flight turn always finishes; we never kill it mid-run.

## Audit log

Every transition writes a JSONL record to
`.frame/specs/<slug>/autopilot-events.jsonl` — open the **Audit** tab on the
spec to see the human view, or `tail -f` the file for a raw stream. Each entry
includes the run id, turn number, before/after pending counts, and the reason
the loop decided what it did.

## When NOT to use

- **Specs without `## Footprint` in `plan.md`.** Cross-spec autopilot (future
  work) uses the footprint guard from orchestration to schedule safely; the
  per-spec loop doesn't need it, but you'll want it before any project-scoped
  run.
- **Specs whose first task is ambiguous.** Autopilot doesn't ask clarifying
  questions for you — if the first task is "decide between X and Y", you'll
  spend the diagnostic budget producing no-progress turns. Land it manually
  first, then turn Auto on.
- **Cost-sensitive runs while the `budget_usd` gap is open.** Use
  `max_total_turns` (default 50) as the explicit ceiling instead.

## Files

| Path | Role |
| --- | --- |
| `src/main/autopilot.js` | Loop driver + IPC handlers |
| `src/main/autopilot.config.js` | Three-tier caps loader + DEFAULTS |
| `src/main/autopilot.signals.js` | `tasksJSONMtime` + `waitForLaneIdle` primitives |
| `src/renderer/autopilotClient.js` | Renderer-side state cache + IPC adapter |
| `src/renderer/autopilotToggle.js` | "Auto" button |
| `src/renderer/autopilotPill.js` | Status pill |
| `.frame/specs/<slug>/autopilot.json` | Optional spec-level cap override |
| `.frame/autopilot.json` | Optional project-level cap override |
| `.frame/specs/<slug>/autopilot-events.jsonl` | Append-only audit log |
