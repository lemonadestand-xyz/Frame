# Tasks — Frame project profiles + Basic Memory integration

- T01 · Create `src/main/profile.js` with `loadProfile`, `saveProfile`, `defaultProfile`, `validateProfile` (loose validation with warnings); export `PROFILE_FILE` constant via `frameConstants.js`
- T02 · Add `src/__tests__/profile.test.js` covering missing file → default, malformed YAML → default + warning, valid YAML → parsed, unknown fields → loose pass with warning, save round-trip
- T03 · Add `watchProfile(projectPath, onChange)` to `src/main/profile.js` using `fs.watch` with 250ms debounce (match `specManager.watchSpecs` pattern); test that write triggers callback exactly once
- T04 · Add `LOAD_PROFILE` / `SAVE_PROFILE` / `WATCH_PROFILE` IPC channels to `src/shared/ipcChannels.js` and register handlers in `src/main/index.js`; load profile on project open and push to renderer state
- T05 · Add `src/renderer/profilePanel.js` rendering the Profile tab (form for policy/budgets/capabilities + raw YAML side-by-side); add to `projectSection.js` tab list with the appropriate switch handler
- T06 · Create `src/main/memory.js` `BasicMemoryBackend` (search/write/list/read) with frontmatter parsing inline, keyword scoring with 2× rules multiplier matching `supervisor/memory.py:94-95`
- T07 · Add `src/__tests__/memory.test.js` covering the 2× rules multiplier, frontmatter YAML round-trip, missing directory → empty results, top-K cap
- T08 · Add `SEARCH_MEMORY` / `LIST_MEMORY` IPC channels and handlers; expose `BASIC_MEMORY_ROOT` derivation (defaults to `~/memory/`) via `frameConstants.js`
- T09 · Add `src/renderer/memoryTab.js` rendering the Memory tab on the spec section (read-only list filtered by `metadata.spec_slug` with "show all project notes" toggle); wire into `specSection.js`
- T10 · Create `src/main/memoryMirror.js` exposing `recordDurableDecision(projectPath, payload)`; add tests in `src/__tests__/memoryMirror.test.js` for durable-only filter and frontmatter shape
- T11 · Add a one-line nudge banner in the Profile tab when `.frame/profile.yaml` is missing, with a "Generate default" button that writes the default profile
- T12 · Update `AGENTS.md` with a "Profiles & Memory" section explaining the YAML schema, the BM directory layout, and the durable-mirror trigger; append `outcome.md` per Frame convention
