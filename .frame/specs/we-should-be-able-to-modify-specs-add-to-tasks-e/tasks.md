# Tasks — We should be able to modify specs + add to tasks etc

- T01 · Create `src/main/specAttachments.js` with `attachSpecFile` (kind: path/buffer), `listSpecAttachments`, 25 MB size cap, basename sanitization, and the staging-dir helpers
- T02 · Add `src/__tests__/specAttachments.test.js` covering sanitize edge cases, size rejection, staging-dir promotion, and rejection on unknown slug
- T03 · Add `ATTACH_SPEC_FILE` + `LIST_SPEC_ATTACHMENTS` to `src/shared/ipcChannels.js` and register handlers via `specAttachments.setupIPC(ipcMain)` in `src/main/index.js`
- T04 · Extend `specManager.createSpec` to accept `opts.pendingAttachments`, move staged files into the new spec's `attachments/` dir, and append a `## References` block to the seeded `spec.md`
- T05 · Add a paste/drop zone, Add-file button, and staged-attachment chip list below the description in the New Spec modal (`src/renderer/specPanel.js`); purge the staging dir on cancel
- T06 · Wire `paste` and `drop` listeners on the spec.md / plan.md inline-edit textareas in `src/renderer/specSection.js` to call `ATTACH_SPEC_FILE` and insert the markdown reference at the cursor
- T07 · Add an "Attachments (N)" chip + popover to the spec section header with copy-path and reveal-in-Finder actions (reuses `OPEN_IN_FINDER`)
- T08 · Add drop-zone hover/dragover, chip list, and size-rejection toast styles to `src/renderer/styles/components/panels.css`
- T09 · Run a manual smoke test: create a spec with a pasted PNG + dropped PDF, confirm references render, run `/spec.plan`, then edit `plan.md` and paste another screenshot — verify both attachments are resolvable
- T10 · Append `outcome.md` per Frame convention with what shipped, what diverged from `plan.md`, and any followups
