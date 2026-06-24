// Extension-aware file opener for supervisor-ui surfaces — Phase P.
//
// Background: Frame's editor.openFile sends READ_FILE via IPC and pops the
// overlay editor when FILE_CONTENT comes back. That works for any absolute
// path on disk, but the overlay shares z-index 1000 with the supervisor's
// task detail modal — so an Open click from inside the modal lands the
// editor BEHIND the modal and looks like a silent failure. shell.openPath
// goes through the OS instead and lands the user in their default editor
// (VS Code, etc) — strictly better for code/binary files anyway.
//
// Routing:
//   markdown + plain text (.md, .markdown, .html, .htm, .txt)
//     → editor.openFile  (Frame's markdown viewer for .md;
//                          overlay editor for the rest)
//   code, config, data, shell, sql, env (.js, .ts, .py, .yaml, .json,
//     .css, .sh, .sql, …)
//     → shell.openPath   (OS default app — the user's actual editor)
//   anything else / unknown
//     → shell.openPath
//
// All callers under supervisor-ui/ use this helper so the routing decision
// lives in one place instead of being duplicated across taskCard,
// taskDetailModal, kanban, projectTree, memoryPanel, and index.

const path = require('path');
const { shell } = require('electron');

// Markdown + plain text render meaningfully in Frame's overlay (the markdown
// viewer auto-renders on .md; .txt/.html fall through to the textarea).
const EDITOR_EXTS = new Set([
  '.md', '.markdown', '.html', '.htm', '.txt',
]);

// Documented as "we explicitly know what to do with these" — every entry
// here intentionally routes to shell.openPath so the user lands in their
// real editor (VS Code, JetBrains, etc) instead of Frame's read-only
// overlay. Anything not listed here also goes to shell.openPath, so the
// set is documentation rather than a gating filter.
const SHELL_EXTS = new Set([
  // JS / TS family
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  // Other languages
  '.py', '.rb', '.go', '.rs', '.java', '.lua', '.r', '.scala', '.kt',
  '.swift', '.dart', '.vue', '.svelte', '.astro', '.php', '.c', '.cpp',
  '.h', '.hpp', '.cs',
  // Config / data
  '.json', '.yaml', '.yml', '.toml', '.ini', '.env',
  '.xml', '.svg', '.gql', '.graphql',
  // Styles
  '.css', '.scss', '.sass', '.less',
  // Shell / scripts / SQL
  '.sh', '.bash', '.zsh', '.fish', '.ps1', '.sql',
]);

function openFile(absPath) {
  if (!absPath) return;
  const ext = path.extname(absPath).toLowerCase();
  try {
    if (EDITOR_EXTS.has(ext)) {
      const editor = require('../editor');
      editor.openFile(absPath, 'supervisor');
      return;
    }
    // Default: defer to the OS. Covers SHELL_EXTS + unknown extensions +
    // extensionless files; never silently no-ops.
    shell.openPath(absPath);
  } catch (err) {
    console.warn('[supervisor] openFile failed:', err, 'path:', absPath);
    try { shell.openPath(absPath); }
    catch (err2) { console.warn('[supervisor] shell.openPath fallback failed:', err2); }
  }
}

module.exports = { openFile, EDITOR_EXTS, SHELL_EXTS };
