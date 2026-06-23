# Frame supervisor loop — LLM-judged spec-driver across all phases

> **What we're building:** Replace Frame's implement-only autopilot with a per-spec **supervisor loop** that drives a spec end-to-end (spec → plan → tasks → implement → done) using LLM judgment, modelled on the autonomous supervisor's run loop. It writes `plan.md` / `tasks.md`, dispatches `/spec.implement` turns, runs an outcome critic, and only stops for genuine ambiguity surfaced as a task-scoped escalation. The user opens a spec, attaches a lane, flips Auto — Frame takes it from there.

---

## Background — what this builds on

The autonomous supervisor at `/Users/christophercampbell/Desktop/lemonade-stand/autonomous_agent/autonomous-supervisor/supervisor/` already encodes the pattern we want. The Explore-agent map (captured below) is the design contract:

- **Main loop** — `supervisor/loop.py:78-90` event-streams worker output; dispatches on `DECISION` events to `_handle_decision()` (line 130).
- **Single "next route" function** — `classifier/__init__.py:27-42` `DefaultClassifier.classify()`. Hard-policy fast path first (cost ceiling, escalate categories), then evidence-based shortcut, then LLM.
- **3-route enum** — `types.py:81-84` `AUTO_ANSWER` / `RESEARCH` / `ESCALATE`.
- **Critic** — `loops/self_revision.py:77-89`; bounded iteration cap.
- **Escalation = task-scoped pause** — `loop.py:159-177` blocks one task on `adapter.await_response()`; rest of system keeps running.

Frame today only owns the worker side of that picture (the `/spec.implement` dispatch loop in `src/main/autopilot.js`). Phase transitions (Spec → Plan → Tasks) are click-driven; there is no LLM-judged "is this ready to advance?" check, no policy fast-path, no escalation pause. The user just experienced the cost: 6 child-spec scaffold tasks (T02–T06 of `supervisor-as-the-intake-funnel-cross-project-or`) ran via manually invoked `__spec.implement.md` prompts, when the system could have driven them itself.

---

## Problem

1. **Phase transitions are click-driven.** Spec → Plan and Plan → Tasks each require a manual *Write the Plan* / *Break into Tasks* click. Auto only kicks in after the human has gotten the spec to `tasks_generated`. The supervisor would handle these via LLM-judged advancement.

2. **No readiness check.** A spec at `phase=specified` can be ambiguous, have unanswered decision-gate questions (§11/§9 blocks), or be missing context. Today nothing reads the spec and decides "ready to plan" vs "needs Chris's input." Autopilot just fires the next phase blind, or doesn't fire at all.

3. **No escalation primitive.** When a spec genuinely needs the user (an ambiguous task, a missing decision, a cost spike), there is no first-class pause + drafted-question pattern. The user notices because nothing is happening, or because they click in and see a stalled lane.

4. **No outcome critic.** Frame's autopilot considers a task complete when `tasks.json` flips `status=completed`. There's no second-pass check that the change actually shipped what the task asked for. The supervisor's self-revision loop catches the "agent said done but didn't" case.

5. **Stranded state requires manual intervention.** Today the user has to flip task statuses back to `pending`, edit phase by hand, or invoke runtime prompts directly when the loop loses track. The supervisor's loop reconciles state on every tick.

---

## Goal

### 1. A per-spec supervisor loop

New module `src/main/supervisorLoop.js`. One instance per Auto'd spec. Each tick:

1. **Snapshot state** — read `status.json`, `tasks.json` rows for this spec, the spec's lane state.
2. **Hard-policy fast path** — if there's no lane attached, or the spec is `phase=done`, or footprint conflicts with another in-flight spec, or the user pressed Pause → stop / wait.
3. **LLM-judged next step** — call a classifier that returns one of `ADVANCE_PHASE` / `IMPLEMENT_NEXT_TASK` / `RESEARCH` / `ESCALATE` / `CRITIC_PASS` / `DONE`.
4. **Dispatch** — translate the verdict into a concrete action (write a new runtime prompt, dispatch to the lane, append to the audit log).
5. **Wait for lane idle**, then loop.

Replaces the existing `autopilot.js`'s loop semantics; the implement-turn machinery (prompt files, no-progress diagnostic) stays and becomes one of the dispatch paths.

### 2. The Frame classifier

```js
classifyNextStep({ spec, status, tasks, laneInfo, recentAudit }) → {
  route: 'advance' | 'implement' | 'research' | 'escalate' | 'critic' | 'done',
  action: { kind, ... },           // concrete dispatch payload
  reasoning: string,
  confidence: 0..1,
  draftedQuestion?: string         // populated only on 'escalate'
}
```

Hard-policy fast path mirrors `classifier/policy.py`:

- `phase === 'specified'` + spec.md missing answers to a `## Open Questions` section → ESCALATE with drafted question
- `phase === 'planned'` + `plan.md` missing a `## Footprint` block → ESCALATE
- pending count > 0 + lane attached → IMPLEMENT
- pending count === 0 + phase ≠ 'done' → CRITIC then ADVANCE/DONE
- footprint conflict with another in-flight spec → wait (no escalation, just defer)

LLM fallback (Claude Haiku via `claude -p --output-format json --max-turns 1`, same shape as supervisor's `classifier/llm.py:93-99`): given the spec text + current phase + recent audit entries, judge "what should happen next" with a confidence score. Below `confidence_threshold` → demote to ESCALATE.

### 3. Phase-advancement dispatch

For `route='advance'`, the supervisor:
- writes the next runtime prompt under `.frame/runtime/prompts/<slug>__spec.<next-phase>.md` (same path autopilot already uses for implement turns)
- dispatches it to the spec's lane
- waits for lane-idle + the new file to land
- reconciles phase via `specManager.reconcilePhase`

The runtime-prompt templates for `spec.plan` and `spec.tasks` already exist; the supervisor reuses them unchanged.

### 4. Outcome critic

After every task lands (`tasks.json` flip to `completed`), the supervisor calls `critique()` — same shape as `loops/self_revision.py:77-89`:

```js
critique({ task, beforeTasksJson, afterTasksJson, outcomeMdEntry, footprintDiff })
  → { passed, issues, correctiveInstructions, reasoning, confidence }
```

- Haiku-cost; bounded by `iterationCap` (default 2)
- On `passed=false`: dispatches a corrective runtime prompt to the lane, increments counter
- On `iterationCap` hit: ESCALATE with drafted question "T<n> did not ship what the task asked for after 2 revision passes — review and decide"

Bug #44 ("critic over-fires on completion summaries") MUST land in the supervisor repo before this is wired here, OR Frame ships with the same `is_terminal_message` short-circuit fix in `supervisor.critic.js`. Working stance: **port the fix**, don't wait on the supervisor child spec.

### 5. Escalation primitive

`escalate({ slug, taskId, category, draftedQuestion, options[] })` → writes a `.frame/specs/<slug>/escalations/<id>.json`, emits a `supervisor-escalation` event, the renderer surfaces a modal on the spec card (similar to `taskInfoModal.js` but inbound). User answers; the loop reads the response from the same file and resumes.

Escalation pauses **only this spec's loop**, not other Auto'd specs. Project Autopilot continues to work other specs in parallel.

### 6. Audit log = the source of truth

Every tick appends to `.frame/specs/<slug>/supervisor-audit.jsonl` with:
```json
{ "ts": "...", "tick": N, "phase": "...", "route": "implement",
  "actionKind": "implement_turn", "reasoning": "...", "confidence": 0.82,
  "beforeUndone": 4, "afterUndone": 3 }
```

The existing `autopilot-events.jsonl` is renamed and absorbs supervisor events too. The renderer's *Audit* tab continues to read it.

### 7. UX surface

- The Auto button on the spec header (already shipped via `autopilot-arm-from-any-phase`) is now the supervisor's enable/disable switch.
- The Audit tab shows the supervisor's tick stream, not just implement turns.
- Escalations surface as a card-level chip ("Awaiting input · Q: ...") + modal.
- No new top-level UI.

---

## Scope-correction (2026-06-22)

This spec is now **child A** of `frame-parity-with-supervisor`. The user
explicitly brought cross-project + memory + profile awareness IN scope. The
prior non-goals around those are removed below.

The supervisor loop in this spec is responsible for both **per-spec** and
**cross-project** orchestration modes:

- **Per-spec mode** — one loop drives one spec to done, as originally drafted.
- **Cross-project mode** — one supervisor instance iterates across every Frame-
  project the user has open, applying the policy fast-path + footprint guard
  at the project boundary. Each project's loop is a sub-loop; this mode wraps
  them. Powers child D (`frame-cross-project-orchestration-ui`).

This spec also assumes children B (`frame-project-profiles-and-memory`) and
C (`frame-capabilities-registry`) have landed — the classifier reads
`ProjectProfile.policy` and dispatches RESEARCH through the capability
registry. If B/C have not landed, the supervisor loop falls back to a
deterministic default profile and skips RESEARCH (demote to ESCALATE on
unknowns), still functional but with less judgment.

## Non-goals

- **No worker model swap inside this spec.** The `WorkerInterface` refactor
  lives in child F (`frame-worker-abstraction`). This spec consumes whatever
  worker abstraction exists at the time it lands.
- **No silent code rewrites.** Critic surfaces failures via revision prompts;
  if the worker disagrees, the iteration cap fires the ESCALATE path.
- **No cost ceiling (yet).** Frame has no per-turn USD telemetry today
  (`AUTOPILOT.md` "Known gap"). The supervisor's `cost_ceiling_usd` policy
  rule is encoded in the read path but inert until cost telemetry lands.
- **No supervisor-app replacement.** The autonomous supervisor app stays the
  central hub for intake / classification / approval-inbox. Frame's supervisor
  loop covers the work that happens *after* a spec lands in a project — the
  in-Frame execution side. Cross-project orchestration in Frame complements,
  not replaces, the supervisor app's cross-project dashboard.

---

## Constraints

- **Existing autopilot machinery stays.** Runtime prompt files, no-progress diagnostic, `readUndoneCount`, lane lock, footprint guard — all preserved. The supervisor wraps them.
- **`status.json` shape is additive only.** No breaking changes to the existing phase enum or fields.
- **Audit JSONL is append-only.** Schema additions OK; field renames require a back-compat reader.
- **Graceful stop must work** (AUTOPILOT.md rule 1). The supervisor's stop signal is checked at every tick boundary.
- **One supervisor per spec.** Multiple supervisors on the same spec is a bug; enforced by a process-local Map keyed by slug.

---

## Open questions

1. **Where does the classifier call live — main process or a child Claude process?**
   Working stance: main process via `claude -p --output-format json` subprocess (same shape supervisor uses). Inline subprocess means no extra config; the user already has `claude` on PATH for lane dispatch.

2. **Confidence threshold for demoting LLM verdict to ESCALATE.**
   Working stance: `0.65`. Same as the supervisor's `LLMClassifier` fallback.

3. **Critic iteration cap.**
   Working stance: `2`. Aggressive but the user's stated value is throughput, not exhaustive QA. Configurable per-spec via `.frame/specs/<slug>/supervisor.json`.

4. **Phase-readiness check for `specified → planned`.**
   The supervisor needs to decide "is this spec well-formed enough to plan?" before invoking `/spec.plan`. Cheap signal: presence of `## Open Questions` with unanswered entries. LLM signal: classifier judges spec.md completeness. Working stance: deterministic check first (open questions block), LLM only if deterministic check passes.

5. **What happens to currently-running specs when the supervisor lands?**
   Working stance: existing `autopilot.json` files with `enabled: true` continue to drive implement turns under the old loop until the user explicitly opts in to the supervisor by setting `mode: "supervisor"` in the per-spec config. New specs default to supervisor mode. Three-month transition window.

6. **Does the project-scoped autopilot become a project-scoped supervisor?**
   Working stance: yes — same wrapping. Project supervisor iterates over each Auto'd spec's supervisor, applying the footprint guard at the project level.

7. **Persistence of escalation answers.**
   Working stance: the answer is written into spec.md / plan.md as an inline "Answered (date): ..." block, then the escalation JSON is moved to `escalations/answered/<id>.json`. Mirrors the cross-project-dashboard's approval write contract.

---

## Success criteria

1. A spec at `phase=specified` with no open questions, Auto on, lane attached → reaches `phase=done` without any user click after the initial enable.

2. A spec at `phase=specified` with unanswered `## Open Questions` triggers ESCALATE on the first supervisor tick; the modal renders with the drafted question; user answers; the loop resumes and reaches `phase=done`.

3. A task that lands but did not change any file in the spec's footprint triggers the critic; the critic dispatches a corrective revision; the worker fixes; the loop continues.

4. Footprint conflict between two Auto'd specs in the same project causes the second to wait (not escalate). When the first finishes, the second resumes.

5. The Audit tab shows one entry per supervisor tick with route + reasoning + confidence. The user can read why every dispatch happened.

6. Stopping autopilot mid-spec works gracefully — the in-flight turn finishes, the next tick does not fire, the supervisor closes its loop.

7. The supervisor handles the exact scenario that surfaced this spec: `supervisor-as-the-intake-funnel-cross-project-or` is reopenable with Auto on, and the loop dispatches T07–T10 in sequence without any user intervention.

---

## Followup roadmap (out of scope for this spec)

- Per-turn cost telemetry → wire `budget_usd` to a real ceiling (`AUTOPILOT.md` "Known gap")
- Memory backend (Basic Memory MCP) for "prior decisions on similar specs" — supervisor classifier reads the same kind of evidence the autonomous supervisor does
- The 3rd route in the supervisor's classifier — RESEARCH — needs a Frame equivalent capability. v1 skips RESEARCH; supervisor demotes to ESCALATE. v2 adds Frame-specific research capabilities (read related specs, grep codebase, fetch a spec's outcome history).
