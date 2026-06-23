# Frame capabilities registry — SpecReader, KnowledgeSearch, WebResearch

> **What we're building:** Frame's port of the supervisor's capability registry — the layer the LLM classifier consults when its initial verdict is RESEARCH (gather more evidence, then re-classify). Ships three capabilities: `SpecReader` (read profile's `context_sources`), `KnowledgeSearch` (Basic Memory lookup), and a `WebResearch` stub. Child C of `frame-parity-with-supervisor`; depends on B (`frame-project-profiles-and-memory`).

---

## Background

Supervisor reference:
- **Registry** built in `supervisor/capabilities.py:155-176` from the active profile's `capabilities` list.
- **`SpecReader`** at `supervisor/capabilities.py:37-107` — keyword-scores paragraphs from profile's `context_sources` markdown files, returns top-K as `Evidence(source, summary, refs)`.
- **`WebResearch`** at `supervisor/capabilities.py:110-120` — stub today; PR-3.5 will wire to worker's WebFetch/WebSearch.
- **`KnowledgeSearch`** at `supervisor/capabilities.py:123-152` — backed by `MemoryBackend.search()`, returns prior decisions / rules as Evidence.
- **`DemoCodebaseSearch`** at `supervisor/capabilities.py:24-34` — canned response for demos; not ported.
- **Run after RESEARCH verdict** at `supervisor/loop.py:148-157` — iterate over enabled caps, append evidence, re-classify.

---

## Problem

Frame's autopilot has no notion of "research before acting." The classifier (when child A lands) needs a way to:
- Read related specs / docs the user declared in `context_sources`
- Pull prior decisions from Basic Memory before re-deciding
- (Future) fetch web content when a spec references external URLs

Without this, every classifier call reasons from spec.md alone. Repeat decisions don't carry forward. Cross-spec context is invisible.

---

## Goal

### 1. Capability protocol

```js
// src/main/capabilities/types.js
class Capability {
  static name = '';
  async run({ question, context, profile }) {
    // returns Evidence[]
  }
}

// Evidence shape:
// { source: 'spec_reader' | 'knowledge_search' | 'web_research',
//   summary: string, refs: string[], score: 0..1 }
```

### 2. `SpecReader` (`src/main/capabilities/specReader.js`)

- Loads every file referenced in `profile.context_sources` that isn't a `bm:` prefix
- Splits each markdown file into paragraphs
- Keyword-scores against the question; returns top-K (K=5 default) with the source file path + line range as `refs`
- Pure I/O + ranking; no LLM call

### 3. `KnowledgeSearch` (`src/main/capabilities/knowledgeSearch.js`)

- Reads from the `BasicMemoryBackend` ported in child B
- Searches the project's memory (decisions / rules / context / transcripts) with the same 2x rules multiplier
- Returns top-K notes as Evidence with `refs` = the markdown file paths
- Requires `bm:<project_id>` to be in `profile.context_sources` to activate

### 4. `WebResearch` stub (`src/main/capabilities/webResearch.js`)

- Returns empty Evidence with a `summary: 'web_research not implemented'` so the classifier knows it ran but found nothing
- Placeholder for future integration with WebFetch / WebSearch
- Enabled if profile lists `web_research` in `capabilities`

### 5. Registry + integration

`src/main/capabilities/registry.js`:
```js
function buildRegistry(profile) {
  const enabled = profile.capabilities || [];
  const reg = {};
  if (enabled.includes('spec_reader')) reg.spec_reader = new SpecReader();
  if (enabled.includes('knowledge_search')) reg.knowledge_search = new KnowledgeSearch();
  if (enabled.includes('web_research')) reg.web_research = new WebResearch();
  return reg;
}
```

The supervisor loop (child A) calls `await runAll(registry, question, ctx, profile)` after a RESEARCH verdict, accumulates Evidence, and re-invokes the classifier.

### 6. Evidence rendered in the audit log

Each capability run emits an audit event with the source + summary + refs. The supervisor's Audit tab (when child A wraps these events) shows what evidence informed which re-classification.

---

## Non-goals

- **No new capability types in v1.** Just port the three above. `DemoCodebaseSearch` is not ported (demo-only). Future capabilities (e.g. `GitGrep`, `TestRunner`) are follow-ups.
- **No vectorstore in SpecReader.** Keyword scoring only, same as the supervisor. Embeddings can land later.
- **No web fetch wiring in v1.** `WebResearch` is a stub returning empty Evidence so the registry can advertise the capability without depending on a fetch implementation.
- **No caching layer for SpecReader.** Re-reads files on every run; profile context_sources are small (<100 KB total typical) and disk reads are cheap.

---

## Constraints

- **All capabilities are async.** The classifier may call multiple in parallel via `Promise.all`.
- **No state between runs.** Each capability is stateless — instantiate once per registry, run many times. Memoisation per-question is fine if added; per-tick state is not.
- **No throw on missing files.** A `context_sources` entry pointing at a missing path returns empty Evidence with a `summary: 'source not found: <path>'`.
- **Frame-meta files excluded from SpecReader.** Hard-coded skip list for `tasks.json`, `STRUCTURE.json`, `PROJECT_NOTES.md`, `AGENTS.md`, `CLAUDE.md`.

---

## Open questions

1. **Top-K default.** Supervisor uses K=5 for SpecReader and KnowledgeSearch. *Working stance:* match.
2. **Capability timeout.** A slow SpecReader run could block the classifier loop. *Working stance:* 2s timeout per capability; on timeout, return empty Evidence with a warning.
3. **Per-spec capability override.** Should a single spec be able to override which capabilities run? *Working stance:* yes — `.frame/specs/<slug>/supervisor.json` can list `capabilities` that union with the profile's defaults.
4. **WebResearch enablement when stub.** Surface a banner in the Profile tab "WebResearch is a stub — enable only for testing"? *Working stance:* yes, one-line warning on save if the capability is enabled.

---

## Success criteria

1. With `spec_reader` enabled, a supervisor classifier's RESEARCH verdict produces a non-empty Evidence list (assuming relevant content in `context_sources`).
2. With `knowledge_search` enabled and Basic Memory populated, the classifier sees prior decisions as Evidence on its next call.
3. A capability with no matching content returns an empty Evidence list, not an error.
4. The audit log shows which capability ran with which question and what it returned.
5. Disabling a capability in the profile removes it from the registry on next project load.
6. All three capabilities follow the same `Capability` protocol so a future capability drops in by registering a name.
