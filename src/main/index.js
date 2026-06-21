/**
 * Main Process Entry Point
 * Initializes Electron app, creates window, loads modules
 */

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { IPC } = require('../shared/ipcChannels');

// Import modules
const pty = require('./pty');
const ptyManager = require('./ptyManager');
const menu = require('./menu');
const dialogs = require('./dialogs');
const fileTree = require('./fileTree');
const promptLogger = require('./promptLogger');
const workspace = require('./workspace');
const frameProject = require('./frameProject');
const fileEditor = require('./fileEditor');
const tasksManager = require('./tasksManager');
const pluginsManager = require('./pluginsManager');
const githubManager = require('./githubManager');
const claudeUsageManager = require('./claudeUsageManager');
const overviewManager = require('./overviewManager');
const gitBranchesManager = require('./gitBranchesManager');
const aiToolManager = require('./aiToolManager');
const claudeSessionsManager = require('./claudeSessionsManager');
const updateChecker = require('./updateChecker');
const userSettings = require('./userSettings');
const gitStatusManager = require('./gitStatusManager');
const gitDiffManager = require('./gitDiffManager');
const telemetry = require('./telemetry');
const specManager = require('./specManager');
const globalDashboardManager = require('./globalDashboardManager');
const chatSessionManager = require('./chatSessionManager');

let mainWindow = null;

/**
 * Create main application window
 */
function createWindow() {
  // Use the repo's PNG for dev builds so the dock/taskbar reflects the
  // forked branding without needing an .icns/.ico round-trip. Production
  // packaging still uses whatever electron-builder is configured with.
  const appIconPath = path.join(__dirname, '../../assets/app-icon.png');

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    backgroundColor: '#1e1e1e',
    title: 'Frame',
    icon: appIconPath
  });

  // On macOS the BrowserWindow icon is ignored for the Dock — we have
  // to set it explicitly via app.dock. Guarded so this stays a no-op on
  // Windows / Linux.
  if (process.platform === 'darwin' && app.dock && typeof app.dock.setIcon === 'function') {
    try {
      app.dock.setIcon(appIconPath);
    } catch (err) {
      console.warn('Failed to set dock icon:', err.message);
    }
  }

  mainWindow.loadFile('index.html');

  // Open DevTools only in development mode
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    pty.killPTY();
    ptyManager.destroyAll();
    mainWindow = null;
  });

  // Initialize modules with window reference
  pty.init(mainWindow);
  ptyManager.init(mainWindow);
  aiToolManager.init(mainWindow, app);
  menu.init(mainWindow, app, aiToolManager);
  dialogs.init(mainWindow, (projectPath) => {
    pty.setProjectPath(projectPath);
    promptLogger.setProject(projectPath);
  });
  updateChecker.init(mainWindow);
  initModulesWithWindow(mainWindow);

  // Create application menu
  menu.createMenu();

  // Check for updates after window is ready
  mainWindow.webContents.on('did-finish-load', () => {
    updateChecker.checkForUpdate();
  });

  return mainWindow;
}

/**
 * Setup all IPC handlers
 */
function setupAllIPC() {
  // Setup module IPC handlers
  pty.setupIPC(ipcMain);
  ptyManager.setupIPC(ipcMain);
  dialogs.setupIPC(ipcMain);
  fileTree.setupIPC(ipcMain);
  promptLogger.setupIPC(ipcMain);
  workspace.setupIPC(ipcMain);
  frameProject.setupIPC(ipcMain);
  fileEditor.setupIPC(ipcMain);
  tasksManager.setupIPC(ipcMain);
  pluginsManager.setupIPC(ipcMain);
  githubManager.setupIPC(ipcMain);
  claudeUsageManager.setupIPC(ipcMain);
  overviewManager.setupIPC(ipcMain);
  gitBranchesManager.setupIPC(ipcMain);
  claudeSessionsManager.setupIPC(ipcMain);
  globalDashboardManager.setupIPC(ipcMain);
  chatSessionManager.setupIPC(ipcMain);

  // Expose the active AI tool's start invocation to renderer-side chat
  // bootstrapping so the chat panel can dispatch it into the newly
  // created pty without re-implementing flag composition.
  ipcMain.handle(IPC.GET_CHAT_START_COMMAND, () => aiToolManager.getStartCommand());

  updateChecker.setupIPC();

  // User settings (renderer-side preferences persisted to userData JSON)
  ipcMain.handle(IPC.GET_USER_SETTING, (event, key) => userSettings.get(key));
  ipcMain.handle(IPC.SET_USER_SETTING, (event, key, value) => userSettings.set(key, value));

  // Terminal completion notifications (lemo-7) — main-process pieces
  // the renderer can't do itself.
  // 1) Dock bounce on macOS so the Frame icon catches the user's eye
  //    when they've switched out to a different app.
  ipcMain.on(IPC.DOCK_BOUNCE, (event, { kind } = {}) => {
    if (process.platform !== 'darwin') return;
    if (!app.dock || typeof app.dock.bounce !== 'function') return;
    try {
      // 'critical' keeps bouncing until the app is focused, 'informational'
      // bounces once. We default to informational — the system
      // notification is the louder channel.
      app.dock.bounce(kind === 'critical' ? 'critical' : 'informational');
    } catch (err) {
      console.warn('dock.bounce failed:', err.message);
    }
  });

  // 2) Notification click handler: pull the window forward + focus.
  //    The renderer handles project/terminal selection itself once it
  //    sees the window-focus event.
  ipcMain.on(IPC.WINDOW_FOCUS_AND_SHOW, () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    if (process.platform === 'darwin' && app.dock && typeof app.dock.show === 'function') {
      app.dock.show();
    }
  });

  // Task references (lemo-4) — file picker + opener. Files and folders
  // are both selectable; the renderer decides what to do with each.
  // Returns the chosen absolute path, or null on cancel.
  // Side-effect-free folder picker (used by the global dashboard's "Add
  // project" button — we don't want to switch the active project just to
  // enroll a folder).
  ipcMain.handle(IPC.PICK_FOLDER, async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Add project to global dashboard',
      properties: ['openDirectory']
    });
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle(IPC.PICK_REFERENCE_FILE, async (event, { defaultPath } = {}) => {
    if (!mainWindow || mainWindow.isDestroyed()) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Add reference',
      defaultPath: defaultPath || undefined,
      properties: ['openFile', 'openDirectory', 'multiSelections']
    });
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) return null;
    return result.filePaths;
  });

  // Open a reference: files / folders via shell.openPath (Finder /
  // default app); URLs via shell.openExternal (default browser). The
  // renderer dispatches one of two `kind`s so we don't have to sniff.
  ipcMain.handle(IPC.OPEN_REFERENCE, async (event, { kind, value } = {}) => {
    if (!value) return { ok: false, error: 'no value' };
    try {
      if (kind === 'url') {
        await shell.openExternal(value);
        return { ok: true };
      }
      // Anything else (kind === 'file' or absent): treat as a path.
      const err = await shell.openPath(value);
      if (err) return { ok: false, error: err };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  });

  // Git status (file tree decoration polling)
  gitStatusManager.setupIPC(ipcMain);

  // Git diff (Changes panel → Diff Viewer overlay)
  gitDiffManager.setupIPC(ipcMain);

  // Spec-Driven Development — .frame/specs/<slug>/ CRUD + watcher
  specManager.setupIPC(ipcMain);

  // Telemetry — toggle from Settings
  ipcMain.handle(IPC.TELEMETRY_SET_ENABLED, (event, enabled) =>
    telemetry.setEnabled(enabled)
  );

  // Terminal input handler (needs prompt logger integration)
  ipcMain.on(IPC.TERMINAL_INPUT, (event, data) => {
    pty.writeToPTY(data);
    promptLogger.logInput(data);
  });
}

/**
 * Initialize application
 */
function init() {
  // Initialize prompt logger with app paths
  promptLogger.init(app);

  // Initialize user settings (must run after app is ready so userData path resolves)
  userSettings.init();

  // Send the launch event after userSettings is loaded so the opt-out
  // check uses the correct state. Aptabase itself was initialized earlier
  // (before app.whenReady) — see app lifecycle below.
  telemetry.trackAppStarted();

  // Setup IPC handlers
  setupAllIPC();
}

/**
 * Initialize modules that need window reference
 */
function initModulesWithWindow(window) {
  workspace.init(app, window);
  frameProject.init(window);
  fileEditor.init(window);
  tasksManager.init(window);
  pluginsManager.init(window);
  githubManager.init(window);
  claudeUsageManager.init(window);
  overviewManager.init(window);
  gitBranchesManager.init(window);
  claudeSessionsManager.init(window);
  gitStatusManager.init(window);
  specManager.init(window);
  globalDashboardManager.init(window);
  chatSessionManager.init(window);
}

// Aptabase MUST be initialized before app.whenReady() because the SDK
// internally calls protocol.registerSchemesAsPrivileged, which is only
// allowed pre-ready. Initialization itself doesn't send anything; the
// actual app_started event is fired from init() after userSettings loads.
telemetry.init();

// App lifecycle
app.whenReady().then(() => {
  // macOS'ta menü bar'da "Frame" görünsün
  app.setName('Frame');

  init();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

module.exports = { createWindow };
