# Outcome — Frame ↔ Supervisor profile + memory bridge

## T01 — Migration script + shared bridge module

Shipped `scripts/migrate-supervisor-profile.js` (driver) +
`src/main/supervisorProfileBridge.js` (shared YAML parser, canonical
`PROJECT_MAP`, translator, merger). Hand-rolled YAML parser covers the
supervisor profile shape: 2-space indent mappings, list items with
`- scalar` / `- { ... }` / `- key: value` inline-mapping continuations,
inline flow sequences `[a, b]` and mappings `{ a: b }`, comments
stripped (preserving `#` inside quoted strings).

Migration applied for real: 8 `.frame/profile.json` files written
(localized, kitli-kids, renovive-services, renovive-qa, cengage, mason,
supervisor-self, frame). Frame's own row uses the supervisor's
`frame-research.yaml` profile and collapses to canonical `project.id:
"frame"`. Idempotent — re-running prints "no-op" for all rows.
Dry-run mode (`--dry-run`) skips disk writes.

Tests: 14 new (`migrateSupervisorProfile.test.js`).

_Captured: 2026-06-22 · 3 file changes (script, bridge, tests)_

---

## T02 — Memory namespace unification

`resolveProjectId(projectPath)` reads `<projectPath>/.frame/profile.json`
and prefers `project.memoryId`, then `id`, then `path.basename`. Emits
a one-time INFO line per project so the user can confirm dir
resolution.

`BasicMemoryBackend({ projectPath })`: constructor now accepts a
workdir; explicit `projectId` still wins (legacy / test paths).
`memoryMirror.deriveProjectId` reads `project.memoryId` first.
`supervisorIPC`'s `SEARCH_MEMORY` / `LIST_MEMORY` handlers construct
the backend with `projectPath`.

`bridgeLegacyHashDir({ rootDir, hashName, namedId })` is safe by
construction: refuses to bridge when both dirs are populated; no-op
when the hash dir is already a symlink. Verified with 4 new tests.

`~/memory/frame-mirror-project-*` legacy dirs were NOT auto-bridged.
None of those hash dirs match a canonical project deterministically —
they came from older Frame builds with no projectPath→hash mapping.
The helper is available for explicit user invocation; new memory
writes land in the canonical named dir.

Tests: 11 new in `memory.test.js` (resolveProjectId × 4, constructor
× 2, bridgeLegacyHashDir × 4, existing tests untouched).

_Captured: 2026-06-22 · 4 file changes (memory.js, memoryMirror.js,
supervisorIPC.js, memory.test.js)_

---

## T03 — Project-level Profile + Memory tabs

`projectSection.js` gains a Memory tab alongside Profile +
Workspace. Mounts `memoryTab.mount(el, { projectPath, scope: 'project' })`.
The cached mount is invalidated on project change.

`memoryTab.mount` + `filterNotes` + `renderHtml` accept a
`scope: 'project' | 'spec'` option. `scope: 'project'` hides the
"show all" toggle (irrelevant — there's no spec to scope to) and
skips the `spec_slug` filter. The summary line gets a `(project)`
suffix so the view is identifiable.

`profilePanel.mount` reads `loaded.supervisorAvailable` and renders a
"Supervisor profile found — Migrate" banner when the discovery
fallback fired. The Migrate button calls `SAVE_PROFILE` with the
in-memory translated profile; the banner disappears on success.

Tests: 5 new in `memoryTab.test.js` (project-scope filter + 4 render
variants), 4 new in `profilePanel.test.js` (`shouldShowSupervisorBanner`
× 3, `renderSupervisorBannerHtml`).

_Captured: 2026-06-22 · 4 file changes (projectSection.js,
memoryTab.js, profilePanel.js, tests)_

---

## T04 — Discovery fallback in profile.js

`profile.loadProfile()` now falls back to the canonical supervisor
YAML when no `.frame/profile.json` exists. Returns
`source: 'supervisor', supervisorAvailable: true` so the renderer can
distinguish "use default" from "translated from supervisor". Does NOT
write to disk — that's the migration script's job.

`findSupervisorProfileForWorkdir(projectPath)` exported for the
renderer's "supervisor profile found" banner — returns the mapping row
(without translating) when a canonical YAML matches.

`KNOWN_BUDGET_KEYS` extended to recognise the supervisor's
`spend_ceiling_*` naming alongside Frame's `spend_per_*`, so migrated
profiles don't trigger "unknown budgets key" warnings on every load.

`project` added to `KNOWN_TOP_KEYS`.

Tests: 5 new in `profileDiscoveryFallback.test.js` (supervisor fallback
wins when only YAML exists; `.frame/profile.json` wins when both
exist; default returned when neither; `findSupervisorProfileForWorkdir`
both branches).

_Captured: 2026-06-22 · 2 file changes (profile.js, tests)_

---

## Validation

- `npx jest --silent`: 310/310 green (up from 271 baseline).
- `npm run build`: PASS (1.8mb renderer bundle).
- 7 `.frame/profile.json` files generated in real workdirs. Idempotent
  re-run = 7 no-ops.
- No new external deps (js-yaml is a transitive package — we did not
  add it as a direct dep; the bridge module hand-rolls its parser).

---

## Footprint

- src/main/supervisorProfileBridge.js
- src/main/profile.js
- src/main/memory.js
- src/main/memoryMirror.js
- src/main/supervisorIPC.js
- src/renderer/projectSection.js
- src/renderer/profilePanel.js
- src/renderer/memoryTab.js
- src/__tests__/migrateSupervisorProfile.test.js
- src/__tests__/profileDiscoveryFallback.test.js
- src/__tests__/memory.test.js
- src/__tests__/memoryTab.test.js
- src/__tests__/profilePanel.test.js
- scripts/migrate-supervisor-profile.js
