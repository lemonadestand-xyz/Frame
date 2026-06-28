// Extension-aware file opener for supervisor-ui surfaces.
//
// Routing rule (single, unambiguous):
//   - Anything text-shaped (code, markup, config, scripts, plain text, no ext)
//     → Frame's editor overlay (editor.openFile via READ_FILE IPC).
//   - opts.rendered === true on a markdown file
//     → MacDown (`open -a MacDown <path>`) for the rendered view. This is the
//       only intentional non-Frame route; callers must opt in explicitly.
//   - Anything else (true binaries: .pdf, .zip, images, ...)
//     → in-renderer toast notice. We do NOT fall back to shell.openPath here:
//       on this user's machine the macOS default for many text/config types
//       (notably .yaml → public.yaml → Xcode) is wrong, and a silent OS
//       hand-off is exactly the bug this module exists to prevent.
//
// Z-index fix: Frame's editor overlay and the supervisor task detail modal
// both sit at z-index 1000. When a file is opened from inside the modal the
// editor lands BEHIND the modal and looks like a no-op. We close the
// supervisor modal (idempotent, no-op when not open) before kicking off
// editor.openFile, so non-modal call sites (sidebar tree, kanban artifact
// buttons, memory panel citations) are unaffected.
//
// All callers under supervisor-ui/ use this helper so the routing decision
// lives in one place instead of being duplicated across taskCard,
// taskDetailModal, kanban, projectTree, memoryPanel, and index.

const path = require('path');
const { spawn } = require('child_process');
const { shell } = require('electron');

// Anything in this set opens in Frame's editor overlay. Monaco-style file
// types, markdown, config formats, shell scripts — everything text-shaped a
// reviewer might want to read inside Frame.
const FRAME_EDITOR_EXTS = new Set([
  // Markdown / docs
  '.md', '.markdown', '.txt', '.rst', '.adoc',
  // Web markup
  '.html', '.htm', '.xml', '.svg',
  // JS / TS family
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  // Other languages
  '.py', '.rb', '.go', '.rs', '.java', '.lua', '.r', '.scala', '.kt',
  '.swift', '.dart', '.vue', '.svelte', '.astro', '.php', '.c', '.cpp',
  '.h', '.hpp', '.cs',
  // Config / data
  '.json', '.yaml', '.yml', '.toml', '.ini', '.env', '.conf', '.cfg',
  '.properties', '.gql', '.graphql',
  // Styles
  '.css', '.scss', '.sass', '.less',
  // Shell / scripts / SQL
  '.sh', '.bash', '.zsh', '.fish', '.ps1', '.sql',
  // Extensionless plain text (LICENSE, README without ext, Dockerfile, ...)
  '',
]);

// Only used when a caller passes opts.rendered: true and asks for the
// rendered view (e.g. a future "Show rendered preview" button). Default
// for .md is still the editor, so source view stays the no-surprise path.
const MACDOWN_EXTS = new Set(['.md', '.markdown']);

function showUnsupportedFileTypeNotice(absPath, ext) {
  const filename = path.basename(absPath || '') || absPath;
  const label = ext ? ext : '(no extension)';
  try {
    const toast = require('./notificationToast');
    toast.show({
      title: 'Can’t open file in Frame',
      kind: 'error',
      body: `${filename} — ${label} files aren’t opened in Frame’s editor. Use Finder if you need a different app.`,
    });
  } catch (err) {
    // Toast module unavailable for some reason — log loud so the no-op is
    // at least debuggable. Don't fall through to shell.openPath; that's the
    // bug this module exists to prevent.
    console.warn('[supervisor] unsupported file type:', absPath, ext, err);
  }
}

function showOpenFileErrorNotice(absPath, err) {
  const filename = path.basename(absPath || '') || absPath;
  try {
    const toast = require('./notificationToast');
    toast.show({
      title: 'Couldn’t open file',
      kind: 'error',
      body: `${filename} — ${err && err.message ? err.message : 'unknown error'}`,
    });
  } catch (toastErr) {
    console.warn('[supervisor] openFile failed and toast failed:', err, toastErr);
  }
}

// Defense in depth: if any future code path lands here, refuse loudly rather
// than handing the path to shell.openPath. shell.openPath on this user's
// machine routes .yaml → Xcode (public.yaml content type) and several other
// text formats to undesired apps — silently delegating to the OS is exactly
// the regression we keep ripping out.
function refuseXcodeRoute(absPath, reason) {
  console.error(
    '[supervisor] BLOCKED: refusing to route',
    absPath,
    'via shell.openPath —',
    reason || 'unknown reason'
  );
  showOpenFileErrorNotice(
    absPath,
    new Error('Routing bug — refused to hand off to OS default app.')
  );
}

// Lazy-required to avoid a circular import: taskDetailModal already requires
// ./openFile at module top. Resolving on first call (after both modules are
// fully loaded) sidesteps the partial-export hazard.
function closeSupervisorModalIfOpen() {
  try {
    const taskDetailModal = require('./taskDetailModal');
    if (typeof taskDetailModal.isOpen === 'function' && taskDetailModal.isOpen()) {
      taskDetailModal.close();
    }
  } catch (err) {
    console.warn('[supervisor] closeSupervisorModalIfOpen failed:', err);
  }
}

function openInMacDown(absPath) {
  // detached + unref'd so killing Frame doesn't take MacDown with it.
  const child = spawn('open', ['-a', 'MacDown', absPath], {
    detached: true,
    stdio: 'ignore',
  });
  child.on('error', (err) => {
    console.warn('[supervisor] MacDown spawn failed:', err);
    showOpenFileErrorNotice(absPath, err);
  });
  try { child.unref(); } catch { /* no-op */ }
}

function openFile(absPath, opts = {}) {
  if (!absPath) return;
  const ext = path.extname(absPath).toLowerCase();
  try {
    if (opts.rendered && MACDOWN_EXTS.has(ext)) {
      openInMacDown(absPath);
      return;
    }
    if (FRAME_EDITOR_EXTS.has(ext)) {
      closeSupervisorModalIfOpen();
      const editor = require('../editor');
      editor.openFile(absPath, 'supervisor');
      return;
    }
    showUnsupportedFileTypeNotice(absPath, ext);
  } catch (err) {
    console.warn('[supervisor] openFile failed:', err, 'path:', absPath);
    showOpenFileErrorNotice(absPath, err);
  }
}

// URL deliverables (e.g. https://app.clickup.com/t/<id>) come through the same
// deliverables manifest as file paths. They must not flow through openFile —
// path.extname strips them to '' which would match FRAME_EDITOR_EXTS and try
// to load them via READ_FILE IPC. Callers detect with isUrl() and dispatch
// here so the URL opens in the user's default browser.
function isUrl(p) {
  if (typeof p !== 'string') return false;
  return /^https?:\/\//i.test(p);
}

function openUrl(url) {
  if (!isUrl(url)) return;
  try {
    shell.openExternal(url);
  } catch (err) {
    console.warn('[supervisor] shell.openExternal failed:', err, 'url:', url);
    try {
      const toast = require('./notificationToast');
      toast.show({
        title: 'Couldn’t open link',
        kind: 'error',
        body: `${url} — ${err && err.message ? err.message : 'unknown error'}`,
      });
    } catch (toastErr) {
      console.warn('[supervisor] openUrl toast failed:', toastErr);
    }
  }
}

module.exports = {
  openFile,
  openUrl,
  isUrl,
  FRAME_EDITOR_EXTS,
  MACDOWN_EXTS,
  refuseXcodeRoute,
};
