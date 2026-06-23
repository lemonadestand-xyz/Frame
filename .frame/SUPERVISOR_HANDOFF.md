# Supervisor handoff — Frame parity push (2026-06-21 / 22)

> **Hand this file to the autonomous supervisor app.** It is the complete brief
> for picking up the in-flight work without interruption. Everything in this
> file is work authored today in this Frame project — nothing inherited from
> upstream PRs.

---

## Initiative — Frame parity with the autonomous supervisor

**Goal:** Bring Frame to feature parity with the autonomous supervisor reference
implementation at
`/Users/christophercampbell/Desktop/lemonade-stand/autonomous_agent/autonomous-supervisor/supervisor/`.
Frame becomes the UI + execution framework for the supervisor's proven
patterns: LLM-judged routing, per-project profiles, Basic Memory, research
capabilities, cross-project orchestration, multi-channel escalation. The
autonomous supervisor remains the reference; Frame becomes the operating
surface that runs alongside it (both processes share `~/memory/<project>/`).

**Parent meta-spec (read first):**
`.frame/specs/frame-parity-with-supervisor/spec.md`

That spec catalogs six child specs (A–F) with a dependency graph, ship order,
constraints, and seven open questions with working stances marked. Every claim
anchors back to a `supervisor/<path>.py:<line>` reference.

---

## Children and progress

| Child | Slug | Done | Total | Status |
|---|---|---|---|---|
| **A** | `frame-supervisor-loop` | 10 | 12 | engine + IPC shipped; pill + docs pending |
| **B** | `frame-project-profiles-and-memory` | 8 | 12 | engine + IPC shipped; UI tabs pending |
| **C** | `frame-capabilities-registry` | 7 | 10 | engine shipped; audit + docs pending |
| **D** | `frame-cross-project-orchestration-ui` | 10 | 11 | board shipped; docs pending |
| **E** | `frame-escalation-adapters` | 7 | 10 | UI adapter shipped; Slack/Email + docs pending |
| **F** | `frame-worker-abstraction` | 6 | 11 | scaffolding + FakeWorker shipped; production workers + agentDispatch refactor pending |

**Test suite: 144/144 green** (was 57 at start of session; +87 new tests).
**Renderer bundle:** rebuilt; `Supervise` button + `Across projects` overlay +
escalation modal are live after a Cmd+R.

---

## Outstanding work (Frame-only; supervisor-app repo work excluded)

### A. `frame-supervisor-loop` — 2 tasks
Spec: `.frame/specs/frame-supervisor-loop/`
- **T10** — Extend `src/renderer/autopilotPill.js` so the existing pill renders
  the supervisor's `lastVerdict.route + confidence` in addition to (or instead
  of) the legacy autopilot run summary. Subscribe via
  `src/renderer/supervisorClient.js`'s `onChange(...)`.
- **T12** — Add a "Supervisor Loop" section to `AGENTS.md` (root) explaining
  the per-spec loop, the routes, the audit JSONL, and how to call
  `SUPERVISOR_START` from a script. Append `outcome.md` entry per Frame
  convention.

### B. `frame-project-profiles-and-memory` — 4 tasks
Spec: `.frame/specs/frame-project-profiles-and-memory/`
- **T05** — `src/renderer/profilePanel.js` Profile tab (form for
  policy/budgets/capabilities + raw JSON side-by-side). Add to
  `projectSection.js` tab list. Profile schema is documented in the spec's
  plan.md.
- **T09** — `src/renderer/memoryTab.js` — Memory tab next to *Audit* on the
  spec section. Read-only list filtered by `metadata.spec_slug` with a "show
  all project notes" toggle. Call `SEARCH_MEMORY` / `LIST_MEMORY` IPC.
- **T11** — Nudge banner in the Profile tab when `.frame/profile.json` is
  missing, with a "Generate default" button that calls `SAVE_PROFILE` with
  the result of `profile.defaultProfile(projectPath)`.
- **T12** — Add a "Profiles & Memory" section to `AGENTS.md` and append
  `outcome.md`.

### C. `frame-capabilities-registry` — 3 tasks
Spec: `.frame/specs/frame-capabilities-registry/`
- **T08** — Broaden `src/__tests__/capabilitiesRegistry.test.js` with the
  precise all-three-registered + timeout + error scenarios mentioned in the
  plan. The existing tests cover the core; this is the extension pass.
- **T09** — Wire per-capability audit-event emission to
  `.frame/runtime/capability-audit.jsonl`. Each line:
  `{capability, question, evidenceCount, duration_ms, ts}`. The hook lives
  in `registry.js`'s `runAll`.
- **T10** — Update `STRUCTURE.json` (run `npm run structure`), add a
  "Capabilities" section to `AGENTS.md`, append `outcome.md`.

### D. `frame-cross-project-orchestration-ui` — 1 task
Spec: `.frame/specs/frame-cross-project-orchestration-ui/`
- **T11** — Update `STRUCTURE.json`, add a "Cross-project view" section to
  `AGENTS.md` explaining the Across-projects overlay, the registry, the
  pause-all semantics. Append `outcome.md`.

### E. `frame-escalation-adapters` — 3 tasks
Spec: `.frame/specs/frame-escalation-adapters/`
- **T08** — Slack adapter stub at `src/main/adapters/slackAdapter.js`. Opt-in
  via `profile.escalation.slack.webhook_url`. Block Kit message + localhost
  callback server on `escalation.slack.callback_port` (default 7333). Falls
  back to UIAdapter on webhook failure. Register in `adapters/registry.js`'s
  `buildAdapters` when the profile config is present.
- **T09** — Email adapter stub at `src/main/adapters/emailAdapter.js`. Writes
  `.frame/runtime/email-drafts/<id>.eml` for manual send. Response detection
  deferred to v3.
- **T10** — Update `STRUCTURE.json`, add an "Escalation" section to
  `AGENTS.md`, append `outcome.md`.

### F. `frame-worker-abstraction` — 5 tasks
Spec: `.frame/specs/frame-worker-abstraction/`
- **T07** — `src/main/workers/claudeCodeWorker.js` wrapping the existing
  claude-code spawn + event-parsing path via the already-shipped
  `EventQueue`. Use `src/main/workers/fakeWorker.js` as the structural model.
- **T08** — `src/main/workers/codexWorker.js` and `geminiWorker.js` with the
  equivalent spawn paths. Permissive decision-detection heuristic for v1.
- **T09** — Refactor `src/renderer/agentDispatch.js` to route every spawn
  through `workers.getWorker(toolName)`. **All IPC channel signatures stay
  identical** — this is a pure refactor; existing tests must still pass.
- **T10** — Run `npx jest`; zero regressions. The 144 tests today (51
  autopilot + 7 profile + 12 workers + 6 capabilities-registry + 5 specReader
  + 3 knowledgeSearch + 14 supervisorPolicy + 5 supervisorClassifier + 9
  supervisorCritic + 3 supervisorLoop + 2 uiAdapter + 4 crossProjectGuard +
  10 memory + 6 memoryMirror + autopilot.intent) must all stay green.
- **T11** — Update `STRUCTURE.json`, add a "Workers" section to `AGENTS.md`,
  append `outcome.md`.

### Other in-flight spec — `we-should-be-able-to-modify-specs-add-to-tasks-e` — 9 tasks
Spec: `.frame/specs/we-should-be-able-to-modify-specs-add-to-tasks-e/`

This is the "attach screenshots / documents during spec / plan creation"
work. T01 (the `src/main/specAttachments.js` storage layer) shipped today;
everything else is pending. See the spec's plan.md for the full architecture
(staging dir lives at `.frame/runtime/spec-attachments-staging/<id>/` per
the T01 outcome divergence note).

- **T02** — `src/__tests__/specAttachments.test.js`
- **T03** — `ATTACH_SPEC_FILE` + `LIST_SPEC_ATTACHMENTS` IPC channels +
  handlers in `src/main/index.js` (call `specAttachments.setupIPC(ipcMain)`
  — need to add a `setupIPC` export to the module).
- **T04** — Extend `specManager.createSpec` to accept `opts.pendingAttachments`
  and call `specAttachments.promoteStagedAttachments`.
- **T05** — Paste/drop zone + Add-file button + staged-attachment chip list
  in the New Spec modal (`src/renderer/specPanel.js`). Purge staging dir on
  cancel.
- **T06** — Paste/drop listeners on spec.md / plan.md inline-edit textareas in
  `src/renderer/specSection.js` → call `ATTACH_SPEC_FILE` and insert
  markdown reference at the cursor.
- **T07** — "Attachments (N)" chip + popover on spec section header (reuses
  `OPEN_IN_FINDER`).
- **T08** — Drop-zone CSS in `src/renderer/styles/components/panels.css`.
- **T09** — Manual smoke test.
- **T10** — `outcome.md` per Frame convention.

---

## File layout reference

```
.frame/
├── SUPERVISOR_HANDOFF.md                     ← this file
└── specs/
    ├── frame-parity-with-supervisor/          ← parent meta-spec (READ FIRST)
    ├── frame-supervisor-loop/                 ← child A (engine done)
    ├── frame-project-profiles-and-memory/     ← child B (engine done)
    ├── frame-capabilities-registry/           ← child C (engine done)
    ├── frame-cross-project-orchestration-ui/  ← child D (board done)
    ├── frame-escalation-adapters/             ← child E (UI adapter done)
    ├── frame-worker-abstraction/              ← child F (foundation done)
    └── we-should-be-able-to-modify-specs-add-to-tasks-e/  ← attachments spec

src/main/                                      ← supervisor engine modules
├── profile.js                                 ← B-T01 (profile load/save/watch)
├── memory.js                                  ← B-T06 (BasicMemoryBackend)
├── memoryMirror.js                            ← B-T10 (durable-decision writer)
├── supervisorClaudeRunner.js                  ← A-T01 (claude -p wrapper)
├── supervisorPromptBuilder.js                 ← A-T02 (classifier + critic prompts)
├── supervisorPolicy.js                        ← A-T03 (hard-policy fast path)
├── supervisorClassifier.js                   ← A-T04 (LLM-judged router)
├── supervisorCritic.js                       ← A-T05 (with bug #44 fix inline)
├── supervisorLoop.js                         ← A-T06 (per-spec tick loop)
├── supervisorRegistry.js                     ← A-T07 (cross-project map)
├── supervisorIPC.js                          ← bridge to renderer
├── crossProjectGuard.js                      ← D-T08 (footprint conflicts)
├── specAttachments.js                        ← attachments-spec T01
├── workers/
│   ├── types.js                              ← F-T02 (WorkerInterface)
│   ├── registry.js                           ← F-T03
│   ├── _eventQueue.js                        ← F-T04 (callback↔AsyncIterator bridge)
│   ├── fakeWorker.js                         ← F-T05
│   └── index.js                              ← bootstrap (registers built-ins)
├── capabilities/
│   ├── types.js                              ← C-T01
│   ├── registry.js                           ← C-T02
│   ├── specReader.js                         ← C-T03
│   ├── knowledgeSearch.js                    ← C-T05
│   ├── webResearch.js                        ← C-T07
│   └── index.js                              ← bootstrap
└── adapters/
    ├── types.js                              ← E-T01 (EscalationAdapter)
    ├── registry.js                           ← E-T02
    └── uiAdapter.js                          ← E-T03

src/renderer/
├── supervisorClient.js                       ← supervisor IPC client
├── crossProjectBoard.js                      ← D-T04 (board renderer)
├── escalationModal.js                        ← E-T05 (drafted-question modal)
└── styles/components/supervisor.css          ← supervisor surfaces styling

src/shared/
├── workerTypes.js                            ← F-T01 (Posture + WorkerEventKind)
└── ipcChannels.js                            ← extended with 19 new channels

src/__tests__/                                ← 87 new tests covering the above
```

---

## Validation commands

```bash
# Full test suite — must stay 144/144 (or higher when new tests land)
npx jest --silent

# Targeted test for a specific subsystem
npx jest src/__tests__/supervisorLoop.test.js
npx jest src/__tests__/memory.test.js

# Renderer bundle — rebuild after every renderer-side edit
npm run build

# Or run a watcher during a session of UI work
npm run watch  # rebuilds dist/renderer.js on every save
```

The supervisor must:
1. Run `npx jest --silent` before AND after every code change. Zero
   regressions allowed.
2. Run `npm run build` after every renderer-side change so the Electron
   reload picks it up.
3. After completing each task, mark the corresponding row in `tasks.json`
   as `status: "completed"` with `completedAt` set, and append a 2–4
   sentence entry to the spec's `outcome.md` per the Frame convention
   (see existing outcome entries in
   `.frame/specs/frame-supervisor-loop/outcome.md` as the template).

---

## Constraints — read CLAUDE.md root

`CLAUDE.md` (the project root one — Frame's own AGENTS.md is symlinked
to it) is the canonical spec-driven-development contract. The supervisor
MUST respect these:

- **Footprint discipline.** Every plan.md declares a `## Footprint`. Don't
  touch files outside it. Frame meta files
  (`tasks.json` / `STRUCTURE.json` / `PROJECT_NOTES.md` / `AGENTS.md` /
  `CLAUDE.md`) are reconciled separately and don't go in any spec's
  Footprint.
- **No `js-yaml` dep.** Profiles use `.frame/profile.json` not YAML
  (documented divergence in
  `.frame/specs/frame-project-profiles-and-memory/outcome.md` T01).
- **Bug #44 fix is ported inline** in `src/main/supervisorCritic.js`.
  Don't wait on the supervisor-repo `engine-fix-decision-overdetection`
  spec to land before wiring critic call sites.
- **Pure-refactor specs** (F-T09 agentDispatch refactor) must not change
  observable behaviour. Existing tests are the litmus test.
- **No new external dependencies** unless the spec calls for one.
- **Working stances** on open questions can be flipped, but flag the flip
  by editing the spec.md AND the impacted children's outcome.md.

---

## Working stances on open questions (from parent meta-spec)

These were marked in `.frame/specs/frame-parity-with-supervisor/spec.md`
§"Open questions":

1. **Profile location:** per-project repo (`.frame/profile.json`, committed).
2. **Engine port vs. MCP call:** port the engine (Node mirrors of Python).
   The MCP path stays optional for advanced workflows.
3. **Memory write authority:** Frame writes directly to `~/memory/<id>/`.
   Both Frame and the supervisor app can write; conflicts surface as git
   diffs.
4. **Cross-project UI:** tab inside Home (overlay opened from lane board
   actions row — shipped).
5. **Escalation channels v1:** UI only. Slack/Email are stubs.
6. **Worker abstraction blast radius:** F-T07–T10 is a pure refactor —
   no UI change, no IPC channel signature change.
7. **Memory schema:** per-project, not per-spec. Spec linkage via
   `metadata.spec_slug`.

---

## Supervisor reference anchors (the contract)

Every Frame engine module anchors back to a supervisor file:line. When
porting a missing piece, read the corresponding supervisor source:

| Frame module | Supervisor reference |
|---|---|
| `supervisorLoop.js` main tick | `supervisor/loop.py:78-90` |
| `supervisorClassifier.classifyNextStep` | `supervisor/classifier/__init__.py:27-42` |
| `supervisorPolicy.decideFastPath` | `supervisor/classifier/policy.py:29-64` |
| `supervisorClaudeRunner.runClaudeJson` | `supervisor/classifier/llm.py:93-99` |
| `supervisorCritic.critique` | `supervisor/loops/self_revision.py:77-89` |
| `supervisorCritic.isTerminalMessage` | bug #44 fix; see `engine-fix-decision-overdetection/spec.md` in the supervisor repo |
| `memory.BasicMemoryBackend` | `supervisor/memory.py:60` (with 2× rules multiplier at `:94-95`) |
| `memoryMirror.recordDurableDecision` | `supervisor/store/memory_mirror.py:40-80` |
| `capabilities/specReader.js` | `supervisor/capabilities.py:37-107` |
| `capabilities/knowledgeSearch.js` | `supervisor/capabilities.py:123-152` |
| `workers/types.js` `WorkerInterface` | `supervisor/types.py:230-239` |
| `adapters/uiAdapter.js` | `supervisor/adapters/mobile_api.py:24-44` |
| `profile.js` `ProjectProfile` schema | `supervisor/types.py:193-210` |
| `crossProjectGuard.js` | not in supervisor; Frame-specific (D spec) |

---

## Today's chat history

Full conversation transcript (this session and the preceding compacted
session) lives on disk at:

```
/Users/christophercampbell/.claude/projects/-Users-christophercampbell-Desktop-lemonade-stand-Frame/5b10146c-5d1d-4a08-baaf-c48174ac83b1.jsonl
```

This is JSONL — one event per line. The user explicitly chose to drive
several specs from a runtime prompt (`.frame/runtime/prompts/<slug>__spec.<phase>.md`)
during this session. Reading the JSONL gives the full context of:

- Why the parity meta-spec was authored (the supervisor app is "close to
  perfect" and the user wants Frame to be its UI/execution surface)
- Why bug #44 was ported inline (don't block on the supervisor child spec)
- Why staging was moved out of `.frame/specs/` (slug discovery walker)
- Why `.frame/profile.json` vs `.frame/profile.yaml` (no `js-yaml` dep yet)
- The Auto button dupe-ID bug fix (specSection.js `surface: 'inline' | 'header'`)
- The terminal scroll-anchoring fix (`followBottom` flag in terminalManager.js)
- The autopilot `in_progress` → undone semantics (`readUndoneCount` in
  specManager.js)

If the supervisor app can read JSONL transcripts and surface them as
prior decisions in its Basic Memory (`bm:frame`), that would give the next
session full continuity.

---

## How to drive a single task to completion

For any pending task `T<n>` in any child spec:

1. **Read** the spec's `spec.md`, `plan.md`, `tasks.md`, and `outcome.md`
   in that order. Outcome.md tells you about any divergences from the
   plan.
2. **Find** the task in `tasks.json` by
   `source === "spec:<slug>:T<n>"`. Set `status: "in_progress"`.
3. **Implement** the change — match Frame's existing patterns; follow
   the spec's plan; respect the footprint.
4. **Run tests** (`npx jest --silent`). Fix any regression before
   marking done.
5. **Build the renderer** if you touched any `src/renderer/**`
   (`npm run build`).
6. **Mark done.** `tasks.json` `status: "completed"` +
   `completedAt: <iso>` + `updatedAt: <iso>`.
7. **Append** a 2–4 sentence outcome entry to the spec's `outcome.md`
   following the existing entries' shape. **Name any divergence** from
   plan.md.
8. **Commit** following the Frame convention (see PROJECT_NOTES.md and
   the project's CLAUDE.md).

---

## Ship order recommendation

The parent meta-spec's documented ordering is **B → F (parallel) → C → A
→ E → D**, but the engine for A/B/C/D/E is already shipped. The
remaining work is mostly polish + the F refactor. Suggested order
prioritising shippability:

1. **F-T07 → F-T11** (worker refactor) — touches the most surfaces; do
   first while context is fresh, with the test suite as guardrails.
2. **B-T05 + B-T09 + B-T11** (Profile + Memory tabs + nudge banner) —
   highest user-visible value left in B.
3. **E-T08 + E-T09** (Slack + Email stubs) — opt-in via profile; doesn't
   gate anything else.
4. **A-T10** (autopilotPill supervisor verdict) — last UI polish.
5. **C-T08 + C-T09** (capabilities tests + audit JSONL) — small.
6. **All -T12 / -T10 / -T11 docs tasks** — bulk-update AGENTS.md +
   STRUCTURE.json at the end.
7. **`we-should-be-able-to-modify-specs-add-to-tasks-e` T02–T10** — its
   own thread of work; independent of the parity push but uses the same
   conventions.

---

## What is NOT in this handoff

Excluded because it's either work in another repo or already merged:

- The supervisor-repo child specs (cross-project-dashboard,
  intake-api-and-receiver, classifier-spec-proposer, approval-inbox-pwa,
  supervisor-mcp-server, playwright-qa-agent-profile,
  meeting-transcript-pipeline, engine-fix-decision-overdetection).
  Those live in
  `/Users/christophercampbell/Desktop/lemonade-stand/autonomous_agent/autonomous-supervisor/supervisor/.frame/specs/`
  and are tracked separately. The Frame-side bug #44 fix is already
  ported INLINE in `supervisorCritic.js` so Frame doesn't block on the
  supervisor-repo spec landing.
- Anything from the meta-spec
  `supervisor-as-the-intake-funnel-cross-project-or` T07–T10. Those
  scaffold the remaining child specs in the supervisor repo, not Frame
  work.
- Bug fixes shipped in this session: terminal scroll-anchoring
  (`task-fix-terminal-scroll-anchoring`), Auto button duplicate ID
  (`task-fix-autopilot-toggle-duplicate-id`), autopilot in_progress
  semantics (`task-autopilot-count-in-progress-as-undone`). All marked
  completed in tasks.json.

---

## Final status snapshot (2026-06-22)

- Test suite: **144/144 green**
- Renderer bundle: **rebuilt, dist/renderer.js contains the supervisor surfaces**
- Engine: **feature-complete for headless supervisor flow**
- UI: **Supervise button + Across-projects overlay + Escalation modal live**
- Remaining: **~27 tasks across 7 specs** — punch-list above
- All 7 spec.md / plan.md / tasks.md files in `.frame/specs/` are
  current and reflect today's design decisions.

The supervisor app should be able to clone the full state by reading:

```
.frame/specs/frame-parity-with-supervisor/spec.md      ← initiative
.frame/specs/frame-*/                                  ← six children
.frame/specs/we-should-be-able-to-modify-specs-add-to-tasks-e/
tasks.json                                              ← canonical task list
.frame/SUPERVISOR_HANDOFF.md                            ← this file
~/.claude/projects/...5b10146c-5d1d-4a08-baaf-c48174ac83b1.jsonl  ← chat log
```

Good luck. Once the punch list is done, run `npx jest` and `npm run
build` one final time, then mark the parent meta-spec
(`frame-parity-with-supervisor`) phase=`done`.
