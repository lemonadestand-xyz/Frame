# Tasks — Frame ↔ Supervisor profile + memory bridge

- T01 · Add `scripts/migrate-supervisor-profile.js` + the shared
  `src/main/supervisorProfileBridge.js` (canonical mapping table,
  hand-rolled YAML parser, supervisor-YAML → Frame-JSON translator,
  shallow merge with existing Frame profile). Driver supports
  `--dry-run` and `-v / --verbose`. Tests in
  `src/__tests__/migrateSupervisorProfile.test.js` cover the parser, the
  translator, the idempotent merge, and the dry-run path.

- T02 · Memory namespace unification. `src/main/memory.js` exposes
  `resolveProjectId(projectPath)` (prefers `profile.project.memoryId`,
  then `profile.id`, then basename). `BasicMemoryBackend({ projectPath })`
  resolves the dir on construction. `bridgeLegacyHashDir` provides a
  safe-by-construction rename + symlink helper. `memoryMirror.deriveProjectId`
  reads `project.memoryId` first. `supervisorIPC` constructs the
  backend with `projectPath`. Tests extended in
  `src/__tests__/memory.test.js`.

- T03 · Project-level Profile + Memory tabs. `src/renderer/projectSection.js`
  adds a Memory tab alongside Profile. `memoryTab.mount` accepts
  `scope: 'project' | 'spec'`; project scope hides the "show all"
  toggle and skips the spec_slug filter. `profilePanel` renders a
  "Supervisor profile found — Migrate" banner when the loader returns
  `supervisorAvailable: true`. Tests extended in
  `src/__tests__/memoryTab.test.js` and `src/__tests__/profilePanel.test.js`.

- T04 · Cross-cutting discovery fallback. `profile.loadProfile()` falls
  back to the supervisor YAML on the fly when no `.frame/profile.json`
  exists (returns `source: 'supervisor'`, `supervisorAvailable: true`).
  `findSupervisorProfileForWorkdir` exported for the renderer banner.
  KNOWN_BUDGET_KEYS extended to recognise both Frame and supervisor
  budget naming. New tests in
  `src/__tests__/profileDiscoveryFallback.test.js`.
