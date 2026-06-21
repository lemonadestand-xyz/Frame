/**
 * Task Run Modal
 *
 * Confirmation/configuration modal shown when the user clicks the play
 * button on a task. Lets them choose:
 *   - existing terminal vs new terminal
 *   - which AI CLI to launch (only if new terminal)
 *   - stay on current branch vs create a new branch (optional name)
 *
 * Returns the chosen options to the caller via the `onRun` callback;
 * the caller is responsible for actually orchestrating the terminal
 * and prompt dispatch (see `tasksPanel.runTaskWithOptions`).
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const aiToolSelector = require('./aiToolSelector');
const state = require('./state');

let modalEl = null;
let titleEl = null;
let terminalRadios = null;
let currentHintEl = null;
let cliSection = null;
let cliOptionsEl = null;
let branchRadios = null;
let currentBranchEl = null;
let newBranchNameInput = null;
let runBtn = null;
let cancelBtn = null;
// Subtask multi-select (shown only when running a task that has children)
let subtasksSection = null;
let subtasksList = null;
let subtasksAllBtn = null;
let subtasksNoneBtn = null;

let initialized = false;
let activeTask = null;
let activeChildren = [];
let activeOnRun = null;
let activeOnCancel = null;

function init() {
  if (initialized) return;
  modalEl = document.getElementById('task-run-modal');
  if (!modalEl) return;

  titleEl = document.getElementById('task-run-modal-task-title');
  terminalRadios = modalEl.querySelectorAll('input[name="task-run-terminal"]');
  currentHintEl = document.getElementById('task-run-current-hint');
  cliSection = document.getElementById('task-run-cli-section');
  cliOptionsEl = document.getElementById('task-run-cli-options');
  branchRadios = modalEl.querySelectorAll('input[name="task-run-branch"]');
  currentBranchEl = document.getElementById('task-run-current-branch');
  newBranchNameInput = document.getElementById('task-run-new-branch-name');
  runBtn = document.getElementById('task-run-confirm');
  cancelBtn = document.getElementById('task-run-cancel');

  // Toggle CLI section + warning hint based on terminal choice
  terminalRadios.forEach(r => r.addEventListener('change', updateTerminalChoiceUI));

  // Toggle new-branch input enabled state based on branch choice
  branchRadios.forEach(r => r.addEventListener('change', updateBranchChoiceUI));

  subtasksSection = document.getElementById('task-run-subtasks-section');
  subtasksList = document.getElementById('task-run-subtasks-list');
  subtasksAllBtn = document.getElementById('task-run-subtasks-all');
  subtasksNoneBtn = document.getElementById('task-run-subtasks-none');

  if (subtasksAllBtn) {
    subtasksAllBtn.addEventListener('click', () => setAllSubtasksChecked(true));
  }
  if (subtasksNoneBtn) {
    subtasksNoneBtn.addEventListener('click', () => setAllSubtasksChecked(false));
  }

  cancelBtn.addEventListener('click', cancel);
  runBtn.addEventListener('click', confirm);

  modalEl.addEventListener('click', (e) => {
    if (e.target === modalEl) cancel();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!modalEl.classList.contains('visible')) return;
    e.stopPropagation();
    cancel();
  }, true);

  modalEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && modalEl.classList.contains('visible')) {
      // Don't hijack Enter while typing in the branch-name field
      if (e.target === newBranchNameInput) return;
      e.preventDefault();
      confirm();
    }
  });

  initialized = true;
}

function updateTerminalChoiceUI() {
  const useNew = getTerminalChoice() === 'new';
  cliSection.style.display = useNew ? '' : 'none';
  currentHintEl.style.display = useNew ? 'none' : '';
}

function updateBranchChoiceUI() {
  const newBranch = getBranchChoice() === 'new';
  newBranchNameInput.disabled = !newBranch;
  if (newBranch) {
    requestAnimationFrame(() => newBranchNameInput.focus());
  }
}

function getTerminalChoice() {
  const checked = Array.from(terminalRadios).find(r => r.checked);
  return checked ? checked.value : 'current';
}

function getBranchChoice() {
  const checked = Array.from(branchRadios).find(r => r.checked);
  return checked ? checked.value : 'current';
}

function getCliChoice() {
  const checked = cliOptionsEl.querySelector('input[name="task-run-cli"]:checked');
  return checked ? checked.value : null;
}

function populateCliOptions() {
  const tools = aiToolSelector.getAvailableTools() || {};
  const current = aiToolSelector.getCurrentTool();
  const currentId = current ? current.id : null;

  cliOptionsEl.innerHTML = '';
  Object.values(tools).forEach(tool => {
    const id = `task-run-cli-${tool.id}`;
    const isDefault = tool.id === currentId;
    const wrapper = document.createElement('label');
    wrapper.className = 'task-run-radio';
    wrapper.innerHTML = `
      <input type="radio" name="task-run-cli" id="${id}" value="${tool.id}">
      <span class="task-run-radio-label">
        <strong>${escapeHtml(tool.name)}</strong>
        ${isDefault ? '<span class="task-run-badge">Default</span>' : ''}
      </span>
    `;
    const input = wrapper.querySelector('input');
    if (isDefault) input.checked = true;
    cliOptionsEl.appendChild(wrapper);
  });

  // Fallback: if nothing matched (no current tool), check the first
  if (!cliOptionsEl.querySelector('input:checked')) {
    const first = cliOptionsEl.querySelector('input');
    if (first) first.checked = true;
  }
}

async function loadCurrentBranch() {
  currentBranchEl.textContent = 'current branch';
  const projectPath = state.getProjectPath();
  if (!projectPath) return;
  try {
    const result = await ipcRenderer.invoke(IPC.LOAD_GIT_BRANCHES, projectPath);
    if (!result || result.error || !result.currentBranch) return;
    currentBranchEl.textContent = result.currentBranch;
  } catch (err) {
    // Not a git repo or git unavailable — leave the placeholder.
  }
}

/**
 * Open the modal for a given task.
 * @param {object} task
 * @param {object} opts
 * @param {function} opts.onRun       - called with chosen options on confirm
 * @param {function} [opts.onCancel]
 * @param {object[]} [opts.children]  - subtasks of `task` (parents only).
 *   When present the modal renders a multi-select so the user can
 *   include/exclude specific subtasks — confirm() returns the chosen IDs
 *   on `options.includedSubtaskIds`.
 */
function open(task, opts = {}) {
  if (!initialized) init();
  if (!modalEl) return;

  activeTask = task;
  activeChildren = Array.isArray(opts.children) ? opts.children.slice() : [];
  activeOnRun = typeof opts.onRun === 'function' ? opts.onRun : null;
  activeOnCancel = typeof opts.onCancel === 'function' ? opts.onCancel : null;

  if (titleEl) {
    titleEl.textContent = task && task.title ? task.title : '';
  }

  // Reset to defaults
  Array.from(terminalRadios).forEach(r => { r.checked = r.value === 'current'; });
  Array.from(branchRadios).forEach(r => { r.checked = r.value === 'current'; });
  newBranchNameInput.value = '';
  newBranchNameInput.disabled = true;

  populateCliOptions();
  populateSubtasks();
  updateTerminalChoiceUI();
  loadCurrentBranch();

  modalEl.classList.add('visible');
  requestAnimationFrame(() => runBtn && runBtn.focus());
}

/**
 * Paint the subtask multi-select. Defaults every checkbox to checked so
 * "click Run, done" still launches the full initiative. Hidden entirely
 * when the task has no children.
 */
function populateSubtasks() {
  if (!subtasksSection || !subtasksList) return;
  subtasksList.innerHTML = '';

  if (!activeChildren || activeChildren.length === 0) {
    subtasksSection.style.display = 'none';
    return;
  }

  subtasksSection.style.display = '';
  for (const child of activeChildren) {
    const row = document.createElement('label');
    row.className = 'task-run-subtask-row';
    const completed = child.status === 'completed';
    row.innerHTML = `
      <input type="checkbox" data-subtask-id="${escapeHtml(child.id)}" ${completed ? '' : 'checked'}>
      <span class="task-run-subtask-status status-${(child.status || 'pending').replace('_', '-')}" title="${escapeHtml(child.status || 'pending').replace('_', ' ')}"></span>
      <span class="task-run-subtask-title${completed ? ' completed' : ''}">${escapeHtml(child.title || 'Untitled')}</span>
    `;
    subtasksList.appendChild(row);
  }
}

function setAllSubtasksChecked(checked) {
  if (!subtasksList) return;
  subtasksList.querySelectorAll('input[type="checkbox"][data-subtask-id]').forEach(cb => {
    cb.checked = checked;
  });
}

function getIncludedSubtaskIds() {
  if (!subtasksList) return [];
  return Array.from(
    subtasksList.querySelectorAll('input[type="checkbox"][data-subtask-id]:checked')
  ).map(cb => cb.dataset.subtaskId);
}

function close() {
  if (!modalEl) return;
  modalEl.classList.remove('visible');
  activeTask = null;
  activeChildren = [];
  activeOnRun = null;
  activeOnCancel = null;
}

function confirm() {
  const options = {
    useNewTerminal: getTerminalChoice() === 'new',
    toolId: getCliChoice(),
    branchMode: getBranchChoice(),
    newBranchName: newBranchNameInput.value.trim() || null,
    includedSubtaskIds: getIncludedSubtaskIds()
  };
  const cb = activeOnRun;
  close();
  if (cb) cb(options);
}

function cancel() {
  const cb = activeOnCancel;
  close();
  if (cb) cb();
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = {
  init,
  open
};
