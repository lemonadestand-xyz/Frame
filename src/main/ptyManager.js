/**
 * PTY Manager Module
 * Manages multiple PTY instances for multi-terminal support
 */

const pty = require('node-pty');
const { IPC } = require('../shared/ipcChannels');
const promptLogger = require('./promptLogger');

// Store multiple PTY instances
const ptyInstances = new Map(); // Map<terminalId, {pty, cwd, projectPath, awaiting, idleTimer}>
let mainWindow = null;
let terminalCounter = 0;
const MAX_TERMINALS = 9;

// How long a terminal must go without any PTY output, after being marked
// "active" by a Run/Start flow, before we consider it complete. Long
// enough to cover Claude's thinking-spinner cadence (which streams a few
// chars every ~200ms) and short enough to be a useful "look back at me"
// signal. 4s is the user-validated default; tunable later.
const TERMINAL_IDLE_THRESHOLD_MS = 4000;

/**
 * Initialize PTY manager with window reference
 */
function init(window) {
  mainWindow = window;
}

/**
 * Get default shell based on platform
 */
function getDefaultShell() {
  if (process.platform === 'win32') {
    try {
      require('child_process').execSync('where pwsh', { stdio: 'ignore' });
      return 'pwsh.exe';
    } catch {
      return 'powershell.exe';
    }
  } else {
    return process.env.SHELL || '/bin/zsh';
  }
}

/**
 * Get available shells on the system
 * @returns {Array<{id: string, name: string, path: string}>}
 */
function getAvailableShells() {
  const shells = [];
  const { execSync } = require('child_process');
  const fs = require('fs');
  const defaultShell = getDefaultShell();

  if (process.platform === 'win32') {
    // Windows shells
    const windowsShells = [
      { id: 'powershell', name: 'PowerShell', path: 'powershell.exe' },
      { id: 'cmd', name: 'Command Prompt', path: 'cmd.exe' }
    ];

    // Check for PowerShell Core (pwsh)
    try {
      execSync('where pwsh', { stdio: 'ignore' });
      windowsShells.unshift({ id: 'pwsh', name: 'PowerShell Core', path: 'pwsh.exe' });
    } catch {}

    // Check for Git Bash
    const gitBashPaths = [
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files (x86)\\Git\\bin\\bash.exe'
    ];
    for (const gitBash of gitBashPaths) {
      if (fs.existsSync(gitBash)) {
        windowsShells.push({ id: 'gitbash', name: 'Git Bash', path: gitBash });
        break;
      }
    }

    // Check for WSL
    try {
      execSync('where wsl', { stdio: 'ignore' });
      windowsShells.push({ id: 'wsl', name: 'WSL', path: 'wsl.exe' });
    } catch {}

    shells.push(...windowsShells);
  } else {
    // Unix-like shells (macOS, Linux)
    const unixShells = [
      { id: 'zsh', name: 'Zsh', path: '/bin/zsh' },
      { id: 'bash', name: 'Bash', path: '/bin/bash' },
      { id: 'sh', name: 'Shell', path: '/bin/sh' }
    ];

    // Check for fish shell
    try {
      execSync('which fish', { stdio: 'ignore' });
      const fishPath = execSync('which fish', { encoding: 'utf8' }).trim();
      unixShells.push({ id: 'fish', name: 'Fish', path: fishPath });
    } catch {}

    // Check for nushell
    try {
      execSync('which nu', { stdio: 'ignore' });
      const nuPath = execSync('which nu', { encoding: 'utf8' }).trim();
      unixShells.push({ id: 'nu', name: 'Nushell', path: nuPath });
    } catch {}

    // Filter to only existing shells and mark default
    for (const shell of unixShells) {
      if (fs.existsSync(shell.path)) {
        shell.isDefault = shell.path === defaultShell;
        shells.push(shell);
      }
    }
  }

  // Sort so default shell is first
  shells.sort((a, b) => {
    if (a.isDefault) return -1;
    if (b.isDefault) return 1;
    return 0;
  });

  return shells;
}

/**
 * Create a new terminal instance
 * @param {string|null} workingDir - Working directory (defaults to HOME)
 * @param {string|null} projectPath - Associated project path (null = global)
 * @param {string|null} shellPath - Shell to use (defaults to system default)
 * @returns {string} Terminal ID
 */
function createTerminal(workingDir = null, projectPath = null, shellPath = null) {
  // Per-project cap. The renderer keeps terminals from inactive projects
  // alive in its Map for fast switch-back, so a global count would surface
  // here as a confusing "you have 3 visible but can't open a 4th" because
  // 6 hidden ones from a previous project are eating the global slot.
  const projectCount = Array.from(ptyInstances.values())
    .filter(p => p.projectPath === projectPath).length;
  if (projectCount >= MAX_TERMINALS) {
    throw new Error(`Maximum terminal limit (${MAX_TERMINALS}) reached for this project`);
  }

  const terminalId = `term-${++terminalCounter}`;
  const cwd = workingDir || process.env.HOME || process.env.USERPROFILE;
  const shell = shellPath || getDefaultShell();

  // Determine shell arguments based on shell type
  let shellArgs = [];
  if (process.platform !== 'win32') {
    // For Unix shells, use interactive login shell
    const shellName = shell.split('/').pop();
    if (shellName === 'fish') {
      shellArgs = ['-i'];
    } else if (shellName === 'nu') {
      shellArgs = ['-l'];
    } else {
      shellArgs = ['-i', '-l'];
    }
  }

  const ptyProcess = pty.spawn(shell, shellArgs, {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: cwd,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor'
    }
  });

  // Handle PTY output - send with terminal ID. Output also resets the
  // idle timer for completion detection (see markTerminalActive).
  ptyProcess.onData((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.TERMINAL_OUTPUT_ID, { terminalId, data });
    }
    const instance = ptyInstances.get(terminalId);
    if (instance && instance.awaiting) {
      resetIdleTimer(terminalId);
    }
  });

  // Handle PTY exit. Marked idempotent — destroyTerminal/destroyAll may
  // have already deleted the instance and cleared timers.
  ptyProcess.onExit(({ exitCode, signal }) => {
    console.log(`Terminal ${terminalId} exited:`, exitCode, signal);
    const inst = ptyInstances.get(terminalId);
    if (inst) {
      inst.destroyed = true;
      clearIdleTimer(terminalId);
      ptyInstances.delete(terminalId);
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        mainWindow.webContents.send(IPC.TERMINAL_DESTROYED, { terminalId, exitCode });
      } catch (_) { /* window torn down between guard and send */ }
    }
  });

  ptyInstances.set(terminalId, { pty: ptyProcess, cwd, projectPath, destroyed: false });
  console.log(`Created terminal ${terminalId} in ${cwd} (project: ${projectPath || 'global'})`);

  return terminalId;
}

/**
 * Get terminals for a specific project
 * @param {string|null} projectPath - Project path or null for global
 * @returns {string[]} Array of terminal IDs
 */
function getTerminalsByProject(projectPath) {
  const result = [];
  for (const [terminalId, instance] of ptyInstances) {
    if (instance.projectPath === projectPath) {
      result.push(terminalId);
    }
  }
  return result;
}

/**
 * Get terminal info
 * @param {string} terminalId - Terminal ID
 * @returns {Object|null} Terminal info (cwd, projectPath)
 */
function getTerminalInfo(terminalId) {
  const instance = ptyInstances.get(terminalId);
  if (instance) {
    return { cwd: instance.cwd, projectPath: instance.projectPath };
  }
  return null;
}

/**
 * Write data to specific terminal. Guarded against the destroyed-race
 * window between user input being dispatched and the pty being torn
 * down — node-pty's native binding will throw a Napi error otherwise.
 */
function writeToTerminal(terminalId, data) {
  const instance = ptyInstances.get(terminalId);
  if (!instance || instance.destroyed) return;
  try {
    instance.pty.write(data);
  } catch (err) {
    console.warn(`pty.write failed for ${terminalId}:`, err.message);
    instance.destroyed = true;
  }
}

/**
 * Resize specific terminal. Same guard as writeToTerminal — a late
 * resize from xterm's fit-addon on window teardown could otherwise
 * crash the process.
 */
function resizeTerminal(terminalId, cols, rows) {
  const instance = ptyInstances.get(terminalId);
  if (!instance || instance.destroyed) return;
  try {
    instance.pty.resize(cols, rows);
  } catch (err) {
    console.warn(`pty.resize failed for ${terminalId}:`, err.message);
    instance.destroyed = true;
  }
}

/**
 * Destroy specific terminal. Idempotent via the `destroyed` flag so
 * destroyAll → onExit double-fire can't kill an already-dead handle.
 */
function destroyTerminal(terminalId) {
  const instance = ptyInstances.get(terminalId);
  if (!instance) return;
  if (instance.destroyed) {
    ptyInstances.delete(terminalId);
    return;
  }
  instance.destroyed = true;
  clearIdleTimer(terminalId);
  try {
    instance.pty.kill();
  } catch (err) {
    // ESRCH / EBADF surface as Napi errors from node-pty if the pid
    // is already gone or the handle is in a bad state. Safe to ignore
    // here — we're tearing down anyway.
    console.warn(`pty.kill failed for ${terminalId}:`, err.message);
  }
  ptyInstances.delete(terminalId);
  console.log(`Destroyed terminal ${terminalId}`);
}

/**
 * Destroy all terminals. Used by mainWindow 'closed' and app shutdown.
 * Each kill is independently guarded so one bad handle can't take
 * down the rest of teardown.
 */
function destroyAll() {
  for (const [terminalId, instance] of ptyInstances) {
    if (instance.destroyed) continue;
    instance.destroyed = true;
    clearIdleTimer(terminalId);
    try {
      instance.pty.kill();
    } catch (err) {
      console.warn(`pty.kill failed for ${terminalId} during destroyAll:`, err.message);
    }
    console.log(`Destroyed terminal ${terminalId}`);
  }
  ptyInstances.clear();
}

/**
 * Get terminal count
 */
function getTerminalCount() {
  return ptyInstances.size;
}

/**
 * Get all terminal IDs
 */
function getTerminalIds() {
  return Array.from(ptyInstances.keys());
}

/**
 * Check if terminal exists
 */
function hasTerminal(terminalId) {
  return ptyInstances.has(terminalId);
}

/**
 * Setup IPC handlers for multi-terminal
 */
function setupIPC(ipcMain) {
  // Get available shells
  ipcMain.on(IPC.GET_AVAILABLE_SHELLS, (event) => {
    try {
      const shells = getAvailableShells();
      event.reply(IPC.AVAILABLE_SHELLS_DATA, { shells, success: true });
    } catch (error) {
      event.reply(IPC.AVAILABLE_SHELLS_DATA, { shells: [], success: false, error: error.message });
    }
  });

  // Create new terminal
  ipcMain.on(IPC.TERMINAL_CREATE, (event, data) => {
    try {
      // Support both old format (string) and new format (object)
      let workingDir = null;
      let projectPath = null;
      let shellPath = null;

      if (typeof data === 'string') {
        // Legacy format: just working directory
        workingDir = data;
      } else if (data && typeof data === 'object') {
        // New format: { cwd, projectPath, shell }
        workingDir = data.cwd;
        projectPath = data.projectPath;
        shellPath = data.shell;
      }

      const terminalId = createTerminal(workingDir, projectPath, shellPath);
      event.reply(IPC.TERMINAL_CREATED, { terminalId, success: true });
    } catch (error) {
      event.reply(IPC.TERMINAL_CREATED, { success: false, error: error.message });
    }
  });

  // Destroy terminal
  ipcMain.on(IPC.TERMINAL_DESTROY, (event, terminalId) => {
    destroyTerminal(terminalId);
  });

  // Input to specific terminal
  ipcMain.on(IPC.TERMINAL_INPUT_ID, (event, { terminalId, data }) => {
    writeToTerminal(terminalId, data);
    promptLogger.logInput(data);
  });

  // Resize specific terminal
  ipcMain.on(IPC.TERMINAL_RESIZE_ID, (event, { terminalId, cols, rows }) => {
    resizeTerminal(terminalId, cols, rows);
  });

  // Activity tracking for completion notifications (lemo-7). Renderer
  // marks a terminal "active" right after dispatching a Run / Start
  // prompt. We arm an idle timer; each PTY output chunk resets it.
  // When the timer expires we emit TERMINAL_COMPLETED so the renderer
  // can notify, bounce the dock, and decorate the source tab + project.
  ipcMain.on(IPC.TERMINAL_MARK_ACTIVE, (event, { terminalId } = {}) => {
    if (!terminalId) return;
    markTerminalActive(terminalId);
  });
}

function markTerminalActive(terminalId) {
  const instance = ptyInstances.get(terminalId);
  if (!instance) return;
  instance.awaiting = true;
  resetIdleTimer(terminalId);
}

function resetIdleTimer(terminalId) {
  const instance = ptyInstances.get(terminalId);
  if (!instance) return;
  if (instance.idleTimer) clearTimeout(instance.idleTimer);
  instance.idleTimer = setTimeout(() => {
    handleIdleExpired(terminalId);
  }, TERMINAL_IDLE_THRESHOLD_MS);
}

function clearIdleTimer(terminalId) {
  const instance = ptyInstances.get(terminalId);
  if (!instance) return;
  if (instance.idleTimer) {
    clearTimeout(instance.idleTimer);
    instance.idleTimer = null;
  }
  instance.awaiting = false;
}

function handleIdleExpired(terminalId) {
  const instance = ptyInstances.get(terminalId);
  if (!instance || !instance.awaiting) return;
  instance.awaiting = false;
  instance.idleTimer = null;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.TERMINAL_COMPLETED, {
      terminalId,
      projectPath: instance.projectPath || null
    });
  }
}

module.exports = {
  init,
  createTerminal,
  writeToTerminal,
  resizeTerminal,
  destroyTerminal,
  destroyAll,
  getTerminalCount,
  getTerminalIds,
  hasTerminal,
  getTerminalsByProject,
  getTerminalInfo,
  getAvailableShells,
  setupIPC
};
