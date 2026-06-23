# Frame cross-project orchestration UI — aggregated supervisor dashboard

> **What we're building:** The aggregated dashboard the user asked for — one Frame view listing every project + every spec + every supervisor's current verdict, with per-project filter and per-spec drilldown. Powers cross-project orchestration: one Frame UI driving multiple parallel projects through their supervisor loops. Child D of `frame-parity-with-supervisor`; depends on A (`frame-supervisor-loop` cross-project mode).

---

## Background

Supervisor reference today **does not aggregate across projects** — it's a single-project run loop. The cross-project view we need is the Frame-side equivalent of what `supervisor-as-the-intake-funnel-cross-project-or` is building in the supervisor PWA (`SUPERVISOR_REPO/.frame/specs/cross-project-dashboard/`). The difference: the supervisor PWA's dashboard is a *Frame project status* aggregator (shows what each project's specs are doing). Frame's cross-project UI is an *active orchestration surface* — the user can drive any project's loop from one screen.

Both surfaces co-exist. The supervisor PWA is the read-only roll-up across all Frame-projects from the supervisor app's vantage. Frame's cross-project tab is the *interactive* layer where the user can pause / answer escalations / re-prioritise specs across any project they have open.

User vision: *"we should have an aggregated dashboard that allows full orchestration within Frame UI."*

---

## Problem

1. **No single surface to see every running supervisor.** Today the user has to switch between Frame projects to see what's running where.
2. **No cross-project pause / resume.** The user can't say "pause everything across all projects" without flipping each Auto toggle by hand.
3. **No cross-project escalation queue.** If three projects each have an escalation, the user has to bounce between them. The supervisor's `MobileApiAdapter` (`supervisor/adapters/mobile_api.py:24-44`) does this in the supervisor PWA; Frame needs the same.
4. **No cross-project footprint visibility.** Two projects could be working specs that touch shared infrastructure; without a cross-project view there's no place to see that.

---

## Goal

### 1. New "Across projects" tab in Home

Top-level tab in the Home view (alongside the existing lane-board). Layout:

```
┌────────────────────────────────────────────────────────────┐
│  ACROSS PROJECTS                  [Filter ▾] [Refresh] [⏸ Pause all]│
├────────────────────────────────────────────────────────────┤
│  ▼ Frame (8 specs · 3 active · 1 escalation)               │
│    🟢 frame-supervisor-loop     implement T03 · 75%        │
│    🔴 we-should-be-able-to-…    escalate · "stagingId?"   │
│    ⚪ frame-parity-with-…        idle                       │
│    …                                                        │
│  ▼ Localized (5 specs · 1 active)                          │
│    🟢 add-csv-export            implement T02 · 30%        │
│    …                                                        │
│  ▶ Kitli Kids (12 specs · 0 active)                        │
└────────────────────────────────────────────────────────────┘
```

One section per Frame-project the user has open. Each section: collapsible, shows specs in supervisor-mode with their current verdict, progress, and any pending escalation.

### 2. Per-row controls

Each spec row exposes:
- **Pause / resume** the supervisor for this spec
- **Open in project** — jump to that project's spec section
- **Answer escalation** — inline expand if the spec is paused with a drafted question; same modal as child E will introduce in the spec section

### 3. Cross-project escalation queue

A second sub-tab: **Escalations**. Lists every paused spec across all projects ordered by `pausedAt` desc. Click → expand drafted question + answer field. Same backing store as per-spec escalations (just filtered globally).

### 4. Cross-project footprint conflicts

The supervisor loop's footprint guard (child A's hard-policy fast path) already prevents two specs in the same project from running on overlapping files. The cross-project UI also surfaces conflicts *between* projects — if Frame is touching `~/some-shared-dir/` and Localized is touching the same path (via a profile's external `context_sources`), the row gets a yellow chip. v1: warn only; v2: block.

### 5. "Pause all" / "Resume all"

Single toggle in the toolbar pauses every supervisor across every project. Graceful stop applies (AUTOPILOT.md rule 1). Useful when the user steps away or wants to inspect state before a big run.

### 6. Data source

This UI reads from `supervisorRegistry.getAcrossProjects()` — a Frame-process-level map of `{ projectPath → { slug → supervisorState } }`. The registry is fed by every supervisor instance (one per Auto'd spec across all open projects). New IPC channels:
- `LIST_CROSS_PROJECT_SUPERVISORS` (renderer → main)
- `PAUSE_CROSS_PROJECT_SUPERVISOR` / `RESUME_CROSS_PROJECT_SUPERVISOR`
- `WATCH_CROSS_PROJECT_SUPERVISORS` (push events on state change)

---

## Non-goals

- **No project discovery.** This UI only aggregates projects the user has explicitly opened in Frame. Auto-discovery of all Frame-projects on disk is out of scope.
- **No project-level supervisor.** This is a *view* over per-spec supervisors; there's no "project supervisor" entity. The pause-all is a fan-out, not a wrapping loop.
- **No write-through to the supervisor app.** Frame's cross-project UI does not push state to the autonomous supervisor's PWA. They remain independent views over the same on-disk state.
- **No notifications channel changes.** Push notifications on cross-project events are handled by child E (`frame-escalation-adapters`).
- **No analytics roll-ups.** v1 shows current state, not historical aggregates. Velocity charts etc. are follow-ups.

---

## Constraints

- **Single-process aggregation.** All supervisors run in one Frame main-process instance. Cross-process aggregation across Frame windows is not v1.
- **No backend daemon.** The supervisor registry lives in-memory of the main process; persisted state is the union of each spec's existing `autopilot-events.jsonl` + `supervisor-audit.jsonl` (when child A lands).
- **Footprint scan is best-effort.** Cross-project footprint conflicts use the `## Footprint` declared in each spec's plan.md. Profile-driven external paths are out of v1 scope.
- **No new auth / permissions.** All projects the user has open in Frame are equally accessible; no role-based gating in v1.

---

## Open questions

1. **What's the right anchor for "this project"?** Frame's project-id today is the workspace path. *Working stance:* use profile `id` if present, else `path.basename(projectPath)`.
2. **Refresh cadence.** Poll vs push? *Working stance:* push — supervisor instances `emit('state-change')` and the registry rebroadcasts. Poll fallback every 30s for safety.
3. **What happens on a project the user closes?** *Working stance:* drop from the registry; in-flight supervisors gracefully stop at the next tick. Re-opening the project resumes from disk state (status.json + tasks.json).
4. **Should the dashboard show projects the user has open but with no supervisor running?** *Working stance:* yes, collapsed by default — useful to see "all my projects" without expanding everything.
5. **Pause-all semantics.** Does it pause *only* supervisor-mode runs or also legacy autopilot? *Working stance:* both. The toolbar reads "Pause all autonomy" and pauses every loop.
6. **Cross-project view for the supervisor app.** Should the supervisor PWA call Frame's `LIST_CROSS_PROJECT_SUPERVISORS` over MCP? *Working stance:* not in v1. Two independent views over the same files is acceptable.

---

## Success criteria

1. With three Frame-projects open and one supervisor running in each, the "Across projects" tab shows all three with their current state.
2. Pausing a single spec from the cross-project tab gracefully halts that spec's supervisor without touching others.
3. An escalation fired in any project shows up in the Escalations sub-tab within 1s.
4. The "Pause all" toggle pauses every supervisor (gracefully) and "Resume all" restarts them in the order they were paused.
5. Closing a project removes it from the dashboard within 1s; reopening restores its state.
6. The cross-project footprint chip surfaces a yellow warning when two projects' specs declare overlapping paths.
