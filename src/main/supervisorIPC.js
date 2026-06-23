/**
 * IPC bridge between the renderer and the supervisor engine.
 *
 * Wires every channel declared under "Project profile" / "Basic Memory" /
 * "Supervisor loop" / "Cross-project orchestration" in src/shared/ipcChannels.js
 * to the engine modules already shipped (profile / memory / supervisorRegistry /
 * UIAdapter).
 *
 * Call `setupSupervisorIPC(ipcMain, getMainWindow)` once from src/main/index.js.
 */

const fs = require('fs');
const path = require('path');
const { IPC } = require('../shared/ipcChannels');
const profile = require('./profile');
const memory = require('./memory');
const supervisorRegistry = require('./supervisorRegistry');
const memoryMirror = require('./memoryMirror');
const specManager = require('./specManager');
const { buildAdapters } = require('./adapters/registry');
const { UIAdapter } = require('./adapters/uiAdapter');

// One UIAdapter per main process. The `emit` hook fans out to whichever
// renderer window the user is looking at; `onAnswered` accepts answers
// from the renderer back into the loop.
let uiAdapter = null;
const _profileWatchers = new Map(); // projectPath → unwatch
const _registrySubscribers = new Set(); // BrowserWindow webContents

function _broadcast(win, channel, payload) {
  try {
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  } catch { /* swallow */ }
}

function setupSupervisorIPC(ipcMain, getMainWindow) {
  const broadcastAll = (channel, payload) => {
    const win = typeof getMainWindow === 'function' ? getMainWindow() : null;
    _broadcast(win, channel, payload);
  };

  // ─── UIAdapter singleton ─────────────────────────────────
  // The adapter writes escalation files + emits to renderer + waits for
  // a matching answered IPC. The supervisor loop's `presentEscalation`
  // executor calls into this adapter.
  const answeredListeners = new Set();
  uiAdapter = new UIAdapter({
    emit: (channel, payload) => broadcastAll(channel, payload),
    onAnswered: (handler) => {
      answeredListeners.add(handler);
      return () => answeredListeners.delete(handler);
    },
  });

  ipcMain.on(IPC.SUPERVISOR_ESCALATION_ANSWERED, (event, payload) => {
    for (const fn of answeredListeners) {
      try { fn(payload); } catch { /* swallow */ }
    }
  });

  // ─── Profile ─────────────────────────────────────────────
  ipcMain.handle(IPC.LOAD_PROFILE, (event, { projectPath }) => {
    return profile.loadProfile(projectPath);
  });

  ipcMain.handle(IPC.SAVE_PROFILE, (event, { projectPath, profile: p }) => {
    return profile.saveProfile(projectPath, p);
  });

  ipcMain.on(IPC.WATCH_PROFILE, (event, { projectPath }) => {
    if (_profileWatchers.has(projectPath)) return; // already watching
    const unwatch = profile.watchProfile(projectPath, (loaded) => {
      broadcastAll(IPC.PROFILE_DATA, { projectPath, ...loaded });
    });
    _profileWatchers.set(projectPath, unwatch);
    // Push an initial snapshot.
    broadcastAll(IPC.PROFILE_DATA, {
      projectPath,
      ...profile.loadProfile(projectPath),
    });
  });

  ipcMain.on(IPC.UNWATCH_PROFILE, (event, { projectPath }) => {
    const unwatch = _profileWatchers.get(projectPath);
    if (unwatch) {
      unwatch();
      _profileWatchers.delete(projectPath);
    }
  });

  // ─── Memory ──────────────────────────────────────────────
  // The backend's own `resolveProjectId(projectPath)` reads
  // .frame/profile.json's `project.memoryId` so named dirs (e.g.
  // ~/memory/localized/) win over the basename fallback.
  ipcMain.handle(IPC.SEARCH_MEMORY, async (event, { projectPath, query, k = 5 }) => {
    const bm = new memory.BasicMemoryBackend({ projectPath });
    return bm.search(query, k);
  });

  ipcMain.handle(IPC.LIST_MEMORY, async (event, { projectPath, category, spec_slug }) => {
    const bm = new memory.BasicMemoryBackend({ projectPath });
    return bm.list({ category, spec_slug });
  });

  // ─── Supervisor lifecycle ────────────────────────────────
  ipcMain.handle(IPC.SUPERVISOR_START, async (event, { projectPath, slug, terminalId }) => {
    const executors = _buildExecutors({ projectPath, slug, terminalId, broadcastAll });
    const loop = supervisorRegistry.startSupervisor({
      projectPath, slug, executors,
      // capabilities wiring happens inside _buildExecutors so the supervisor
      // can call into them on RESEARCH verdicts. Today the loop's classifier
      // path-through is enough.
    });
    return { success: true, state: loop.getState() };
  });

  ipcMain.handle(IPC.SUPERVISOR_STOP, async (event, { projectPath, slug }) => {
    await supervisorRegistry.stopSupervisor(projectPath, slug);
    return { success: true };
  });

  ipcMain.handle(IPC.SUPERVISOR_AUDIT, (event, { projectPath, slug, tail = 100 }) => {
    const auditPath = path.join(projectPath, '.frame', 'specs', slug, 'supervisor-audit.jsonl');
    if (!fs.existsSync(auditPath)) return [];
    try {
      const raw = fs.readFileSync(auditPath, 'utf8');
      const lines = raw.split(/\r?\n/).filter(Boolean);
      const slice = lines.slice(-tail);
      return slice.map((line) => {
        try { return JSON.parse(line); } catch { return { _malformed: line }; }
      });
    } catch { return []; }
  });

  // ─── Cross-project ───────────────────────────────────────
  ipcMain.handle(IPC.LIST_CROSS_PROJECT_SUPERVISORS, () => {
    return supervisorRegistry.getAcrossProjects();
  });

  ipcMain.on(IPC.WATCH_CROSS_PROJECT_SUPERVISORS, (event) => {
    const wc = event.sender;
    _registrySubscribers.add(wc);
    // initial snapshot
    try { wc.send(IPC.CROSS_PROJECT_SUPERVISORS_DATA, supervisorRegistry.getAcrossProjects()); }
    catch { /* swallow */ }
  });

  // Single shared subscriber that fans out to every registered webContents.
  supervisorRegistry.subscribe((snapshot) => {
    for (const wc of _registrySubscribers) {
      try {
        if (!wc.isDestroyed()) wc.send(IPC.CROSS_PROJECT_SUPERVISORS_DATA, snapshot);
      } catch { /* swallow */ }
    }
  });

  ipcMain.handle(IPC.PAUSE_SPEC_SUPERVISOR, async (event, { projectPath, slug }) => {
    await supervisorRegistry.stopSupervisor(projectPath, slug);
    return { success: true };
  });

  ipcMain.handle(IPC.RESUME_SPEC_SUPERVISOR, async (event, { projectPath, slug, terminalId }) => {
    const executors = _buildExecutors({ projectPath, slug, terminalId, broadcastAll });
    const loop = supervisorRegistry.startSupervisor({ projectPath, slug, executors });
    return { success: true, state: loop.getState() };
  });

  ipcMain.handle(IPC.PAUSE_ALL_SUPERVISORS, async () => {
    const halted = await supervisorRegistry.pauseAll();
    return { success: true, halted };
  });
}

// ─── Executor factory ─────────────────────────────────────

function _buildExecutors({ projectPath, slug, terminalId, broadcastAll }) {
  return {
    async readStatus(pp, s) {
      const result = specManager.getSpec(pp, s);
      return result?.status || { phase: 'specified', slug: s };
    },
    async readTasks(pp, s) {
      const tasksManager = require('./tasksManager');
      const data = tasksManager.loadTasks(pp);
      if (!data) return [];
      return (data.tasks || []).filter(
        (t) => t && t.source && t.source.startsWith(`spec:${s}:`)
      );
    },
    async readLane() {
      // Lane resolution happens in the renderer for now (agentDispatch
      // owns the map). The supervisor loop just needs a truthy terminalId
      // to proceed past the "no lane attached" gate.
      return terminalId ? { terminalId } : null;
    },
    async readDoc(pp, s, doc) {
      const file = path.join(pp, '.frame', 'specs', s, doc);
      if (!fs.existsSync(file)) return '';
      try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
    },
    async readRecentAudit(pp, s, n = 5) {
      const auditPath = path.join(pp, '.frame', 'specs', s, 'supervisor-audit.jsonl');
      if (!fs.existsSync(auditPath)) return [];
      try {
        const raw = fs.readFileSync(auditPath, 'utf8');
        const lines = raw.split(/\r?\n/).filter(Boolean).slice(-n);
        return lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      } catch { return []; }
    },
    async readProfile(pp) {
      return profile.loadProfile(pp).profile;
    },
    async presentEscalation(escalation) {
      if (!uiAdapter) throw new Error('UIAdapter not initialised');
      return uiAdapter.present({ ...escalation, projectPath, slug });
    },
    async advancePhase(pp, s, nextPhase) {
      // The phase-advance dispatch reuses Frame's existing `specManager`
      // command-file builder + lane dispatch. For v1, we update the
      // status.json + write the next runtime prompt; lane dispatch is
      // left to existing renderer-side agentDispatch.
      const cmdMap = { planned: 'spec.plan', tasks_generated: 'spec.tasks', implementing: 'spec.implement' };
      const cmd = cmdMap[nextPhase] || 'spec.plan';
      try {
        specManager.buildSpecCommandFile(pp, s, cmd, 'claude-code');
      } catch { /* tolerate — runtime prompt isn't fatal */ }
      // Phase transition fires through Frame's spec watcher when the
      // implementer writes the new doc; we don't force the phase here.
    },
    async implementNextTurn(pp, s) {
      try {
        specManager.buildSpecCommandFile(pp, s, 'spec.implement', 'claude-code');
      } catch { /* swallow */ }
    },
    async readLastOutcomeEntry(pp, s) {
      const file = path.join(pp, '.frame', 'specs', s, 'outcome.md');
      if (!fs.existsSync(file)) return '';
      try {
        const raw = fs.readFileSync(file, 'utf8');
        const parts = raw.split(/\n---\n/);
        return parts[parts.length - 1] || raw;
      } catch { return ''; }
    },
    async readFootprint(pp, s) {
      return specManager.getSpecFootprint(pp, s) || [];
    },
    async readChangedFiles() { return []; },
    async checkFootprintConflict() { return false; },
    async markDone(pp, s) {
      try { specManager.updateSpecStatus(pp, s, { phase: 'done' }); } catch { /* swallow */ }
    },
    async dispatchRevision(pp, s, _instructions) {
      try {
        specManager.buildSpecCommandFile(pp, s, 'spec.implement', 'claude-code');
      } catch { /* swallow */ }
    },
  };
}

module.exports = { setupSupervisorIPC };
