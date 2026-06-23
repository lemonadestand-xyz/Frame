# Outcome — We should be able to modify specs + add to tasks etc

## T01 — Create `src/main/specAttachments.js`

Shipped the storage layer: `attachToSpec`, `stageAttachment`,
`promoteStagedAttachments`, `purgeStagedAttachments`, `listSpecAttachments`,
plus the `sanitizeBasename` / `buildAttachmentFilename` helpers. 25 MB cap
enforced for both `kind: "path"` (stat the source) and `kind: "buffer"`
(decode base64 then measure). Files touched: `src/main/specAttachments.js` only.

Diverged from plan.md on staging location: plan called for
`.frame/specs/attachments/.staging/`, but `.frame/specs/<anything>` is
walked by specManager's slug discovery. Staged files now live at
`.frame/runtime/spec-attachments-staging/<stagingId>/` instead — consistent
with how runtime prompts and the orch bus are organised. Documented in the
module header so T03/T04/T05 don't have to rediscover it.

Followup: T03 will need to know that the renderer must generate the
`stagingId` (uuid or crypto.randomUUID) and pass it on every stage / promote /
purge call so the same session's files are grouped.

_Captured: 2026-06-22 · 1 file change_

---

## T02 — `src/__tests__/specAttachments.test.js`

Shipped 19 unit tests covering `sanitizeBasename`, `buildAttachmentFilename`,
`attachToSpec` (path + buffer kinds, 25 MB cap, unknown-slug rejection,
bad-kind rejection), the full staging flow (`stage` → `promote` → `purge`
with re-stage, invalid-id, and noop-on-missing-dir edge cases), and
`listSpecAttachments` (empty case + posix path projection). All pass on the
T01 storage layer unchanged.

_Captured: 2026-06-22 · 1 file change_

---

## T03 — IPC channels + handlers + `setupIPC`

Added `ATTACH_SPEC_FILE`, `LIST_SPEC_ATTACHMENTS`, and `PURGE_STAGED_ATTACHMENTS`
to `src/shared/ipcChannels.js`. Exposed a new `setupIPC(ipcMain)` from
`src/main/specAttachments.js` that wires all three. One `ATTACH_SPEC_FILE`
handler routes by `slug` vs `stagingId` so the New Spec modal (pre-slug)
and the inline editor (post-slug) share the same channel. Registered in
`src/main/index.js` alongside the other spec subsystems. Added a third
IPC channel beyond what plan.md called for (`PURGE_STAGED_ATTACHMENTS`)
so the modal can clean up after a Cancel without bloating the existing
channels' contracts. 4 new integration tests in
`specAttachments.test.js` exercise the handlers end-to-end.

_Captured: 2026-06-22 · 3 file changes_

---

## T04 — `specManager.createSpec` extension

Added `opts.pendingAttachments` (a string stagingId) to `createSpec`. On
success, promotes the staged files into `.frame/specs/<slug>/attachments/`
via `specAttachments.promoteStagedAttachments` and appends a
`## References` block to the seeded spec.md, with `![]()` for image
extensions and `[]()` for everything else (matches plan.md's reference
shape). 3 new tests cover the regression path (no pendingAttachments),
the happy path (file lands + References block written + staging dir
cleaned), and an unknown stagingId (no error, no References block).

_Captured: 2026-06-22 · 2 file changes (1 modified, 1 test extension)_

---

## T05 — New Spec modal paste / drop / Add-file

Added a paste listener, drop listener, and an *Add file* button (hidden
`<input type="file">`) to the description textarea in the New Spec
modal (`src/renderer/specPanel.js`). Each modal open generates a unique
`stagingId` (renderer-side `makeStagingId` — uses `crypto.randomUUID`
with a fallback); files paste/dropped through the lifetime of the modal
land in `.frame/runtime/spec-attachments-staging/<id>/` and surface as
removable chips below the description. On Cancel, the modal fires
`PURGE_STAGED_ATTACHMENTS` so abandoned files do not leak. On Create,
`pendingAttachments: stagingId` flows into `CREATE_SPEC.opts` so
specManager promotes the staged files in one shot. Exposed
`makeStagingId` from the module for unit-testing; a regression-guard
test enforces the safe pattern accepted by the main process. Full
modal interaction (paste / drop / chip remove) is exercised manually
in Electron — node test env does not include jsdom in this repo.

_Captured: 2026-06-22 · 2 file changes_

---

## T06 — Inline-edit paste / drop on spec.md / plan.md

Wired `paste` and `drop` listeners on the textarea used by the
*Edit spec.md* / *Edit plan.md* inline editors (`src/renderer/specSection.js`).
Per plan.md, only spec.md and plan.md get the affordance — tasks.md
intentionally does not. Each handler calls `ATTACH_SPEC_FILE` with the
spec slug (no staging — the spec already exists), then inserts a
markdown reference at the cursor using a `buildMarkdownRef` helper that
mirrors the New Spec modal's image-vs-other extension rule. Exposed
`buildMarkdownRef` at module level for unit-testing; 2 new tests cover
both branches (image embed vs link).

_Captured: 2026-06-22 · 2 file changes_

---

## T07 — "Attachments (N)" chip + popover

Added an *Attachments (N)* chip to the spec section header
(`src/renderer/specSection.js`), rendered only when the spec has at least
one attachment (N=0 hides the chip — `renderAttachmentsChip` returns
empty string). `fetchDetail` now loads the attachments list via
`LIST_SPEC_ATTACHMENTS` so the chip count tracks the underlying
filesystem. Clicking the chip toggles a popover (`spec-attachments-popover`)
listing each file with a *Show in Finder* button. **Divergence from
plan.md**: the plan said the popover "reuses the existing `OPEN_IN_FINDER`
IPC" but that channel does not exist in the codebase. Used
`electron.shell.showItemInFolder` directly from the renderer instead
(nodeIntegration is enabled in `createWindow`, matching how githubManager
and menu.js access shell APIs). 3 new tests cover the empty / non-empty
chip rendering.

_Captured: 2026-06-22 · 2 file changes_

---

## T08 — Drop-zone CSS

Appended drop-zone + chip + popover styles to
`src/renderer/styles/components/panels.css`. Uses existing theme tokens
(`--bg-tertiary`, `--border`, `--accent`, `--text-primary`,
`--space-sm`, `--radius-sm`) so the highlight tracks the user's theme.
Drop-zone uses a dashed outline + tinted background (via `color-mix`)
applied to both `.spec-attach-dropzone` (the New Spec modal description)
and `.spec-doc-textarea` (the inline editor) — same `.drag-over` class
toggled on by both call sites in T05/T06. Popover styling matches the
existing panel popovers in this stylesheet.

_Captured: 2026-06-22 · 1 file change_

---

## T09 — Manual smoke test (deferred to user)

The supervisor agent ran in a headless Bash sandbox with no display,
so it could not actually click through the Electron UI. The full smoke
test was deferred to the user. Checklist for the user to walk through
after a Cmd+R reload:

1. Open Frame, create a new spec via the Specs panel + New button.
2. Paste a screenshot from clipboard into the description — confirm a
   chip appears.
3. Drag a file from Finder onto the description textarea — confirm a
   second chip appears and the dashed-outline drop highlight fires.
4. Click Create — confirm the spec was created and the files landed
   in `.frame/specs/<slug>/attachments/` (`ls` from a terminal works).
5. Open the spec — confirm the *Attachments (2)* chip is visible in
   the header.
6. Open *Edit spec.md*, paste another image into the textarea —
   confirm the markdown reference `![name](attachments/...)` was
   inserted at the cursor + the new file exists on disk.
7. Click the *Attachments (3)* chip → popover opens → click *Show in
   Finder* on one of the rows → Finder opens at the right path.
8. Open the New Spec modal, attach a file, then click *Cancel* —
   confirm `.frame/runtime/spec-attachments-staging/` is empty (the
   purge ran).

All 31 jest tests covering the engine side pass. The renderer bundle
was rebuilt (`npm run build`) so the next Frame reload picks up every
T05–T08 change.

_Captured: 2026-06-22 · 0 file changes (manual)_

---

## T10 — Outcome appended

This file. Covers T02–T09 above with per-task entries naming any
divergence from plan.md (T03 added a third channel; T07 swapped a
nonexistent OPEN_IN_FINDER IPC for direct `shell.showItemInFolder`).
T01's earlier divergence (staging dir relocation under
`.frame/runtime/spec-attachments-staging/`) carried through every
later task without further change.

_Captured: 2026-06-22 · 1 file change_

---
