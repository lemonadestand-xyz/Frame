# Outcome — Frame project profiles + Basic Memory integration

## T01 — `src/main/profile.js` loader

Shipped `loadProfile`, `saveProfile`, `defaultProfile`, `validateProfile`, `watchProfile`. Default profile is permissive (no escalate categories, no cost ceiling, iteration_cap=3, a single `user` role with `*` authority). Loose validation produces warnings on unknown top-level / policy / budgets keys without failing. Files touched: `src/main/profile.js`.

Diverged from plan.md on the on-disk format: plan called for `.frame/profile.yaml` matching the supervisor's YAML, but Frame has no `js-yaml` dependency and adding one is a separate decision. Shipped `.frame/profile.json` with an identical schema. A YAML↔JSON converter for supervisor interop is a follow-up.

_Captured: 2026-06-22 · 1 file change_

---

## T02 — Tests for the profile loader

Shipped `src/__tests__/profile.test.js` covering: missing file → default, valid JSON parsed, malformed JSON → default + warning, loose unknown-field warnings, save round-trip, invalid-profile rejection, bad-route policy rule warning. 7/7 passing; full suite stayed green (71/71). Files touched: `src/__tests__/profile.test.js`.

_Captured: 2026-06-22 · 1 file change_

---

## T03 — Profile watcher

Already shipped as part of T01's `src/main/profile.js` (`watchProfile(projectPath, onChange)` with 250ms debounce matching `specManager.watchSpecs`). No additional code needed.

_Captured: 2026-06-22 · 0 file changes (already in T01)_

---

## T04 — Profile IPC channels (channels only; handlers deferred)

Added `LOAD_PROFILE` / `SAVE_PROFILE` / `WATCH_PROFILE` / `UNWATCH_PROFILE` / `PROFILE_DATA` to `src/shared/ipcChannels.js`. Handler registration in `src/main/index.js` is deferred to the integration session — the channels are declared so renderer code can import them, but the main-process router isn't wired yet. Files touched: `src/shared/ipcChannels.js`.

_Captured: 2026-06-22 · 1 file change · partial (handlers pending)_

---

## T06 — Basic Memory backend

Shipped `src/main/memory.js` with `BasicMemoryBackend` (search / write / list / read) plus exported helpers `tokenize`, `parseFrontmatter`, `serialiseFrontmatter`, `safeFilename`, `defaultRootDir`. On-disk layout matches `supervisor/memory.py` exactly — same directory `~/memory/<project>/{rules,decisions,context,transcripts}/`, same flat YAML-ish frontmatter, same 2× rules multiplier (`supervisor/memory.py:94-95`). Both Frame and the supervisor app can read each other's writes.

_Captured: 2026-06-22 · 1 file change_

---

## T07 — Memory tests

Shipped `src/__tests__/memory.test.js`: tokenize edge cases, frontmatter round-trip, write/read round-trip, missing-projectDir empty, spec_slug filter, unknown-category rejection, 2× rules multiplier rank ordering, empty-query empty result, top-K cap. 10/10 passing.

_Captured: 2026-06-22 · 1 file change_

---

## T10 — Memory mirror

Shipped `src/main/memoryMirror.js` + `src/__tests__/memoryMirror.test.js`. `recordDurableDecision(projectPath, payload)` is async and writes a `decisions/<slug>-<task>-<ts>.md` note when the category is in `DEFAULT_DURABLE_CATEGORIES` (dependency / schema / consistency / deployment / security / architecture). Profile-level override via `profile.memory_mirror.durable_categories`. The supervisor loop calls this on every ESCALATE-answered with a durable category (see `supervisorLoop.js` `_dispatch` ESCALATE branch). 6/6 tests covering durable filter, non-durable skip, payload validation.

_Captured: 2026-06-22 · 2 file changes_

---

## Pending (UI integration session)

- **T05 — Profile tab UI** (`src/renderer/profilePanel.js` + form/YAML editor)
- **T08 — Memory IPC channels** (handlers in `index.js`)
- **T09 — Memory tab UI on spec section**
- **T11 — Nudge banner** for missing profile.json
- **T12 — AGENTS.md "Profiles & Memory" section**

Followup: these are renderer + final-mile wiring; they don't unblock the supervisor engine, which runs end-to-end on the modules already shipped.

_Captured: 2026-06-22 · status note_

---

## T05 — Profile tab UI

Shipped `src/renderer/profilePanel.js` — inline editor with a structured form (id / policy.escalate_categories / policy.cost_ceiling_usd / budgets / capabilities / context_sources) side-by-side with the raw JSON textarea (stacks on narrow sidebars; alongside at ≥640px). Form blur re-projects values into the JSON; save uses the JSON as the source of truth so the user can edit fields the form doesn't surface. Exposed pure helpers (`profileToFormData`, `formDataToProfile`, `parseJsonSafely`, `shouldShowNudge`) tested under jest's node env in `src/__tests__/profilePanel.test.js`. CSS lives in `src/renderer/styles/components/profile.css`.

Per plan.md, added a real tab strip to `projectSection.js` (`.project-section-tabs` with *Workspace* + *Profile* buttons, role=tablist, ARIA-correct). The Workspace tab keeps the existing workspace list + Add button intact; the Profile tab swaps a sibling content container in via display toggling. `openProfile()` and `switchTab(name)` are exported so the command palette / focus commands can target tabs programmatically. The mount is invalidated on project switch and re-mounted lazily on the next tab activation so different projects don't share form state.

_Captured: 2026-06-22 · 3 file changes (profilePanel.js, projectSection.js, profile.css)_

---

## T09 — Memory tab on spec section

Shipped `src/renderer/memoryTab.js`, mounted as a new "Memory" tab next to *Audit* on the spec section. Defaults to notes whose `metadata.spec_slug` matches the current spec; a "Show all project notes" toggle expands to the full project memory.

A search box at the top routes the IPC fetch through `SEARCH_MEMORY` (keyword-scored top-25) when the query is non-empty, falling back to `LIST_MEMORY` when empty — both channels from the supervisorIPC bridge are exercised. Search results render a small score chip per row; the spec_slug filter still applies unless "Show all" is on so the user can scope queries.

Pure helpers (`filterNotes`, `renderHtml`) are tested in `src/__tests__/memoryTab.test.js` (11 tests) including HTML escaping for hostile note bodies, the search query summary, and the score chip render. CSS lives alongside the profile styles. Categories render with distinct chip colours (rules / decisions / context / transcripts).

_Captured: 2026-06-22 · 3 file changes (memoryTab.js, specSection.js, profile.css)_

---

## T11 — Profile nudge banner

When `.frame/profile.json` is absent on disk (the loader's new `fileExists: false` signal), the Profile tab renders an amber banner explaining the project is running under the permissive default, with a *Generate default* button that calls `SAVE_PROFILE` with the in-memory default profile already returned by `LOAD_PROFILE`. After save the banner disappears and the form populates with the just-written values.

Trigger condition uses `fileExists` rather than `source` so a file-on-disk-but-malformed scenario doesn't show the nudge (which would otherwise invite the user to overwrite their broken file). Instead the load warnings render in a separate "Warnings while loading profile" callout — the user should fix the file, not regen. `loadProfile` was extended in `src/main/profile.js` to return the new `fileExists` boolean alongside the existing `source / warnings`. Three new tests in `profile.test.js` (file missing / present-malformed / present-valid) lock in the contract; `shouldShowNudge` in `profilePanel.test.js` was updated accordingly.

_Captured: 2026-06-22 · 2 file changes (profile.js delta, profilePanel.js delta) + 2 test files updated_

---

## T12 — AGENTS.md Profiles & Memory section

Added a "Profiles & Memory" section to `AGENTS.md` covering: the profile location (`.frame/profile.json`, committed per repo) and full schema example, the loader's `{ profile, source, fileExists, warnings }` return contract and loose-validation policy, the LOAD/SAVE/WATCH/SEARCH/LIST IPC channel table, the Memory tab's read-only `metadata.spec_slug` filter + "Show all project notes" toggle, the BasicMemoryBackend on-disk layout under `~/memory/<projectId>/` mirroring `supervisor/memory.py`, the 2× rules multiplier rule, and the Profile nudge banner (fires on `fileExists: false`, never on malformed files — those route to a separate warnings callout).

Documented the YAML-vs-JSON divergence already noted in T01 (no js-yaml dep) so future contributors land on the same call.

_Captured: 2026-06-22 · 1 file change (AGENTS.md)_
