# Plan — Frame project profiles + Basic Memory integration

## Architecture

### `.frame/profile.yaml` schema

Mirrors `supervisor/types.py:193-210` `ProjectProfile`. Top-level keys:

```yaml
id: <string>                        # logical project id
worker: {auth, permission, workdir, model?}
context_sources: [<string>, ...]    # paths or "bm:<project>" refs
policy:
  escalate_categories: [<string>, ...]
  cost_ceiling_usd: <float|null>
  rules: [{category, route}, ...]   # route ∈ auto_answer|research|escalate
roles: [{name, authority: [...], channel, proactivity}, ...]
people: {<name>: <role>, ...}
capabilities: [<string>, ...]       # spec_reader, knowledge_search, web_research
budgets: {iteration_cap, spend_per_task_usd?, spend_per_day_usd?}
ledger: {kind, ...config}           # jira/trello/null
store: {kind}                       # local|mongo
```

### Loader module — `src/main/profile.js`

```js
loadProfile(projectPath) → {profile, source: 'file'|'default'}
saveProfile(projectPath, profile) → {success, error?}
defaultProfile(projectPath) → ProjectProfile  // deterministic empty
validateProfile(profile) → {valid, warnings[]}  // loose; warnings on unknown fields
watchProfile(projectPath, onChange) → unwatch  // fs.watch
```

Default profile is permissive: no escalate_categories, no cost ceiling, all rules auto_answer for naming/style/formatting, escalate for dependency/schema. This matches the user's existing run behaviour today.

### Memory backend — `src/main/memory.js`

Port of `supervisor/memory.py:60` `BasicMemoryBackend`. Same on-disk layout (`~/memory/<project>/{rules,decisions,context,transcripts}/*.md` with YAML frontmatter):

```js
class BasicMemoryBackend {
  constructor({rootDir, projectId}) {}
  async search(query, k = 5) → Note[]
  async write({category, title, body, metadata}) → Note
  async list({category, spec_slug?}) → Note[]
  async read(notePath) → Note
}
// Note: {path, title, category, metadata: {spec_slug, created_at, ...}, body, score?}
```

Keyword scoring with **2× multiplier on `rules/`** matches `supervisor/memory.py:94-95`. Tokenisation is conservative: split on whitespace, lowercase, drop tokens <3 chars, intersect with note title+body tokens.

### Mirror — `src/main/memoryMirror.js`

Mirrors `supervisor/store/memory_mirror.py:40-80`. Subscribes to escalation-answered events (from child E once it lands) and to AUTO_ANSWER events on durable categories (from child A). Writes a `decisions/<slug>-<task>-<ts>.md` note with:

```
---
category: dependency
spec_slug: <slug>
task_id: <id>
durable: true
created_at: <iso>
---
# <drafted question>

**Answer:** <answer>
**Reasoning:** <reasoning>
**Confidence:** <0..1>
```

For v1, the trigger surface is a `recordDurableDecision(projectPath, payload)` IPC handler the supervisor loop calls. No event-bus subscription yet.

### UI surfaces

- **Profile tab** — new tab in the project section (alongside Specs / Tasks). Renders a form-side editor + raw YAML side-by-side; save writes to `.frame/profile.yaml`.
- **Memory tab on spec section** — new tab next to *Audit*. Read-only list of notes filtered by `metadata.spec_slug`, with a toggle for "show all project notes."
- **Nudge banner** — first time the user opens a project without `.frame/profile.yaml`, a dismissable banner in the Profile tab suggests creating one with a "Generate default" button.

### IPC

```
LOAD_PROFILE          renderer → main
SAVE_PROFILE          renderer → main
WATCH_PROFILE         renderer → main (push on change)
SEARCH_MEMORY         renderer → main
LIST_MEMORY           renderer → main
RECORD_DURABLE_DECISION  main-internal (supervisor loop will call)
```

### Sharing memory with the supervisor app

`~/memory/<project>/` is the canonical directory. Both Frame and the supervisor app read and write there. Conflict resolution is filesystem-level (last-write-wins per file; git resolves if the directory is committed). No locking, no daemon.

The `project_id` is taken from `profile.yaml`'s `id` field (falling back to `path.basename(projectPath)`). This must match the id the supervisor app uses for the same project.

---

## Files

**New**
- `src/main/profile.js` — load/save/validate + watcher
- `src/main/memory.js` — `BasicMemoryBackend`
- `src/main/memoryMirror.js` — durable-decision mirror
- `src/__tests__/profile.test.js` — load + save + default + watch
- `src/__tests__/memory.test.js` — search ranking + 2× rules multiplier + write/read round-trip
- `src/__tests__/memoryMirror.test.js` — durable-only filter + frontmatter shape
- `src/renderer/profilePanel.js` — Profile tab (form + raw YAML)
- `src/renderer/memoryTab.js` — Memory tab on spec section
- `src/renderer/styles/components/profile.css` — Profile tab styling
- `.frame/specs/frame-project-profiles-and-memory/outcome.md` — appended on implementation

**Modified**
- `src/main/index.js` — register profile + memory IPC handlers
- `src/shared/ipcChannels.js` — add the 6 new channels
- `src/renderer/specSection.js` — add Memory tab + tab-switch handler
- `src/renderer/projectSection.js` — add Profile tab to project view
- `src/shared/frameConstants.js` — add `PROFILE_FILE` constant + `BASIC_MEMORY_ROOT` derivation
- `package.json` — confirm `js-yaml` is in deps (add if missing)
- `AGENTS.md` — "Profiles & Memory" section
- `STRUCTURE.json` — auto-updated on pre-commit

---

## Footprint

- src/main/profile.js
- src/main/memory.js
- src/main/memoryMirror.js
- src/__tests__/profile.test.js
- src/__tests__/memory.test.js
- src/__tests__/memoryMirror.test.js
- src/renderer/profilePanel.js
- src/renderer/memoryTab.js
- src/renderer/styles/components/profile.css
- src/main/index.js
- src/shared/ipcChannels.js
- src/renderer/specSection.js
- src/renderer/projectSection.js
- src/shared/frameConstants.js

---

## Dependencies

- `js-yaml` — already in dev deps (used by some scripts); promote to runtime deps if not already there.

No other new deps. Filesystem ops are stdlib. Frontmatter parsing is hand-rolled (the supervisor's `BasicMemoryBackend` does the same; format is `---\n<yaml>\n---\n<body>`).

---

## Sequencing

1. **Profile loader foundation.** `src/main/profile.js` with `loadProfile`, `saveProfile`, `defaultProfile`, `validateProfile`. Tests cover: missing file → default, malformed YAML → fallback to default + warning, valid YAML → parsed, unknown fields → loose pass with warning.
2. **Profile watcher.** Add `watchProfile` using `fs.watch` with a 250ms debounce; same pattern as `specManager.watchSpecs`. Test covers: write → callback fires once with new profile.
3. **Profile IPC + project-open wiring.** Register `LOAD_PROFILE` / `SAVE_PROFILE` / `WATCH_PROFILE` handlers; load profile on project open and stash on `state` for the renderer.
4. **Profile tab in project section.** New `src/renderer/profilePanel.js` rendering the YAML side-by-side with a form for the most-edited fields (policy / budgets / capabilities). Add to `projectSection.js` tab list. Test the round-trip: edit → save → reload → unchanged.
5. **Basic Memory backend.** `src/main/memory.js` with `BasicMemoryBackend` (search / write / list / read). Frontmatter parsing inline. Tests for: 2× rules multiplier, frontmatter round-trip, missing directory → empty results.
6. **Memory IPC.** `SEARCH_MEMORY` / `LIST_MEMORY` handlers.
7. **Memory tab on spec section.** `src/renderer/memoryTab.js` — list notes filtered by `metadata.spec_slug`, with toggle. Add tab button to `specSection.js`.
8. **Memory mirror.** `src/main/memoryMirror.js` exposing `recordDurableDecision(projectPath, payload)` that writes a `decisions/<slug>-<task>-<ts>.md` note. Tests: durable category writes, non-durable category skips.
9. **Defaults + nudge banner.** When a project has no `.frame/profile.yaml`, render a one-line banner in the Profile tab with "Generate default" → writes the default profile.
10. **Docs + outcome.** Update AGENTS.md "Profiles & Memory" section; append outcome.md.
