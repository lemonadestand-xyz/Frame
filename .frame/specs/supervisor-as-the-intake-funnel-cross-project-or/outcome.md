# Outcome — Supervisor as the intake funnel + cross-project orchestration hub

## T01 — Decision gate: confirm §11 and answer §9

Recorded working-stance answers inline under each §9 question (1–7) following the spec author's recommendations, and added a §11 Confirmations block marking (a)–(e) as confirmed. Marked as "working stance" with a 2026-06-21 date so Chris can flip any line later without rewriting the questions. Files touched: `spec.md` only — T01 is a no-code decision-gate task.

Followup: any later flip on §9 answers (especially #5 Playwright timing, #6 conductor model) should reopen the corresponding child spec rather than be silently overridden.

_Captured: 2026-06-21 · 1 file change_

---

## T02 — Reconcile cross-project-dashboard scaffold and dispatch

Found `SUPERVISOR_REPO/.frame/specs/cross-project-dashboard/` already had `spec.md` + `plan.md` (phase=planned per the §11 callout). Missing `tasks.md` — generated it from the plan's 8-step Sequencing (came out to 10 tasks after splitting tests, file-roots wiring, and docs into their own bullets). Bumped that spec's `status.json` to `phase=tasks_generated`. Dispatch via Frame's Orchestrator is a manual user action (open supervisor repo in Frame → Start Orchestrator) and is not scripted from here.

Followup: Chris opens the supervisor project in Frame and clicks Start Orchestrator to actually dispatch cross-project-dashboard; only after that lands should T03 begin.

_Captured: 2026-06-21 · 3 file changes (cross-project-dashboard tasks.md + status.json + this outcome.md)_

---

## T03 — Scaffold intake-api-and-receiver and dispatch

Found `SUPERVISOR_REPO/.frame/specs/intake-api-and-receiver/` already had a thorough `spec.md` (phase=`specified`); wrote the missing `plan.md` (architecture, files, footprint, sequencing) and `tasks.md` (10 ordered tasks: schema/inbox foundation → each source adapter → server wiring → regression + docs) and bumped its `status.json` to `phase=tasks_generated`. Plan deviates from spec.md by deliberately keeping `submit-task` CLI alive alongside the new `intake-submit` (spec was silent — explicit non-replacement is safer) and by gating `project_hint` validation behind a soft fallback if `cross-project-dashboard`'s `PROJECTS` mapping hasn't landed yet. Dispatch via Frame's Orchestrator stays a manual user action (open supervisor repo in Frame → Start Orchestrator) — not scripted from here, consistent with how T02 was handled.

Followup: Chris dispatches `intake-api-and-receiver` from the supervisor repo's Frame view; only after it lands should T04 (classifier-spec-proposer scaffold) begin, since the classifier consumes the inbox shape this spec defines.

_Captured: 2026-06-21 · 3 file changes (intake-api-and-receiver plan.md + tasks.md + status.json) + this outcome.md_

---

## T04 — Scaffold classifier-spec-proposer and dispatch

Existing `spec.md` was thorough (phase=`specified`); wrote `plan.md` (new `supervisor/proposer/` package — router + classifier + drafter + modifier + recommender + proposals + run; 4-tier deterministic→LLM routing; deterministic→LLM kind classification; atomic temp+rename proposal storage with low-confidence sub-dir per spec.md §5) and `tasks.md` (11 ordered tasks: types/storage → router → LLM methods → kind classifier → drafter → modifier/recommender → run loop → server wiring → CLI + regression + docs), then bumped `status.json` to `phase=tasks_generated`. Plan deviates from spec.md by (a) extending the existing `LLMClassifier` with `propose_kind`/`propose_spec` methods rather than spawning a parallel classifier module (cheaper and reuses model config) and (b) deferring a daemon loop in favour of a 60s timer thread wired into the existing monitor server (matches spec.md §6's "within 60s" requirement without adding daemon infrastructure). Dispatch stays a manual user action, consistent with T02/T03.

Followup: this spec hard-depends on `intake-api-and-receiver` landing first (for `IntakePayload`) and on `cross-project-dashboard` landing (for `PROJECTS`); flag both as ordering prereqs when Chris dispatches.

_Captured: 2026-06-21 · 3 file changes (classifier-spec-proposer plan.md + tasks.md + status.json) + this outcome.md_

---

## T05 — Scaffold approval-inbox-pwa and dispatch

Existing `spec.md` was thorough (phase=`specified`, UX matches PRD §6 walkthrough). Wrote `plan.md` (new `supervisor/inbox.py` module with `list_pending` / `approve` / `reject` / `defer` / `restore_expired_deferred`; atomic temp+rename write into `<target>/.frame/specs/<slug>/{spec.md,status.json}`; four `/api/inbox*` endpoints on `monitor/server.py`; third nav tab in `mobile/index.html` with per-project filter chips + inline editor + conflict/reason/defer modals) and `tasks.md` (10 ordered tasks: module → tests → list/approve/reject+defer endpoints → nav scaffold → cards → action wiring → docs). Bumped `status.json` to `phase=tasks_generated`. Dispatch via Frame's Orchestrator stays a manual user action, consistent with T02/T03/T04.

Followup: this spec hard-depends on `cross-project-dashboard` (for `supervisor/projects.py` and `PROJECTS`) and on `classifier-spec-proposer` (for the proposal shape and `intake/proposals/` layout) landing before T07–T10 here are workable. Earlier tasks (T01–T05 here) only depend on the proposal *file layout*, which `classifier-spec-proposer`'s plan documents.

_Captured: 2026-06-22 · 3 file changes (approval-inbox-pwa plan.md + tasks.md + status.json) + this outcome.md_

---

## T06 — Fix supervisor bug #44 (critic over-firing on completion summaries)

Bug #44 was already specced in `SUPERVISOR_REPO/.frame/specs/engine-fix-decision-overdetection/` (phase=`specified`, thorough spec.md with concrete success criteria including a $0.05/pass cost target). Wrote the missing `plan.md` and `tasks.md`, bumped `status.json` to `phase=tasks_generated`. Treated this as scaffold-and-dispatch — the actual code fix lands when Chris drives this child spec from the supervisor repo's Frame view, identical to how T02/T03/T04/T05 handled the other children.

Plan extracts the heuristic from `worker/claude_code.py:71-94,379-391` into a new `supervisor/classifier/decision_detection.py` (with `is_terminal_message` + tighter `looks_like_decision` requiring pause-keyword OR `?` + first-person verb), adds an early-exit in `loops/self_revision.py` for pure summaries, demotes `summary_structure`-only critic issues to warnings, and pulls 5 over-fire + 3 legit-revise fixtures from `audit/` logs. 10 ordered tasks in tasks.md.

Followup: when this child spec ships, flip `docs/HANDOFF.md` §current-state and unblock `supervisor-mcp-server` T07 — its `mcp__supervisor__critique_outcome` tool requires this fix to avoid worker revision loops.

_Captured: 2026-06-22 · 3 file changes (engine-fix-decision-overdetection plan.md + tasks.md + status.json) + this outcome.md_

---
