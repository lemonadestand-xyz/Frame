# Non-Invasive Frame Overlay (.frame-only, zero-touch)

> **What we're building:** a version of Frame that can be used on *any* codebase
> — including a company or third-party repository the developer must never alter
> — while still delivering Frame's full feature set (tasks, specs, notes,
> structure map, prompt history, multi-terminal, AI-tool launching with context).
> Frame becomes a **read-only overlay** on top of the project: it owns exactly
> one directory, `.frame/`, and touches nothing else in the working tree.

---

## Problem

Today Frame's identity and data are physically embedded in the project root, and
initialization actively *mutates* the repository:

- `initializeFrameProject` writes root-level files: `AGENTS.md`, `STRUCTURE.json`,
  `PROJECT_NOTES.md`, `tasks.json`, `QUICKSTART.md`.
- It **destructively** consumes an existing `CLAUDE.md`: reads it, `fs.unlinkSync`
  deletes it, merges its content into `AGENTS.md`, then replaces it with a
  `CLAUDE.md → AGENTS.md` symlink. Same pattern for `GEMINI.md`.
- `structureBootstrap` installs a git **pre-commit hook** and copies parser
  scripts into the project.
- `isFrameProject` decides "is this a Frame project?" by looking for
  `projectPath/.frame/config.json` — so the project's identity lives *inside* the
  repo as well.

Consequences that block the target use case:

1. **You cannot use Frame on a codebase you don't own.** Opening a company repo
   and initializing pollutes it with 5+ root files, deletes/relinks an existing
   `CLAUDE.md`, and installs a git hook. None of this is acceptable on a shared,
   reviewed, or third-party codebase.
2. **Existing instruction files are clobbered.** Many real projects already ship
   their own `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, Codex config, `.cursorrules`,
   etc. Frame currently rewrites/relinks them rather than respecting them.
3. **`git status` is never clean.** Even if a developer wanted Frame's metadata
   to stay local, today it lands as untracked/modified files across the tree.

The desired workflow — *"use Frame's organizing and context-preservation
features on top of my real work, without leaving a fingerprint on the repo"* — is
impossible with the current architecture.

---

## Goal

Frame supports a single, non-invasive operating model with these properties:

1. **One footprint only.** Everything Frame creates or maintains for a project
   lives under `projectPath/.frame/`. Frame **never** creates, modifies, deletes,
   or symlinks any file outside `.frame/` in the working tree — including the
   project's `.gitignore`.

2. **`.frame/` is the home for all Frame artifacts.** The files Frame currently
   scatters at the root move inside `.frame/`:
   - `.frame/AGENTS.md` (Frame's own workflow instructions for AI tools)
   - `.frame/STRUCTURE.json`
   - `.frame/PROJECT_NOTES.md`
   - `.frame/tasks.json`
   - `.frame/QUICKSTART.md`
   - `.frame/specs/…` (already there today)
   - `.frame/config.json`, `.frame/bin/…` (already there today)

3. **Existing root instruction files are sacred — discovered, never touched.**
   On opening a project, Frame detects any of: `CLAUDE.md`, `AGENTS.md`,
   `GEMINI.md`, Codex config (`AGENTS.md` / Codex's own convention),
   `.claude/CLAUDE.md`, `.cursorrules`, `.cursor/rules/*`,
   `.github/copilot-instructions.md`. These are read **read-only** and surfaced in
   the UI. Frame must never rewrite, delete, symlink-over, or append to them.

4. **Native prompt injection, composed at launch time — not by planting files.**
   Because Frame no longer drops a root `CLAUDE.md` symlink, the AI tool can no
   longer auto-discover Frame's conventions from the root. Instead, Frame injects
   context **when it launches the AI tool**, via the start command it already
   controls (`aiToolManager.getStartCommand`). Injection composes two layers
   without merging or duplicating them:

   | AI tool | Repo's own root instruction file | Frame's behavior |
   |---------|----------------------------------|------------------|
   | Claude Code | `CLAUDE.md` present | Leave it alone (Claude reads it natively). Append a pointer to `.frame/AGENTS.md`. |
   | Gemini CLI | `GEMINI.md` present | Same — leave it, point to `.frame/AGENTS.md`. |
   | Codex / no native convention | any/none | Wrapper injects: "read the repo's instruction file if present **and** `.frame/AGENTS.md`". |
   | any | none present | `.frame/AGENTS.md` is the sole injected source. |

   The repo's instruction file remains authoritative for code conventions; Frame's
   `.frame/AGENTS.md` adds only the Frame meta-layer (task recognition, note
   capture, spec workflow, structure upkeep). No content is copied out of the
   repo's files and no duplicate context is injected.

5. **Committing `.frame/` is opt-in, never imposed.**
   - **Default (zero-touch):** Frame keeps `.frame/` out of git locally using
     `.git/info/exclude` (a per-clone, untracked file). The tracked tree —
     including `.gitignore` — is never modified, so `git status` stays clean.
   - **Team opt-in:** a developer/team that *wants* to share tasks and specs can
     choose to commit `.frame/`. Frame surfaces this as an explicit choice; it
     does not edit the tracked `.gitignore` on the user's behalf.

6. **All other features keep working unchanged.** Multi-terminal, file tree,
   file editor (which only writes when the user explicitly saves a real source
   file — intended), git status/branches panels, overview, prompt history, AI
   tool switching — these already read the repo or write to user-scoped storage
   and need no behavioral change beyond path resolution.

---

## Constraints

- **Absolute no-write rule:** outside `projectPath/.frame/`, the only writes Frame
  may perform are to **untracked, local-only git internals**: `.git/info/exclude`
  and `.git/hooks/*`. Nothing in the tracked working tree, ever — not even
  `.gitignore`.
- **Non-destructive discovery:** reading existing instruction files must never
  open them for write, rename, or relink. `fs.unlinkSync` / `symlinkSync` against
  root instruction files is removed entirely.
- **Single model, not a toggle.** This replaces the embedded behavior; there is no
  "embedded vs external" switch to maintain. (Migration of already-embedded Frame
  projects is handled separately — see Out of Scope.)
- **Path resolution must be centralized.** Every place that currently hardcodes a
  root path (`tasksManager.getTasksFilePath`, `overviewManager.loadStructure /
  loadTasks / loadDecisions`, `frameProject`, `structureBootstrap` output, etc.)
  resolves through one helper that returns `projectPath/.frame/<file>`.
  `specManager` already lives under `.frame/specs/` and is the reference pattern.
- **Tool-agnostic injection.** The composition logic must work for Claude Code,
  Gemini CLI, and Codex CLI today, and be extensible to future tools via
  `aiToolManager` without per-tool special cases leaking across modules.
- **Freshness without ownership.** If a discovered root instruction file changes
  on disk, Frame re-reads it for subsequent injections (the debounced `fs.watch`
  pattern from `specManager` is the model). Frame caches/references; it never
  writes back.
- **Cross-platform:** `.git/info/exclude` and `.git/hooks` handling, plus any path
  encoding, must behave on macOS, Linux, and Windows (including the
  symlink-unsupported Windows fallback already handled elsewhere).

---

## Success Criteria

The work is complete when all of the following hold:

1. **Clean tree.** Open an arbitrary repository, initialize Frame, use it for a
   full session (create tasks, a spec, notes; launch an AI tool), then run
   `git status`: the only thing git could possibly see is `.frame/`, and in the
   default (zero-touch) setup `git status` reports **no changes at all** because
   `.frame/` is excluded via `.git/info/exclude`. The tracked `.gitignore` is
   byte-identical to before.
2. **Existing instruction files untouched.** A repo that ships its own
   `CLAUDE.md` / `AGENTS.md` / `GEMINI.md` / `.cursorrules` has those files
   **byte-identical** (checksum-equal) before and after a full Frame session. No
   symlink replaces them; none is deleted.
3. **Context reaches the AI both ways.** When Frame launches the AI tool in a repo
   that has its own `CLAUDE.md`, the tool ends up aware of *both* the repo's
   conventions and Frame's `.frame/AGENTS.md` meta-layer — verifiable by the tool
   acting on Frame conventions (e.g. offering to capture a note / recognizing a
   task) without the repo's `CLAUDE.md` having been modified.
4. **No root artifacts.** After init and use, there are **zero** Frame-created
   files in the project root or anywhere outside `.frame/`. All of
   `AGENTS.md`, `STRUCTURE.json`, `PROJECT_NOTES.md`, `tasks.json`,
   `QUICKSTART.md` are found only under `.frame/`.
5. **Opt-in commit works.** A team that chooses to track `.frame/` can commit it
   and a teammate cloning the repo sees the shared tasks/specs — without any
   change to how Frame reads them.
6. **Feature parity.** Tasks, specs, notes, structure map, overview, prompt
   history, and AI-tool launching all function as before, now reading from
   `.frame/`.

---

## Out of Scope

The following are explicitly **not** part of this effort (may become separate
specs later):

- **Migration tooling for already-embedded Frame projects.** Existing projects
  that have root `AGENTS.md`/`tasks.json`/etc. need a separate migration story
  (move-into-`.frame/`, leave-in-place, or dual-read). Not decided here.
- **Editing the user's tracked `.gitignore`.** Default stays `.git/info/exclude`;
  any future "write to `.gitignore`" convenience is a separate decision.
- **Auto-committing `.frame/`** or any git write beyond local excludes/hooks.
- **Frame Server / browser mode**, multi-user, and remote-host concerns.
- **Parsing existing instruction files into Frame's own structure** (e.g.
  auto-seeding `PROJECT_NOTES.md` from a discovered `CLAUDE.md`). Discovery +
  launch-time composition is in scope; transformation/import is not.
- **Deep semantic validation** of discovered instruction files. Frame detects and
  references them; it does not lint or interpret their content.
