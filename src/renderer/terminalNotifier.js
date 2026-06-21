/**
 * Terminal Notifier Module (lemo-7)
 *
 * Listens for TERMINAL_COMPLETED events from the main process and
 * raises three signals so the user knows to look back at the terminal:
 *
 *   1. macOS dock bounce (via IPC.DOCK_BOUNCE → app.dock.bounce)
 *   2. System notification (HTML5 Notification API in renderer)
 *   3. In-app indicator dots on the source terminal tab AND the source
 *      project row in the sidebar.
 *
 * All three are suppressed when the window is focused AND the source
 * terminal is the currently active terminal — there's no point bugging
 * the user when they're already looking at the right thing. The visual
 * dots STILL clear on focus, even when notifications were suppressed.
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const state = require('./state');

// terminalId -> { projectPath }
const pendingByTerminal = new Map();
// projectPath -> count of terminals with pending notifications
const pendingByProject = new Map();

let multiTerminalUIRef = null;
let projectListUIRef = null;

function init({ multiTerminalUI, projectListUI } = {}) {
  multiTerminalUIRef = multiTerminalUI || null;
  projectListUIRef = projectListUI || null;

  ipcRenderer.on(IPC.TERMINAL_COMPLETED, (event, payload) => {
    handleCompletion(payload || {});
  });

  // Clear the source-terminal dot when the user actually focuses it.
  // Project-level dot clears when any of its terminals is focused.
  window.addEventListener('focus', () => {
    // Window focus alone doesn't clear indicators — the user might be
    // returning to look at a different terminal. Only an explicit
    // terminal switch clears.
  });
}

function handleCompletion({ terminalId, projectPath }) {
  if (!terminalId) return;

  // Record the pending state for indicator dots regardless of focus —
  // the user might be off-window and miss the bounce, but later return
  // and need to see which terminal still needs attention.
  pendingByTerminal.set(terminalId, { projectPath });
  if (projectPath) {
    pendingByProject.set(projectPath, (pendingByProject.get(projectPath) || 0) + 1);
  }
  paintIndicators();

  if (shouldSuppressNotification(terminalId)) return;

  // 1. Dock bounce. Main process gates this on macOS itself.
  ipcRenderer.send(IPC.DOCK_BOUNCE, { kind: 'informational' });

  // 2. System notification.
  fireSystemNotification(terminalId, projectPath);
}

/**
 * Don't pop a notification when the user is already watching: window
 * is focused AND the source terminal is the active one. Anything else
 * (different terminal active, window unfocused, dashboard open with no
 * specific terminal selected, etc.) still notifies.
 */
function shouldSuppressNotification(terminalId) {
  if (!document.hasFocus()) return false;
  if (!multiTerminalUIRef) return false;
  const activeId = multiTerminalUIRef.getActiveTerminalId && multiTerminalUIRef.getActiveTerminalId();
  return activeId === terminalId;
}

function fireSystemNotification(terminalId, projectPath) {
  // Browsers / Electron renderers require notification permission. In
  // packaged apps Electron grants this implicitly, but we still guard
  // for the unhappy path.
  if (typeof Notification === 'undefined') return;
  if (Notification.permission === 'denied') return;
  if (Notification.permission !== 'granted') {
    // Best-effort request — first time only. Subsequent completions
    // will already have permission resolved.
    Notification.requestPermission().then(perm => {
      if (perm === 'granted') {
        showNotification(terminalId, projectPath);
      }
    }).catch(() => {});
    return;
  }
  showNotification(terminalId, projectPath);
}

function showNotification(terminalId, projectPath) {
  const projectName = projectPath ? projectPath.split(/[/\\]/).filter(Boolean).pop() : null;
  const body = projectName
    ? `${prettyTerminalLabel(terminalId)} · ${projectName}`
    : prettyTerminalLabel(terminalId);

  try {
    const note = new Notification('AI session is waiting on you', {
      body,
      silent: false,
      tag: `frame-term-${terminalId}` // collapses repeated notifs for the same terminal
    });
    note.onclick = () => {
      // Click pulls the user back: focus window, switch to the source
      // project (which auto-selects one of its terminals), then make
      // sure the actual source terminal is active.
      ipcRenderer.send(IPC.WINDOW_FOCUS_AND_SHOW);
      if (projectPath && projectListUIRef && typeof projectListUIRef.selectProject === 'function') {
        projectListUIRef.selectProject(projectPath);
      }
      if (multiTerminalUIRef && typeof multiTerminalUIRef.setActiveTerminal === 'function') {
        multiTerminalUIRef.setActiveTerminal(terminalId);
      }
      clearTerminalIndicator(terminalId);
    };
  } catch (err) {
    console.warn('Failed to show system notification:', err);
  }
}

function prettyTerminalLabel(terminalId) {
  // Terminal IDs come in as "term-3" / "term-1745". Promote the numeric
  // suffix to "Terminal N" for human reading.
  const m = String(terminalId).match(/(\d+)\s*$/);
  return m ? `Terminal ${m[1]}` : 'Terminal';
}

/**
 * Called by multiTerminalUI when a terminal becomes active. Clears the
 * dot on that terminal's tab AND, if it was the project's last pending
 * terminal, the project's row dot too.
 */
function clearTerminalIndicator(terminalId) {
  if (!pendingByTerminal.has(terminalId)) return;
  const { projectPath } = pendingByTerminal.get(terminalId);
  pendingByTerminal.delete(terminalId);
  if (projectPath) {
    const remaining = (pendingByProject.get(projectPath) || 1) - 1;
    if (remaining <= 0) pendingByProject.delete(projectPath);
    else pendingByProject.set(projectPath, remaining);
  }
  paintIndicators();
}

/**
 * Called by projectListUI when a project becomes active. Clears the
 * project row dot AND every terminal-tab dot under that project.
 */
function clearProjectIndicator(projectPath) {
  if (!projectPath) return;
  pendingByProject.delete(projectPath);
  for (const [tid, info] of pendingByTerminal) {
    if (info.projectPath === projectPath) pendingByTerminal.delete(tid);
  }
  paintIndicators();
}

/**
 * Walk the DOM and toggle `.has-notification` on every terminal tab and
 * project row according to the current pending maps. Idempotent so it's
 * safe to call after any state change.
 */
function paintIndicators() {
  // Terminal tabs
  document.querySelectorAll('.terminal-tab').forEach(tab => {
    const tid = tab.dataset.terminalId || tab.dataset.id;
    if (!tid) return;
    tab.classList.toggle('has-notification', pendingByTerminal.has(tid));
  });

  // Project rows in the sidebar
  document.querySelectorAll('.project-item').forEach(row => {
    const projectPath = row.dataset.path;
    if (!projectPath) return;
    row.classList.toggle('has-notification', pendingByProject.has(projectPath));
  });
}

module.exports = {
  init,
  clearTerminalIndicator,
  clearProjectIndicator,
  paintIndicators
};
