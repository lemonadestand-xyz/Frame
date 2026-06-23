/**
 * AI Tool Selector Module
 * Manages UI for switching between AI coding tools (Claude Code, Codex CLI, etc.)
 * Includes the "Start options" popover for managing per-tool launch flags
 * (preset checkboxes like `--continue` + a free-form custom-flags field).
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');

let currentTool = null;
let availableTools = {};
let onToolChangeCallback = null;

/**
 * Initialize the AI tool selector
 */
async function init(onToolChange) {
  onToolChangeCallback = onToolChange;

  // Get initial config
  const config = await ipcRenderer.invoke(IPC.GET_AI_TOOL_CONFIG);
  currentTool = config.activeTool;
  availableTools = config.availableTools;

  // Setup UI
  setupSelector();
  setupOptionsPopover();
  updateUI();

  // Listen for tool changes from main process. AI_TOOL_CHANGED is also
  // emitted when launch flags are updated (so the popover refreshes
  // without re-fetching), not just on tool switches.
  ipcRenderer.on(IPC.AI_TOOL_CHANGED, async (event, tool) => {
    currentTool = tool;
    updateUI();
    if (isOptionsPopoverOpen()) await renderOptionsPopover();
    if (onToolChangeCallback) {
      onToolChangeCallback(tool);
    }
  });
}

/**
 * Setup the selector dropdown
 */
function setupSelector() {
  const selector = document.getElementById('ai-tool-selector');
  if (!selector) return;

  // Populate options
  selector.innerHTML = '';
  Object.values(availableTools).forEach(tool => {
    const option = document.createElement('option');
    option.value = tool.id;
    option.textContent = tool.name.replace(' Code', '').replace(' CLI', '');
    selector.appendChild(option);
  });

  // Set current value
  if (currentTool) {
    selector.value = currentTool.id;
  }

  // Handle change
  selector.addEventListener('change', async (e) => {
    const toolId = e.target.value;
    const success = await ipcRenderer.invoke(IPC.SET_AI_TOOL, toolId);
    if (!success) {
      selector.value = currentTool.id;
    }
  });
}

/**
 * Update UI to reflect current tool
 */
function updateUI() {
  if (!currentTool) return;

  const selector = document.getElementById('ai-tool-selector');
  if (selector) {
    selector.value = currentTool.id;
  }

  const startBtn = document.getElementById('btn-start-ai');
  if (startBtn) {
    startBtn.textContent = `Start ${currentTool.name}`;
  }
}

/**
 * Get the current active tool
 */
function getCurrentTool() {
  return currentTool;
}

/**
 * Get all available AI tools (keyed by id).
 */
function getAvailableTools() {
  return availableTools;
}

/**
 * Get the start command for current tool, including any saved launch
 * flags (preset checkboxes + custom flags). Falls back to the bare
 * binary if flags aren't resolved yet.
 */
function getStartCommand() {
  if (!currentTool) return 'claude';
  return currentTool.fullCommand || currentTool.command;
}

/* ----------------------- Start-options popover ----------------------- */

function isOptionsPopoverOpen() {
  const popover = document.getElementById('ai-tool-options-popover');
  return !!popover && !popover.hasAttribute('hidden');
}

function setupOptionsPopover() {
  const btn = document.getElementById('btn-start-ai-options');
  const popover = document.getElementById('ai-tool-options-popover');
  const closeBtn = document.getElementById('ai-tool-options-close');
  const customInput = document.getElementById('ai-tool-options-custom');
  if (!btn || !popover) return;

  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (isOptionsPopoverOpen()) {
      closeOptionsPopover();
    } else {
      await openOptionsPopover();
    }
  });

  if (closeBtn) {
    closeBtn.addEventListener('click', closeOptionsPopover);
  }

  // Outside-click closes the popover; inside clicks don't bubble out so
  // they never trigger the close.
  popover.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', (e) => {
    if (!isOptionsPopoverOpen()) return;
    if (popover.contains(e.target)) return;
    if (btn.contains(e.target)) return;
    closeOptionsPopover();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOptionsPopoverOpen()) {
      closeOptionsPopover();
    }
  });

  if (customInput) {
    customInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitOptionsFromUI();
      }
    });
    customInput.addEventListener('blur', commitOptionsFromUI);
    customInput.addEventListener('input', updatePreviewFromUI);
  }
}

async function openOptionsPopover() {
  const popover = document.getElementById('ai-tool-options-popover');
  const btn = document.getElementById('btn-start-ai-options');
  if (!popover || !btn) return;

  await renderOptionsPopover();
  popover.removeAttribute('hidden');
  btn.setAttribute('aria-expanded', 'true');
  const customInput = document.getElementById('ai-tool-options-custom');
  if (customInput) {
    requestAnimationFrame(() => customInput.focus());
  }
}

function closeOptionsPopover() {
  const popover = document.getElementById('ai-tool-options-popover');
  const btn = document.getElementById('btn-start-ai-options');
  if (!popover || !btn) return;
  commitOptionsFromUI();
  popover.setAttribute('hidden', '');
  btn.setAttribute('aria-expanded', 'false');
}

/**
 * Fetch the active tool's flag config from the main process and paint
 * the popover. Always re-asks because the active tool could have
 * changed between opens.
 */
async function renderOptionsPopover() {
  const presetsContainer = document.getElementById('ai-tool-options-presets');
  const noPresets = document.getElementById('ai-tool-options-no-presets');
  const customInput = document.getElementById('ai-tool-options-custom');
  if (!presetsContainer || !customInput || !currentTool) return;

  const flagsConfig = await ipcRenderer.invoke(IPC.GET_TOOL_FLAGS, currentTool.id);
  if (!flagsConfig) return;

  presetsContainer.innerHTML = '';
  const enabled = new Set(flagsConfig.enabledPresets || []);
  const presets = flagsConfig.presets || [];

  if (presets.length === 0) {
    if (noPresets) noPresets.removeAttribute('hidden');
  } else {
    if (noPresets) noPresets.setAttribute('hidden', '');
    for (const preset of presets) {
      const row = document.createElement('label');
      row.className = 'ai-tool-options-preset';
      row.title = preset.description || '';
      row.innerHTML = `
        <input type="checkbox" data-preset-id="${preset.id}" ${enabled.has(preset.id) ? 'checked' : ''} />
        <div class="ai-tool-options-preset-text">
          <span class="ai-tool-options-preset-label">${preset.label}</span>
          <code class="ai-tool-options-preset-flag">${preset.flag}</code>
          ${preset.description ? `<span class="ai-tool-options-preset-desc">${preset.description}</span>` : ''}
        </div>
      `;
      const cb = row.querySelector('input');
      cb.addEventListener('change', commitOptionsFromUI);
      presetsContainer.appendChild(row);
    }
  }

  customInput.value = flagsConfig.customFlags || '';
  updatePreview(flagsConfig.fullCommand || (currentTool && currentTool.command) || '');
}

function commitOptionsFromUI() {
  if (!currentTool) return;
  const presetsContainer = document.getElementById('ai-tool-options-presets');
  const customInput = document.getElementById('ai-tool-options-custom');
  if (!presetsContainer || !customInput) return;

  const enabledPresets = Array.from(
    presetsContainer.querySelectorAll('input[type="checkbox"][data-preset-id]:checked')
  ).map(cb => cb.dataset.presetId);
  const customFlags = customInput.value;

  ipcRenderer.invoke(IPC.SET_TOOL_FLAGS, {
    toolId: currentTool.id,
    enabledPresets,
    customFlags
  }).then((res) => {
    if (res && res.ok) {
      updatePreview(res.fullCommand);
    }
  });
}

/**
 * Live-update the "Will run" preview as the user types into the custom
 * flags input — without an IPC round-trip per keystroke. Mirrors the
 * backend's buildInvocation logic for the preview only; the persisted
 * version still comes from setToolFlags on commit.
 */
function updatePreviewFromUI() {
  if (!currentTool) return;
  const presetsContainer = document.getElementById('ai-tool-options-presets');
  const customInput = document.getElementById('ai-tool-options-custom');
  if (!presetsContainer || !customInput) return;

  const enabledSet = new Set(
    Array.from(
      presetsContainer.querySelectorAll('input[type="checkbox"][data-preset-id]:checked')
    ).map(cb => cb.dataset.presetId)
  );
  const presetFlags = ((currentTool.presets) || [])
    .filter(p => enabledSet.has(p.id))
    .map(p => p.flag);
  const trimmed = customInput.value.replace(/\s+/g, ' ').trim();
  const parts = [currentTool.command, ...presetFlags];
  if (trimmed) parts.push(trimmed);
  updatePreview(parts.join(' '));
}

function updatePreview(fullCommand) {
  const previewEl = document.getElementById('ai-tool-options-preview');
  if (previewEl) previewEl.textContent = fullCommand || '';
}

/**
 * Get a specific command for current tool
 */
function getCommand(action) {
  if (!currentTool || !currentTool.commands) return null;
  return currentTool.commands[action] || null;
}

/**
 * Check if current tool supports a feature
 */
function supportsFeature(feature) {
  if (!currentTool) return false;

  switch (feature) {
    case 'plugins':
      return currentTool.supportsPlugins;
    case 'init':
      return !!currentTool.commands.init;
    case 'commit':
      return !!currentTool.commands.commit;
    default:
      return false;
  }
}

module.exports = {
  init,
  getCurrentTool,
  getAvailableTools,
  getStartCommand,
  getCommand,
  supportsFeature
};
