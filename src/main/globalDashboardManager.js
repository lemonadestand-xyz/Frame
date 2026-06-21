/**
 * Global Dashboard Manager
 *
 * Owns the cross-project registry at ~/.frame/registry.json. Each entry
 * indexes one project's metadata (user-curated) plus a cached snapshot
 * of its tasks.json. Sync is manual: the renderer pulls a Sync button
 * which sequentially re-reads every tracked project's tasks.json and
 * refreshes the snapshot.
 *
 * `tracked` = present in the registry. Removing wipes metadata.
 * `filterHidden` = registered but hidden from the current view. Toggle
 * preserves metadata + snapshot.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { IPC } = require('../shared/ipcChannels');
const { WORKSPACE_DIR, FRAME_FILES } = require('../shared/frameConstants');

const REGISTRY_FILE = 'registry.json';
const WORKSPACES_FILE = 'workspaces.json';
const REGISTRY_VERSION = '1.0';

let mainWindow = null;
let registryDir = null;
let registryPath = null;

function init(window) {
  mainWindow = window;
  registryDir = path.join(os.homedir(), WORKSPACE_DIR);
  registryPath = path.join(registryDir, REGISTRY_FILE);
  ensureRegistry();
}

function ensureRegistry() {
  if (!fs.existsSync(registryDir)) {
    fs.mkdirSync(registryDir, { recursive: true });
  }
  if (!fs.existsSync(registryPath)) {
    saveRegistry(emptyRegistry());
  }
}

function emptyRegistry() {
  return {
    version: REGISTRY_VERSION,
    lastSyncedAt: null,
    projects: {}
  };
}

function loadRegistry() {
  try {
    if (!fs.existsSync(registryPath)) return emptyRegistry();
    const raw = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    if (!raw || typeof raw !== 'object') return emptyRegistry();
    if (!raw.projects || typeof raw.projects !== 'object') raw.projects = {};
    raw.version = raw.version || REGISTRY_VERSION;
    return raw;
  } catch (err) {
    console.error('Error loading global registry:', err);
    return emptyRegistry();
  }
}

function saveRegistry(registry) {
  try {
    fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error saving global registry:', err);
    return false;
  }
}

/**
 * Resolve the display name for a project. Preference order:
 *   1. Explicit name passed in by the caller.
 *   2. Name stored in ~/.frame/workspaces.json (the user's preferred name —
 *      they may have renamed via the sidebar).
 *   3. Parent directory name when the basename is generic ("develop",
 *      "main", "src", etc.) — common when projects use git worktrees.
 *   4. path.basename as a last resort.
 */
function resolveProjectName(projectPath, fallbackName) {
  if (fallbackName && fallbackName.trim()) return fallbackName.trim();
  try {
    const wsPath = path.join(os.homedir(), WORKSPACE_DIR, WORKSPACES_FILE);
    if (fs.existsSync(wsPath)) {
      const ws = JSON.parse(fs.readFileSync(wsPath, 'utf8'));
      const active = ws.activeWorkspace;
      const projects = (ws.workspaces && ws.workspaces[active] && ws.workspaces[active].projects) || [];
      const match = projects.find(p => p.path === projectPath);
      if (match && match.name) return match.name;
    }
  } catch (err) {
    // Workspace read failed — fall through to path-based guesses
  }
  const base = path.basename(projectPath);
  const generic = new Set(['develop', 'main', 'master', 'src', 'app', 'trunk']);
  if (generic.has(base.toLowerCase())) {
    const parent = path.basename(path.dirname(projectPath));
    if (parent) return parent;
  }
  return base;
}

function readTaskSnapshot(projectPath) {
  const tasksPath = path.join(projectPath, FRAME_FILES.TASKS);
  if (!fs.existsSync(tasksPath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
    const tasks = Array.isArray(raw.tasks) ? raw.tasks : [];
    return {
      tasks,
      readAt: new Date().toISOString(),
      lastUpdated: raw.lastUpdated || null
    };
  } catch (err) {
    console.warn(`Failed to read tasks for ${projectPath}:`, err.message);
    return null;
  }
}

function addProject(projectPath, { name, description, metadata } = {}) {
  if (!projectPath) return null;
  const registry = loadRegistry();
  const existing = registry.projects[projectPath];
  const now = new Date().toISOString();

  const resolvedName = resolveProjectName(projectPath, name);
  const entry = existing
    ? { ...existing, tracked: true }
    : {
        path: projectPath,
        name: resolvedName,
        description: description || '',
        metadata: metadata && typeof metadata === 'object' ? metadata : {},
        tracked: true,
        filterHidden: false,
        addedAt: now,
        lastSyncedAt: null,
        pathMissing: false,
        taskSnapshot: null
      };

  if (existing && name) entry.name = name;
  if (existing && description !== undefined) entry.description = description;
  if (existing && metadata && typeof metadata === 'object') entry.metadata = metadata;

  // Probe the project's tasks immediately so the entry isn't empty.
  if (fs.existsSync(projectPath)) {
    const snap = readTaskSnapshot(projectPath);
    if (snap) {
      entry.taskSnapshot = snap;
      entry.lastSyncedAt = now;
      entry.pathMissing = false;
    }
  } else {
    entry.pathMissing = true;
  }

  registry.projects[projectPath] = entry;
  saveRegistry(registry);
  return entry;
}

function removeProject(projectPath) {
  const registry = loadRegistry();
  if (!registry.projects[projectPath]) return false;
  delete registry.projects[projectPath];
  saveRegistry(registry);
  return true;
}

function updateMetadata(projectPath, { description, metadata, name } = {}) {
  const registry = loadRegistry();
  const entry = registry.projects[projectPath];
  if (!entry) return null;
  if (description !== undefined) entry.description = description;
  if (name !== undefined && name !== null) {
    entry.name = name;
    // Explicit rename from the dashboard locks the name so future
    // syncs won't overwrite it with the workspace value.
    entry.nameLocked = true;
  }
  if (metadata && typeof metadata === 'object') entry.metadata = metadata;
  saveRegistry(registry);
  return entry;
}

/**
 * Mutate `registry.projects` in place, pulling a fresh display name from
 * ~/.frame/workspaces.json for every entry that isn't name-locked. Used
 * by sync and by load so dashboard names always mirror what the user
 * renamed in the sidebar — until they explicitly override in-dashboard.
 */
function refreshNamesFromWorkspace(registry) {
  let mutated = false;
  for (const entry of Object.values(registry.projects)) {
    if (entry.nameLocked) continue;
    const resolved = resolveProjectName(entry.path, null);
    if (resolved && resolved !== entry.name) {
      entry.name = resolved;
      mutated = true;
    }
  }
  return mutated;
}

function setFilter(projectPath, filterHidden) {
  const registry = loadRegistry();
  const entry = registry.projects[projectPath];
  if (!entry) return null;
  entry.filterHidden = !!filterHidden;
  saveRegistry(registry);
  return entry;
}

/**
 * Re-read tasks.json from every tracked project. Sequential to keep
 * disk pressure low (N is expected to be small) and to allow per-step
 * progress updates to the renderer.
 */
async function sync(sender) {
  const registry = loadRegistry();
  refreshNamesFromWorkspace(registry);
  const entries = Object.values(registry.projects);
  const total = entries.length;
  let index = 0;

  for (const entry of entries) {
    index += 1;
    if (sender && !sender.isDestroyed()) {
      sender.send(IPC.GLOBAL_DASHBOARD_SYNC_PROGRESS, {
        index,
        total,
        projectPath: entry.path,
        name: entry.name
      });
    }
    if (!fs.existsSync(entry.path)) {
      entry.pathMissing = true;
      entry.lastSyncedAt = new Date().toISOString();
      continue;
    }
    const snap = readTaskSnapshot(entry.path);
    entry.pathMissing = false;
    entry.taskSnapshot = snap;
    entry.lastSyncedAt = new Date().toISOString();
  }

  registry.lastSyncedAt = new Date().toISOString();
  saveRegistry(registry);

  if (sender && !sender.isDestroyed()) {
    sender.send(IPC.GLOBAL_DASHBOARD_SYNC_PROGRESS, {
      index: total,
      total,
      done: true
    });
  }
  return registry;
}

/**
 * Re-read tasks.json for a single tracked project and refresh its
 * snapshot. Used after a mutation made through the dashboard so the UI
 * reflects the change without waiting for a full Sync.
 */
function refreshProject(projectPath) {
  const registry = loadRegistry();
  const entry = registry.projects[projectPath];
  if (!entry) return null;
  if (!fs.existsSync(projectPath)) {
    entry.pathMissing = true;
  } else {
    const snap = readTaskSnapshot(projectPath);
    entry.pathMissing = false;
    if (snap) entry.taskSnapshot = snap;
  }
  entry.lastSyncedAt = new Date().toISOString();
  saveRegistry(registry);
  return registry;
}

function isTracked(projectPath) {
  const registry = loadRegistry();
  const entry = registry.projects[projectPath];
  return !!(entry && entry.tracked);
}

function notifyEnrollPrompt(projectPath, projectName) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(IPC.PROMPT_GLOBAL_DASHBOARD_ENROLL, {
    projectPath,
    projectName: projectName || path.basename(projectPath)
  });
}

function setupIPC(ipcMain) {
  ipcMain.on(IPC.LOAD_GLOBAL_DASHBOARD, (event) => {
    const registry = loadRegistry();
    // Self-heal: pre-fix entries that captured the bare basename get
    // their names refreshed from the workspace on every load.
    if (refreshNamesFromWorkspace(registry)) saveRegistry(registry);
    event.sender.send(IPC.GLOBAL_DASHBOARD_DATA, registry);
  });

  ipcMain.on(IPC.SYNC_GLOBAL_DASHBOARD, async (event) => {
    const registry = await sync(event.sender);
    event.sender.send(IPC.GLOBAL_DASHBOARD_DATA, registry);
  });

  ipcMain.on(IPC.ADD_GLOBAL_PROJECT, (event, payload) => {
    if (Array.isArray(payload)) {
      for (const item of payload) {
        addProject(item.projectPath || item.path, item);
      }
    } else if (payload) {
      addProject(payload.projectPath || payload.path, payload);
    }
    event.sender.send(IPC.GLOBAL_DASHBOARD_DATA, loadRegistry());
  });

  ipcMain.on(IPC.REMOVE_GLOBAL_PROJECT, (event, { projectPath } = {}) => {
    removeProject(projectPath);
    event.sender.send(IPC.GLOBAL_DASHBOARD_DATA, loadRegistry());
  });

  ipcMain.on(IPC.UPDATE_GLOBAL_PROJECT_METADATA, (event, { projectPath, description, metadata, name } = {}) => {
    updateMetadata(projectPath, { description, metadata, name });
    event.sender.send(IPC.GLOBAL_DASHBOARD_DATA, loadRegistry());
  });

  ipcMain.on(IPC.SET_GLOBAL_PROJECT_FILTER, (event, { projectPath, filterHidden } = {}) => {
    setFilter(projectPath, filterHidden);
    event.sender.send(IPC.GLOBAL_DASHBOARD_DATA, loadRegistry());
  });

  ipcMain.on(IPC.REFRESH_GLOBAL_PROJECT, (event, { projectPath } = {}) => {
    const updated = refreshProject(projectPath);
    if (updated) event.sender.send(IPC.GLOBAL_DASHBOARD_DATA, updated);
  });
}

module.exports = {
  init,
  loadRegistry,
  addProject,
  removeProject,
  updateMetadata,
  setFilter,
  sync,
  refreshProject,
  isTracked,
  notifyEnrollPrompt,
  setupIPC
};
