/**
 * Tasks Panel Module
 * UI for displaying and managing project tasks
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const state = require('./state');

let isVisible = false;
let currentFilter = 'all'; // all, pending, inProgress, completed
let tasksData = null;
let claudeCodeRunning = false; // Track if Claude Code was started
// Set when the user clicks "+ Subtask" on a parent row and consumed by
// handleTaskFormSubmit. Cleared on every modal open and on submit.
let pendingParentId = null;
// Module-level so collapse state survives re-renders (driven by external
// task edits, filter changes, etc.). Not persisted to disk in v1 — it's
// a viewing preference, not task data.
const collapsedParents = new Set();

// DOM Elements
let panelElement = null;
let contentElement = null;
let filterButtons = null;

/**
 * Initialize tasks panel
 */
function init() {
  panelElement = document.getElementById('tasks-panel');
  contentElement = document.getElementById('tasks-content');

  if (!panelElement) {
    console.error('Tasks panel element not found');
    return;
  }

  setupEventListeners();
  setupIPCListeners();
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  // Close button
  const closeBtn = document.getElementById('tasks-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', hide);
  }

  // Collapse button
  const collapseBtn = document.getElementById('tasks-collapse-btn');
  if (collapseBtn) {
    collapseBtn.addEventListener('click', hide);
  }

  // Add task button — opens the modal in place. The modal's transparent
  // blurred backdrop makes whatever is behind (terminal / dashboard / etc.)
  // serve as the visible context.
  const addBtn = document.getElementById('tasks-add-btn');
  if (addBtn) {
    addBtn.addEventListener('click', showAddTaskModal);
  }

  // Show Dashboard button — opens the full-page Kanban view. Lazy-required to
  // sidestep the circular dependency between tasksPanel and tasksDashboard.
  const dashboardBtn = document.getElementById('tasks-dashboard-btn');
  if (dashboardBtn) {
    dashboardBtn.addEventListener('click', () => {
      require('./tasksDashboard').show();
    });
  }

  // Filter buttons
  document.querySelectorAll('.tasks-filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const filter = e.target.dataset.filter;
      setFilter(filter);
    });
  });
}

/**
 * Setup IPC listeners
 */
function setupIPCListeners() {
  ipcRenderer.on(IPC.TASKS_DATA, (event, { projectPath, tasks }) => {
    if (tasks) {
      tasksData = tasks;
      render();
    }
  });

  ipcRenderer.on(IPC.TASK_UPDATED, (event, { action, task, success }) => {
    if (success) {
      // Tasks data will be sent separately
    }
  });

  ipcRenderer.on(IPC.TOGGLE_TASKS_PANEL, () => {
    toggle();
  });
}

/**
 * Load tasks for current project
 */
function loadTasks() {
  const projectPath = state.getProjectPath();
  if (projectPath) {
    ipcRenderer.send(IPC.LOAD_TASKS, projectPath);
  }
}

/**
 * Show tasks panel. If there's no active project, surface an info modal
 * instead of opening an empty panel — there's nothing to show without one.
 */
function show() {
  if (!panelElement) return;
  if (!state.getProjectPath()) {
    require('./taskInfoModal').open({
      title: 'No project selected',
      message: 'Select a project from the sidebar to see and manage its tasks.'
    });
    return;
  }
  panelElement.classList.add('visible');
  isVisible = true;
  loadTasks();
}

/**
 * Hide tasks panel
 */
function hide() {
  if (panelElement) {
    panelElement.classList.remove('visible');
    isVisible = false;
  }
}

/**
 * Toggle tasks panel visibility
 */
function toggle() {
  if (isVisible) {
    hide();
  } else {
    show();
  }
}

/**
 * Set filter
 */
function setFilter(filter) {
  currentFilter = filter;

  // Update active button
  document.querySelectorAll('.tasks-filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === filter);
  });

  render();
}

/**
 * Get filtered tasks for the sidebar. Initiative-centric: only top-level
 * tasks are listed here — subtasks are visible via the dashboard's
 * detail aside or by drilling into the parent. This keeps the sidebar
 * scan-able when initiatives explode into many subtasks.
 */
function getFilteredTasks() {
  if (!tasksData || !tasksData.tasks) return [];

  const allTasks = Array.isArray(tasksData.tasks)
    ? tasksData.tasks
    : [
        ...(tasksData.tasks.pending || []).map(t => ({ ...t, status: 'pending' })),
        ...(tasksData.tasks.inProgress || []).map(t => ({ ...t, status: 'in_progress' })),
        ...(tasksData.tasks.completed || []).map(t => ({ ...t, status: 'completed' }))
      ];

  const topLevel = allTasks.filter(t => !t.parentId);
  if (currentFilter === 'all') return topLevel;

  const statusMap = {
    pending: 'pending',
    inProgress: 'in_progress',
    completed: 'completed'
  };

  return topLevel.filter(t => t.status === statusMap[currentFilter]);
}

/**
 * Return all tasks (including subtasks) — used internally for rollup
 * computation and locating tasks by ID when launching a parent run.
 */
function getAllTasks() {
  if (!tasksData || !tasksData.tasks) return [];
  return Array.isArray(tasksData.tasks) ? tasksData.tasks : [];
}

/**
 * Render tasks list
 */
function render() {
  if (!contentElement) return;

  const tasks = getFilteredTasks();

  if (tasks.length === 0) {
    contentElement.innerHTML = `
      <div class="tasks-empty">
        <div class="tasks-empty-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M9 11l3 3L22 4"/>
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
          </svg>
        </div>
        <p>No tasks found</p>
        <span>Tasks will appear here when added</span>
      </div>
    `;
    return;
  }

  // Sidebar lists only top-level tasks now (see getFilteredTasks).
  // Subtask hierarchy is owned by the dashboard's detail aside.
  // Each parent gets a small rollup chip in its meta row showing
  // children completion progress.
  const allTasks = getAllTasks();
  contentElement.innerHTML = tasks
    .map(task => renderTaskItem(task, 0, null, computeRollup(task.id, allTasks)))
    .join('');

  // Add event listeners to task items
  contentElement.querySelectorAll('.task-item').forEach(item => {
    const taskId = item.dataset.taskId;

    // Action buttons
    item.querySelectorAll('.task-action-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        handleTaskAction(taskId, action);
      });
    });

    // Edit on click (on task content only)
    item.querySelector('.task-content')?.addEventListener('click', () => {
      showEditTaskModal(taskId);
    });
  });
}

/**
 * Build a tree view from a flat task list. Tasks whose parent is not in
 * the filtered set are rendered as top-level so they don't disappear
 * (this matters when filter narrowing removes a parent but keeps a child).
 */
function renderTree(tasks) {
  const inFilter = new Set(tasks.map(t => t.id));
  const childrenByParent = new Map();
  const roots = [];

  for (const task of tasks) {
    const pid = task.parentId && inFilter.has(task.parentId) ? task.parentId : null;
    if (pid === null) {
      roots.push(task);
    } else {
      if (!childrenByParent.has(pid)) childrenByParent.set(pid, []);
      childrenByParent.get(pid).push(task);
    }
  }

  const renderBranch = (task, depth) => {
    const kids = childrenByParent.get(task.id) || [];
    const rollup = computeRollup(task.id, tasks);
    const isCollapsed = kids.length > 0 && collapsedParents.has(task.id);
    const self = renderTaskItem(task, depth, null, rollup, {
      hasChildren: kids.length > 0,
      isCollapsed
    });
    if (isCollapsed) return self;
    return self + kids.map(k => renderBranch(k, depth + 1)).join('');
  };

  return roots.map(t => renderBranch(t, 0)).join('');
}

/**
 * Compute a small rollup summary ({completed, total}) over the immediate
 * children of a task within the current filtered set. Returns null when
 * the task has no children — caller decides whether to render the chip.
 */
function computeRollup(taskId, tasks) {
  let total = 0;
  let completed = 0;
  for (const t of tasks) {
    if (t.parentId === taskId) {
      total += 1;
      if (t.status === 'completed') completed += 1;
    }
  }
  return total > 0 ? { total, completed } : null;
}

/**
 * Render single task item.
 *
 * @param {object} task — the task to render
 * @param {number} depth — nesting depth (0 = top-level). Used for indent only.
 * @param {object|null} parentBreadcrumb — when rendered outside tree mode
 *   (e.g. a status filter) and the task has a parent, pass the parent task
 *   so we can show a `↳ parent title` line above the row.
 * @param {{ total: number, completed: number } | null} rollup — child summary
 *   for parent tasks. Renders as a small chip in the meta row.
 * @param {{ hasChildren: boolean, isCollapsed: boolean }} treeInfo — only
 *   meaningful in tree-render mode. Drives the chevron toggle.
 */
function renderTaskItem(task, depth = 0, parentBreadcrumb = null, rollup = null, treeInfo = {}) {
  const priorityClass = `priority-${task.priority || 'medium'}`;
  const statusClass = `status-${task.status.replace('_', '-')}`;
  const isCompleted = task.status === 'completed';
  const isInProgress = task.status === 'in_progress';
  const isPending = task.status === 'pending';

  const priorityLabel = {
    high: 'High',
    medium: 'Med',
    low: 'Low'
  }[task.priority] || 'Med';

  // Status indicator icon
  const statusIcon = isCompleted
    ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`
    : isInProgress
      ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`
      : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>`;

  // Action buttons based on status
  let actionButtons = '';
  if (isPending) {
    actionButtons = `
      <button class="task-action-btn task-start" data-action="start" title="Start working">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
      </button>
      <button class="task-action-btn task-complete" data-action="complete" title="Mark complete">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
      </button>
    `;
  } else if (isInProgress) {
    actionButtons = `
      <button class="task-action-btn task-complete" data-action="complete" title="Mark complete">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
      </button>
      <button class="task-action-btn task-pause" data-action="pause" title="Pause">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
      </button>
    `;
  } else {
    actionButtons = `
      <button class="task-action-btn task-reopen" data-action="reopen" title="Reopen task">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
      </button>
    `;
  }

  // Depth-based indent. Done as inline style to keep the CSS surface
  // small — if we extend hierarchy more (collapse/expand toggles,
  // connector lines, drag-to-reparent) move to a class-based approach.
  const indentStyle = depth > 0 ? ` style="padding-left: ${12 + depth * 18}px"` : '';
  const depthAttr = depth > 0 ? ` data-task-depth="${depth}"` : '';

  const breadcrumb = parentBreadcrumb
    ? `<div class="task-parent-breadcrumb" title="Parent task">↳ ${escapeHtml(parentBreadcrumb.title)}</div>`
    : '';

  const rollupChip = rollup
    ? `<span class="task-rollup-chip" title="Subtasks completed">${rollup.completed}/${rollup.total} ✓</span>`
    : '';

  const subtaskButton = `
        <button class="task-action-btn task-add-subtask" data-action="subtask" title="Add subtask">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </button>`;

  // Expand: jump straight to the full-page initiative view. Available
  // on every sidebar row even when there are no subtasks yet — the
  // view doubles as a roomy editor for the initiative itself.
  const expandButton = `
        <button class="task-action-btn task-expand" data-action="expand" title="Open as initiative view">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 3 21 3 21 9"/>
            <polyline points="9 21 3 21 3 15"/>
            <line x1="21" y1="3" x2="14" y2="10"/>
            <line x1="3" y1="21" x2="10" y2="14"/>
          </svg>
        </button>`;

  return `
    <div class="task-item ${statusClass}" data-task-id="${task.id}"${depthAttr}${indentStyle}>
      <div class="task-status-indicator" title="${task.status.replace('_', ' ')}">
        ${statusIcon}
      </div>
      <div class="task-content">
        ${breadcrumb}
        <div class="task-title ${isCompleted ? 'completed' : ''}">${escapeHtml(task.title)}</div>
        ${task.description ? `<div class="task-description">${escapeHtml(task.description)}</div>` : ''}
        <div class="task-meta">
          <span class="task-priority ${priorityClass}">${priorityLabel}</span>
          ${task.category ? `<span class="task-category">${task.category}</span>` : ''}
          ${rollupChip}
          ${renderSourceChip(task.source)}
          ${renderDueChip(task)}
          <span class="task-date">${formatDate(task.createdAt)}</span>
        </div>
      </div>
      <div class="task-actions">
        ${actionButtons}
        ${subtaskButton}
        ${expandButton}
        <button class="task-action-btn task-delete" data-action="delete" title="Delete task">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    </div>
  `;
}

/**
 * Handle task action buttons
 */
function handleTaskAction(taskId, action) {
  const projectPath = state.getProjectPath();
  if (!projectPath) return;

  const task = getFilteredTasks().find(t => t.id === taskId);
  if (!task) return;

  let newStatus = null;
  let toastMessage = '';

  switch (action) {
    case 'start':
      // Open the run-config modal first; status flips and prompt is sent
      // only after the user confirms AND the launch actually succeeds
      // (e.g. the chosen CLI is installed). Lazy-required to avoid
      // load-order coupling with the rest of the renderer wiring.
      // Pass children so the modal can render the subtask multi-select
      // when this is a parent task.
      require('./taskRunModal').open(task, {
        children: getAllTasks().filter(t => t.parentId === task.id),
        onRun: async (opts) => {
          const ok = await runTaskWithOptions(task, opts);
          if (!ok) return;
          ipcRenderer.send(IPC.UPDATE_TASK, {
            projectPath,
            taskId,
            updates: { status: 'in_progress' }
          });
          showToast('Task sent', 'info');
        }
      });
      return;
    case 'complete':
      newStatus = 'completed';
      toastMessage = 'Task completed';
      break;
    case 'pause':
      newStatus = 'pending';
      toastMessage = 'Task paused';
      break;
    case 'reopen':
      newStatus = 'pending';
      toastMessage = 'Task reopened';
      break;
    case 'subtask':
      showAddSubtaskModal(taskId);
      return;
    case 'expand':
      // Defer to the dashboard module — it owns the fullscreen overlay
      // and already knows how to render parent + subtasks side-by-side.
      require('./tasksDashboard').openInitiativeView(taskId);
      return;
    case 'delete':
      deleteTask(taskId);
      return;
    default:
      return;
  }

  if (newStatus) {
    ipcRenderer.send(IPC.UPDATE_TASK, {
      projectPath,
      taskId,
      updates: { status: newStatus }
    });
    showToast(toastMessage, action === 'complete' ? 'success' : 'info');
  }
}

/**
 * Show toast notification
 */
function showToast(message, type = 'info') {
  // Remove existing toast
  const existingToast = document.querySelector('.tasks-toast');
  if (existingToast) {
    existingToast.remove();
  }

  // Create toast element
  const toast = document.createElement('div');
  toast.className = `tasks-toast tasks-toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${getToastIcon(type)}</span>
    <span class="toast-message">${message}</span>
  `;

  // Mount on body so the toast lives in the viewport's coordinate space
  // rather than inside the narrow side panel — otherwise errors sit
  // bottom-right where they're easy to miss.
  document.body.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => {
    toast.classList.add('visible');
  });

  // Errors stay longer because they require user attention.
  const visibleMs = type === 'error' ? 4000 : 2000;
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, visibleMs);
}

/**
 * Get toast icon based on type
 */
function getToastIcon(type) {
  switch (type) {
    case 'success':
      return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
    case 'error':
      return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
    default:
      return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
  }
}

/**
 * Build the task prompt that gets injected into the AI CLI. If the user
 * asked for a new branch, instruct the AI to (1) surface any uncommitted
 * changes for an explicit decision rather than silently carrying or
 * discarding them, and (2) either use the user-provided branch name or
 * — when none was given — suggest one and wait for confirmation before
 * creating it. Uncommitted-check comes first so the branch decision is
 * never made on top of an unresolved working tree.
 */
function buildTaskPrompt(task, opts = {}) {
  // Initiative shape: when subtasks are attached, the parent is the
  // umbrella and the AI gets an explicit checklist of which children to
  // execute. Without subtasks, we keep the older single-task wording.
  // When the task being run is itself a subtask, opts.parent carries
  // the parent task so we can prepend just enough context — title +
  // acceptance criteria — without dumping every sibling and the full
  // parent description (the Claude-Skill philosophy: slim contextual
  // headers, not full-context-on-every-call).
  const subtasks = Array.isArray(opts.subtasks) ? opts.subtasks : [];
  const parent = opts.parent || null;

  // References (lemo-4) — render as "[file] /abs/path" / "[url] https://..."
  // so the agent can read/open whatever the user already had on hand.
  const formatRefs = (refs) => {
    if (!Array.isArray(refs) || refs.length === 0) return '';
    return refs.map(r => {
      const kind = r.kind === 'url' ? 'url' : 'file';
      const label = r.label ? ` (${r.label})` : '';
      return `  - [${kind}] ${r.value}${label}`;
    }).join('\n');
  };

  let prompt;
  if (subtasks.length > 0) {
    prompt = `Work on this initiative: ${task.title}`;
    if (task.description) prompt += `. ${task.description}`;
    if (task.priority === 'high') prompt += ` (High priority)`;
    if (task.acceptanceCriteria) {
      prompt += `\n\nInitiative is done when: ${task.acceptanceCriteria}`;
    }
    prompt += `\n\nComplete the following sub-tasks, in order:\n`;
    subtasks.forEach((sub, i) => {
      prompt += `${i + 1}. ${sub.title}`;
      if (sub.description) prompt += ` — ${sub.description}`;
      if (sub.acceptanceCriteria) prompt += `\n   Done when: ${sub.acceptanceCriteria}`;
      prompt += `\n`;
    });
    prompt += `\nDo not work on anything outside this list — other sub-tasks on the initiative are intentionally excluded.`;
  } else {
    // Parent context goes FIRST so the AI knows the umbrella before
    // we narrow in on the subtask. Kept brief on purpose — full
    // parent description is omitted unless the caller explicitly
    // bumps opts.parentContextLevel to 'full' later.
    if (parent) {
      prompt = `You're working on a subtask within initiative "${parent.title}".`;
      if (parent.acceptanceCriteria) {
        prompt += ` The initiative succeeds when: ${parent.acceptanceCriteria}.`;
      }
      prompt += `\n\nFocus only on the subtask below — sibling subtasks are intentionally not in your context.\n\n`;
      prompt += `Subtask: ${task.title}`;
    } else {
      prompt = `Work on this task: ${task.title}`;
    }
    if (task.description) prompt += `. ${task.description}`;
    if (task.priority === 'high') prompt += ` (High priority)`;
    if (task.acceptanceCriteria) {
      prompt += `\n\nDone when: ${task.acceptanceCriteria}`;
    }
  }

  // References block. Always appended last so the agent has the
  // primary context first. Parent's references travel with subtask
  // runs (initiative-wide assets); subtask references are listed
  // alongside their subtask in initiative runs.
  const taskRefs = formatRefs(task.references);
  const parentRefs = parent ? formatRefs(parent.references) : '';
  if (taskRefs || parentRefs) {
    prompt += `\n\nReferences to consult before starting:`;
    if (parentRefs) prompt += `\n(from initiative)\n${parentRefs}`;
    if (taskRefs) prompt += `\n(direct)\n${taskRefs}`;
  }
  if (subtasks.length > 0) {
    const subtaskRefsBlock = subtasks
      .map((sub, i) => {
        const r = formatRefs(sub.references);
        return r ? `${i + 1}. ${sub.title}\n${r}` : '';
      })
      .filter(Boolean)
      .join('\n');
    if (subtaskRefsBlock) {
      prompt += `\n\nSubtask references:\n${subtaskRefsBlock}`;
    }
  }

  if (opts.branchMode === 'new') {
    const branchStep = opts.newBranchName
      ? `create and switch to a new branch named "${opts.newBranchName}"`
      : `suggest an appropriate branch name based on this task, wait for my confirmation, and then create and switch to that branch`;

    prompt += `\n\nBefore starting, do the following in order:`
      + ` First, check for uncommitted changes on the current branch — if any exist, ask me what to do with them (commit, stash, or discard) and act on my decision before continuing.`
      + ` Then, ${branchStep}.`;
  }
  return prompt;
}

/**
 * Send the task to a terminal according to the user's choices in the
 * run modal. For "use current" we just write into the active terminal.
 * For "new terminal" we pre-flight that the chosen CLI is actually
 * installed, then spawn a terminal, launch the CLI, and inject the
 * prompt once the CLI has had a moment to come up.
 *
 * Returns true on success, false if we aborted (e.g. CLI missing) so
 * the caller can decide whether to flip status / show "sent" toast.
 */
async function runTaskWithOptions(task, opts = {}) {
  // Resolve subtask IDs (from the run modal's multi-select) into actual
  // task objects so buildTaskPrompt can render them inline. Skip
  // already-completed subtasks even if the user left them checked —
  // re-running completed work is rarely intended.
  const byId = new Map(getAllTasks().map(t => [t.id, t]));
  let subtasks = [];
  if (Array.isArray(opts.includedSubtaskIds) && opts.includedSubtaskIds.length > 0) {
    subtasks = opts.includedSubtaskIds
      .map(id => byId.get(id))
      .filter(t => t && t.status !== 'completed');
  }
  // If the task being run is itself a subtask, look up its parent so
  // buildTaskPrompt can prepend a slim initiative-context block.
  const parent = task.parentId ? (byId.get(task.parentId) || null) : null;
  const prompt = buildTaskPrompt(task, { ...opts, subtasks, parent });

  if (!opts.useNewTerminal) {
    // Same text-then-Enter trick as the new-terminal flow: AI CLI input
    // boxes (Claude/Codex/Gemini) buffer text+\r in one chunk as paste
    // content, so the trailing \r ends up in the input instead of
    // submitting. Splitting the writes makes submit reliable.
    if (typeof window.terminalSendPromptThenEnter === 'function') {
      window.terminalSendPromptThenEnter(prompt);
      if (typeof window.terminalMarkActive === 'function') {
        window.terminalMarkActive();
      }
      return true;
    }
    if (typeof window.terminalSendCommand === 'function') {
      window.terminalSendCommand(prompt);
      if (typeof window.terminalMarkActive === 'function') {
        window.terminalMarkActive();
      }
      return true;
    }
    console.error('Terminal sendCommand not available');
    return false;
  }

  if (typeof window.terminalCreateAndStart !== 'function') {
    console.error('Terminal createAndStart not available');
    return false;
  }

  const projectPath = state.getProjectPath();

  // Pre-flight: confirm the chosen CLI is installed. Without this we'd
  // happily hand the user a "command not found" followed by the task
  // prompt sitting in a bare shell.
  let startCommand = null;
  if (opts.toolId) {
    let check;
    try {
      check = await ipcRenderer.invoke(IPC.CHECK_AI_TOOL_AVAILABLE, {
        toolId: opts.toolId,
        projectPath
      });
    } catch (err) {
      console.error('Failed to verify AI tool availability', err);
      showToast('Could not verify AI CLI availability', 'error');
      return false;
    }
    if (!check || !check.available) {
      const name = (check && check.name) || opts.toolId;
      showToast(`${name} CLI not found on your system`, 'error');
      return false;
    }
    startCommand = check.resolvedCommand;
  }

  const newTerminalId = await window.terminalCreateAndStart(projectPath, startCommand);
  if (!newTerminalId) return false;

  // Give the CLI a few seconds to boot before injecting the prompt.
  // window.terminalCreateAndStart already waits 1s before sending the
  // start command, so we add another 4s on top of that. Use the
  // text-then-Enter helper so the prompt actually submits — sending
  // text+\r in a single chunk often gets buffered as paste content by
  // AI CLI input boxes.
  setTimeout(() => {
    if (typeof window.terminalSendPromptThenEnter === 'function') {
      window.terminalSendPromptThenEnter(prompt, newTerminalId);
    } else if (typeof window.terminalSendCommand === 'function') {
      window.terminalSendCommand(prompt, newTerminalId);
    }
    if (typeof window.terminalMarkActive === 'function') {
      window.terminalMarkActive(newTerminalId);
    }
  }, 5000);
  return true;
}

/**
 * Mark Claude Code as running (called from external modules)
 */
function setClaudeRunning(running) {
  claudeCodeRunning = running;
}

/**
 * Check if Claude Code is marked as running
 */
function isClaudeRunning() {
  return claudeCodeRunning;
}

/**
 * Delete task — opens the shared confirm modal first; only dispatches the IPC
 * if the user explicitly confirms. Lazy-required to avoid a hard cycle if
 * load order ever shifts.
 */
function deleteTask(taskId) {
  const projectPath = state.getProjectPath();
  if (!projectPath) return;

  const task = getFilteredTasks().find(t => t.id === taskId);
  const confirmModal = require('./taskConfirmModal');
  confirmModal.open({
    title: task ? task.title : null,
    onConfirm: () => {
      ipcRenderer.send(IPC.DELETE_TASK, { projectPath, taskId });
    }
  });
}

/**
 * Show add task modal
 */
function showAddTaskModal() {
  const modal = document.getElementById('task-modal');
  const form = document.getElementById('task-form');
  const title = document.getElementById('task-modal-title');

  if (!modal || !form) return;

  pendingParentId = null;
  updateParentInfo(null);

  title.textContent = 'Add Task';
  form.reset();
  form.dataset.mode = 'add';
  form.dataset.taskId = '';
  // Expand button only meaningful when editing an existing task.
  const expandBtn = document.getElementById('task-modal-expand');
  if (expandBtn) expandBtn.style.display = 'none';

  modal.classList.add('visible');
  document.getElementById('task-title-input')?.focus();
}

/**
 * Show the add-task modal pre-bound to a parent. The submit handler will
 * include `parentId` in the payload so tasksManager wires the new task
 * under the right parent. Renders a small "Subtask of: <parent title>"
 * banner in the modal so the user knows what they're filing under.
 */
function showAddSubtaskModal(parentId) {
  const modal = document.getElementById('task-modal');
  const form = document.getElementById('task-form');
  const title = document.getElementById('task-modal-title');

  if (!modal || !form) return;

  const parent = (tasksData?.tasks || []).find(t => t.id === parentId);
  if (!parent) {
    showToast('Parent task not found', 'error');
    return;
  }

  pendingParentId = parentId;
  updateParentInfo(parent);

  title.textContent = 'Add Subtask';
  form.reset();
  form.dataset.mode = 'add';
  form.dataset.taskId = '';

  modal.classList.add('visible');
  document.getElementById('task-title-input')?.focus();
}

/**
 * Show or hide the "Subtask of: ..." banner in the task modal. The
 * banner element is inserted into the DOM once (lazily) so we don't
 * have to touch index.html.
 */
function updateParentInfo(parent) {
  const body = document.querySelector('#task-modal .task-modal-body');
  if (!body) return;

  let info = document.getElementById('task-parent-info');
  if (!info) {
    info = document.createElement('div');
    info.id = 'task-parent-info';
    info.className = 'task-parent-info';
    info.style.cssText = 'padding: 6px 10px; margin-bottom: 10px; border-radius: 4px; background: rgba(212,165,116,0.12); border: 1px solid rgba(212,165,116,0.35); font-size: 12px; display: none;';
    body.insertBefore(info, body.firstChild);
  }

  if (parent) {
    info.textContent = `Subtask of: ${parent.title}`;
    info.style.display = 'block';
  } else {
    info.textContent = '';
    info.style.display = 'none';
  }
}

/**
 * Show edit task modal
 */
function showEditTaskModal(taskId) {
  // Look up the task in the full list, not just the filtered view —
  // a subtask click from the modal subtasks list needs to work even
  // though subtasks are excluded from the sidebar's filtered list.
  const task = getAllTasks().find(t => t.id === taskId);
  if (!task) return;

  const modal = document.getElementById('task-modal');
  const form = document.getElementById('task-form');
  const title = document.getElementById('task-modal-title');

  if (!modal || !form) return;

  pendingParentId = null;

  title.textContent = 'Edit Task';
  form.dataset.mode = 'edit';
  form.dataset.taskId = taskId;
  // Show the Expand button so the user can jump from this modal into
  // the full-page initiative view (handler set up in setupModalListeners).
  const expandBtn = document.getElementById('task-modal-expand');
  if (expandBtn) {
    expandBtn.style.display = '';
    expandBtn.dataset.taskId = taskId;
  }

  // Surface parent context: if this is a subtask, show the "Subtask of"
  // banner. If it's a parent (has children), the dedicated subtasks
  // section below replaces that role.
  const parent = task.parentId ? getAllTasks().find(t => t.id === task.parentId) : null;
  updateParentInfo(parent || null);

  // Fill form with task data
  document.getElementById('task-title-input').value = task.title || '';
  document.getElementById('task-description-input').value = task.description || '';
  document.getElementById('task-priority-input').value = task.priority || 'medium';
  document.getElementById('task-category-input').value = task.category || 'feature';
  document.getElementById('task-start-date-input').value = task.startDate || '';
  document.getElementById('task-end-date-input').value = task.endDate || '';

  renderModalSubtasks(task);

  modal.classList.add('visible');
}

/**
 * Paint the subtasks section inside the edit modal. Hidden for tasks
 * with no children; shown otherwise. Clicking a child swaps the modal
 * to edit that child (parent edits in the form are abandoned — that's
 * the same UX as switching between Add and Edit modes elsewhere).
 */
function renderModalSubtasks(task) {
  const section = document.getElementById('task-modal-subtasks');
  const list = document.getElementById('task-modal-subtasks-list');
  const countEl = document.getElementById('task-modal-subtasks-count');
  const addBtn = document.getElementById('task-modal-add-subtask');
  if (!section || !list) return;

  const children = getAllTasks().filter(t => t.parentId === task.id);

  if (children.length === 0 && task.parentId) {
    // Subtask itself with no children → no subtasks section needed.
    section.style.display = 'none';
    return;
  }

  section.style.display = '';
  if (countEl) {
    const completed = children.filter(c => c.status === 'completed').length;
    countEl.textContent = children.length === 0
      ? ''
      : ` (${completed}/${children.length})`;
  }

  list.innerHTML = '';
  for (const child of children) {
    const row = document.createElement('div');
    row.className = `task-modal-subtask status-${(child.status || 'pending').replace('_', '-')}`;
    row.dataset.taskId = child.id;
    const completedCls = child.status === 'completed' ? ' completed' : '';
    row.innerHTML = `
      <span class="task-modal-subtask-dot status-${(child.status || 'pending').replace('_', '-')}"></span>
      <span class="task-modal-subtask-title${completedCls}"></span>
      <span class="task-modal-subtask-status">${(child.status || 'pending').replace('_', ' ')}</span>
    `;
    row.querySelector('.task-modal-subtask-title').textContent = child.title || 'Untitled';
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      showEditTaskModal(child.id);
    });
    list.appendChild(row);
  }

  if (addBtn) {
    // Clone-replace to clear stale parent IDs from previous renders so a
    // user editing parent A then B can't accidentally add a subtask to A.
    const fresh = addBtn.cloneNode(true);
    addBtn.parentNode.replaceChild(fresh, addBtn);
    fresh.addEventListener('click', (e) => {
      e.stopPropagation();
      showAddSubtaskModal(task.id);
    });
  }
}

/**
 * Hide task modal
 */
function hideTaskModal() {
  const modal = document.getElementById('task-modal');
  if (modal) {
    modal.classList.remove('visible');
  }
  pendingParentId = null;
  updateParentInfo(null);
  const section = document.getElementById('task-modal-subtasks');
  if (section) section.style.display = 'none';
}

/**
 * Handle task form submit
 */
function handleTaskFormSubmit(e) {
  e.preventDefault();

  const form = e.target;
  const mode = form.dataset.mode;
  const taskId = form.dataset.taskId;
  const projectPath = state.getProjectPath();

  if (!projectPath) return;

  const taskData = {
    title: document.getElementById('task-title-input').value.trim(),
    description: document.getElementById('task-description-input').value.trim(),
    priority: document.getElementById('task-priority-input').value,
    category: document.getElementById('task-category-input').value,
    startDate: document.getElementById('task-start-date-input').value || null,
    endDate: document.getElementById('task-end-date-input').value || null
  };

  if (!taskData.title) {
    alert('Task title is required');
    return;
  }

  if (mode === 'add') {
    if (pendingParentId) taskData.parentId = pendingParentId;
    ipcRenderer.send(IPC.ADD_TASK, { projectPath, task: taskData });
  } else if (mode === 'edit' && taskId) {
    ipcRenderer.send(IPC.UPDATE_TASK, {
      projectPath,
      taskId,
      updates: taskData
    });
  }

  pendingParentId = null;
  hideTaskModal();
}

/**
 * Setup modal event listeners
 */
function setupModalListeners() {
  const modal = document.getElementById('task-modal');
  const form = document.getElementById('task-form');
  const cancelBtn = document.getElementById('task-cancel-btn');
  const closeBtn = document.getElementById('task-modal-close');
  const expandBtn = document.getElementById('task-modal-expand');

  if (form) {
    form.addEventListener('submit', handleTaskFormSubmit);
  }

  if (cancelBtn) {
    cancelBtn.addEventListener('click', hideTaskModal);
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', hideTaskModal);
  }

  if (expandBtn) {
    expandBtn.addEventListener('click', () => {
      const taskId = expandBtn.dataset.taskId;
      if (!taskId) return;
      // Close the modal so the initiative view isn't visually layered
      // on top of it. The fullscreen overlay takes over.
      hideTaskModal();
      require('./tasksDashboard').openInitiativeView(taskId);
    });
  }

  // Close on backdrop click
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        hideTaskModal();
      }
    });
  }

  // Close on Escape (capture phase so we beat any other Esc handlers — e.g.
  // the dashboard's — when the modal is the topmost layer).
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!modal || !modal.classList.contains('visible')) return;
    e.stopPropagation();
    hideTaskModal();
  }, true);
}

/**
 * Escape HTML for safe rendering
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Render a small attribution chip for tasks that came from a Frame spec.
 * `source` looks like `spec:<slug>:T<n>`. We surface just the slug since
 * that's the actionable identifier the user knows.
 */
function renderSourceChip(source) {
  if (!source || typeof source !== 'string') return '';
  const m = source.match(/^spec:([^:]+):/);
  if (!m) return '';
  const slug = escapeHtml(m[1]);
  return `<span class="task-source-chip" title="From spec: ${slug}">spec · ${slug}</span>`;
}

/**
 * Render a chip for a task's due date — colored as overdue when the
 * date has passed and the task is not yet completed.
 */
function renderDueChip(task) {
  if (!task || !task.endDate) return '';
  const overdue = task.status !== 'completed' && task.endDate < todayYMD();
  const cls = `task-due${overdue ? ' overdue' : ''}`;
  const label = formatDueDate(task.endDate);
  const title = overdue ? `Overdue · due ${task.endDate}` : `Due ${task.endDate}`;
  return `<span class="${cls}" title="${escapeHtml(title)}">${escapeHtml(label)}</span>`;
}

function todayYMD() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDueDate(ymd) {
  if (!ymd) return '';
  const today = todayYMD();
  if (ymd === today) return 'Due today';
  const [y, m, d] = ymd.split('-').map(Number);
  const target = new Date(y, (m || 1) - 1, d || 1);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const diffDays = Math.round((target - now) / (1000 * 60 * 60 * 24));
  if (diffDays === 1) return 'Due tomorrow';
  if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`;
  if (diffDays < 7) return `Due in ${diffDays}d`;
  return `Due ${target.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

/**
 * Format date for display
 */
function formatDate(isoString) {
  if (!isoString) return '';

  const date = new Date(isoString);
  const now = new Date();
  const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Initialize when DOM is ready
 */
function initWhenReady() {
  init();
  setupModalListeners();
}

/**
 * Public entry point for opening the Add Subtask modal from outside
 * this module (e.g. the dashboard's full-page initiative view). Same
 * flow as the in-row "+" button, just callable by ID.
 */
function openAddSubtaskModalForParent(parentId) {
  showAddSubtaskModal(parentId);
}

module.exports = {
  init: initWhenReady,
  show,
  hide,
  toggle,
  loadTasks,
  isVisible: () => isVisible,
  setClaudeRunning,
  isClaudeRunning,
  // Exported so the dashboard can reuse the same launch flow for its
  // Run buttons (detail aside + subtask rows) without duplicating the
  // CLI pre-flight + prompt build + status flip wiring.
  runTaskWithOptions,
  showToast,
  openAddSubtaskModalForParent
};
