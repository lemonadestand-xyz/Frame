/**
 * Sidebar Collapse Module
 *
 * Toggles the left sidebar between its full-width state and a narrow
 * icon rail. The collapsed state is persisted via user settings so it
 * survives app restarts, and applied early (before the user can
 * notice a flash) on init.
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');

const SETTING_KEY = 'sidebar.collapsed';

let sidebarEl = null;
let toggleBtn = null;

async function init() {
  sidebarEl = document.getElementById('sidebar');
  toggleBtn = document.getElementById('sidebar-collapse-toggle');
  if (!sidebarEl || !toggleBtn) return;

  // Restore persisted state before wiring the click handler so the
  // first toggle doesn't undo a stale preference.
  try {
    const saved = await ipcRenderer.invoke(IPC.GET_USER_SETTING, SETTING_KEY);
    if (saved === true) applyCollapsed(true);
  } catch (err) {
    // Non-fatal: defaults to expanded if we can't read the setting.
    console.warn('Failed to load sidebar collapsed state:', err);
  }

  toggleBtn.addEventListener('click', toggle);
}

function toggle() {
  const willCollapse = !sidebarEl.classList.contains('collapsed');
  applyCollapsed(willCollapse);
  // Fire-and-forget — the UI already responded; the persistence call
  // catching up a few ms later is fine.
  ipcRenderer.invoke(IPC.SET_USER_SETTING, SETTING_KEY, willCollapse).catch(err => {
    console.warn('Failed to persist sidebar collapsed state:', err);
  });
}

/**
 * Force-expand the sidebar. Used by the tab buttons in collapsed-mode
 * so clicking an icon brings the rail back to full width AND switches
 * the visible tab in one motion (activity-bar pattern).
 */
function expand() {
  if (!sidebarEl) return;
  if (!sidebarEl.classList.contains('collapsed')) return;
  applyCollapsed(false);
  ipcRenderer.invoke(IPC.SET_USER_SETTING, SETTING_KEY, false).catch(() => {});
}

function isCollapsed() {
  return !!(sidebarEl && sidebarEl.classList.contains('collapsed'));
}

function applyCollapsed(collapsed) {
  if (!sidebarEl || !toggleBtn) return;
  sidebarEl.classList.toggle('collapsed', collapsed);
  toggleBtn.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  toggleBtn.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
}

module.exports = { init, toggle, expand, isCollapsed };
