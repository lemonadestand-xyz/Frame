# Plan — Frame capabilities registry

## Architecture

### Capability protocol — `src/main/capabilities/types.js`

```js
class Capability {
  static name = '';                  // e.g. 'spec_reader'
  static timeoutMs = 2000;           // safety cap per run
  /**
   * @returns {Promise<Evidence[]>}
   */
  async run({ question, context, profile }) {
    throw new Error('abstract');
  }
}

// Evidence:
// { source: string, summary: string, refs: string[], score: number }
```

### Registry — `src/main/capabilities/registry.js`

```js
function buildRegistry(profile, deps) {
  const enabled = profile?.capabilities || [];
  const reg = {};
  if (enabled.includes('spec_reader'))
    reg.spec_reader = new SpecReader({projectPath: deps.projectPath});
  if (enabled.includes('knowledge_search'))
    reg.knowledge_search = new KnowledgeSearch({memory: deps.memory});
  if (enabled.includes('web_research'))
    reg.web_research = new WebResearch();
  return reg;
}

async function runAll(registry, question, ctx, profile) {
  const caps = Object.values(registry);
  // run in parallel with per-cap timeout; collect Evidence[]
  const all = await Promise.all(caps.map((c) =>
    _withTimeout(c.run({question, context: ctx, profile}), c.constructor.timeoutMs)
      .catch((err) => [{source: c.constructor.name, summary: `timeout/error: ${err.message}`, refs: [], score: 0}])
  ));
  return all.flat();
}
```

The supervisor loop (child A) calls `runAll` after a RESEARCH verdict
and re-invokes the classifier with the accumulated Evidence.

### `SpecReader` — `src/main/capabilities/specReader.js`

- Reads every non-`bm:` entry in `profile.context_sources` as a markdown file
- Splits each file into paragraphs (`\n\n` separator)
- For each paragraph: lowercase tokens ≥3 chars; intersect with question tokens; score = intersection size; bonus if the file's first H1 matches a question token
- Returns top-K paragraphs (default K=5) as Evidence with `refs: ["<path>:L<start>-L<end>"]`
- Hard-coded skip list for Frame meta files (tasks.json / STRUCTURE.json / PROJECT_NOTES.md / AGENTS.md / CLAUDE.md) so the capability doesn't drown in housekeeping content
- Files larger than 256 KB are skipped (silently, with a warning Evidence)

### `KnowledgeSearch` — `src/main/capabilities/knowledgeSearch.js`

- Requires a `memory` dep (the `BasicMemoryBackend` from child B)
- Calls `memory.search(question, k=5)`; maps each Note to Evidence with `refs: ["<note.path>"]` and `score: note.score`
- If `bm:<id>` is missing from `profile.context_sources`, the capability returns empty Evidence with a `summary: 'knowledge_search disabled — add bm:<id> to context_sources'`

### `WebResearch` stub — `src/main/capabilities/webResearch.js`

- Returns `[{source: 'web_research', summary: 'web_research not implemented (stub)', refs: [], score: 0}]`
- Reserved for a future WebFetch / WebSearch integration

### Audit emission

Each capability emits a single audit event `capability_ran` with
`{capability, question, evidenceCount, duration_ms}`. The supervisor's
audit log (child A's `supervisor-audit.jsonl`) consumes these. v1
writes them to a per-project `.frame/runtime/capability-audit.jsonl`
until A integrates.

---

## Files

**New**
- `src/main/capabilities/types.js`
- `src/main/capabilities/registry.js`
- `src/main/capabilities/specReader.js`
- `src/main/capabilities/knowledgeSearch.js`
- `src/main/capabilities/webResearch.js`
- `src/__tests__/specReader.test.js`
- `src/__tests__/knowledgeSearch.test.js`
- `src/__tests__/capabilitiesRegistry.test.js`
- `.frame/specs/frame-capabilities-registry/outcome.md`

**Modified**
- `STRUCTURE.json` — auto-updated
- `AGENTS.md` — "Capabilities" section (how to register a new one)

---

## Footprint

- src/main/capabilities/types.js
- src/main/capabilities/registry.js
- src/main/capabilities/specReader.js
- src/main/capabilities/knowledgeSearch.js
- src/main/capabilities/webResearch.js
- src/__tests__/specReader.test.js
- src/__tests__/knowledgeSearch.test.js
- src/__tests__/capabilitiesRegistry.test.js

---

## Dependencies

None new. Builds on `BasicMemoryBackend` from child B (frame-project-profiles-and-memory).

---

## Sequencing

1. **Protocol + registry shell.** `types.js` + `registry.js` with no concrete capabilities. `buildRegistry` returns `{}` if profile has no capabilities; `runAll` handles empty registry.
2. **SpecReader.** Implement + test the keyword-scoring + top-K + skip list + paragraph splitting.
3. **KnowledgeSearch.** Implement + test against a `FakeMemoryBackend` (mirrors child B's `BasicMemoryBackend` contract).
4. **WebResearch stub.** Trivial. Confirms the registry handles a no-op capability.
5. **Audit emission.** Each capability writes one line to `capability-audit.jsonl` per run with the standard shape.
6. **Timeout + error handling.** `_withTimeout` helper; per-cap try/catch returns a synthetic warning Evidence instead of throwing.
7. **Docs + outcome.** AGENTS.md "Capabilities" section; append outcome.md.
