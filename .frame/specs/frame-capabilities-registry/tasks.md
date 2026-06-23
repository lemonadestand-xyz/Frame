# Tasks — Frame capabilities registry

- T01 · Create `src/main/capabilities/types.js` exporting the abstract `Capability` base class (with `name`, `timeoutMs`, `run()`)
- T02 · Create `src/main/capabilities/registry.js` exporting `buildRegistry(profile, deps)` and `runAll(registry, question, ctx, profile)` with per-cap timeout + error fallback to a warning-shaped Evidence
- T03 · Implement `src/main/capabilities/specReader.js` (paragraph split + keyword score + top-K + Frame-meta skip list + 256 KB cap)
- T04 · Add `src/__tests__/specReader.test.js` covering ranking order, top-K cap, missing source file → empty, meta-file skip, oversized file warning
- T05 · Implement `src/main/capabilities/knowledgeSearch.js` consuming a `memory` dep with the same surface as child B's `BasicMemoryBackend`
- T06 · Add `src/__tests__/knowledgeSearch.test.js` against a `FakeMemoryBackend` covering the bm-source-required guard, evidence shape, top-K
- T07 · Implement `src/main/capabilities/webResearch.js` (stub returning a single warning Evidence)
- T08 · Add `src/__tests__/capabilitiesRegistry.test.js` exercising `buildRegistry` (empty / single / all-three) + `runAll` with one timing-out capability and one erroring one
- T09 · Wire audit-event emission to `.frame/runtime/capability-audit.jsonl` per capability run (one line, JSONL shape `{capability, question, evidenceCount, duration_ms, ts}`)
- T10 · Update `STRUCTURE.json`, add a "Capabilities" section to `AGENTS.md`, append `outcome.md`
