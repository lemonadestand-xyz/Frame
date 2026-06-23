# Plan — Frame ↔ Supervisor profile + memory bridge

## Architecture

### Shared bridge module — `src/main/supervisorProfileBridge.js`

Single source of truth for:

- `PROJECT_MAP` — the canonical `project_id → supervisor profile → workdir`
  rows. Used by the migration script *and* the on-the-fly fallback.
- `parseYaml(text)` — hand-rolled YAML parser sufficient for the supervisor
  profile shape (2-space indent, key:value mappings, list items including
  `- key: value` inline-mapping continuations + `[a, b]` / `{ a: b }` flow
  forms, comments stripped). No new dependencies.
- `translateSupervisorProfile(parsed, { projectId, name })` — maps the
  supervisor YAML shape onto Frame's ProjectProfile JSON. `allowed_tools`
  → `allowedTools` (camelCase). `worker.workdir` discarded. `id` set to
  the canonical `projectId` so role-specific variants (e.g.
  `localized-research.yaml`) collapse to `localized`.
- `translateSupervisorProfileForWorkdir(projectPath)` — convenience wrapper
  used by `profile.loadProfile`'s discovery fallback.

### Migration script — `scripts/migrate-supervisor-profile.js`

Iterates `PROJECT_MAP`. For each row:

1. Reads the supervisor YAML, translates it.
2. Merges with any existing `<workdir>/.frame/profile.json` (Frame fields
   win per top-level key; supervisor fills gaps).
3. Diff-checks and skips writes that would produce identical content.
4. Supports `--dry-run` and `-v / --verbose`.

### Memory namespace — `src/main/memory.js`

- `resolveProjectId(projectPath)`: reads `<projectPath>/.frame/profile.json`
  and prefers `project.memoryId`, then `id`, then `path.basename`. Emits a
  one-time INFO log per project so the user can confirm dir resolution.
- `BasicMemoryBackend({ projectPath })`: constructor now accepts a
  workdir; explicit `projectId` still wins (legacy / test paths).
- `bridgeLegacyHashDir({ rootDir, hashName, namedId })`: safe-by-construction
  helper that renames `hashName` → `namedId` and replaces the old path with
  a symlink. Refuses to bridge when both dirs are populated.

### Profile loader — `src/main/profile.js`

`loadProfile()` gains a discovery fallback:

```
1. .frame/profile.json exists  → load + return  (source: 'file')
2. supervisor YAML matches     → translate + return  (source: 'supervisor',
                                  supervisorAvailable: true, no disk write)
3. else                        → defaultProfile  (source: 'default')
```

New export `findSupervisorProfileForWorkdir(projectPath)` returns the
mapping row (without translating) when a canonical YAML matches — used
by the renderer's "supervisor profile found" banner.

### Renderer — `projectSection.js`, `profilePanel.js`, `memoryTab.js`

- `projectSection.js` gains a third tab: **Memory**. Mounts
  `memoryTab.mount(el, { projectPath, scope: 'project' })`.
- `memoryTab.mount` accepts a `scope: 'project' | 'spec'` option.
  `scope: 'project'` hides the "show all" toggle and skips the
  spec_slug filter.
- `profilePanel.mount` reads `loaded.supervisorAvailable` and renders a
  "Supervisor profile found — Migrate" banner that calls `SAVE_PROFILE`
  with the in-memory translated profile.

### Cross-cutting

- `src/main/memoryMirror.js`'s `deriveProjectId` now reads
  `profile.project.memoryId` first so durable decisions land in the
  canonical dir.
- `src/main/supervisorIPC.js`'s SEARCH/LIST handlers construct the
  backend with `projectPath` directly; the constructor handles
  resolution.

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
- src/__tests__/profile.test.js
- src/__tests__/memory.test.js
- src/__tests__/memoryTab.test.js
- src/__tests__/profilePanel.test.js
- scripts/migrate-supervisor-profile.js

---

## Dependencies

- Depends on the parity push's profile + memory engines already shipped
  (`frame-project-profiles-and-memory` spec).
- No new external deps; YAML parsing is hand-rolled inside
  `supervisorProfileBridge.js`.
