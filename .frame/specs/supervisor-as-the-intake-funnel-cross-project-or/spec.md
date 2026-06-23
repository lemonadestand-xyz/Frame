# Supervisor as the intake funnel + cross-project orchestration hub

# PRD — Supervisor as the intake funnel + cross-project orchestration hub

**Date:** 2026-06-21
**Author:** Chris (vision) · Claude (synthesis)
**Status:** Draft — for review before any new specs are queued

---

## 1. Vision

> "My central hub this week for all of my projects. Requests come in / meetings happen, recordings get passed in, knowledgebase gets reviewed for either new specs, modifications of existing, improvement recommendations, etc. Tasks are created for me to review, I can approve which I like, and they are pushed to the queue for execution — parallel execution where appropriate if they don't depend on other work."

The supervisor becomes the **front-end funnel** that turns external signal (transcripts, requests, webhooks, knowledgebase) into **reviewed, approved, queued work** for Frame's per-project Orchestrator to execute.

It is no longer trying to BE the orchestrator. Frame ships that now (as of PR #89, 2026-06-17). The supervisor's role narrows and sharpens.

---

## 2. The original supervisor intent (recap)

Set down before Frame's orchestration shipped:

| Capability | Description |
|---|---|
| **Task intake** | Receive work from many sources: CLI, HTTP API, webhooks (Loom, GitHub, Calendar, ClickUp), file drops, manual entry. |
| **Three-route classifier** | Every decision point routes to one of: auto-answer (cheap default) · research-then-answer (gather evidence) · escalate (genuine judgment call → human). |
| **Self-revision + QA loops** | Worker reaches "absolute resolution" (tested, spec-checked) not just "code written." A critic agent re-reads and challenges the output before the worker reports done. |
| **Cross-channel escalation** | Routed by role: engineer → PWA modal · PM → Slack · COO → email · support → Slack status-only. Role adapters render the same escalation per channel style. |
| **Memory integration** | Per-project Basic Memory MCP — `bm:supervisor-self`, `bm:localized`, `bm:renovive-qa`, etc. Decisions recorded; loaded into next session's context. |
| **Parallel queue scheduler** | DAG-aware, workdir auto-serialized, daemon-mode with file-watched intake. |
| **PWA cockpit** | Web Push notifications, Kanban view, deliverable file viewer, "open in Finder" / "open in default app" actions. |
| **Profile-driven config** | Per-project (`profiles/*.yaml`) and per-person (RoleProfile inside a profile). Config over forks. |
| **Project audit + onboarding** | HANDOFF.md, PROJECTS.md, AUDIT-*.md — picked up by future Claude sessions. |

---

## 3. Frame's capability snapshot (as shipped 2026-06-21)

Pulled in clean from upstream this morning (`84c8a8a → 873c69a`, 92 files, +17,020 lines).

| Capability | Shipped as |
|---|---|
| **Spec-driven dev** | `.frame/specs/<slug>/{spec,plan,tasks,outcome}.md` — PRs #71, #72, #74, #76, #77 |
| **`/spec.*` slash commands** | `/spec`, `/spec.plan`, `/spec.tasks`, `/spec.implement` — auto-drafts spec, walks the lifecycle |
| **Specs panel + tasks dashboard** | Sidebar UI with refresh button |
| **Per-project structure** | `STRUCTURE.json` (intentIndex), `PROJECT_NOTES.md`, `AGENTS.md` (== `CLAUDE.md` symlink), `tasks.json` |
| **Project overview page** | Per-project home view |
| **Orchestrator (PR #89)** | Conductor agent + per-spec worker agents, each in its own `.frame/worktrees/<slug>` |
| **Footprint conflict guard** | Code-enforced in `orchestrationManager.js`; refuses overlapping specs |
| **Drift-checked merge** | `merge.js` validates worker stayed within declared footprint before merging into `frame/<slug>/integration` |
| **Live cockpit UI** | Pipeline rail · worker lanes · spec rail · embedded conductor terminal |
| **Per-worker Approve / Remove** | Nothing merges without user click |
| **Individual frame tabs (PR #90)** | Multiple projects open simultaneously, each in its own tab |
| **Git commit as context anchor** | Pre-commit hook auto-updates STRUCTURE.json; tasks.json syncs at commit time |
| **Spec steering directive (PR #91)** | AGENTS.md tells the AI to suggest a spec for significant work |
| **Multi-AI support** | Claude Code · Codex CLI · Gemini CLI |
| **Diff viewer (PR #82)** | Read-only diff overlay; sidebar Changes panel |
| **Lane orchestrator (PRs #86, #87)** | Home as a lane board; lane = terminal/context |

---

## 4. Capability matrix — Supervisor vs Frame

| Capability | Frame ships | Supervisor ships | New role |
|---|---|---|---|
| Parallel spec execution + worktree isolation | ✅ Orchestrator | ✅ queue_runner | **Frame wins** — retire supervisor's scheduler |
| Footprint conflict guard | ✅ enforced in code | ➖ workdir auto-serialize (simpler/weaker) | **Frame wins** |
| Spec lifecycle UI | ✅ Specs panel | ❌ | **Frame wins** |
| Conductor/worker cockpit | ✅ pipeline rail + lanes | ❌ (PWA Kanban is task-level, not spec-level) | **Frame wins** |
| Per-project structure bootstrap | ✅ STRUCTURE.json + AGENTS.md | ❌ (just CLAUDE.md) | **Frame wins** |
| **Cross-project hub** | ❌ per-project only | ✅ PWA Kanban + queue | **Supervisor wins** — keep + sharpen |
| **External task intake** (webhooks, HTTP, file drops) | ❌ requires manual `/spec` | ✅ Loom webhook, HTTP API, CLI submit-task | **Supervisor wins** — extend |
| **Three-route classifier** | ❌ | ✅ policy + LLM fallback | **Supervisor wins** — apply per-task |
| **Self-revision / QA loops** | ❌ explicit non-goal ("guardrailed, human-steered — not fire-and-forget") | ✅ critic pass | **Supervisor wins** — opt-in per profile |
| **Cross-channel escalation** | ❌ in-IDE Approve only | ✅ PWA / Slack / email / role-aware | **Supervisor wins** — keep |
| **Knowledge-driven recommendations** (memory → proposed specs) | ❌ | ➖ Basic Memory wired but not used to PROPOSE work | **Supervisor unique** — build out |
| **Approval inbox** (review-before-queue) | ➖ has Approve on completion, not on intake | ❌ | **Supervisor unique** — build |
| **Playwright QA agents** | ❌ no specific QA workflow | ❌ planned, not built | **Supervisor unique** — build (as Frame-dispatched spec workers) |
| **Audit + onboarding docs** | ➖ PROJECT_NOTES.md but per-project | ✅ cross-project HANDOFF.md, PROJECTS.md, AUDIT-*.md | **Supervisor wins** — keep |

---

## 5. The new role: supervisor as intake funnel + cross-project hub

### 5.1 What supervisor STOPS doing

- ❌ Per-task git worktree management — Frame's `orchestrationManager` owns this
- ❌ Footprint conflict guard — Frame's `findFootprintConflict` is code-enforced
- ❌ Parallel scheduler — Frame's conductor handles wave dispatch
- ❌ Direct spec lifecycle UI — Frame's Specs panel + `/spec.*` commands
- ❌ Trying to be the cockpit for an active orchestration run — Frame is

### 5.2 What supervisor KEEPS

- ✅ PWA, now as a **cross-project bird's-eye view** mirroring all projects' `.frame/specs/*/status.json` state
- ✅ Web Push notifications, deliverable viewer, file actions
- ✅ Cross-channel escalation routing (Slack/email/PWA modal) — but escalations now ORIGINATE from Frame workers OR from intake classifier
- ✅ Memory integration (Basic Memory MCP) — per-project knowledge graphs
- ✅ Audit + onboarding documentation system
- ✅ HTTP API + webhook receivers (Loom is already wired)

### 5.3 What supervisor BUILDS NEW

- 🆕 **Intake API** — typed input from many sources: meeting transcript, request text, file drop, webhook payload, calendar event, knowledgebase delta
- 🆕 **Classifier-driven spec proposer** — given intake + project context (memory, recent commits, open issues), generate **proposed spec drafts** (new spec / modification to existing / improvement recommendation)
- 🆕 **Approval inbox** — PWA view: list of pending proposals, each with rationale + classifier confidence + suggested target project. Actions: Approve (writes `.frame/specs/<slug>/spec.md` in target project) · Edit · Reject · Defer.
- 🆕 **Cross-project orchestration dashboard** — single PWA view showing every project's spec state aggregated (queued / running / approved / done across all projects)
- 🆕 **Playwright QA agent** — special profile that, when given a deliverable, spawns a Playwright-driven test loop and reports pass/fail
- 🆕 **Self-revision as Frame-worker-callable** — supervisor's critic exposed via MCP server so any Frame worker can invoke `mcp__supervisor__critique_outcome` at end of a task

---

## 6. The user flow (the central hub workflow)

```
1. EXTERNAL INPUTS arrive at supervisor's intake API:
   - Loom meeting transcript (webhook)
   - Calendar event with action items (webhook)
   - GitHub issue (webhook)
   - Chris pastes raw text via PWA "New input" button
   - File drop into /intake/inbox/
   - Voice memo transcription (future)

2. CLASSIFIER + MEMORY analyze:
   - Which project does this belong to? (uses Basic Memory + path heuristics)
   - Is this a new spec, modification to existing, or improvement rec?
   - What's the relevant prior context? (memory search)
   - Generate a draft spec.md scaffold + suggested footprint + dependencies

3. APPROVAL INBOX surfaces in PWA:
   ┌──────────────────────────────────────────────┐
   │  📥 Proposed: "Add invoice export to CSV"    │
   │  Project: Localized                          │
   │  Type: new spec  ·  Confidence: 87%          │
   │  Source: Loom 2026-06-20 standup transcript  │
   │  Footprint: src/billing/*, tests/billing/*   │
   │  [View draft] [Approve] [Edit] [Reject]      │
   └──────────────────────────────────────────────┘

4. CHRIS REVIEWS:
   - Approve → supervisor writes .frame/specs/<slug>/{spec,plan,tasks}.md
              into the target project's worktree; status.json phase=planned
   - Edit    → opens the draft in PWA editor; on save, same as Approve
   - Reject  → archived with reason; memory updated to not re-propose
   - Defer   → snoozed N days

5. APPROVED SPECS appear in Frame's Specs panel (target project) within seconds
   (Frame's existing spec watcher picks them up from .frame/specs/).

6. CHRIS DISPATCHES via Frame's Orchestrator:
   - Open project in Frame
   - Click "Start Orchestrator"
   - Conductor agent receives the assigned specs
   - Parallel workers spawn in worktrees, footprint-guarded

7. SUPERVISOR PWA shows a CROSS-PROJECT view of all running orchestrations:
   ┌─────────────────────────────────────────────────┐
   │  Frame Orchestrations · Live                   │
   │  ─────────────────────────────────────────────  │
   │  Localized:  3 specs · 2 running · 1 queued    │
   │  Renovive:   1 spec  · approved, awaiting merge │
   │  Kitli:      —                                  │
   │  Mason:      1 spec  · done                     │
   │  Supervisor: 2 specs · 1 running · 1 done       │
   └─────────────────────────────────────────────────┘

8. WORKERS optionally invoke supervisor's smarts mid-task:
   - mcp__supervisor__classify_decision → routes via 3-route policy
   - mcp__supervisor__critique_outcome → self-revision pass
   - mcp__supervisor__escalate → routes to Chris via PWA/Slack/email per role

9. CHRIS APPROVES MERGE in Frame's UI (standard Frame UX).

10. POST-MERGE, supervisor:
    - Records outcome to memory (decisions/, outcomes/)
    - Notifies originating source (e.g. replies to the Loom comment thread)
    - Closes the inbox item

11. PWA's cross-project dashboard reflects done state.
```

---

## 7. Phased delivery — what gets built when

Each row is a Frame spec. They go into `.frame/specs/<slug>/` in the **supervisor** repo, dispatched via Frame's Orchestrator (dogfooding the new framework).

| Order | Spec slug | Scope | Cost | Wall time |
|---|---|---|---|---|
| 1 (first) | `cross-project-dashboard` | PWA gains a Frame-orchestration view aggregating `.frame/specs/*/status.json` across all known projects | $5–15 | 1 day |
| 2 | `intake-api-and-receiver` | Typed intake API + receivers for HTTP, file-drop, expanded Loom webhook → writes to `intake/inbox/*.json` | $10–20 | 1–2 days |
| 3 | `classifier-spec-proposer` | Given intake + project context, generate proposed `.frame/specs/<slug>/spec.md` drafts (uses classifier + memory) | $20–35 | 2–3 days |
| 4 | `approval-inbox-pwa` | PWA inbox view: list proposals, action buttons (Approve / Edit / Reject / Defer), atomic write to target project's `.frame/specs/` on approve | $15–25 | 2 days |
| 5 | `supervisor-mcp-server` | Wrap supervisor classifier + critic + escalation as MCP server — workers can call `mcp__supervisor__*` | $30–50 | 3–4 days |
| 6 | `playwright-qa-agent-profile` | Profile + harness that spawns Playwright-driven QA on a deliverable; reports pass/fail to spec outcome.md | $25–40 | 2–3 days |
| 7 | `meeting-transcript-pipeline` | End-to-end: Loom comment → classifier → proposal → inbox → approval → spec scaffold | $20–35 | 2–3 days |
| 8+ | (per-project flows, slack adapter completion, calendar adapter, …) | … | … | … |

**Total to MVP central hub:** ~$95–155 + 8–12 days agent wall time. After spec 5 (`supervisor-mcp-server`), the loop is operational end-to-end.

---

## 8. Recommended architecture (one diagram, prose)

```
┌──────────────────────────────────────────────────────────────────────────┐
│  EXTERNAL SIGNAL                                                          │
│  Loom · GitHub · Calendar · ClickUp · file drops · manual PWA input      │
└──────────────────────┬───────────────────────────────────────────────────┘
                       │ webhook / HTTP / CLI / file watcher
                       ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  SUPERVISOR — INTAKE LAYER                                                │
│  intake/api/ + intake/receivers/* → normalized payloads in inbox/        │
└──────────────────────┬───────────────────────────────────────────────────┘
                       │ classifier + memory search
                       ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  SUPERVISOR — SPEC PROPOSER                                               │
│  Generate {project, kind, draft spec.md, footprint, deps, confidence}   │
└──────────────────────┬───────────────────────────────────────────────────┘
                       │ enqueue for review
                       ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  SUPERVISOR — APPROVAL INBOX (PWA)                                        │
│  [Approve] [Edit] [Reject] [Defer]                                       │
└──────────────────────┬───────────────────────────────────────────────────┘
                       │ on Approve: atomic write of
                       │ <project>/.frame/specs/<slug>/spec.md, plan.md, status.json
                       ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  FRAME — Per-project Orchestrator                                         │
│  Specs panel surfaces the new spec → user clicks "Start Orchestrator"   │
│  Conductor + parallel workers in .frame/worktrees/<slug>                 │
└──────────────────────┬───────────────────────────────────────────────────┘
                       │ workers can call (via MCP)
                       ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  SUPERVISOR — MCP SERVER (smart-worker amplifier)                         │
│  mcp__supervisor__classify_decision · critique_outcome · escalate        │
│  → may route escalation via Slack / email / PWA modal                   │
└──────────────────────┬───────────────────────────────────────────────────┘
                       │ worker done → user approves merge in Frame
                       ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  SUPERVISOR — CROSS-PROJECT DASHBOARD (PWA)                               │
│  Aggregates .frame/specs/*/status.json across ALL projects               │
│  + writes outcomes to per-project Basic Memory + notifies origin source │
└──────────────────────────────────────────────────────────────────────────┘
```

The supervisor is now an **L-shape** wrapping Frame:
- **Top of L:** intake → classification → proposal → approval (everything BEFORE Frame)
- **Right of L:** cross-project view + MCP smart-worker amplifier + outcome capture (everything ALONGSIDE/AFTER Frame)

Frame owns the vertical: spec lifecycle + parallel execution + cockpit + merge.

---

## 9. Open questions for Chris

1. **Approval inbox UX defaults** — when a proposal is high-confidence (>90%), do you want auto-approve into Frame, or always require click? (Recommendation: always require click for v1; auto-approve as a per-source opt-in later.)

   **Answer (2026-06-21, working stance):** Always require click for v1. Per-source auto-approve opt-in deferred to a post-MVP follow-up.

2. **Per-project profile defaults** — when intake fires for "Renovive," should the classifier always use `profiles/renovive-*.yaml`? Or pick based on intake content? (Recommendation: project-first, content adjusts within project's profile family.)

   **Answer (2026-06-21, working stance):** Project-first; classifier may pick within a project's profile family based on intake content.

3. **Memory writes from approved specs** — should approving a spec ALSO write a memory note ("user accepted proposal X about Y") so future proposals can be more aligned? (Recommendation: yes — implicit feedback loop.)

   **Answer (2026-06-21, working stance):** Yes. Approval writes to per-project Basic Memory under `decisions/` for the implicit feedback loop.

4. **Cross-project supervisor PWA vs Frame's per-project UI** — are these two views complementary forever, or does the PWA eventually become the primary surface? (Recommendation: complementary. Frame is the work surface; PWA is the inbox + cross-project oversight surface. Use the right tool for each moment.)

   **Answer (2026-06-21, working stance):** Complementary. Frame = work surface; PWA = inbox + cross-project oversight.

5. **Playwright QA when** — does QA run BEFORE the user's Approve click (gates merge) or AFTER (informs merge)? (Recommendation: AFTER, surfaced as additional info on the Approve panel. Don't block the user; inform them.)

   **Answer (2026-06-21, working stance):** AFTER. QA result surfaces on the Approve panel as info; it doesn't gate.

6. **Conductor model — your supervisor or Frame's?** — Frame's conductor is just a Claude session reading `CONDUCTOR.md`. Could supervisor REPLACE that with a smarter conductor (classifier-aware, memory-aware)? (Recommendation: NOT v1 — Frame's conductor is fine. v2 if Frame's conductor proves limited.)

   **Answer (2026-06-21, working stance):** Not v1. Revisit only if Frame's conductor proves limited in practice.

7. **What's the cadence?** — do you want supervisor running 24/7 daemon? Only when you've got Frame open? Only during work hours? (Recommendation: 24/7 daemon for intake API to receive webhooks; PWA pollable anytime.)

   **Answer (2026-06-21, working stance):** 24/7 daemon for the intake API (webhooks need to land anytime); PWA pollable on demand.

---

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Frame upstream changes spec format → supervisor's spec scaffolder breaks | Use `specManager.js`'s exported helpers (e.g. `generateSlug`, schema constants) as the source of truth. Snapshot Frame versions; test our scaffolder against each upstream pull. |
| Classifier proposes bad specs → user wastes time rejecting | Confidence threshold (>70%) before surfacing; sub-threshold proposals stay in a "low-confidence" folder for batch review. |
| Approval inbox grows to hundreds of items | Auto-archive after 30 days; per-project Slack digest of pending items. |
| Two paths to create specs (PWA inbox vs Frame `/spec` direct) confuse | Document explicitly: `/spec` is for in-flight work decisions; PWA inbox is for external/asynchronous intake. Both write to the same `.frame/specs/` so Frame sees them identically. |
| Footprint conflict if supervisor writes spec while user is `/spec`-ing | PWA approval action checks for existing slug; rejects with helpful error. Atomic file writes via temp+rename. |
| MCP server overhead per worker call | Cache classifier policy decisions locally; only consult LLM when policy ambiguous. |
| Self-revision loop over-fires (bug #44) | Fix bug #44 BEFORE wiring critic into Frame workers. The supervisor's existing critic is too aggressive on completion summaries. |

---

## 11. Decision needed (gating the first spec)

Before queueing `cross-project-dashboard` (Frame spec, separate from this doc), please confirm:

- **(a)** Direction broadly correct? (intake funnel + cross-project hub + smart-worker MCP)
- **(b)** First spec scope right? (cross-project-dashboard reintroduces what Frame is missing)
- **(c)** Roadmap ordering (1→7) reasonable? Specifically: intake-api before classifier-proposer; classifier-proposer before approval-inbox; supervisor-mcp-server before playwright-qa-agent.
- **(d)** Anything missing from the unique-value list? (intake sources you want that I didn't list?)
- **(e)** Open questions §9 — answers welcome inline.

### Confirmations (2026-06-21, working stance)

- **(a) Confirmed** — direction is correct: intake funnel + cross-project hub + smart-worker MCP, with Frame retaining the vertical (spec lifecycle, conductor/workers, footprint guard, merge).
- **(b) Confirmed** — `cross-project-dashboard` is the right first spec; it's the lowest-risk, highest-feedback piece (read-only consumption of `status.json` Frame already writes).
- **(c) Confirmed** — ordering stands: intake-api → classifier-proposer → approval-inbox → supervisor-mcp-server → playwright-qa-agent → meeting-transcript-pipeline.
- **(d) Nothing missing yet** — intake sources noted (Loom, GitHub, Calendar, ClickUp, file drops, manual PWA, voice memo future). Add as discovered.
- **(e) Answered inline above** in §9.

These are working-stance confirmations recorded to unblock the roadmap; flip any line and reopen the corresponding child spec if a stance changes.

Once confirmed, I'll mark this PRD as `Approved` and queue `cross-project-dashboard` as the first Frame spec to dispatch via Frame's Orchestrator (dogfooding the integration). It's already scaffolded at `.frame/specs/cross-project-dashboard/` with phase=`planned`.

---

## 12. References

- Frame README — Spec-Driven Development + Agent Orchestration sections
- Frame `src/templates/orchestration/CONDUCTOR.md` + `WORKER.md` — protocol contracts
- Frame `src/main/orchestrationManager.js` — execution engine (worktree, footprint guard, drift check)
- Frame `src/main/specManager.js` — spec lifecycle + phase derivation
- Supervisor `CLAUDE.md` — original supervisor goals (P0 spec)
- Supervisor `docs/HANDOFF.md` — current state
- Archived obsolete plan: `archive/obsolete-frame-integration-2026-06-21/` (frame-002 through frame-006)
- Frame snapshot before catch-up: branch `chris-local-pre-orchestration-2026-06-21`, tag `pre-upstream-pull-2026-06-21`

Note, I have a version of this working from my Frame branch, and portion working form my /Users/christophercampbell/Desktop/lemonade-stand/autonomous_agent/autonomous-supervisor/supervisor directory (where this spec was generated from).  The intention is to make Frame my unified interface for execution, but this requires reviewing both Frame & Supervisor apps for how to port over features
