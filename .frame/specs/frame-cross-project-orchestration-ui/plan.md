# Plan — Frame cross-project orchestration UI

## Architecture

### Data source

The supervisor registry from child A (`src/main/supervisorRegistry.js`)
already aggregates `{projectPath → {slug → supervisorState}}` across every
project the user has open. This UI reads from there via a new IPC channel:

```
LIST_CROSS_PROJECT_SUPERVISORS  renderer → main → snapshot
WATCH_CROSS_PROJECT_SUPERVISORS  renderer → main → push events
PAUSE_SPEC_SUPERVISOR  renderer → main → graceful stop one
RESUME_SPEC_SUPERVISOR
PAUSE_ALL_SUPERVISORS
RESUME_ALL_SUPERVISORS
```

State shape pushed to the renderer:

```js
{
  projects: [
    {
      projectId: 'frame',
      projectPath: '/Users/.../Frame',
      label: 'Frame',
      activeCount: 3,
      escalationCount: 1,
      specs: [
        { slug, title, phase, route, confidence, lastTickAt,
          undoneCount, doneCount, pendingEscalation? }
      ]
    },
    ...
  ],
  totalActive: 5, totalEscalations: 1, anyRunning: true
}
```

### New view — `src/renderer/crossProjectBoard.js`

Top-level Home tab "Across projects" (alongside the existing lane-board).
Layout matches the ASCII sketch in spec.md §1. Components:

- **Toolbar** — filter dropdown (per-project), refresh button, "Pause all" / "Resume all" toggle, total counts chip
- **Project sections** — one collapsible section per project, headed by `<projectLabel> (N specs · M active · K escalations)`
- **Spec rows** — slug + title + phase chip + route chip + confidence + last-tick-time + per-row controls (Pause / Open in project / Answer escalation)
- **Escalations sub-tab** — flat list across projects ordered by `pausedAt desc`; click expands the same answer UI as the spec section's escalation modal

### Home-tab integration

`src/renderer/index.js` (or wherever the Home nav lives) gets a new
"Across projects" tab. The lane-board stays as the first tab.

### Cross-project footprint warnings

Best-effort: when the registry detects two specs (in different projects)
whose plan.md `## Footprint` declares overlapping paths, the affected spec
rows get a yellow chip "FP conflict: <other project> / <other slug>".
v1 warn only.

### Pause-all semantics

"Pause all" iterates the registry and calls `pauseSpec(slug, projectPath)`
on every running supervisor. Graceful stop — current turn finishes, next
tick doesn't fire. Resume restores in the order they were paused (saved in
a small `.frame/runtime/pause-snapshot.json`).

### IPC + watcher

The supervisor registry already emits state-change events (child A T07);
this UI subscribes via `WATCH_CROSS_PROJECT_SUPERVISORS`. Polling
fallback at 30s.

### Styling

Reuse the existing lane-board card styles. New CSS file
`src/renderer/styles/components/cross-project-board.css` for project
sections, the route chip, the FP-conflict warning chip.

---

## Files

**New**
- `src/renderer/crossProjectBoard.js`
- `src/renderer/styles/components/cross-project-board.css`
- `src/main/crossProjectGuard.js` — best-effort cross-project footprint conflict detector
- `src/__tests__/crossProjectGuard.test.js`
- `.frame/specs/frame-cross-project-orchestration-ui/outcome.md`

**Modified**
- `src/main/supervisorRegistry.js` — expose `LIST_CROSS_PROJECT_SUPERVISORS` + push events
- `src/shared/ipcChannels.js` — add the 6 cross-project channels above
- `src/main/index.js` — register the cross-project IPC handlers
- `src/renderer/index.js` — mount the Across-projects tab into Home
- `src/renderer/laneBoard.js` — accommodate the new tab sibling (tab nav widget)
- `STRUCTURE.json`, `AGENTS.md`

---

## Footprint

- src/renderer/crossProjectBoard.js
- src/renderer/styles/components/cross-project-board.css
- src/main/crossProjectGuard.js
- src/__tests__/crossProjectGuard.test.js
- src/main/supervisorRegistry.js
- src/shared/ipcChannels.js
- src/main/index.js
- src/renderer/index.js
- src/renderer/laneBoard.js

---

## Dependencies

- Child A (`frame-supervisor-loop`) — supervisor registry must exist + emit state-change events.
- Child E (`frame-escalation-adapters`) — escalation answer flow reused for the cross-project escalations sub-tab.

No new external deps.

---

## Sequencing

1. **Registry surface.** Extend `supervisorRegistry.js` with `getAcrossProjects()` returning the snapshot shape. Push state-change events on tick boundaries.
2. **IPC channels.** Register the 6 new channels in `index.js` + `ipcChannels.js`.
3. **Home tab scaffold.** Add the "Across projects" tab to Home; empty view; confirm the lane-board still renders unchanged.
4. **Project sections + spec rows.** Fetch snapshot on mount; render projects → specs. Click "Open in project" jumps to that project's spec section.
5. **Per-row controls.** Wire Pause / Resume on a single spec.
6. **Escalations sub-tab.** Aggregate `pendingEscalation` across all spec rows; render in order; reuse the escalation modal from child E for answering.
7. **Pause-all / Resume-all toggle.** Implement the snapshot file for resume-order recovery.
8. **Cross-project footprint guard.** `crossProjectGuard.js` walks all open specs' `## Footprint` blocks and surfaces yellow chips on overlapping rows.
9. **Live push.** Switch from snapshot+poll to push events via `WATCH_CROSS_PROJECT_SUPERVISORS`; keep 30s poll as safety net.
10. **Styling polish.** Cross-project-board CSS; chip styles; collapsible section interactions.
11. **Docs + outcome.** AGENTS.md "Cross-project view" section; append outcome.md.
