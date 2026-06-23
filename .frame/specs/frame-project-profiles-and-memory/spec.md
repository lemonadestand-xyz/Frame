# Frame project profiles + Basic Memory integration

> **What we're building:** Port the supervisor's `ProjectProfile` (YAML on disk) and Basic Memory backend into Frame. Each project gains a `.frame/profile.yaml` declaring policy rules, role authority, budgets, context sources, capabilities, and a Memory tab in the spec section showing decisions/rules/context the supervisor loop has accumulated. This is child B of `frame-parity-with-supervisor` and the trunk dependency for everything downstream.

---

## Background

Supervisor reference:
- **`ProjectProfile` dataclass** at `supervisor/types.py:193-210` — fields: `id`, `worker` (WorkerConfig), `context_sources` (list of spec paths or `bm:<project>` refs), `policy` (EscalationPolicy), `roles` (RoleProfile list), `people`, `capabilities`, `budgets` (iteration_cap, spend ceilings), `ledger`, `store`.
- **Profile loader** at `supervisor/config.py:16-59`, loads YAML.
- **Example** at `supervisor/profiles/solo.yaml` — illustrates every field.
- **BasicMemoryBackend** at `supervisor/memory.py:60` — markdown-on-disk under `~/memory/<project>/`, categorised by frontmatter (rules / decisions / context / transcripts). Keyword scoring with 2x rules multiplier (`memory.py:94-95`).
- **MemoryMirrorStore** at `supervisor/store/memory_mirror.py:40-80` — only "durable" actions (escalated, human_responded, answered) with categories like dependency/schema/consistency mirror back after audit lands.

---

## Problem

Frame's autopilot runs the same way for every project. There's no per-project notion of:
- Which categories of decision always require Chris's input (escalate_categories)
- What the spend ceiling is per task or per day
- Which context sources the LLM classifier should pull from (related spec paths, BM project IDs)
- Which roles exist + their authority + their proactivity levels
- What the project's policy rules are (e.g. "naming → AUTO_ANSWER, schema → ESCALATE")

And there's no persistent memory: each supervisor tick reasons from scratch. Repeat decisions ("we settled this last week") aren't carried forward.

---

## Goal

### 1. `.frame/profile.yaml` per project

Schema mirrors `ProjectProfile` 1:1. Example shape (subset shown):

```yaml
id: frame
worker:
  auth: subscription
  permission: cautious
  workdir: .
context_sources:
  - bm:frame             # this project's Basic Memory notes
  - docs/AUTOPILOT.md
  - AGENTS.md
policy:
  escalate_categories: [dependency, schema, deployment]
  cost_ceiling_usd: 5.0
  rules:
    - category: naming    # always AUTO_ANSWER
      route: auto_answer
    - category: testing
      route: research
roles:
  - name: chris
    authority: [dependency, schema, deployment, scope]
    channel: ui
    proactivity: notify  # auto | notify | wait
capabilities: [spec_reader, knowledge_search]
budgets:
  iteration_cap: 3
  spend_per_task_usd: 1.0
  spend_per_day_usd: 20.0
```

Frame loads this on project open, exposes it to the supervisor loop, surfaces it in a Profile tab for editing.

### 2. Frame Profile editor

A new tab inside the project view (alongside Specs / Tasks / Files): **Profile**. Form-driven editor for the YAML. Save writes `.frame/profile.yaml` (committed to git like everything else under `.frame/`).

For v1, the editor is form + raw YAML side-by-side. Future passes can dedicate UI per section.

### 3. Basic Memory backend integration

Frame ships a Node port of `BasicMemoryBackend`:
- Reads from `~/memory/<project_id>/{rules,decisions,context,transcripts}/*.md`
- `search(query, k=5)` returns top-K notes by keyword score (2x multiplier on `rules/`)
- `write(note)` appends a frontmatter+body markdown file under the right category

The Node port lives in `src/main/memory.js`. Same on-disk format as the supervisor's Python implementation; both processes can read each other's writes (markdown is idempotent).

### 4. Memory tab on the spec section

A new tab next to *Audit*: **Memory**. Shows the notes the supervisor wrote for this spec (filtered by frontmatter `spec_slug`) plus the project-wide notes the loop's classifier pulled as evidence on its last tick. Read-only for v1; manual edits go through the file system.

### 5. "Durable decision mirror" wiring

When the supervisor loop (child A) escalates → user answers, OR answers via AUTO_ANSWER with a category in the durable list, the answer + reasoning are mirrored to memory as a `decisions/<spec>-<task>-<ts>.md` note. Same shape as the supervisor's mirror (`store/memory_mirror.py:40-80`). The mirror fires only on durable categories so the memory doesn't fill with trivia.

---

## Non-goals

- **No vectorstore.** Pure keyword scoring like the supervisor uses today. Adding embeddings is a v2 follow-up.
- **No memory write conflicts handling.** Both Frame and supervisor app can write — last-write-wins per file, conflict resolution via git.
- **No remote memory backend.** Local filesystem only. `BasicMemoryBackend` over the network is future.
- **No per-role UI personalisation.** The Profile declares roles but Frame's UI doesn't (yet) check role authority before letting the user act. v2.
- **No automatic profile generation.** v1 ships an empty default; the user edits.

---

## Constraints

- **YAML schema must match the supervisor's `ProjectProfile`** 1:1 so the supervisor app can read Frame-written profiles (and vice versa) when both are pointed at the same project.
- **Default profile when missing.** A project without `.frame/profile.yaml` runs under a deterministic default (no escalate_categories, no cost ceiling, all routes default to LLM). Frame surfaces a one-line nudge to create one but doesn't block.
- **Basic Memory directory is shared** with the supervisor app. `~/memory/<project_id>/` is the canonical location; both processes read and write there.
- **No new external dependencies.** YAML parser already in dev deps (`js-yaml`); filesystem ops are stdlib.

---

## Open questions

1. **Profile-id vs. project-id mapping.** Frame's project identifier is the workspace path; the supervisor's profile `id` is a logical name. *Working stance:* take `id` from `profile.yaml`; fall back to `path.basename(projectPath)` if absent.

2. **Schema validation strictness.** Reject unknown fields (strict) or accept (loose)? *Working stance:* loose — log a warning on unknown fields, don't fail. The supervisor's loader is loose.

3. **Profile editor: form-only or YAML-only or both?** *Working stance:* both, side-by-side. Form is the friendly path; YAML is the source of truth.

4. **What happens on schema migration?** *Working stance:* additive only for v1. Field renames trigger a one-shot migrator in `frameProject.js`.

5. **Memory tab — show only this-spec notes, or all relevant notes?** *Working stance:* default to "this-spec" with a "show all project notes" toggle.

6. **Encryption of memory.** *Working stance:* none in v1. Memory is local-only by design; user encrypts the disk if they need it.

---

## Success criteria

1. A project with `.frame/profile.yaml` loads its policy / roles / budgets on open; the supervisor loop (when it lands) reads from the same file.
2. The Profile tab renders the YAML, lets the user edit, and saves back to disk without data loss.
3. `~/memory/<project>/decisions/` contains a new note after the user answers an escalation; the note is readable by the supervisor app.
4. The Memory tab on a spec section shows the project's notes filtered to this spec slug.
5. A project without `.frame/profile.yaml` still works (default profile applied silently with a single nudge banner).
6. Both Frame and the supervisor app can read each other's memory writes without conflict.
