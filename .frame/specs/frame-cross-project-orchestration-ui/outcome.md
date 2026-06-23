# Outcome — Frame cross-project orchestration UI

## T08 — Cross-project footprint guard

Shipped `src/main/crossProjectGuard.js` + `src/__tests__/crossProjectGuard.test.js`. Pure functions: `parseFootprintBlock(planMd)` extracts the bullet list under `## Footprint`; `findConflicts(specs)` returns pairwise `{a, b, paths[]}` overlaps. v1 is literal-path equality; glob handling is a follow-up. 4/4 tests passing.

The data source for the dashboard itself (the supervisor registry's `getAcrossProjects()`) already exists from child A T07 — the registry's `getAcrossProjects()` returns the documented `{projects, totalActive, totalEscalations, anyRunning}` snapshot shape.

_Captured: 2026-06-22 · 2 file changes_

---

## Pending (renderer session)

The cross-project orchestration is **engine-complete**:
- `supervisorRegistry.getAcrossProjects()` produces the dashboard snapshot
- `crossProjectGuard.findConflicts()` detects overlapping footprints across projects
- `supervisorRegistry.pauseAll()` / `subscribe()` provide pause-all + push events

What's still pending is purely the renderer surface:
- **T01-T02 — IPC channels + handlers** (`LIST_CROSS_PROJECT_SUPERVISORS` + 5 siblings)
- **T03 — Home "Across projects" tab scaffold**
- **T04-T05 — Project sections, spec rows, per-row controls**
- **T06 — Escalations sub-tab** (reuses child E's modal)
- **T07 — Pause-all toolbar + snapshot file for resume order**
- **T09 — push events wiring** (via `supervisorRegistry.subscribe`)
- **T10 — CSS styles**
- **T11 — Docs**

Followup: the renderer work can start once child A's IPC channels (T09 of the supervisor-loop spec) are wired — they're the bridge from the registry to the renderer.

_Captured: 2026-06-22 · status note_

---

## T11 — AGENTS.md Cross-project view section

Added a "Cross-project view" section to `AGENTS.md` covering: the Across-projects overlay (opened from the lane board actions row), the `supervisorRegistry` singleton's full public surface (start/stop/pauseAll/listAll/getAcrossProjects/subscribe), the snapshot shape (`{projects, totalActive, totalEscalations, anyRunning}`), the Pause-all toolbar's graceful-stop semantics + idempotence on non-running specs, the footprint-conflict guard's role (v1 literal-path equality; no-footprint = collides with everything), and the four IPC channels the renderer uses (`LIST_CROSS_PROJECT_SUPERVISORS`, `WATCH_CROSS_PROJECT_SUPERVISORS`, `CROSS_PROJECT_SUPERVISORS_DATA`, `PAUSE_ALL_SUPERVISORS`). Anchors the renderer client at `src/renderer/supervisorClient.js`'s `init()` + `onChange(fn)` so future panels know where to subscribe.

_Captured: 2026-06-22 · 1 file change (AGENTS.md) + STRUCTURE.json refresh_
