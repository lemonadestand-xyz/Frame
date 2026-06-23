# Plan — Supervisor as the intake funnel + cross-project orchestration hub

## Architecture

This spec is a **roadmap-level meta-plan**, not a single executable unit. It
gates and sequences seven child Frame specs (the §7 table in `spec.md`) that
together repurpose the supervisor app as the intake funnel and cross-project
hub wrapping Frame's per-project Orchestrator.

### Where work actually lands

The roadmap's child specs are dispatched as Frame specs but **scaffold into the
supervisor repo's `.frame/specs/<slug>/`**, not Frame's. Frame is the execution
framework (conductor + workers + footprint guard + merge); the supervisor repo
is the codebase being modified. This Frame-side spec exists only as a planning
anchor and decision gate — its "implementation" is approving direction and
queueing the children.

Path conventions used below:
- `SUPERVISOR_REPO` = `/Users/christophercampbell/Desktop/lemonade-stand/autonomous_agent/autonomous-supervisor/supervisor`
- `<project>` = any per-project repo Frame is opened against
- Frame's own source tree is **not** modified by this meta-spec

### The L-shape (re-stated for planning)

- **Top of the L (intake)**: external signal → typed intake API → classifier +
  memory search → proposed spec draft → approval inbox → atomic write into
  `<project>/.frame/specs/<slug>/spec.md`. Frame's existing spec watcher and
  Specs panel pick it up; no change to Frame is required here.
- **Right of the L (amplifier + oversight)**: supervisor exposes an MCP server
  (`mcp__supervisor__classify_decision`, `…__critique_outcome`, `…__escalate`)
  that Frame workers call mid-task; a cross-project PWA dashboard reads every
  watched project's `.frame/specs/*/status.json` and aggregates state.
- **Frame keeps the vertical**: spec lifecycle, conductor/worker dispatch,
  footprint conflict guard, drift-checked merge, per-project cockpit. None of
  that is rebuilt or wrapped.

### Data shapes that cross the boundary

These are the only contracts this meta-plan needs to assert; each child spec
will refine its own internals.

- **Intake payload** (written to `SUPERVISOR_REPO/intake/inbox/<id>.json`):
  `{ id, source, received_at, project_hint, raw, normalized }`.
- **Proposal record** (approval-inbox row):
  `{ id, target_project, kind: 'new'|'modification'|'recommendation',
     suggested_slug, draft_spec_md, footprint, dependencies,
     confidence, source_ref, created_at }`.
- **Cross-project status row** (PWA dashboard):
  `{ project, slug, title, phase, ai_tool, updated_at, last_phase_at }` —
  field-for-field passthrough of each watched project's
  `.frame/specs/<slug>/status.json`, keyed by `(project, slug)`.
- **MCP tool contract**: each `mcp__supervisor__*` call is stateless from the
  worker's perspective; the supervisor records the call to per-project Basic
  Memory before returning.

### Why the order in §7 is the order here

1. The **cross-project dashboard** (#1) is the lowest-risk, highest-feedback
   piece: read-only consumption of `status.json` Frame already writes.
2. **Intake API** (#2) before **classifier** (#3) because the classifier needs
   a normalized payload shape to receive.
3. **Classifier-proposer** (#3) before **approval inbox** (#4) so the inbox has
   real proposals to render against (no mock data layer required).
4. **MCP server** (#5) gates the smart-worker loop; nothing after #5 can call
   it. Per §10's bug-#44 mitigation, the critic must be calmed before being
   exposed to Frame workers.
5. **Playwright QA** (#6) and **meeting-transcript pipeline** (#7) are the
   first two consumers of the full stack and validate it end-to-end.

### What's intentionally out of scope here

- Replacing Frame's conductor with a supervisor-side conductor (§9.6 — defer).
- Auto-approving proposals (§9.1 — always require click for v1).
- The §7 row labelled "8+ (per-project flows, slack adapter completion,
  calendar adapter, …)" — tracked downstream of this roadmap.

## Files

This meta-spec creates **no Frame source files**. All implementation files
live in `SUPERVISOR_REPO` and are declared by each child spec's own plan.md.
What this spec produces is the seven child-spec scaffolds, each in the
supervisor repo:

- **New** `SUPERVISOR_REPO/.frame/specs/cross-project-dashboard/{spec,plan,tasks}.md` — PWA aggregates every watched project's `.frame/specs/*/status.json`.
- **New** `SUPERVISOR_REPO/.frame/specs/intake-api-and-receiver/{spec,plan,tasks}.md` — typed intake API + HTTP / file-drop / Loom receivers → `intake/inbox/*.json`.
- **New** `SUPERVISOR_REPO/.frame/specs/classifier-spec-proposer/{spec,plan,tasks}.md` — intake + project context → proposed spec drafts (kind, slug, footprint, confidence).
- **New** `SUPERVISOR_REPO/.frame/specs/approval-inbox-pwa/{spec,plan,tasks}.md` — PWA inbox UI with Approve / Edit / Reject / Defer; atomic write into target project's `.frame/specs/`.
- **New** `SUPERVISOR_REPO/.frame/specs/supervisor-mcp-server/{spec,plan,tasks}.md` — wraps classifier + critic + escalation as MCP tools; calmed critic per bug #44.
- **New** `SUPERVISOR_REPO/.frame/specs/playwright-qa-agent-profile/{spec,plan,tasks}.md` — profile + harness spawning Playwright QA on a deliverable; pass/fail → spec `outcome.md`.
- **New** `SUPERVISOR_REPO/.frame/specs/meeting-transcript-pipeline/{spec,plan,tasks}.md` — end-to-end: Loom comment → classifier → proposal → inbox → approval → spec scaffold.

Already scaffolded (per spec.md §11) — verify only:

- **Existing** `SUPERVISOR_REPO/.frame/specs/cross-project-dashboard/` — `phase=planned` is asserted by spec.md; reconcile if drifted before queueing.

## Footprint

(none — meta-roadmap spec, no Frame source files modified; each child spec declares its own footprint at plan time)

## Dependencies

None at this level. Each child spec declares its own. Anticipated additions
(for child-spec planners' awareness, not for this spec to install):

- `supervisor-mcp-server` → `@modelcontextprotocol/sdk` in the supervisor repo.
- `playwright-qa-agent-profile` → `@playwright/test` (or reuses existing
  supervisor Playwright tooling if already present).
- `cross-project-dashboard` / `approval-inbox-pwa` → consume the supervisor
  PWA's existing stack; no new top-level deps expected.

## Sequencing

Each step is a child Frame spec that can be dispatched independently via
Frame's Orchestrator from the supervisor repo. Steps are gated by the
preceding step landing on its integration branch (or merged manually); no step
bundles unrelated work.

1. **Decision gate (no code).** Confirm §11 (a)–(e) in `spec.md` with Chris;
   answer §9's open questions inline; flip this spec's `status.json`
   `phase=planned`. Output: this plan.md + a confirmed roadmap.

2. **`cross-project-dashboard`.** PWA view aggregating `.frame/specs/*/status.json`
   across every watched project. Read-only. First because it's the safest
   dogfooding of Frame's Orchestrator and immediately useful.

3. **`intake-api-and-receiver`.** Typed intake API + HTTP / file-drop /
   expanded Loom receivers writing normalized payloads to
   `SUPERVISOR_REPO/intake/inbox/*.json`. No classifier yet — just a clean
   pipe.

4. **`classifier-spec-proposer`.** Consumes inbox payloads + per-project Basic
   Memory + path heuristics; emits proposal records (target project, kind,
   draft `spec.md`, suggested footprint, confidence). Confidence threshold
   (>70%, per §10) gates surfacing.

5. **`approval-inbox-pwa`.** PWA inbox view + Approve / Edit / Reject / Defer
   actions. On Approve: atomic temp+rename write of
   `<target_project>/.frame/specs/<slug>/spec.md` (collision check on slug per
   §10). Edit reopens the draft in a PWA editor.

6. **`supervisor-mcp-server`.** Wraps the classifier policy + critic +
   escalation router as MCP tools (`mcp__supervisor__classify_decision`,
   `…__critique_outcome`, `…__escalate`). **Pre-req**: bug #44 fix lands first
   so the critic isn't over-firing on completion summaries (§10).

7. **`playwright-qa-agent-profile`.** A profile + harness that, when invoked
   on a Frame spec's deliverable, runs Playwright tests and writes pass/fail
   to the spec's `outcome.md`. Runs **after** user approval (§9.5 — informs,
   doesn't gate).

8. **`meeting-transcript-pipeline`.** End-to-end validation: a Loom comment
   webhook flows through receiver → classifier → proposal → inbox → approval →
   spec scaffold appearing in the target project's Frame Specs panel. Closes
   the MVP loop.

9. **Closeout (no code).** Mark this spec's `outcome.md`: which children
   landed, which deferred, links to the §11 confirmations, and the §9 answers
   captured. Open a follow-up roadmap entry for §7 row 8+ (per-project flows,
   Slack adapter completion, calendar adapter).
