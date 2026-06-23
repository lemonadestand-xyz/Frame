// Supervisor OS notifier (main) — Phase E.
//
// Thin wrapper over Electron's Notification API. Receives SUPERVISOR_NOTIFY
// payloads from the renderer's notifications.js detector and surfaces them as
// OS notifications. Click → restores + focuses Frame and forwards
// SUPERVISOR_NOTIFY_CLICK back to the renderer so it can activate the
// Supervisor section and scroll/highlight the named taskId.
//
// All renderer-side state lives in src/renderer/supervisor-ui/notifications.js
// (dedupe, diffing, stale-detection). Main is dumb on purpose: payload-in →
// OS notification. The 'urgency' field on Linux/Windows is a hint that gets
// ignored on macOS without harm.

const { Notification, BrowserWindow } = require('electron');
const SUP = require('../../shared/supervisor-ipc');

function show({ title, body, kind, taskId } = {}) {
  if (!Notification.isSupported()) return;
  const opts = { title: String(title || ''), body: String(body || '') };
  if (kind === 'failed' || kind === 'daemon-stale') opts.urgency = 'critical';
  const n = new Notification(opts);
  n.on('click', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    // Renderer side picks this up in supervisor-ui/index.js and triggers
    // open() + kanban.scrollToTask(taskId) (with the existing .flash pulse).
    win.webContents.send(SUP.SUPERVISOR_NOTIFY_CLICK, { taskId });
  });
  n.show();
}

function register(ipcMain) {
  ipcMain.on(SUP.SUPERVISOR_NOTIFY, (_evt, payload) => {
    try {
      show(payload || {});
    } catch (err) {
      console.warn('[supervisor-bridge] notifier.show failed:', err.message);
    }
  });
}

module.exports = { register, show };
