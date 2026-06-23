# Tasks — Frame cross-project orchestration UI

- T01 · Extend `src/main/supervisorRegistry.js` with `getAcrossProjects()` returning the documented snapshot shape; emit state-change events on every supervisor tick
- T02 · Add the 6 cross-project IPC channels (`LIST_CROSS_PROJECT_SUPERVISORS`, `WATCH_CROSS_PROJECT_SUPERVISORS`, `PAUSE_SPEC_SUPERVISOR`, `RESUME_SPEC_SUPERVISOR`, `PAUSE_ALL_SUPERVISORS`, `RESUME_ALL_SUPERVISORS`) to `src/shared/ipcChannels.js` and register handlers in `src/main/index.js`
- T03 · Add the "Across projects" tab to Home in `src/renderer/index.js` + tab nav in `src/renderer/laneBoard.js`; empty view container; confirm the existing lane-board still renders unchanged
- T04 · Implement `src/renderer/crossProjectBoard.js` rendering project sections (collapsible) + spec rows (slug, title, phase chip, route chip, confidence, last-tick-time, per-row controls)
- T05 · Wire per-row Pause / Resume controls and "Open in project" jump (uses existing project switcher IPC)
- T06 · Add an Escalations sub-tab aggregating `pendingEscalation` rows across all projects; reuse the escalation modal from child E for answering
- T07 · Implement Pause-all / Resume-all toolbar toggle with snapshot file `.frame/runtime/pause-snapshot.json` for restoring resume order
- T08 · Implement `src/main/crossProjectGuard.js` walking each open spec's plan.md `## Footprint` block to detect cross-project overlaps; surface yellow "FP conflict" chips in the renderer; tests in `src/__tests__/crossProjectGuard.test.js`
- T09 · Switch from snapshot-fetch + 10s poll to push events via `WATCH_CROSS_PROJECT_SUPERVISORS`; keep 30s poll as safety net
- T10 · Add `src/renderer/styles/components/cross-project-board.css` for project sections, route chip, FP-conflict chip, escalation row styling
- T11 · Update `STRUCTURE.json`, add a "Cross-project view" section to `AGENTS.md`, append `outcome.md` per Frame convention
