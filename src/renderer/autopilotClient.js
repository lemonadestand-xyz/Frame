/**
 * Autopilot client (renderer-side state cache + IPC adapter)
 *
 * Holds a single in-memory view of the active autopilot runs the main
 * process is broadcasting via AUTOPILOT_STATE. UI helpers
 * (autopilotToggle.js, autopilotPill.js) read from here; they don't
 * subscribe to IPC themselves.
 *
 * Subscribers receive a snapshot on every state push. Use `getRunFor`
 * to look up a single spec's run without sifting through the whole list.
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');

let cache = { activeRuns: [] };
const listeners = new Set();
let subscribed = false;

// Slugs that asked to auto-arm but had no lane attached at fire time.
// The next lane-attach for that slug will re-check and start the run.
const pendingArmSlugs = new Set();

function _emit() {
  for (const cb of listeners) {
    try { cb(cache); } catch (err) { console.error('autopilotClient: listener threw', err); }
  }
}

async function _tryArmRun(projectPath, slug) {
  // Lazy require — agentDispatch pulls in DOM-touching modules; loading
  // it at file-eval would explode before the renderer's DOM exists.
  const agentDispatch = require('./agentDispatch');
  const info = agentDispatch.getSpecLaneInfo(slug);
  const terminalId = info ? info.terminalId : null;
  if (!terminalId) {
    // No lane attached — remember the intent so a later attach can fire.
    // Also broadcast so the spec section can render the "no lane" chip.
    pendingArmSlugs.add(slug);
    document.dispatchEvent(new CustomEvent('autopilot-arm-pending', { detail: { projectPath, slug } }));
    return false;
  }
  pendingArmSlugs.delete(slug);
  const result = await start({ projectPath, scope: 'spec', slug, terminalId });
  return result && result.success;
}

// Public: called by agentDispatch after a lane is assigned to a slug.
// If the slug was previously armed-without-lane (received ARM_REQUEST
// with no lane to satisfy it), fire startAutopilot now.
function consumeArmIfPending(projectPath, slug) {
  if (!projectPath || !slug) return Promise.resolve(false);
  if (!pendingArmSlugs.has(slug)) return Promise.resolve(false);
  return _tryArmRun(projectPath, slug);
}

function isArmPending(slug) {
  return !!slug && pendingArmSlugs.has(slug);
}

function _ensureSubscribed() {
  if (subscribed) return;
  subscribed = true;
  ipcRenderer.on(IPC.AUTOPILOT_STATE, (event, snapshot) => {
    cache = snapshot && Array.isArray(snapshot.activeRuns) ? snapshot : { activeRuns: [] };
    _emit();
  });
  ipcRenderer.on(IPC.AUTOPILOT_ARM_REQUEST, (event, { projectPath, slug } = {}) => {
    if (!projectPath || !slug) return;
    _tryArmRun(projectPath, slug);
  });
  // Pull initial state on first subscription
  ipcRenderer.invoke(IPC.AUTOPILOT_GET).then((snapshot) => {
    if (snapshot && Array.isArray(snapshot.activeRuns)) {
      cache = snapshot;
      _emit();
    }
  }).catch(() => { /* main may not be ready yet; AUTOPILOT_STATE will fill it */ });
}

function getState() { return cache; }

function getRunFor({ projectPath, slug, scope = 'spec' } = {}) {
  if (!projectPath) return null;
  for (const r of cache.activeRuns) {
    if (r.projectPath !== projectPath) continue;
    if (r.scope !== scope) continue;
    if (scope === 'spec' && r.slug !== slug) continue;
    return r;
  }
  return null;
}

function onChange(cb) {
  _ensureSubscribed();
  if (typeof cb === 'function') listeners.add(cb);
  return () => listeners.delete(cb);
}

async function start(args) {
  _ensureSubscribed();
  try {
    return await ipcRenderer.invoke(IPC.AUTOPILOT_START, args);
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
}

async function stop(args) {
  try {
    return await ipcRenderer.invoke(IPC.AUTOPILOT_STOP, args);
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
}

async function setAutoOnTasks({ projectPath, slug, value }) {
  try {
    return await ipcRenderer.invoke(IPC.SET_AUTO_ON_TASKS, { projectPath, slug, value: value === true });
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
}

async function getAutoOnTasks({ projectPath, slug }) {
  if (!projectPath || !slug) return false;
  try {
    return !!(await ipcRenderer.invoke(IPC.GET_AUTO_ON_TASKS, { projectPath, slug }));
  } catch { return false; }
}

module.exports = {
  getState, getRunFor, onChange,
  start, stop,
  setAutoOnTasks, getAutoOnTasks,
  consumeArmIfPending, isArmPending,
};
