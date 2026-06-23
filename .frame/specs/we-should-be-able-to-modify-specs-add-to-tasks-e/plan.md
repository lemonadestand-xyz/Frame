# Plan — We should be able to modify specs + add to tasks etc

## Architecture

### Scope reconciliation (what's already shipped vs. new)

The spec text bundles three asks. Two are **already shipped** and only need
docs/UX surfacing — no code:

- **Modify specs.** `specManager.writeSpecDoc` + the *Edit `<doc>`.md* button
  on each spec tab (spec.md / plan.md / tasks.md) already overwrite the file,
  bump `updated_at`, and re-sync tasks for `tasks.md`. See CLAUDE.md
  "UI editing".
- **Add to tasks etc.** The `+ Add` row at the bottom of the Tasks tab
  (`addSpecTask`) and the trash icon on pending rows (`removeSpecTask`,
  history-guarded) already exist.
- **Autopilot.** Spec-scoped *Auto* toggle and project-scoped *🤖 Project
  Autopilot* are live. See CLAUDE.md "Autopilot".

The **new** work this spec delivers is: **attach screenshots and reference
documents during spec / plan creation (and afterwards via inline edit) so
the AI authoring `spec.md` / `plan.md` can see them.** Everything below is
scoped to that one capability.

### Storage layout — attachments live inside the spec dir

```
.frame/specs/<slug>/
  status.json
  spec.md
  plan.md
  tasks.md
  outcome.md
  attachments/                     ← new
    2026-06-22T01-23-45__screenshot-1.png
    2026-06-22T01-24-01__brief.pdf
```

Rationale:
- Co-located with the spec → moves cleanly when a spec is renamed
  (`renameSpec` already does `fs.renameSync(oldDir, newDir)`).
- Excluded from Footprint conflict checks the same way `outcome.md` is —
  attachments live under `.frame/specs/<slug>/`, not in `src/`.
- Filenames are `<ISO-with-colons-stripped>__<sanitized-original>` to keep
  insertion order, avoid collisions on re-paste, and stay shell-safe.

### Reference shape in spec.md / plan.md

Attachments are referenced in the markdown using **relative paths** so the
file moves with the spec dir and the AI's local-file reader can resolve
them:

```markdown
![screenshot-1](attachments/2026-06-22T01-23-45__screenshot-1.png)
[brief.pdf](attachments/2026-06-22T01-24-01__brief.pdf)
```

Images get `![...]()` syntax; everything else gets `[...]()`. The
inline-edit drop/paste handler inserts these at the cursor position.

When the **New Spec** modal seeds `spec.md` from the description, any
attached files are appended as a `## References` section so the
draft phase isn't lost:

```markdown
# <title>

<description>

## References

- ![screenshot-1](attachments/...)
- [brief.pdf](attachments/...)
```

### IPC + main-process module

New module: `src/main/specAttachments.js`. Two public functions wired
through new IPC channels:

- `attachSpecFile(projectPath, slug, payload) → { success, relativePath, error }`
  - `payload.kind`: `"path"` (copy from a file on disk) or
    `"buffer"` (write bytes from the renderer, e.g. clipboard paste).
  - `payload.originalName`: used for the sanitized suffix.
  - `payload.data` (base64) for `kind: "buffer"`, `payload.sourcePath`
    for `kind: "path"`.
  - Validates the spec exists; creates `attachments/` lazily; rejects
    if the file is >25 MB (config constant); returns the relative path
    the renderer should insert into the editor / description field.
- `listSpecAttachments(projectPath, slug) → string[]` — relative paths,
  used by the spec section to render a small "Attachments" strip below
  the tab bar.

The two IPC channels:

```
ATTACH_SPEC_FILE      renderer → main
LIST_SPEC_ATTACHMENTS renderer → main
```

Both follow the same `{ projectPath, slug, ... }` payload shape used by
the existing `WRITE_SPEC_DOC` / `ADD_SPEC_TASK` handlers.

### Renderer surfaces (3 touchpoints, all opt-in)

1. **New Spec modal** (`specPanel.js`) — below the description textarea,
   add a paste/drop zone *and* an "Add file" button. Files are uploaded
   immediately; relative paths are accumulated in a `pendingAttachments`
   array passed into `CREATE_SPEC`'s `opts`. Because the slug doesn't
   exist yet at paste-time, the modal stages attachments in a temporary
   `attachments/.staging/` sibling under `.frame/specs/` and the main
   process moves them into the new spec dir once the slug is allocated.
2. **Inline editor** (`specSection.js`) — when the user is editing
   spec.md or plan.md, intercept `paste` (image clipboard) and `drop`
   events on the `<textarea>`. On a match, call `ATTACH_SPEC_FILE`,
   insert the resulting markdown reference at the cursor, save behavior
   unchanged.
3. **Spec section header** (`specSection.js`) — small "Attachments (N)"
   chip that opens a popover listing existing attachments with a copy-path
   action and a reveal-in-Finder action (reuses `OPEN_IN_FINDER`).

The Tasks tab does **not** get attachment UI — attachments belong to
spec / plan authoring per the spec text ("in spec / plan creation").

### How runtime prompts pick up attachments

`/spec.plan` and `/spec.tasks` runtime prompts already read `spec.md`
verbatim. Because attachments are referenced as relative paths inside
`spec.md`, Claude Code can resolve them itself (it reads local images
and PDFs natively). **No runtime-prompt change required**; this is the
key reason the reference shape is plain markdown rather than a sidecar
manifest.

### Security + size guards

- **Path traversal**: sanitize `originalName` to basename, strip `..`,
  normalize to `[A-Za-z0-9._-]`.
- **Size**: hard cap at 25 MB per file, rejected with a friendly error.
- **MIME**: no MIME enforcement (the spec calls out "screenshots,
  existing documents etc"), but extensions are preserved for the AI tool
  to pick the right reader.
- **No deletion API in v1**. Removing an attachment means editing the
  markdown reference out — orphaned files stay until the spec is
  deleted. This avoids a "I removed it from spec.md, did the file go
  too?" footgun and matches how the spec dir treats `outcome.md`
  history.

### What this spec deliberately does NOT touch

- `tasks.json` shape, autopilot config, orchestrator footprint guard.
- `/spec.new` (slice 1.7) — when it lands and replaces seeded spec.md
  with AI-authored content, the `## References` section it inherits
  stays as-is.
- Cross-project attachments (out of scope; cross-project work lives in
  the supervisor app per AUTOPILOT.md rule 4).

---

## Files

**New**
- `src/main/specAttachments.js` — staging + write of attachments, IPC handlers
- `src/__tests__/specAttachments.test.js` — unit tests for sanitize/size/staging-promotion
- `.frame/specs/we-should-be-able-to-modify-specs-add-to-tasks-e/outcome.md` — appended during implementation per Frame convention

**Modified**
- `src/main/specManager.js` — accept `pendingAttachments` in `createSpec` opts, promote staging dir into new spec dir, seed `## References` block
- `src/main/index.js` — wire `specAttachments.setupIPC(ipcMain)`
- `src/shared/ipcChannels.js` — add `ATTACH_SPEC_FILE` + `LIST_SPEC_ATTACHMENTS`
- `src/renderer/specPanel.js` — New Spec modal: paste/drop zone + Add file button + chip list
- `src/renderer/specSection.js` — paste/drop on inline editor; Attachments chip in header
- `src/renderer/styles/components/panels.css` — drop-zone + chip styles

---

## Footprint

- src/main/specAttachments.js
- src/__tests__/specAttachments.test.js
- src/main/specManager.js
- src/main/index.js
- src/shared/ipcChannels.js
- src/renderer/specPanel.js
- src/renderer/specSection.js
- src/renderer/styles/components/panels.css

---

## Dependencies

None. Clipboard image extraction uses the existing `Blob.arrayBuffer()` /
`DataTransferItem` browser APIs already available in Electron's renderer.
File copies use Node's built-in `fs.copyFileSync` / `fs.writeFileSync`.

---

## Sequencing

1. **Attachment storage foundation.** Build `specAttachments.js` with
   `attachSpecFile` (kind: path/buffer), `listSpecAttachments`, the
   25 MB guard, and basename sanitization. Add unit tests for sanitize
   edge cases, size rejection, and staging-dir promotion. No UI yet.
2. **IPC wiring.** Add `ATTACH_SPEC_FILE` + `LIST_SPEC_ATTACHMENTS`
   channels to `src/shared/ipcChannels.js` and register handlers in
   `index.js`. Smoke-test from the Electron devtools console.
3. **createSpec attachment promotion.** Extend `specManager.createSpec`
   to accept `opts.pendingAttachments: string[]` (staging paths). On
   success, move each into the new spec's `attachments/` dir. If a
   description is seeded, append a `## References` block listing the
   attachments.
4. **New Spec modal UI.** In `specPanel.js`, add the drop zone, paste
   handler, Add-file button, and a small chip list of staged
   attachments below the description. Wire submission to pass
   `pendingAttachments` into `CREATE_SPEC`. Add a Cancel handler that
   purges the staging dir so an abandoned modal doesn't leak files.
5. **Inline editor paste/drop.** In `specSection.js`, attach `paste`
   and `drop` listeners to the spec.md / plan.md textareas during
   edit mode. On match, call `ATTACH_SPEC_FILE` and insert the
   markdown reference at the cursor. Keep tasks.md editing untouched.
6. **Attachments chip in spec header.** Add a small "Attachments (N)"
   chip + popover that lists files and offers copy-path / reveal-in-Finder
   (reuses the existing `OPEN_IN_FINDER` IPC).
7. **Styles + polish.** Drop-zone hover/dragover states; chip styles;
   error toasts for size-rejected files.
8. **Manual smoke test.** Walk through: create spec with pasted PNG +
   dropped PDF → confirm references render in spec.md → run `/spec.plan`
   → confirm Claude reads the attachment paths → edit plan.md and
   paste a second screenshot → confirm it lands and renders.
9. **Outcome.** Append `outcome.md` per Frame convention (what shipped,
   what diverged, what to follow up on).
