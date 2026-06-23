# Outcome — Frame capabilities registry

## T01 — Capability protocol

Shipped `src/main/capabilities/types.js` with the abstract `Capability` base class (`run()` throws `abstract` when not overridden) and the `Evidence` JSDoc shape (`source` / `summary` / `refs` / `score`). Static `timeoutMs` defaults to 2000 — concrete capabilities override per-class. Files touched: `src/main/capabilities/types.js`.

_Captured: 2026-06-22 · 1 file change_

---

## T02 — Registry + runAll

Shipped `src/main/capabilities/registry.js` with `buildRegistry(profile, deps)`, `runAll(registry, question, ctx, profile)`, `register(name, Ctor)`, `listRegistered()`. `runAll` runs in parallel with per-capability timeout via `_withTimeout`; timeouts and thrown errors are caught and returned as a single warning-shaped Evidence so the supervisor classifier's re-classification logic stays simple. Plug-in point `REGISTERED` is populated by the concrete capability modules at T03–T07.

Tests in `src/__tests__/capabilitiesRegistry.test.js`: empty profile → empty registry, unknown capability names ignored, parallel run flattens evidence, timeout → warning, error → warning. 6/6 in this file, 78/78 overall.

_Captured: 2026-06-22 · 2 file changes_

---

## T03 — SpecReader

Shipped `src/main/capabilities/specReader.js`. Reads every non-`bm:` entry in `profile.context_sources`, splits into paragraphs (`\n\n` separator), keyword-scores by token intersection, returns top-K with `refs: ["<path>:L<start>-L<end>"]`. Hard-coded Frame-meta skip list (tasks.json / STRUCTURE.json / PROJECT_NOTES.md / AGENTS.md / CLAUDE.md / GEMINI.md). Files >256 KB return a warning Evidence and are skipped.

_Captured: 2026-06-22 · 1 file change_

---

## T04 — SpecReader tests

`src/__tests__/specReader.test.js` covers: rank by score (highest first), empty question → empty, missing file → warning Evidence, Frame meta skip even when listed, top-K cap. 5/5 passing.

_Captured: 2026-06-22 · 1 file change_

---

## T05 — KnowledgeSearch

Shipped `src/main/capabilities/knowledgeSearch.js`. Requires `bm:<id>` in `profile.context_sources` (returns warning Evidence if missing). Calls `memory.search(question, 5)` and maps each Note to Evidence with `refs: [note.path]` and `score: note.score`. Memory backend injection through the constructor — supervisor passes the live `BasicMemoryBackend`, tests pass a `FakeMemoryBackend`.

_Captured: 2026-06-22 · 1 file change_

---

## T06 — KnowledgeSearch tests

`src/__tests__/knowledgeSearch.test.js`: no-bm-source warning, evidence shape, no-memory-wired warning. 3/3 passing.

_Captured: 2026-06-22 · 1 file change_

---

## T07 — WebResearch stub

Shipped `src/main/capabilities/webResearch.js`. Returns a single warning Evidence `web_research not implemented (stub)`. Placeholder for a future WebFetch / WebSearch integration. Registered as `web_research` in `src/main/capabilities/index.js`.

_Captured: 2026-06-22 · 1 file change · stub_

---

## Bootstrap module

`src/main/capabilities/index.js` registers all three capabilities (`spec_reader` / `knowledge_search` / `web_research`) with the registry on require. Supervisor loop calls `buildRegistry(profile, deps)` and gets back only the capabilities the profile lists.

_Captured: 2026-06-22 · 1 file change_

---

## Pending (integration session)

- **T08 — capabilities-registry test broadening** (already covered by T02 + T04 + T06)
- **T09 — capability-audit.jsonl emission** (currently the audit emit lives inline in supervisorLoop's `_emitAudit`; per-capability audit lines deferred)
- **T10 — AGENTS.md "Capabilities" section**

Followup: capability runs are visible in the supervisor's audit JSONL via the evidence list inside each tick's verdict; per-capability audit lines are a refinement.

_Captured: 2026-06-22 · status note_

---

## T08 — Broadened registry tests

Extended `src/__tests__/capabilitiesRegistry.test.js` with the three scenarios called out in the plan: **all-three-registered** (spec_reader + knowledge_search + web_research, asserts evidence is returned from every capability and flattens to the expected count), **timeout** (FastCap + SlowCap; the hung capability surfaces as a timeout-warning Evidence and the fast one still returns its real evidence), and **error** (FastCap + ErrorCap; the throwing cap is logged but the other still completes). The base 7 tests still pass — this is a strict extension. 7 → 16 tests in this file.

_Captured: 2026-06-22 · 1 file change (capabilitiesRegistry.test.js)_

---

## T09 — Per-capability audit JSONL

Wired per-capability audit emission inside `registry.runAll`: for every capability in the registry, the writer appends one line to `<projectPath>/.frame/runtime/capability-audit.jsonl` after the run resolves (or times out). Each line carries `{capability, question, evidenceCount, duration_ms, ts}`. The runtime directory is created with `mkdir -p` on first write. Project path is resolved from `ctx.projectPath` first, then any cap instance's `.projectPath` — when neither is set the write is a silent no-op so the supervisor loop never crashes on an audit-write fault.

Tests cover: per-capability line emission, append-vs-truncate across successive calls, the timeout path still emitting an audit row, mkdir-p on a tmpdir without any `.frame` directory, no-projectPath silent no-op, and ctx-omits-projectPath fallback to the cap instance. 7 → 16 tests in the file; full suite 231 → 240 green.

_Captured: 2026-06-22 · 2 file changes (registry.js, capabilitiesRegistry.test.js)_

---

## T10 — AGENTS.md Capabilities section

Added a "Capabilities" section to `AGENTS.md` covering: the `Capability` abstract contract, the registry surface (`buildRegistry` / `runAll`), the three default capabilities (`spec_reader`, `knowledge_search`, `web_research`) with their engine-file anchors and brief behaviour, a step-by-step "Adding a new capability" recipe mirroring the Workers section's style, and the audit JSONL location with line shape. Documents the silent-no-op resolve-projectPath behaviour so future contributors don't get confused by missing audit rows in unit tests.

_Captured: 2026-06-22 · 1 file change (AGENTS.md) + STRUCTURE.json refresh_
