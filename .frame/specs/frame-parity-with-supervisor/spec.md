# Frame parity with the autonomous supervisor — roadmap

> **What we're building:** Bring Frame to full feature parity with the autonomous supervisor reference implementation at `/Users/christophercampbell/Desktop/lemonade-stand/autonomous_agent/autonomous-supervisor/supervisor/`. Frame becomes the UI + execution framework for the supervisor's proven patterns: LLM-judged routing, per-project profiles, Basic Memory, research capabilities, cross-project orchestration, multi-channel escalation. The supervisor stays the reference; Frame becomes the operating surface.

---

## Background

Two Explore-agent passes mapped the supervisor (anchors below). The control flow is solid (3-route classifier → AUTO/RESEARCH/ESCALATE → bounded critic loop → audit log) and the capability surface is durable (Basic Memory, ProjectProfile YAML, capability registry, worker abstraction, console/mobile/slack/email adapters). Frame today has only the implement-turn slice and the basic spec/lane UI; everything else is missing or click-driven.

The user's directive: *"Frame is mostly just UI and framework for executing the concepts in supervisor reference implementation. Push this UI to account for all items we have there."*

---

## Problem — what Frame is missing relative to the supervisor

1. **No per-project profile.** Frame has no equivalent to `ProjectProfile` (`supervisor/types.py:193-210`). Policy rules, role authority, budgets, context sources, capabilities — none are first-class. Today every spec runs under the same implicit policy.
2. **No persistent memory.** Basic Memory mirroring of decisions / outcomes / rules per project (`supervisor/memory.py:60`, `supervisor/store/memory_mirror.py:40-80`) does not exist in Frame. Each spec session starts blind.
3. **No capability / research layer.** The supervisor's RESEARCH route runs `SpecReader`, `KnowledgeSearch`, `WebResearch` (`supervisor/capabilities.py:155-176`) and re-classifies with the evidence. Frame's autopilot has no analogue — it can't gather context before acting.
4. **No LLM-judged routing.** Phase transitions (spec → plan → tasks) are click-driven. The supervisor's `DefaultClassifier.classify` (`supervisor/classifier/__init__.py:27-42`) is the single function deciding "what's next"; Frame has nothing equivalent.
5. **No cross-project visibility from Frame.** The supervisor PWA aggregates queue state (`supervisor/scripts/monitor/server.py:54-68`); the cross-project-dashboard child of `supervisor-as-the-intake-funnel-cross-project-or` builds that in the supervisor app. Frame itself has no cross-project board — yet the user wants Frame to be the central command surface.
6. **Worker layer is concrete, not abstracted.** `agentDispatch.js` knows about claude-code, codex, gemini lane-by-lane. The supervisor's `WorkerInterface` (`supervisor/types.py:230-239`) is a clean abstraction Frame should mirror so future workers drop in.
7. **Escalation is implicit.** No first-class "pause this spec, surface drafted question, resume on answer" primitive. The supervisor's `MobileApiAdapter` + Console adapter (`supervisor/adapters/`) define this surface.

---

## Goal — six child specs covering the parity gap

### Children (this meta-spec coordinates; each child has its own Spec → Plan → Tasks → Implement → Done lifecycle):

#### A. `frame-supervisor-loop` *(exists at `phase=specified`; will be scope-corrected by this meta-spec)*
The LLM-judged loop driving one or many specs end-to-end. Reads `ProjectProfile`, dispatches via the capability registry + worker abstraction, writes to memory on durable decisions, surfaces escalations through adapters. **In scope: cross-project supervisor loop** (was deferred — flipped IN by this meta-spec). The cross-project loop iterates across every Frame-project the user has open, applying the same policy/footprint guards across project boundaries.

#### B. `frame-project-profiles-and-memory`
Port `ProjectProfile` (YAML in `.frame/profile.yaml` per project) + Basic Memory integration. Frame UI gains a Profile editor (read/write the YAML), Memory tab (browse decisions/rules/context per project), and an "Updated memory after this approval" feedback line so the user can see when the supervisor writes durable decisions. Combined into one spec because the profile declares where memory lives.

#### C. `frame-capabilities-registry`
Mirror `supervisor/capabilities.py`. Frame ships `SpecReader` (read `context_sources` from profile, keyword-score paragraphs), `KnowledgeSearch` (Basic Memory lookup, requires B), and `WebResearch` stub (placeholder until web fetch/search lands). Capabilities run before the classifier re-classifies, exactly as the supervisor does at `supervisor/loop.py:148-157`.

#### D. `frame-cross-project-orchestration-ui`
The aggregated dashboard the user asked for: one Frame view listing every project + every spec + every supervisor's current verdict (advance, implement, research, escalate, done). Per-project filter, per-spec drilldown, manual override per row. Powered by `frame-supervisor-loop`'s cross-project mode. Replaces the need to bounce between Frame instances; this is where Frame becomes the central surface.

#### E. `frame-escalation-adapters`
First-class escalation: drafted question + role + category + draft answer surfaces in the spec card (UI adapter), and optionally to Slack / Email per profile config. Mirrors `supervisor/adapters/mobile_api.py:24-44` and `supervisor/adapters/slack.py:18-32`. Frame's UI adapter is the v1 must-ship; Slack + Email are opt-in.

#### F. `frame-worker-abstraction`
Refactor `agentDispatch.js` behind a `WorkerInterface` contract (`start`, `events`, `answer`, `revise`) matching `supervisor/types.py:230-239`. Existing claude-code / codex / gemini paths land as `*Worker` implementations. Pure refactor; no user-visible change. Pre-requisite for swapping workers cleanly later.

---

## Ordering / dependency graph

```
            B (profiles + memory)
            │
            ▼
            C (capabilities)
            │
            ▼
    F ──►   A (supervisor loop) ──►   E (escalation adapters)
            │
            ▼
            D (cross-project UI)
```

- **B is the trunk.** Profiles encode the policy + context sources that everything downstream reads. Basic Memory is the durable substrate.
- **C depends on B.** `KnowledgeSearch` reads memory; `SpecReader` reads profile's `context_sources`.
- **F is independent** — pure refactor of the worker layer. Can land in parallel with B/C.
- **A consumes B + C + F.** The supervisor loop is the orchestration layer that ties profile/memory/capabilities/worker together via LLM judgment.
- **E depends on A** for the escalation primitive. UI adapter is v1; Slack/Email pluggable.
- **D depends on A's cross-project mode** but the UI scaffolding can land in parallel.

Ship order: **B → F (parallel) → C → A → E → D**. Bug #44 (in the supervisor repo) must land before E wires the critic to escalate on critic failure — `engine-fix-decision-overdetection` already has `phase=tasks_generated`.

---

## Non-goals

- **No port of the supervisor's queue runner** (`scripts/self-build/queue_runner.py`). Frame already has tasks + lanes; that's the equivalent abstraction.
- **No port of `supervisor/scripts/monitor/server.py` HTTP layer.** Frame is a desktop app, not a server. The data shapes the monitor serves get rendered directly in Frame's renderer.
- **No port of the supervisor's `mongo` store** (PR-5 future in supervisor). Frame stays on JSONL + filesystem; multi-project persistence in Frame is the cross-project orchestration spec's job, not a DB swap.
- **No deletion of the supervisor app.** It remains the central hub for intake / classification / approval inbox. Frame absorbs the supervisor's engine patterns, not its role.
- **No re-implementation of the autonomous-supervisor codebase in Frame.** Where Frame can call the supervisor's running process (e.g. via MCP server from `supervisor-mcp-server` spec, once it lands), it does.

---

## Constraints

- **Each child spec is independently shippable.** No "all or nothing" — each one improves Frame on its own merits even if no other child lands.
- **Backward compatible with the existing autopilot.** Specs that don't opt into the supervisor loop continue running the implement-only autopilot. Per-spec opt-in via `.frame/specs/<slug>/supervisor.json` `mode: "supervisor" | "autopilot-legacy"`.
- **All persistence stays local-filesystem.** No new daemon, no new DB. Basic Memory uses the same `~/memory/<project>/` directory the supervisor uses — Frame *reads and writes* that directory, doesn't shadow it.
- **The supervisor process can co-exist.** If the user runs the supervisor app alongside Frame, both write to the same Basic Memory directory. No conflict, since BM is markdown-on-disk.
- **Frame meta files stay excluded from Footprint.** All new specs respect the existing `tasks.json` / `STRUCTURE.json` / `PROJECT_NOTES.md` / `AGENTS.md` exclusion.

---

## Open questions

1. **Where does `.frame/profile.yaml` live — per project repo or in user's `~/.frame/`?**
   *Working stance:* per-project repo (committed). Matches how the supervisor's `profiles/*.yaml` is treated as project config. Allows team-level profile sharing via git.

2. **Does Frame *call* the supervisor process or *port* its engine?**
   *Working stance:* port the engine (Node.js mirrors of the Python classifier/memory/capabilities). Calling the supervisor via MCP works but couples Frame to a running Python service. The MCP path stays optional for advanced workflows.

3. **Basic Memory write authority — does Frame write directly, or queue writes for the supervisor app to flush?**
   *Working stance:* Frame writes directly. Markdown-on-disk is idempotent; both processes can write safely. Conflicts surface as a git diff if BM is committed; the user resolves like any other file.

4. **Cross-project UI: a new top-level Frame window, or a tab inside the existing Home view?**
   *Working stance:* tab inside Home. The current Home board already has the lane-board; a sibling tab "Across projects" reuses the same surface.

5. **Escalation channels — must Slack/Email land in v1?**
   *Working stance:* no. UI adapter ships in v1; Slack/Email are flagged behind profile config and built as `frame-escalation-adapters` follow-ups.

6. **Worker abstraction blast radius.**
   *Working stance:* F is a pure refactor — no behaviour change, no new IPC channels, no UI change. Lands in a single PR with tests proving claude-code / codex / gemini paths still spawn correctly.

7. **Memory schema — store decisions per spec, per project, or both?**
   *Working stance:* per project (mirrors supervisor). Decisions inside a spec's outcome.md naturally reference the spec slug; the project-level memory is the durable substrate. Inter-spec linking via slug references.

---

## Success criteria

1. Each of the six children reaches `phase=done` independently.
2. After A + B + C + F land, an Auto'd spec at `phase=specified` reaches `phase=done` with zero user clicks (assuming no genuine ambiguity), reading profile policy and writing durable decisions to memory.
3. After D lands, the user can see every spec across every Frame-project the user has open, in one view, with the supervisor's verdict per row.
4. After E lands, an ambiguous spec pauses with a drafted question in a Frame modal; resuming the loop continues from the same tick.
5. F lands as a pure refactor — every existing test still passes; no user-visible change.
6. The supervisor app continues to function independently; Frame reads the same Basic Memory directory the supervisor writes.

---

## Anchors (supervisor reference)

| Capability | File | Lines |
|---|---|---|
| Main loop | `supervisor/loop.py` | 78–90 |
| Classifier | `supervisor/classifier/__init__.py` | 27–42 |
| Hard policy | `supervisor/classifier/policy.py` | 29–64 |
| LLM classifier | `supervisor/classifier/llm.py` | 65–77 |
| Critic | `supervisor/loops/self_revision.py` | 77–89 |
| 3-route enum | `supervisor/types.py` | 81–84 |
| ProjectProfile | `supervisor/types.py` | 193–210 |
| Profile loader | `supervisor/config.py` | 16–59 |
| Memory backend | `supervisor/memory.py` | 60 |
| Memory mirror | `supervisor/store/memory_mirror.py` | 40–80 |
| Capability registry | `supervisor/capabilities.py` | 155–176 |
| WorkerInterface | `supervisor/types.py` | 230–239 |
| LocalStore | `supervisor/store/local.py` | 17–48 |
| Adapters | `supervisor/adapters/` | (whole dir) |
| Example profile | `supervisor/profiles/solo.yaml` | (whole file) |
