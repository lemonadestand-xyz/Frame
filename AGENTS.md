# Frame - Project Instructions

This project is managed with **Frame**. AI assistants should follow the rules below to keep documentation up to date.

> **Note:** This file is named `AGENTS.md` to be AI-tool agnostic. A `CLAUDE.md` symlink is provided for Claude Code compatibility.

---

## Core Working Principle

**Only do what the user asks.** Do not go beyond the scope of the request.

- Implement exactly what the user requested — nothing more, nothing less.
- Do not change business logic, flow, or architecture unless the user explicitly asks for it.
- If a user asks for a design change, only change the design. Do not refactor, restructure, or modify functionality alongside it.
- If you have additional suggestions or improvements, **present them as suggestions** to the user. Never implement them without approval.
- The user's request must be completed first. Additional ideas come after, as proposals.

**Example:** If the user asks for a modal design change, only change the visual appearance. Do not add new IPC channels, modify event flows, or restructure code.

---

## 🧭 Project Navigation

**Read these files at the start of each session:**

1. **STRUCTURE.json** - Module map, which file is where
2. **PROJECT_NOTES.md** - Project vision, past decisions, session notes
3. **tasks.json** - Pending tasks

**Workflow:**
1. Read these files to understand the project and capture context
2. Identify relevant files based on the task
3. Update STRUCTURE.json after making changes (if new modules/files are added)

**Fast File Lookup:** When searching for files related to a feature or concept, run:
```bash
node scripts/find-module.js <keyword>
```
This searches STRUCTURE.json's intentIndex and returns the exact files you need. Use this **before** doing manual grep/glob searches. Examples:
- `node scripts/find-module.js github` → finds githubManager.js + githubPanel.js
- `node scripts/find-module.js terminal` → finds all terminal-related files
- `node scripts/find-module.js --list` → lists all features and their files

**Note:** This system doesn't prevent reading code - it just helps you know where to look.

---

## Spec-Driven Development (steer the conversation)

Frame is built around **spec-driven development**: significant work flows
through a spec (`spec.md` → `plan.md` → `tasks.md`) before code is written. This
is Frame's core way of working, so when a user describes meaningful new work
**mid-conversation**, gently steer them toward a spec instead of silently diving
into code.

### When to suggest a spec

Suggest a spec only for **significant work** — don't make this a reflex on every
message. Good triggers:

- A new **feature** or capability ("users should be able to …", "add a … system")
- A change that will touch **multiple files / modules** or affect architecture
- Anything that clearly benefits from a **plan and ordered tasks** before coding
- Work the user describes vaguely/largely and would benefit from being scoped first

**Do NOT suggest a spec for:**
- Typos, one-line fixes, small tweaks, renames → just do it
- Small, discrete tracked work → that's a **task** (see Task Management below)
- Questions, debugging, explanations, experiments
- Anything the user explicitly says to "just do" / "do directly"

Rough ladder: *trivial → just do it · small but worth tracking → task · sizable
feature or multi-file change → spec.*

### How to suggest

When a significant request appears, ask once, in plain language, before coding:

> "This is a sizable feature. Want me to handle it as a **spec** — I'll draft
> `spec.md`, then we plan it and generate tasks — or should I just implement it
> directly?"

- If the user agrees → start the spec flow (create the spec, then plan, then
  tasks). If they have the slash commands set up, point them at `/spec` etc.;
  otherwise scaffold `.frame/specs/<slug>/` per the existing structure.
- If the user says "just do it" / declines → proceed directly and **don't ask
  again for that same piece of work** in the session.
- Never force it. The spec is an offer, not a gate. The user's stated preference
  always wins.

---

## Task Management (tasks.json)

### Task Recognition Rules

**These ARE TASKS - add to tasks.json:**
- When the user requests a feature or change
- Decisions like "Let's do this", "Let's add this", "Improve this"
- Deferred work when we say "We'll do this later", "Let's leave it for now"
- Gaps or improvement opportunities discovered while coding
- Situations requiring bug fixes

**These are NOT TASKS:**
- Error messages and debugging sessions
- Questions, explanations, information exchange
- Temporary experiments and tests
- Work already completed and closed
- Instant fixes (like typo fixes)

### Task Creation Flow

1. Detect task patterns during conversation
2. Ask the user at an appropriate moment: "I identified these tasks from our conversation, should I add them to tasks.json?"
3. If the user approves, add to tasks.json

### Task Structure

```json
{
  "id": "unique-id",
  "title": "Short and clear title (max 60 characters)",
  "description": "AI's detailed explanation - what will be done, how it will be done, which files will be affected",
  "userRequest": "User's original request/prompt - copy exactly",
  "acceptanceCriteria": "When is this task considered complete? List of concrete criteria",
  "notes": "Important notes, decisions, alternatives that came up during discussion",
  "status": "pending | in_progress | completed",
  "priority": "high | medium | low",
  "category": "feature | fix | refactor | docs | test",
  "context": "Session date and context",
  "createdAt": "ISO date",
  "updatedAt": "ISO date",
  "completedAt": "ISO date | null"
}
```

### Task Content Rules

**title:** Short, action-oriented title
- ✅ "Add tasks button to terminal toolbar"
- ❌ "Tasks"

**description:** AI's detailed technical explanation
- What will be done (what)
- How it will be done (how) - brief technical approach
- Which files will be affected
- Minimum 2-3 sentences

**userRequest:** User's original words
- Copy the user's prompt/request exactly
- Important for preserving context
- In "User said: ..." format

**acceptanceCriteria:** Completion criteria
- Concrete, testable items
- "Task is complete when this happens" list

**notes:** Discussion notes (optional)
- Alternatives considered
- Important decisions and their reasons
- Dependencies marked as "we'll do this later"

### Task Status Updates

- When starting work on a task: `status: "in_progress"`
- When task is completed: `status: "completed"`, update `completedAt`
- After commit: Check and update the status of related tasks

---

## PROJECT_NOTES.md Rules

### When to Update?
- When an important architectural decision is made
- When a technology choice is made
- When an important problem is solved and the solution method is noteworthy
- When an approach is determined together with the user

### Format
Free format. Date + title is sufficient:
```markdown
### [2026-01-26] Topic title
Conversation/decision as is, with its context...
```

### Update Flow
- Update immediately after a decision is made
- You can add without asking the user (for important decisions)
- You can accumulate small decisions and add them in bulk

---

## 📝 Context Preservation (Automatic Note Taking)

Frame's core purpose is to prevent context loss. Therefore, capture important moments and ask the user.

### When to Ask?

Ask the user when one of the following situations occurs: **"Should I add this conversation to PROJECT_NOTES.md?"**

- When a task is successfully completed
- When an important architectural/technical decision is made
- When a bug is fixed and the solution method is noteworthy
- When "let's do this later" is said (in this case, also add to tasks.json)
- When a new pattern or best practice is discovered

### Completion Detection

Pay attention to these signals:
- User approval: "okay", "done", "it worked", "nice", "fixed", "yes"
- Moving from one topic to another
- User continuing after build/run succeeds

### How to Add?

1. **DON'T write a summary** - Add the conversation as is, with its context
2. **Add date** - In `### [YYYY-MM-DD] Title` format
3. **Add to Session Notes section** - At the end of PROJECT_NOTES.md

### When NOT to Ask

- For every small change (it becomes spam)
- Typo fixes, simple corrections
- If the user already said "no" or "not needed", don't ask again for the same topic in that session

### If User Says "No"

No problem, continue. The user can also say what they consider important themselves: "add this to notes"

---

## STRUCTURE.json Rules

**This file is the map of the codebase.**

### When to Update?
- When a new file/folder is created
- When a file/folder is deleted or moved
- When module dependencies change
- When an IPC channel is added or changed
- When an important architectural pattern is discovered (architectureNotes)

### Format
```json
{
  "modules": {
    "main/tasksManager": {
      "path": "src/main/tasksManager.js",
      "purpose": "Task CRUD operations",
      "exports": ["init", "loadTasks", "addTask"],
      "depends": ["fs", "path", "shared/ipcChannels"]
    }
  },
  "ipcChannels": {
    "LOAD_TASKS": {
      "direction": "renderer → main",
      "handler": "main/tasksManager.js"
    }
  },
  "architectureNotes": {
    "circularDependencies": {
      "issue": "Description",
      "solution": "Solution"
    }
  }
}
```

### Update Rules
- Pre-commit hook updates automatically (before commit)
- Manual: `npm run structure`
- If you added a new IPC channel, check the ipcChannels section

---

## QUICKSTART.md Rules

### When to Update?
- When installation steps change
- When new requirements are added
- When important commands change

---

## General Rules

1. **Language:** Write documentation in English (except code examples)
2. **Date Format:** ISO 8601 (YYYY-MM-DDTHH:mm:ssZ)
3. **After Commit:** Check tasks.json and STRUCTURE.json
4. **Session Start:** Review pending tasks in tasks.json

---

## Agent Orchestration (conductor-led parallel specs)

Frame can run **several specs in parallel**, each by its own agent in its own
git worktree, coordinated by a **conductor** agent. Open it from the Home board
("Start Orchestrator") or the command palette (Open Orchestrator). The unit of
parallelism is the **spec** (a spec's own tasks run sequentially in one lane);
across specs run in parallel.

**Roles**
- **Conductor** — a Claude lane running `.frame/orchestration/CONDUCTOR.md`. It
  validates each assigned spec is `tasks_generated`, reads each spec's
  `## Footprint` (in `plan.md`) to detect file conflicts, dispatches
  parallel-safe specs, reviews worker reports, and merges.
- **Worker** — one Claude lane per spec, in `.frame/worktrees/<slug>` on branch
  `frame/<slug>/work`. Implements only that spec's `tasks.md` in order, commits
  to its own branch, **never pushes/merges**, and **never touches meta files**
  (`tasks.json`, `STRUCTURE.json`, `PROJECT_NOTES.md`, `AGENTS.md`).

**Command bus** — the conductor/worker talk to Frame via `.frame/bin/`:
`dispatch.js <slug>`, `report-done.js`, `merge.js <slug>`, `status.js`. Frame
(`orchestrationManager`) owns worktrees, the bus, a **code-enforced conflict
guard** (refuses to run a spec whose footprint overlaps an in-flight one), and
the fast-forward merge into `frame/<slug>/integration`. `main` is never touched;
promoting an integration branch / opening a PR stays a manual user step.

**For the plan step:** every `plan.md` must declare a `## Footprint` — a flat
`- <path>` list of the source files the spec touches (meta files excluded). This
is what the conductor and Frame use to schedule safely.

---

## Autopilot (drive `/spec.implement` automatically)

Autopilot drives `/spec.implement` turns against a spec without manual clicks
between them. Same prompt the **Implement Next Task** button uses; same lane
the user already opened — just no click between turns. Full reference:
[`docs/AUTOPILOT.md`](docs/AUTOPILOT.md).

### Two scopes

- **Spec-scoped** — drives a single spec to completion. Toggle is the **Auto**
  button next to *Implement Next Task* in the spec section. Requires an
  attached Frame (lane) for the spec.
- **Project-scoped** — drives every spec in the project that has both pending
  tasks and an attached lane, picking the next parallel-safe one via the
  `## Footprint` conflict guard (same guard the conductor uses). Toggle is
  the **🤖 Project Autopilot** button at the top of the lane board.

### Hard rules

1. **Always graceful stop.** Stop never kills a turn mid-flight. The current
   turn finishes; the loop exits before the next dispatch. Never bypass.
2. **The canonical `spec.implement` template is read-only.** The
   no-progress diagnostic appendix is appended **at runtime** to the per-turn
   prompt file under `.frame/runtime/prompts/`, never to the template.
3. **`tasks.json` is the source of truth for progress.** Pending count is
   computed via `specManager.readPendingCount(projectPath, slug)` — do not
   shortcut by scraping terminal output.
4. **No cross-project autopilot.** Cross-project orchestration is the
   supervisor app's job; Frame autopilot stays single-project.
5. **Footprint is the parallel-safety gate.** Project autopilot will not
   spawn a sub-run whose footprint overlaps an in-flight sub-run. Specs
   without a `## Footprint` block in `plan.md` collide with everything
   (safe default) — author the footprint to unlock parallelism.

### Failure recovery

When a turn lands without reducing the pending count autopilot:

1. Bumps the no-progress counter.
2. Appends a diagnostic appendix to the next turn's prompt file:
   *"your previous attempt did not land — identify why and try a different
   approach"*.
3. Pauses with `pausedReason: max_turns_per_task` after the no-progress
   counter exceeds `caps.max_turns_per_task` (default 3).

Explicit errors (dispatch failed, staging failed) bypass the retry policy
and fail the run immediately.

### Caps (`.frame/specs/<slug>/autopilot.json` → `.frame/autopilot.json` → global)

```json
{
  "max_turns_per_task":   3,
  "max_total_turns":     50,
  "budget_usd":        null,
  "max_parallel_specs":  2,
  "pause_on_phase_transition": [],
  "stop_on_explicit_error": true
}
```

`budget_usd` is **advisory only** today — Frame has no per-run USD signal,
so the gate falls back to `max_total_turns` as the real ceiling. See
`docs/AUTOPILOT.md` "Known gap" for the upgrade path when a cost signal is
wired.

### Audit log — your source of truth

Every transition lands in `.frame/specs/<slug>/autopilot-events.jsonl` and
the spec section's **Audit** tab. Read it before re-dispatching after a
pause. Each per-turn record carries:
- `turn` — 1-indexed turn number
- `beforePending` / `afterPending` — pending-task delta
- `outcome` — `'progress'` or `'noprogress'`
- `retryAttempt` — non-zero when the diagnostic appendix fired

The project run writes its scheduling events to
`.frame/specs/_project/autopilot-events.jsonl` (the `_project` directory is
reserved — do not create a spec slug named `_project`).

### When to suggest enabling Auto

- Spec has 3+ pending tasks, all well-scoped (titles read as complete
  asks, no "decide between X and Y" ambiguity), AND a lane is already
  attached → suggest spec-level Auto.
- Project has multiple specs in `tasks_generated` / `implementing`, lanes
  attached, and you can see distinct footprints → suggest Project
  Autopilot.

### When NOT to suggest Auto

- The next task is ambiguous or requires a design decision the user
  should make. The diagnostic-retry budget will be wasted.
- Cost-sensitive runs (`budget_usd` is advisory only today).
- A spec where the first task is in progress AND blocked — fix the block
  first; Auto won't unstick it.

---

## UI editing — specs / plans / tasks from the panel

Specs ship with inline editors so the user does not have to bounce out
to a text editor for small corrections.

### What's editable

- **`spec.md` / `plan.md` / `tasks.md`** — each tab has an *Edit `<doc>`.md*
  button. Saving overwrites the file on disk and bumps the spec's
  `updated_at`. Saving `tasks.md` re-runs `syncTasksFromMarkdown`, so new
  markdown rows become tracked tasks immediately.
- **Add a pending task** — *+ Add* row at the bottom of the Tasks tab.
  Generates the next `T<n>` id, appends to `tasks.md`, upserts into
  `tasks.json`.
- **Remove a pending task** — trash icon on pending rows only. The
  backend (`specManager.removeSpecTask`) **rejects** deletion of any
  task that is `in_progress` or `completed` — historical record stays
  intact even if the user clicks the icon by mistake.

### Rules for agents

- Never silently restructure a spec when the user asked for a small edit.
  Surface the change inline instead.
- When the user asks to "remove a task that was already done", explain
  the historical-record guard and propose a status change (e.g. mark
  `completed` with a note) instead of trying to delete.
- The inline editor is **last-write-wins**; if a file watcher fires
  during edit, the renderer defers the re-render until save/cancel.

---

## Start options + `--continue` (per-tool launch flags)

Every lane Start runs `<tool.command> <flags>`. Flags persist per-tool in
`userData/ai-tool-config.json`. Surface: the **gear** button next to
*Start* in the sidebar agent footer opens the **Start options** popover.

### Claude presets

- `--dangerously-skip-permissions` — skip permission prompts (trusted
  local work)
- `--continue` — **resume the most recent Claude Code session in this
  directory.** This is the closest thing to "keep my sessions across a
  Frame reload" — the next spawn rehydrates state from
  `~/.claude/projects/...`. Claude Code's PTYs always die when Frame
  reloads (they're children of Electron); `--continue` is how you pick
  up where you left off.

### Custom flags

The popover also has a free-form *Additional flags* input — anything
that isn't a curated preset goes there. The "Will run" preview at the
bottom is the literal invocation that will land in the PTY.

### Rules for agents

- When the user says "resume my session" / "continue where I left off"
  / "I was in the middle of a Claude session", point them at the gear
  → Continue last session preset rather than telling them to re-prompt.
- The flag suffix flows into both the Start button **and** the
  agent-dispatch path (via `CHECK_AI_TOOL_AVAILABLE`'s `resolvedCommand`).
  A user who has enabled `--continue` will get session resumption on
  *every* new lane until they uncheck it.
- Switching tools (Claude → Codex etc.) does not clear other tools'
  saved flags — they're keyed by tool id.

---

## Workers (per-tool `WorkerInterface` registry)

Every CLI Frame can drive (claude, codex, gemini, plus the test-only
`fake`) is wrapped in a `WorkerInterface` implementation under
`src/main/workers/`. The renderer's `agentDispatch.js` and the
supervisor loop both dispatch through `workers.getWorker(toolName)` —
there is no per-tool branching outside the worker modules.

### The contract — `src/main/workers/types.js`

```js
class WorkerInterface {
  async start({ task, ctx, posture, exec }) { /* → SessionHandle */ }
  async *events(session)                    { /* yields WorkerEvent */ }
  async  answer(session, decisionId, reply) { /* resolve a DECISION */ }
  async  revise(session, instructions)      { /* → TaskResult */ }
  async  stop(session)                      { /* cleanup */ }
}
```

Shapes mirror `supervisor/types.py:230-239`. `SessionHandle`,
`WorkerEvent`, `TaskResult`, and the `Posture` enum live in
`src/shared/workerTypes.js` so main and renderer share them.

### The registry — `src/main/workers/registry.js`

```js
const workers = require('src/main/workers');     // boot side-effect: registers built-ins
const worker  = workers.getWorker('claude');     // throws on unknown name
```

`src/main/workers/index.js` registers `claude` / `codex` / `gemini` /
`fake` on require. The renderer requires the same bootstrap module so
both processes see the same singleton.

### The exec adapter (injected per-dispatch)

Workers never touch IPC or the PTY directly. `agentDispatch.dispatch()`
builds an `exec` object exposing:

- `checkAvailable({ toolId, projectPath })` → wraps `CHECK_AI_TOOL_AVAILABLE`
- `sendCommand(command, terminalId)` → wraps `multiTerminalUI.sendCommand`
- `waitForReady(terminalId)` → wraps `_waitForAgentReady` (laneStatus gate)
- `subscribeToStatus(terminalId, cb)` → wraps `laneStatus.onChange`

This keeps the workers process-agnostic and unit-testable — every
worker test passes a mocked exec and asserts the sequence of calls.

### Dispatch flow

```
renderer agentDispatch.dispatch({ prompt, terminalId, ... })
  → workers.getWorker(toolId)
    → worker.start({ task, ctx, posture, exec })
      → exec.checkAvailable() → exec.waitForReady() (subscribe-first)
      → exec.sendCommand(resolvedCommand)
      → await readyPromise → SessionHandle
  → window.terminalSendPromptThenEnter(prompt)
```

The IPC channel contract is unchanged — the worker simply funnels every
side-effect through the exec adapter, which calls the same channels the
renderer was calling inline before the refactor.

### Adding a new worker

1. Add the CLI to `aiToolManager.AI_TOOLS` (command, presets, etc.).
2. Create `src/main/workers/<name>Worker.js` extending `WorkerInterface`
   — copy `codexWorker.js` as a template; override
   `parseEventFromTail`, `mapPostureToFlag`, `mapStatusToEvent` to match
   the new CLI's TUI / posture semantics.
3. Register it in `src/main/workers/index.js`:
   ```js
   const { MyWorker } = require('./myWorker');
   registry.register('mytool', MyWorker);
   ```
4. Add a `describe('MyWorker', …)` block to `src/__tests__/workers.test.js`
   exercising the worker against a mocked exec.

`agentDispatch.js` requires no change — it routes by tool id, and the
new id is now wired.

### Posture overrides

`Posture.DANGEROUSLY_SKIP` is the only posture that splices a CLI flag
today, and only on `claudeCodeWorker` (the `--dangerously-skip-permissions`
override). Codex / Gemini have no equivalent so their tables are
intentionally empty — the user's saved presets via `aiToolManager`
still apply on top.

### Decision detection (permissive v1)

Each worker owns its own `APPROVAL_PATTERNS`. Claude Code mirrors the
existing `laneStatus.APPROVAL_PATTERNS` exactly so behaviour is
unchanged. Codex / Gemini use a permissive set (question-mark, yes/no,
"confirm", "proceed?", etc.) — better to over-flag a decision and let
the supervisor's classifier re-judge than to miss one.

---

## Supervisor Loop (per-spec LLM-judged driver)

Frame ships the autonomous-supervisor engine inline: every `Supervise`
button on a spec spawns a **per-spec `SupervisorLoop`** that owns one
state machine and drives the spec to `done` (or a documented stop)
without manual `/spec.implement` clicks. The loop is the LLM-judged
sibling of legacy Autopilot; both ship side-by-side during the
transition.

### What the loop does

`src/main/supervisorLoop.js` ticks once per `tickIntervalMs` (default
1000 ms). Each tick:

1. **Snapshot** — `_snapshot()` collects spec status, tasks, lane state,
   spec/plan markdown, recent audit lines, and the project profile via
   the injected `executors` map (so unit tests can drive the loop
   without a real project).
2. **Classify** — `supervisorClassifier.classifyNextStep(snapshot)`
   produces a `Verdict` (mirrors `supervisor/loop.py:78-90`). If a
   capabilities registry is wired and the verdict is `research`,
   `classifyWithResearch(snapshot, runAll)` re-classifies after one
   evidence-gathering pass (capped at 1).
3. **Dispatch** — the verdict's `route` selects an `executors.*`
   method to run (`advance`, `implementNext`, `markDone`,
   `presentEscalation`, …).
4. **Audit** — `_emitAudit(...)` appends a line to
   `.frame/specs/<slug>/supervisor-audit.jsonl`. Listeners registered
   via `onAudit` get the same payload.

Graceful stop is a hard rule: `loop.stop()` sets `_stopRequested`,
awaits any in-flight tick (`_stopGracefulPromise`), then transitions
to `paused`. The loop never kills a tick mid-flight.

### The three routes (and their friends)

The classifier emits one of six `route` values; the dispatch table is
in `supervisorLoop.js:167+`:

| Route | What it does | Engine file |
|---|---|---|
| `auto_answer` | Hard-policy fast path / low-confidence answer; loop continues | `src/main/supervisorPolicy.js` |
| `research` | Triggers `classifyWithResearch` → capabilities `runAll` → re-classify | `src/main/supervisorClassifier.js` |
| `escalate` | Drafts a question, calls `executors.presentEscalation(...)` — routes via the adapter registry to UI/Slack/Email | `src/main/supervisorCritic.js`, `src/main/adapters/registry.js` |
| `advance` / `implement` / `done` | Phase advancement, task dispatch, mark-done | `src/main/supervisorLoop.js` |
| `paused` / `wait` | Idle a tick — typically waits for a transient signal (footprint conflict clearing, lane reattaching) | inline |

The hard-policy fast path lives in `supervisorPolicy.decideFastPath` —
fourteen short-circuit rules (phase=done, user pause, footprint
conflict, no lane attached, undone=0, etc.) that skip the LLM when the
answer is mechanical.

### Audit JSONL

Every tick lands a JSON line in
`.frame/specs/<slug>/supervisor-audit.jsonl`:

```json
{"ts":"2026-06-22T13:04:11.382Z","tick":3,"phase":"tasks_generated",
 "beforeUndone":2,"verdict":{"route":"implement","confidence":0.86,
 "reasoning":"...","actionKind":"dispatch_implement_next"}}
```

The IPC channel `SUPERVISOR_AUDIT` (`supervisorIPC.js:125-136`) reads
the tail of this file for the spec section's Audit tab. The verdict's
`route + confidence` is the source of truth for the supervisor verdict
badge rendered next to the autopilot pill (see
`src/renderer/autopilotPill.js`).

### Calling `SUPERVISOR_START` from a script

```js
const { ipcRenderer } = require('electron');
const { IPC } = require('./src/shared/ipcChannels');
// terminalId optional — the loop attaches when a lane is present, but
// will run headless when only the engine path is needed (no implement).
await ipcRenderer.invoke(IPC.SUPERVISOR_START, {
  projectPath: '/abs/path/to/repo',
  slug: 'my-spec-slug',
  terminalId: null,
});
```

Cross-process: `supervisorRegistry.startSupervisor({...})` is the
underlying function (`src/main/supervisorRegistry.js:19`). Calling it
on an already-running `(projectPath, slug)` is a no-op. `pauseAll()`
gracefully stops every loop in the registry — used by the Across
projects overlay's Pause-all toolbar.

---

## Profiles & Memory

Frame mirrors the autonomous supervisor's per-project configuration:
each repo declares its policy + budgets + capabilities + roles in
`.frame/profile.json`, and shares a Basic-Memory store at
`~/memory/<project-id>/` with the supervisor app. Both processes can
read each other's notes.

### Profile location + schema

`src/main/profile.js` loads `<projectPath>/.frame/profile.json` —
**committed per repo** so the policy travels with the code. Divergence
from the supervisor's YAML: Frame uses JSON to avoid a `js-yaml`
dependency (documented in
`.frame/specs/frame-project-profiles-and-memory/outcome.md` T01).

```jsonc
{
  "id": "frame",
  "policy": {
    "escalate_categories": ["design", "ambiguity"],
    "cost_ceiling_usd": null,
    "iteration_cap": 3
  },
  "budgets": { "daily_usd": null, "per_task_usd": null },
  "capabilities": ["spec_reader", "knowledge_search"],
  "context_sources": [
    ".frame/specs/frame-supervisor-loop/spec.md",
    "bm:frame"
  ],
  "roles": [{ "name": "user", "authority": "*", "channel": "ui" }],
  "escalation": {
    "slack":  { "webhook_url": null, "callback_port": 7333 },
    "email":  { "to": null, "from": null }
  }
}
```

The loader returns `{ profile, source, fileExists, warnings }`. Loose
validation produces warnings on unknown top-level / policy / budgets
keys without rejecting the file — so the supervisor app and Frame can
evolve the schema independently. A missing file falls back to
`defaultProfile(projectPath)` (permissive: no escalate categories, no
cost ceiling, iteration cap 3, single `user` role with `*`).

### `LOAD_PROFILE` / `SAVE_PROFILE` IPC

| Channel | Direction | Payload |
|---|---|---|
| `LOAD_PROFILE` | renderer → main | `{ projectPath }` → `{ profile, source, fileExists, warnings }` |
| `SAVE_PROFILE` | renderer → main | `{ projectPath, profile }` → `{ success, error? }` |
| `WATCH_PROFILE` / `UNWATCH_PROFILE` | renderer → main | subscribe / unsubscribe to file-watcher pushes |
| `PROFILE_DATA` | main → renderer | pushed on initial load + every watcher fire |
| `SEARCH_MEMORY` | renderer → main | `{ projectPath, query, k? }` → `Note[]` |
| `LIST_MEMORY` | renderer → main | `{ projectPath, category?, spec_slug? }` → `Note[]` |

### The Memory tab (per-spec, opt-in expand)

`src/renderer/memoryTab.js` mounts a "Memory" tab next to *Audit* on
every spec section. By default it lists notes whose
`metadata.spec_slug` matches the current spec. A *Show all project
notes* toggle expands to the full project memory; a search box routes
through `SEARCH_MEMORY` (keyword top-25) when non-empty, otherwise
through `LIST_MEMORY`.

Notes are read-only in the renderer — writes go through the supervisor
loop's `memoryMirror.recordDurableDecision(...)` so durable decisions
are mirrored consistently across processes. Categories
(`rules` / `decisions` / `context` / `transcripts`) render with
distinct chips.

### `BasicMemoryBackend` (`src/main/memory.js`)

`new BasicMemoryBackend({ projectId, root? })` exposes
`search(query, k)` / `write(category, slug, body, metadata)` /
`list({category, spec_slug})` / `read(category, slug)`. On-disk layout
mirrors `supervisor/memory.py` exactly:

```
~/memory/<projectId>/
├── rules/<slug>.md
├── decisions/<slug>.md
├── context/<slug>.md
└── transcripts/<slug>.md
```

Each note carries a flat YAML-ish frontmatter (key: value lines).
Search applies a **2× rules multiplier** (`supervisor/memory.py:94-95`)
so policy/rules notes outrank context when both match. Both Frame and
the supervisor app write to the same root, so a decision recorded in
one shows up in the other — conflicts surface as git diffs when the
user commits the memory tree.

### Profile nudge banner

When `.frame/profile.json` is absent (loader's `fileExists: false`),
the Profile tab renders an amber banner with a *Generate default*
button that saves the default profile in one click. Malformed files
do NOT show the nudge — the loader's `warnings` array drives a
separate "Warnings while loading profile" callout so the user fixes,
not overwrites.

---

## Capabilities (research surface for the supervisor)

The supervisor's `research` route runs **capabilities** in parallel
and feeds their evidence back into the classifier. The contract
mirrors the `WorkerInterface` pattern: every capability extends
`Capability`, registers a name, and returns `Evidence[]`.

### The contract — `src/main/capabilities/types.js`

```js
class Capability {
  async run({ question, context, profile }) {
    // returns Promise<Evidence[]>
  }
}
Capability.name = '';
Capability.timeoutMs = 2000;   // overrideable per class
```

`Evidence` shape (JSDoc on `types.js`):

```js
{ source: string, summary: string, refs: string[], score: number }
```

### The registry — `src/main/capabilities/registry.js`

```js
const registry = require('src/main/capabilities');     // bootstrap
const reg = registry.buildRegistry(profile, { projectPath, memory });
const evidence = await registry.runAll(reg, 'why is T3 blocked?',
                                       { projectPath }, profile);
```

`buildRegistry` only instantiates capabilities the profile lists
under `profile.capabilities[]`. Unknown names are ignored (loose
match). `runAll` runs every capability in parallel with a per-instance
timeout; timeouts and thrown errors become a single warning-shaped
Evidence so the classifier's re-classification stays simple.

### The three default capabilities

| Name | What it does | Anchor |
|---|---|---|
| `spec_reader` | Keyword-scores paragraphs across `profile.context_sources` markdown; returns top-K with `<path>:L<start>-L<end>` refs | `src/main/capabilities/specReader.js` (mirrors `supervisor/capabilities.py:37-107`) |
| `knowledge_search` | Calls `BasicMemoryBackend.search(question, 5)` and maps each Note to Evidence with `score = note.score` | `src/main/capabilities/knowledgeSearch.js` (mirrors `supervisor/capabilities.py:123-152`) |
| `web_research` | Stub — returns a single warning Evidence until a WebFetch/WebSearch path is wired | `src/main/capabilities/webResearch.js` |

### Adding a new capability

1. Create `src/main/capabilities/<name>.js`:
   ```js
   const { Capability } = require('./types');
   class MyCap extends Capability {
     constructor({ projectPath, profile } = {}) {
       super();
       this.projectPath = projectPath;
     }
     async run({ question }) {
       return [{ source: 'my_cap', summary: '...', refs: [], score: 0.5 }];
     }
   }
   MyCap.name = 'my_cap';
   MyCap.timeoutMs = 3000;
   module.exports = { MyCap };
   ```
2. Register it in `src/main/capabilities/index.js`:
   ```js
   const { MyCap } = require('./myCap');
   registry.register('my_cap', MyCap);
   ```
3. Add `"my_cap"` to a profile's `capabilities[]` to enable it.
4. Add a `describe('MyCap', …)` block to
   `src/__tests__/capabilitiesRegistry.test.js` (or its own file).

### Audit JSONL

Every `runAll` call appends one line per capability to
`<projectPath>/.frame/runtime/capability-audit.jsonl`:

```json
{"capability":"spec_reader","question":"why is T3 blocked?",
 "evidenceCount":3,"duration_ms":42,"ts":"2026-06-22T13:04:11.382Z"}
```

The writer creates `.frame/runtime/` on first write (`mkdir -p`). If
the project path can't be resolved (no `ctx.projectPath` and no
`cap.projectPath`), the write is a silent no-op — the supervisor loop
never crashes on an audit fault.

---

## Cross-project view

Frame's Home board has an **Across projects** overlay (opened from the
lane board actions row) that surfaces every running supervisor across
every project Frame knows about. It is the user-facing surface for
`supervisorRegistry.getAcrossProjects()` and the place to triage
escalations + footprint conflicts spanning multiple projects.

### The `supervisorRegistry` singleton

`src/main/supervisorRegistry.js` is a process-global
`Map<projectPath::slug, SupervisorLoop>`. Public surface:

```js
startSupervisor({ projectPath, slug, executors, capabilities, tickIntervalMs })
stopSupervisor(projectPath, slug)
pauseAll()                 // graceful stop of every running loop
getSupervisor(pp, slug)
listAll()
getAcrossProjects()        // dashboard snapshot
subscribe(listener)        // push events on every state change
```

`getAcrossProjects()` returns:

```ts
{ projects: [{ projectPath, activeCount, escalationCount, specs }],
  totalActive: number,
  totalEscalations: number,
  anyRunning: boolean }
```

Where each spec carries its `SupervisorLoop.getState()` payload
(status / tickCount / lastVerdict / lastTickAt / pausedReason +
projectPath/slug).

### Pause-all semantics

The overlay's Pause-all toolbar fires `PAUSE_ALL_SUPERVISORS`, which
calls `supervisorRegistry.pauseAll()`. It gracefully stops every
running loop (`status === 'running'`) and returns the snapshot of
paused keys so the user can resume them in the same order. Loops that
are already `paused` / `idle` / `completed` are unaffected — Pause-all
is idempotent for non-running specs.

### Footprint conflict guard

`src/main/crossProjectGuard.js` is the conflict detector reused by the
overlay and the conductor. `parseFootprintBlock(planMd)` extracts the
bullet list under `## Footprint`; `findConflicts(specs)` returns
pairwise `{a, b, paths[]}` overlaps. v1 is **literal-path equality**
(glob handling is a follow-up). A spec with no `## Footprint` block
collides with everything (safe default) — author the footprint to
unlock parallelism.

The same module powers project-scoped autopilot's parallel-safety
gate; cross-project supervisor scheduling uses an identical contract,
so adding/removing a project from the Across-projects overlay does
not change conflict semantics.

### Push events

Renderer wires:

| Channel | Direction | Payload |
|---|---|---|
| `LIST_CROSS_PROJECT_SUPERVISORS` | renderer → main | () → snapshot |
| `WATCH_CROSS_PROJECT_SUPERVISORS` | renderer → main | subscribe |
| `CROSS_PROJECT_SUPERVISORS_DATA` | main → renderer | full snapshot, pushed on every registry change |
| `PAUSE_ALL_SUPERVISORS` | renderer → main | () → paused keys |

The renderer client is `src/renderer/supervisorClient.js` —
`init()` registers the push handler once, `onChange(fn)` subscribes
any panel (Across-projects board, spec section, header pill) to the
cached snapshot.

---

## Escalation

When the supervisor's classifier returns `route='escalate'`, the loop
drafts a question and routes it via an `EscalationAdapter`. Frame's v1
ships **UI-only**; Slack + Email are opt-in stubs that fall back to UI
if their config or runtime is missing.

### The contract — `src/main/adapters/types.js`

```js
class EscalationAdapter {
  async present(escalation, { onAnswered }) { /* throws abstract */ }
  async awaitResponse(escalationId)         { /* throws abstract */ }
}
```

`Escalation` shape: `{ id, projectPath, slug, category, draftedQuestion,
suggestedAnswer?, options?, taskId?, reasoning?, createdAt }`. Mirrors
`supervisor/adapters/__init__.py:40-67`.

### The registry — `src/main/adapters/registry.js`

`buildAdapters(profile, hooks)` always returns at least `{ui}`. It
opt-in registers `slack` and `email` when the profile's `escalation.*`
config is present. `routeAdapter(adapters, escalation, profile)`
resolves the role's channel from `profile.roles[].channel`, falling
back to UI when the resolved channel adapter is missing.

### Built-in adapters

| Adapter | Where it surfaces | Opt-in |
|---|---|---|
| `UIAdapter` (`src/main/adapters/uiAdapter.js`) | Writes `<projectPath>/.frame/specs/<slug>/escalations/<id>.json` and fires `SUPERVISOR_ESCALATION_OPEN`; on answer moves the file under `escalations/answered/<id>.json` | always on |
| `SlackAdapter` (`src/main/adapters/slackAdapter.js`) | POSTs a Block Kit message to `profile.escalation.slack.webhook_url`; spins up a localhost callback server on `escalation.slack.callback_port` (default 7333) | `profile.escalation.slack.webhook_url` |
| `EmailAdapter` (`src/main/adapters/emailAdapter.js`) | Writes one RFC 5322 `.eml` under `<projectPath>/.frame/runtime/email-drafts/<id>.eml` for manual send | `profile.escalation.email.to` |

Slack + Email both inject `reg.ui` as a `fallback` — webhook 5xx,
EADDRINUSE on the callback server, or disk failures all delegate back
to the UI adapter so the supervisor loop never stalls on a missing
external dependency.

### The escalation modal flow

1. `SupervisorLoop` dispatches `escalate` → calls
   `executors.presentEscalation(escalation)`.
2. The executor calls `routeAdapter(adapters, escalation, profile).present(...)`.
3. `UIAdapter.present` writes the escalation to disk and `emit`s
   `SUPERVISOR_ESCALATION_OPEN`.
4. The renderer (`src/renderer/escalationModal.js`) listens on the
   same channel and surfaces the drafted question + options.
5. User picks an option → renderer invokes
   `SUPERVISOR_ESCALATION_ANSWERED` → `UIAdapter.onAnswered` fires →
   the `present` promise resolves with `{ answer, answeredBy }`.
6. The supervisor loop continues on the next tick with the answer in
   the classifier's snapshot.

### Adding a new adapter

1. Create `src/main/adapters/<name>Adapter.js` extending
   `EscalationAdapter`. Wire `present` to your channel and resolve
   the promise from `awaitResponse` when the answer lands.
2. Register it in `adapters/registry.js`'s `buildAdapters` under the
   profile-config gate that opt-in enables it.
3. Add a test under `src/__tests__/<name>Adapter.test.js` exercising
   `present` → channel write → answered → resolve, plus at least one
   fallback path delegating to UIAdapter.

---

*This file was automatically created by Frame.*
*Creation date: 2026-01-24*
