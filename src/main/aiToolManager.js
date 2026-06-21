/**
 * AI Tool Manager
 * Manages switching between different AI coding tools (Claude Code, Codex CLI, etc.)
 */

const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { IPC } = require('../shared/ipcChannels');

let mainWindow = null;
let configPath = null;

// Default AI tools configuration.
// `presets` are well-known launch flags surfaced as checkboxes in the
// "Start options" popover. Tools without curated presets fall back to
// the popover's free-form "Additional flags" input — which is also how
// users add anything we haven't named here.
const AI_TOOLS = {
  claude: {
    id: 'claude',
    name: 'Claude Code',
    command: 'claude',
    description: 'Anthropic Claude Code CLI',
    commands: {
      init: '/init',
      commit: '/commit',
      review: '/review-pr',
      help: '/help'
    },
    menuLabel: 'Claude Commands',
    supportsPlugins: true,
    presets: [
      {
        id: 'dangerous',
        label: 'Skip permissions',
        flag: '--dangerously-skip-permissions',
        description: 'Bypass file/command permission prompts. Daily-driver flag for trusted local work.'
      },
      {
        id: 'remote',
        label: 'Remote control',
        flag: '--remote-control',
        description: 'Enable remote-control mode so external tools can drive the session.'
      },
      {
        id: 'continue',
        label: 'Continue last session',
        flag: '--continue',
        description: 'Resume the most recent Claude Code session in this directory.'
      }
    ]
  },
  codex: {
    id: 'codex',
    name: 'Codex CLI',
    command: './.frame/bin/codex',
    fallbackCommand: 'codex',
    description: 'OpenAI Codex CLI (with AGENTS.md injection)',
    commands: {
      review: '/review',
      model: '/model',
      permissions: '/permissions',
      help: '/help'
    },
    menuLabel: 'Codex Commands',
    supportsPlugins: false,
    presets: []
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini CLI',
    command: 'gemini',
    description: 'Google Gemini CLI (reads GEMINI.md natively)',
    commands: {
      init: '/init',
      model: '/model',
      memory: '/memory',
      compress: '/compress',
      settings: '/settings',
      help: '/help'
    },
    menuLabel: 'Gemini Commands',
    supportsPlugins: false,
    presets: []
  }
};

// Current configuration. `toolFlags` is the per-tool persistence layer
// for launch flags: { [toolId]: { enabledPresets: string[], customFlags: string } }.
// Missing entries get sensible defaults at read time so older config
// files keep working without a migration step.
let config = {
  activeTool: 'claude',
  customTools: {},
  toolFlags: {}
};

/**
 * Initialize the AI Tool Manager
 */
function init(window, app) {
  mainWindow = window;
  configPath = path.join(app.getPath('userData'), 'ai-tool-config.json');
  loadConfig();
  setupIPC();
}

/**
 * Load configuration from file
 */
function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf8');
      const loaded = JSON.parse(data);
      config = { ...config, ...loaded };
    }
  } catch (error) {
    console.error('Error loading AI tool config:', error);
  }
}

/**
 * Save configuration to file
 */
function saveConfig() {
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  } catch (error) {
    console.error('Error saving AI tool config:', error);
  }
}

/**
 * Get all available AI tools
 */
function getAvailableTools() {
  return { ...AI_TOOLS, ...config.customTools };
}

/**
 * Get the currently active tool
 */
function getActiveTool() {
  const tools = getAvailableTools();
  return tools[config.activeTool] || tools.claude;
}

/**
 * Active tool with flags + fullCommand attached. This is the shape the
 * renderer expects whenever AI_TOOL_CHANGED fires — without `fullCommand`
 * here, the renderer's cached currentTool would lose its flag suffix
 * after every flag toggle and the Start button would silently fall back
 * to the bare binary.
 */
function getActiveToolDecorated() {
  const active = getActiveTool();
  return {
    ...active,
    flags: getToolFlags(active.id),
    fullCommand: buildInvocation(active.id)
  };
}

/**
 * Set the active AI tool
 */
function setActiveTool(toolId) {
  const tools = getAvailableTools();
  if (tools[toolId]) {
    config.activeTool = toolId;
    saveConfig();

    // Notify renderer about the change. Send the decorated tool so the
    // renderer's currentTool keeps its flag-resolved fullCommand.
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.AI_TOOL_CHANGED, getActiveToolDecorated());
    }

    return true;
  }
  return false;
}

/**
 * Read the saved launch-flag config for a tool. Returns the canonical
 * shape with defaults filled in. Validates `enabledPresets` against the
 * tool's actual preset list — stale IDs (from preset rename / removal)
 * are dropped silently so the popover never shows ghost selections.
 */
function getToolFlags(toolId) {
  const tools = getAvailableTools();
  const tool = tools[toolId];
  if (!tool) return { enabledPresets: [], customFlags: '' };

  const saved = config.toolFlags && config.toolFlags[toolId];
  const presetIds = new Set((tool.presets || []).map(p => p.id));
  const enabledPresets = Array.isArray(saved && saved.enabledPresets)
    ? saved.enabledPresets.filter(id => presetIds.has(id))
    : [];
  const customFlags = typeof (saved && saved.customFlags) === 'string'
    ? saved.customFlags
    : '';
  return { enabledPresets, customFlags };
}

/**
 * Persist launch-flag config for a tool. Sanitizes the custom-flags
 * string (trims whitespace, collapses internal runs) so what the user
 * sees and what we splice into the command line are the same.
 */
function setToolFlags(toolId, flags) {
  const tools = getAvailableTools();
  const tool = tools[toolId];
  if (!tool) return false;

  const presetIds = new Set((tool.presets || []).map(p => p.id));
  const enabledPresets = Array.isArray(flags && flags.enabledPresets)
    ? flags.enabledPresets.filter(id => presetIds.has(id))
    : [];
  const customFlags = typeof (flags && flags.customFlags) === 'string'
    ? flags.customFlags.replace(/\s+/g, ' ').trim()
    : '';

  config.toolFlags = config.toolFlags || {};
  config.toolFlags[toolId] = { enabledPresets, customFlags };
  saveConfig();

  // Notify the renderer so the start button + task launches pick up
  // the new flags without requiring a relaunch. Send the decorated
  // active tool so `currentTool.fullCommand` reflects the new flags
  // — without this, the start button would fall back to the bare
  // binary after every toggle.
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.AI_TOOL_CHANGED, getActiveToolDecorated());
  }
  return true;
}

/**
 * Build the full command-line invocation for a tool: base command +
 * enabled preset flags (in declared order) + custom flags. This is what
 * we write into the PTY when the user clicks Start.
 */
function buildInvocation(toolId) {
  const tools = getAvailableTools();
  const tool = tools[toolId];
  if (!tool) return null;

  const { enabledPresets, customFlags } = getToolFlags(toolId);
  const enabledSet = new Set(enabledPresets);
  const presetFlags = (tool.presets || [])
    .filter(p => enabledSet.has(p.id))
    .map(p => p.flag);
  const parts = [tool.command, ...presetFlags];
  if (customFlags) parts.push(customFlags);
  return parts.join(' ');
}

/**
 * Get full configuration for renderer. Includes the active tool's
 * resolved flags + fullCommand so the renderer can render the start
 * button label / popover state without a second round-trip.
 */
function getConfig() {
  return {
    activeTool: getActiveToolDecorated(),
    availableTools: getAvailableTools()
  };
}

/**
 * Add a custom AI tool
 */
function addCustomTool(tool) {
  if (tool.id && tool.name && tool.command) {
    config.customTools[tool.id] = {
      ...tool,
      commands: tool.commands || {},
      menuLabel: tool.menuLabel || `${tool.name} Commands`,
      supportsPlugins: tool.supportsPlugins || false
    };
    saveConfig();
    return true;
  }
  return false;
}

/**
 * Remove a custom AI tool
 */
function removeCustomTool(toolId) {
  if (config.customTools[toolId]) {
    delete config.customTools[toolId];
    if (config.activeTool === toolId) {
      config.activeTool = 'claude';
    }
    saveConfig();
    return true;
  }
  return false;
}

function isPathLike(command) {
  return !!command && (
    command.startsWith('./') ||
    command.startsWith('../') ||
    command.startsWith('/')
  );
}

/**
 * Check whether a CLI command can actually be launched on this system.
 * Used as a pre-flight before spawning a terminal so we don't hand the
 * user a "command not found" + an injected prompt sitting in a bare
 * shell. Tries the tool's primary command first, then its fallback.
 */
async function isCommandAvailable(command, projectPath) {
  if (!command) return false;

  // Path-based command: check the binary actually exists & is executable.
  if (isPathLike(command)) {
    const target = command.startsWith('/')
      ? command
      : (projectPath ? path.resolve(projectPath, command) : command);
    try {
      fs.accessSync(target, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  // PATH-based command: probe via the user's login shell so PATH
  // additions from .zshrc/.bashrc and shim managers (asdf, nvm, brew)
  // are visible — same reason we run the PTY shell with -l.
  const isWin = process.platform === 'win32';
  const shell = isWin
    ? (process.env.COMSPEC || 'cmd.exe')
    : (process.env.SHELL || '/bin/sh');
  const args = isWin
    ? ['/c', `where ${command}`]
    : ['-lc', `command -v ${command}`];

  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };
    let child;
    try {
      child = spawn(shell, args, { stdio: 'ignore' });
    } catch {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch {}
      finish(false);
    }, 3000);
    child.on('exit', (code) => finish(code === 0));
    child.on('error', () => finish(false));
  });
}

/**
 * Setup IPC handlers
 */
function setupIPC() {
  ipcMain.removeHandler(IPC.GET_AI_TOOL_CONFIG);
  ipcMain.handle(IPC.GET_AI_TOOL_CONFIG, () => {
    return getConfig();
  });

  ipcMain.removeHandler(IPC.SET_AI_TOOL);
  ipcMain.handle(IPC.SET_AI_TOOL, (event, toolId) => {
    return setActiveTool(toolId);
  });

  ipcMain.removeHandler(IPC.CHECK_AI_TOOL_AVAILABLE);
  ipcMain.handle(IPC.CHECK_AI_TOOL_AVAILABLE, async (event, payload = {}) => {
    const { toolId, projectPath } = payload;
    const tools = getAvailableTools();
    const tool = tools[toolId];
    if (!tool) {
      return { available: false, resolvedCommand: null, name: toolId || null };
    }

    const primaryOk = await isCommandAvailable(tool.command, projectPath);

    // When the primary is a path-based wrapper script and the tool
    // declares a fallback, the wrapper almost always `exec`s the
    // fallback (see .frame/bin/codex). Treat the fallback as a hard
    // dependency in that case — wrapper presence alone isn't enough.
    if (primaryOk && tool.fallbackCommand && isPathLike(tool.command)) {
      const fallbackOk = await isCommandAvailable(tool.fallbackCommand, projectPath);
      if (fallbackOk) {
        return { available: true, resolvedCommand: tool.command, name: tool.name };
      }
      return { available: false, resolvedCommand: null, name: tool.name };
    }

    // Resolve the binary first, then layer the saved flags on top so the
    // task "Send to AI" flow uses the same invocation as the Start button.
    const tail = composeFlagSuffix(toolId);

    if (primaryOk) {
      return {
        available: true,
        resolvedCommand: tail ? `${tool.command} ${tail}` : tool.command,
        name: tool.name
      };
    }

    if (tool.fallbackCommand && await isCommandAvailable(tool.fallbackCommand, projectPath)) {
      return {
        available: true,
        resolvedCommand: tail ? `${tool.fallbackCommand} ${tail}` : tool.fallbackCommand,
        name: tool.name
      };
    }

    return { available: false, resolvedCommand: null, name: tool.name };
  });

  ipcMain.removeHandler(IPC.GET_TOOL_FLAGS);
  ipcMain.handle(IPC.GET_TOOL_FLAGS, (event, toolId) => {
    const id = toolId || getActiveTool().id;
    const tools = getAvailableTools();
    const tool = tools[id];
    if (!tool) return null;
    return {
      toolId: id,
      presets: tool.presets || [],
      ...getToolFlags(id),
      fullCommand: buildInvocation(id)
    };
  });

  ipcMain.removeHandler(IPC.SET_TOOL_FLAGS);
  ipcMain.handle(IPC.SET_TOOL_FLAGS, (event, { toolId, enabledPresets, customFlags } = {}) => {
    const id = toolId || getActiveTool().id;
    const ok = setToolFlags(id, { enabledPresets, customFlags });
    return ok
      ? { ok: true, fullCommand: buildInvocation(id), flags: getToolFlags(id) }
      : { ok: false };
  });
}

/**
 * Helper for IPC.CHECK_AI_TOOL_AVAILABLE: build the flag suffix
 * (enabled preset flags + custom flags) for a given tool, without
 * duplicating the buildInvocation logic. Returns '' when there's
 * nothing to append.
 */
function composeFlagSuffix(toolId) {
  const tools = getAvailableTools();
  const tool = tools[toolId];
  if (!tool) return '';
  const { enabledPresets, customFlags } = getToolFlags(toolId);
  const enabledSet = new Set(enabledPresets);
  const presetFlags = (tool.presets || [])
    .filter(p => enabledSet.has(p.id))
    .map(p => p.flag);
  const parts = [...presetFlags];
  if (customFlags) parts.push(customFlags);
  return parts.join(' ');
}

/**
 * Get command for specific action
 */
function getCommand(action) {
  const tool = getActiveTool();
  return tool.commands[action] || null;
}

/**
 * Get the start command for the active tool, including saved launch
 * flags (preset checkboxes + custom flags). Backwards compatible
 * signature — callers that need the raw binary should hit `tool.command`
 * directly.
 */
function getStartCommand() {
  return buildInvocation(getActiveTool().id);
}

module.exports = {
  init,
  getAvailableTools,
  getActiveTool,
  setActiveTool,
  getConfig,
  getCommand,
  getStartCommand,
  getToolFlags,
  setToolFlags,
  buildInvocation,
  addCustomTool,
  removeCustomTool,
  AI_TOOLS
};
