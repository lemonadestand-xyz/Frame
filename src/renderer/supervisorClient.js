/**
 * Renderer-side supervisor client.
 *
 * Wraps the SUPERVISOR_* IPC channels: start/stop a supervisor for a
 * (projectPath, slug); subscribe to cross-project state changes; read
 * the supervisor audit log; trigger pause-all.
 *
 * Exposed singleton with `onChange(fn)` listeners so any panel
 * (spec section, cross-project board, header pill) can re-render on
 * supervisor activity.
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');

const listeners = new Set();
let _cachedSnapshot = { projects: [], totalActive: 0, totalEscalations: 0, anyRunning: false };
let _watching = false;

function init() {
  if (_watching) return;
  _watching = true;
  ipcRenderer.on(IPC.CROSS_PROJECT_SUPERVISORS_DATA, (event, snapshot) => {
    _cachedSnapshot = snapshot || _cachedSnapshot;
    _emit();
  });
  ipcRenderer.send(IPC.WATCH_CROSS_PROJECT_SUPERVISORS);
}

function onChange(fn) {
  if (typeof fn !== 'function') return () => {};
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function _emit() {
  for (const fn of listeners) {
    try { fn(_cachedSnapshot); } catch { /* swallow */ }
  }
}

function getSnapshot() { return _cachedSnapshot; }

async function start({ projectPath, slug, terminalId }) {
  return ipcRenderer.invoke(IPC.SUPERVISOR_START, { projectPath, slug, terminalId });
}

async function stop({ projectPath, slug }) {
  return ipcRenderer.invoke(IPC.SUPERVISOR_STOP, { projectPath, slug });
}

async function listAcrossProjects() {
  return ipcRenderer.invoke(IPC.LIST_CROSS_PROJECT_SUPERVISORS);
}

async function readAudit({ projectPath, slug, tail = 100 }) {
  return ipcRenderer.invoke(IPC.SUPERVISOR_AUDIT, { projectPath, slug, tail });
}

async function pauseAll() { return ipcRenderer.invoke(IPC.PAUSE_ALL_SUPERVISORS); }

function getSpecState(projectPath, slug) {
  for (const proj of _cachedSnapshot.projects || []) {
    if (proj.projectPath !== projectPath) continue;
    for (const spec of proj.specs || []) {
      if (spec.slug === slug) return spec;
    }
  }
  return null;
}

module.exports = {
  init,
  onChange,
  getSnapshot,
  start,
  stop,
  listAcrossProjects,
  readAudit,
  pauseAll,
  getSpecState,
};
