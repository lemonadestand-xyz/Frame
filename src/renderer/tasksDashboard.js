/**
 * Tasks Dashboard Module
 *
 * Full-page Kanban board with three columns (Pending / In Progress /
 * Completed). Cards are draggable within and across columns; drops persist
 * via REORDER_TASKS, which rewrites tasks.json so array order matches column
 * order and each task's status reflects its column.
 *
 * Cards are intentionally minimal here — no Play / Complete / Pause buttons.
 * Clicking a card opens a detail aside on the right with the full task body
 * (description, original userRequest, acceptance criteria, notes, context).
 *
 * State is sourced from the same TASKS_DATA stream used by the side panel,
 * so the dashboard, the side panel, and the on-disk tasks.json all stay in
 * sync — no separate fetch.
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const state = require('./state');

const STATUS_COLUMNS = ['pending', 'in_progress', 'completed'];
const STATUS_LABELS = {
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Completed'
};

let isVisible = false;
let tasks = [];
let selectedTaskId = null;
// Set of parent task IDs that are currently collapsed in the dashboard.
// Module-scoped so toggle state survives re-renders driven by external
// task edits. Not persisted — it's a viewing preference, not data.
const collapsedParents = new Set();
let dashboardEl = null;
let projectLabelEl = null;
let columnEls = {};
let countEls = {};
let detailEl = null;
let detailEmptyEl = null;
let detailContentEl = null;
let detailFormEl = null;
let dragSource = null;

// Initiative view state — the task ID being shown in full-page mode,
// or null when the regular dashboard is showing.
let activeInitiativeId = null;
let initiativeViewEl = null;
// Set while an inline editor is active so the TASKS_DATA listener
// doesn't yank the editor out from under the user when an unrelated
// task update arrives. Cleared when the editor commits or cancels.
let inlineEditorActive = false;
// rAF handle for the column auto-scroll during drag. Held module-level
// so we can cancel it the moment the drag ends (otherwise the loop
// keeps scrolling after drop).
let autoScrollFrame = null;

/**
 * Dashboard-only filter state. Empty set on a dimension means "no filter on
 * this dimension"; multi-select within a dimension is OR; across dimensions
 * is AND. Never persisted to tasks.json — this is purely a viewing layer.
 */
const filters = { categories: new Set(), priorities: new Set() };
let filterBtnEl = null;
let filterPopoverEl = null;
let filterBadgeEl = null;

/**
 * Sort state. mode is 'default' | 'category' | 'priority' (default = file
 * order, the original behavior). applyToFile is the toggle: when true,
 * picking a sort also rewrites tasks.json via REORDER_TASKS so the new order
 * persists.
 */
const sort = { mode: 'default', applyToFile: false };
const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };
let sortBtnEl = null;
let sortPopoverEl = null;
let sortLabelEl = null;

function init() {
  dashboardEl = document.getElementById('tasks-dashboard');
  if (!dashboardEl) return;

  projectLabelEl = document.getElementById('tasks-dashboard-project');
  detailEl = document.getElementById('tasks-dashboard-detail');
  detailEmptyEl = detailEl.querySelector('.tasks-dashboard-detail-empty');
  detailContentEl = detailEl.querySelector('.tasks-dashboard-detail-content');
  detailFormEl = document.getElementById('tasks-dashboard-form');

  for (const status of STATUS_COLUMNS) {
    columnEls[status] = dashboardEl.querySelector(`[data-drop-status="${status}"]`);
    countEls[status] = dashboardEl.querySelector(`[data-count-for="${status}"]`);
  }

  setupDropTargets();

  document.getElementById('tasks-dashboard-close').addEventListener('click', hide);

  // Both Add entry points (header New Task button, empty-state add card)
  // open the form inside the right aside instead of the modal — the modal
  // is reserved for the tasks side panel.
  document.getElementById('tasks-dashboard-add').addEventListener('click', showForm);
  const detailAddBtn = document.getElementById('tasks-dashboard-detail-add');
  if (detailAddBtn) detailAddBtn.addEventListener('click', showForm);

  detailEl.querySelector('.tasks-dashboard-detail-close').addEventListener('click', clearSelection);

  // Delete button on the selected card — routes through the shared confirm
  // modal before any DELETE_TASK is dispatched.
  const deleteBtn = detailEl.querySelector('.tasks-dashboard-detail-delete');
  if (deleteBtn) deleteBtn.addEventListener('click', requestDeleteSelected);

  // Run button on the selected card — opens taskRunModal with the
  // selected task and (if it's a parent) its children, so the user
  // can pick which subtasks to include in the launch.
  const runBtn = detailEl.querySelector('.tasks-dashboard-detail-run');
  if (runBtn) runBtn.addEventListener('click', runSelectedTask);

  // Expand: open the full-page initiative view for the selected task.
  const expandBtn = detailEl.querySelector('.tasks-dashboard-detail-expand');
  if (expandBtn) expandBtn.addEventListener('click', expandSelectedAsInitiative);

  // Move (reparent) popover.
  const moveBtn = detailEl.querySelector('.tasks-dashboard-detail-move');
  if (moveBtn) moveBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMovePopover();
  });
  setupMovePopover();
  setupInitiativeView();

  setupForm();
  setupFilter();
  setupSort();

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !isVisible) return;
    // Don't intercept Esc while the side-panel modal is on top — that flow
    // owns its own dismissal.
    const modal = document.getElementById('task-modal');
    if (modal && modal.classList.contains('visible')) return;

    if (isFilterPopoverOpen()) {
      closeFilterPopover();
    } else if (isSortPopoverOpen()) {
      closeSortPopover();
    } else if (isFormOpen()) {
      hideForm();
    } else if (selectedTaskId) {
      clearSelection();
    } else {
      hide();
    }
  });

  ipcRenderer.on(IPC.TASKS_DATA, (event, { tasks: data }) => {
    tasks = flatten(data);
    if (isVisible) render();
    // Repaint the initiative view when its underlying task changes
    // (e.g. a subtask was edited from elsewhere) so the side-by-side
    // detail stays current without forcing the user to close + reopen.
    // Skip while an inline editor is open — re-rendering would destroy
    // the textarea and lose the user's in-flight typing. The next
    // commit / cancel triggers a render itself.
    if (activeInitiativeId && !inlineEditorActive) renderInitiativeView();
  });

  ipcRenderer.on(IPC.TOGGLE_TASKS_DASHBOARD, () => toggle());
}

function flatten(data) {
  if (!data || !data.tasks) return [];
  if (Array.isArray(data.tasks)) return data.tasks.slice();
  // Defensive: legacy nested shape (loader normally migrates this).
  return [
    ...(data.tasks.pending || []).map(t => ({ ...t, status: 'pending' })),
    ...(data.tasks.inProgress || []).map(t => ({ ...t, status: 'in_progress' })),
    ...(data.tasks.completed || []).map(t => ({ ...t, status: 'completed' }))
  ];
}

function show() {
  if (!dashboardEl) return;
  const projectPath = state.getProjectPath();
  // No project = nothing to show. Surface the same info modal the side panel
  // uses so the user gets one consistent message no matter where they enter.
  if (!projectPath) {
    require('./taskInfoModal').open({
      title: 'No project selected',
      message: 'Select a project from the sidebar to open the task board.'
    });
    return;
  }
  isVisible = true;
  dashboardEl.classList.add('visible');
  if (projectLabelEl) {
    projectLabelEl.textContent =
      projectPath.split('/').pop() || projectPath.split('\\').pop() || '';
  }
  ipcRenderer.send(IPC.LOAD_TASKS, projectPath);
  render();
}

function hide() {
  if (!dashboardEl) return;
  isVisible = false;
  dashboardEl.classList.remove('visible');
  clearSelection();
  closeFilterPopover();
  closeSortPopover();
}

function toggle() {
  if (isVisible) hide(); else show();
}

function render() {
  for (const status of STATUS_COLUMNS) {
    const col = columnEls[status];
    if (!col) continue;
    col.innerHTML = '';
  }

  // Initiative-centric layout: only top-level tasks (parentId == null)
  // occupy a column slot. Subtasks live inside their parent card as a
  // collapsible list — see renderCard. This trades the strict
  // status-per-column invariant for a clearer picture of which work
  // belongs to which initiative.
  const childrenByParent = new Map();
  for (const task of tasks) {
    if (!task.parentId) continue;
    if (!childrenByParent.has(task.parentId)) childrenByParent.set(task.parentId, []);
    childrenByParent.get(task.parentId).push(task);
  }
  const topLevel = tasks.filter(t => !t.parentId);

  const buckets = { pending: [], in_progress: [], completed: [] };
  for (const task of topLevel) {
    const status = STATUS_COLUMNS.includes(task.status) ? task.status : 'pending';
    buckets[status].push(task);
  }

  // Apply sort within each column. Default mode preserves the array order
  // (= file order), which is what the rest of the codebase relies on.
  if (sort.mode !== 'default') {
    for (const status of STATUS_COLUMNS) {
      buckets[status].sort(compareTasks);
    }
  }

  for (const status of STATUS_COLUMNS) {
    const col = columnEls[status];
    const count = countEls[status];
    // All cards are rendered in DOM (filtered ones get .filtered-out and are
    // CSS-hidden) so drag-and-drop reorder still sees the full ordering and
    // doesn't accidentally drop hidden tasks to the end of tasks.json.
    const visibleCount = buckets[status].filter(filterMatches).length;
    if (count) {
      count.textContent = isFilterActive()
        ? `${visibleCount}/${buckets[status].length}`
        : String(buckets[status].length);
    }
    if (!col) continue;

    if (buckets[status].length === 0) {
      const empty = document.createElement('div');
      empty.className = 'tasks-dashboard-column-empty';
      empty.textContent = 'Drop tasks here';
      col.appendChild(empty);
      continue;
    }

    for (const task of buckets[status]) {
      const cardEl = renderCard(task, childrenByParent);
      if (!filterMatches(task)) cardEl.classList.add('filtered-out');
      col.appendChild(cardEl);
    }

    if (visibleCount === 0 && isFilterActive()) {
      const empty = document.createElement('div');
      empty.className = 'tasks-dashboard-column-empty';
      empty.textContent = 'No matches in this column';
      col.appendChild(empty);
    }
  }

  if (selectedTaskId) {
    const stillExists = tasks.some(t => t.id === selectedTaskId);
    if (stillExists) {
      renderDetail(tasks.find(t => t.id === selectedTaskId));
    } else {
      clearSelection();
    }
  }
}

function renderCard(task, childrenByParent) {
  const card = document.createElement('div');
  card.className = `tasks-dashboard-card priority-${task.priority || 'medium'}`;
  card.dataset.taskId = task.id;
  card.draggable = true;
  if (task.id === selectedTaskId) card.classList.add('selected');

  const title = document.createElement('div');
  title.className = 'tasks-dashboard-card-title';
  title.textContent = task.title || 'Untitled';
  card.appendChild(title);

  if (task.description) {
    const desc = document.createElement('div');
    desc.className = 'tasks-dashboard-card-desc';
    desc.textContent = task.description;
    card.appendChild(desc);
  }

  const meta = document.createElement('div');
  meta.className = 'tasks-dashboard-card-meta';

  const priority = document.createElement('span');
  priority.className = `tasks-dashboard-card-priority priority-${task.priority || 'medium'}`;
  priority.textContent = (task.priority || 'medium').toUpperCase();
  meta.appendChild(priority);

  if (task.category) {
    const cat = document.createElement('span');
    cat.className = 'tasks-dashboard-card-category';
    cat.textContent = task.category;
    meta.appendChild(cat);
  }

  if (task.endDate) {
    const due = document.createElement('span');
    const overdue = isOverdue(task);
    due.className = `tasks-dashboard-card-due${overdue ? ' overdue' : ''}`;
    due.textContent = formatDueShort(task.endDate);
    due.title = overdue ? `Overdue · due ${task.endDate}` : `Due ${task.endDate}`;
    meta.appendChild(due);
  }

  const date = document.createElement('span');
  date.className = 'tasks-dashboard-card-date';
  date.textContent = formatDate(task.updatedAt || task.createdAt);
  meta.appendChild(date);

  card.appendChild(meta);

  // Subtask sub-list: only present if this task has children.
  const children = (childrenByParent && childrenByParent.get(task.id)) || [];
  if (children.length > 0) {
    appendSubtaskSection(card, task, children, childrenByParent);
  }

  card.addEventListener('click', () => selectTask(task.id));
  card.addEventListener('dragstart', (e) => onDragStart(e, task));
  card.addEventListener('dragend', onDragEnd);

  return card;
}

/**
 * Attach a collapsible "Subtasks" section to a parent card. The header
 * shows a chevron + completed/total rollup. The list of children is
 * rendered as compact rows (status indicator + title + priority dot)
 * directly inside the parent card — subtasks never appear as separate
 * primary cards in columns. Click on a row selects the task (opens
 * detail aside), same as clicking a top-level card.
 */
function appendSubtaskSection(card, parentTask, children, childrenByParent) {
  const isCollapsed = collapsedParents.has(parentTask.id);
  const completed = children.filter(c => c.status === 'completed').length;

  const section = document.createElement('div');
  section.className = 'tasks-dashboard-card-subtasks';

  const header = document.createElement('div');
  header.className = 'tasks-dashboard-card-subtasks-header';
  header.innerHTML = `
    <span class="tasks-dashboard-card-subtasks-chevron">${isCollapsed ? '▶' : '▼'}</span>
    <span class="tasks-dashboard-card-subtasks-label">Subtasks ${completed}/${children.length}</span>
  `;
  header.addEventListener('click', (e) => {
    e.stopPropagation();
    if (collapsedParents.has(parentTask.id)) {
      collapsedParents.delete(parentTask.id);
    } else {
      collapsedParents.add(parentTask.id);
    }
    render();
  });
  section.appendChild(header);

  if (!isCollapsed) {
    const list = document.createElement('div');
    list.className = 'tasks-dashboard-card-subtasks-list';
    for (const child of children) {
      list.appendChild(renderSubtaskRow(child, childrenByParent));
    }
    section.appendChild(list);
  }

  card.appendChild(section);
}

/**
 * Render a single subtask as a compact row inside a parent card. Recurses
 * into grandchildren via indented nested rows so deep initiatives stay
 * visible without bloating the renderer. Click selects the task (opens
 * detail aside) — full edit happens there.
 */
function renderSubtaskRow(task, childrenByParent) {
  const row = document.createElement('div');
  row.className = `tasks-dashboard-subtask-row status-${(task.status || 'pending').replace('_', '-')} priority-${task.priority || 'medium'}`;
  row.dataset.taskId = task.id;
  if (task.id === selectedTaskId) row.classList.add('selected');

  const indicator = document.createElement('span');
  indicator.className = `tasks-dashboard-subtask-indicator status-${(task.status || 'pending').replace('_', '-')}`;
  indicator.title = (task.status || 'pending').replace('_', ' ');
  row.appendChild(indicator);

  const titleEl = document.createElement('span');
  titleEl.className = 'tasks-dashboard-subtask-title';
  if (task.status === 'completed') titleEl.classList.add('completed');
  titleEl.textContent = task.title || 'Untitled';
  row.appendChild(titleEl);

  if (task.priority && task.priority !== 'medium') {
    const pri = document.createElement('span');
    pri.className = `tasks-dashboard-subtask-priority priority-${task.priority}`;
    pri.textContent = task.priority === 'high' ? 'H' : 'L';
    pri.title = `${task.priority} priority`;
    row.appendChild(pri);
  }

  row.addEventListener('click', (e) => {
    e.stopPropagation();
    selectTask(task.id);
  });

  // Run button on each subtask row — same flow as parent Run, just
  // launched for this single subtask. Stops propagation so clicking
  // the button doesn't also trigger the row's selectTask click.
  if (task.status !== 'completed') {
    const runBtn = document.createElement('button');
    runBtn.className = 'tasks-dashboard-subtask-run';
    runBtn.title = 'Run subtask';
    runBtn.innerHTML = `
      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <polygon points="5 3 19 12 5 21 5 3"/>
      </svg>`;
    runBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      runTaskById(task.id);
    });
    row.appendChild(runBtn);
  }

  const grandchildren = (childrenByParent && childrenByParent.get(task.id)) || [];
  if (grandchildren.length > 0) {
    const nested = document.createElement('div');
    nested.className = 'tasks-dashboard-subtask-nested';
    for (const gk of grandchildren) {
      nested.appendChild(renderSubtaskRow(gk, childrenByParent));
    }
    row.appendChild(nested);
  }

  return row;
}

/**
 * Open the run modal for a task identified by ID. Shared by the Run
 * button on subtask rows and the Run button in the detail aside. Reuses
 * tasksPanel.runTaskWithOptions so the CLI pre-flight + prompt build +
 * status flip wiring stays in one place.
 */
function runTaskById(taskId) {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;
  const projectPath = state.getProjectPath();
  if (!projectPath) return;

  const children = tasks.filter(t => t.parentId === task.id);
  const taskRunModal = require('./taskRunModal');
  const tasksPanel = require('./tasksPanel');

  taskRunModal.open(task, {
    children,
    onRun: async (opts) => {
      const ok = await tasksPanel.runTaskWithOptions(task, opts);
      if (!ok) return;
      ipcRenderer.send(IPC.UPDATE_TASK, {
        projectPath,
        taskId: task.id,
        updates: { status: 'in_progress' }
      });
      tasksPanel.showToast('Task sent', 'info');
    }
  });
}

function runSelectedTask() {
  if (selectedTaskId) runTaskById(selectedTaskId);
}

/* -------------------- Reparent ("Move to...") popover -------------------- */

function setupMovePopover() {
  const popover = document.getElementById('tasks-dashboard-move-popover');
  if (!popover) return;
  // Clicks inside the popover stay inside.
  popover.addEventListener('click', (e) => e.stopPropagation());
  // Outside-click closes.
  document.addEventListener('click', (e) => {
    if (!isMovePopoverOpen()) return;
    if (popover.contains(e.target)) return;
    const moveBtn = detailEl && detailEl.querySelector('.tasks-dashboard-detail-move');
    if (moveBtn && moveBtn.contains(e.target)) return;
    closeMovePopover();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isMovePopoverOpen()) closeMovePopover();
  });
}

function isMovePopoverOpen() {
  const popover = document.getElementById('tasks-dashboard-move-popover');
  return !!popover && !popover.hasAttribute('hidden');
}

function toggleMovePopover() {
  if (isMovePopoverOpen()) closeMovePopover(); else openMovePopover();
}

function openMovePopover() {
  if (!selectedTaskId) return;
  const popover = document.getElementById('tasks-dashboard-move-popover');
  const list = document.getElementById('tasks-dashboard-move-list');
  if (!popover || !list) return;

  const selected = tasks.find(t => t.id === selectedTaskId);
  if (!selected) return;

  list.innerHTML = '';

  // Excluded targets: the task itself + its descendants (prevents
  // cycles like A → B → A). Walking the children map handles the
  // multi-level case even though the modal only renders one level.
  const excluded = collectDescendantIds(selected.id);
  excluded.add(selected.id);

  // "Make top-level" appears first — most-used escape hatch.
  const topRow = document.createElement('button');
  topRow.type = 'button';
  topRow.className = 'tasks-dashboard-move-option tasks-dashboard-move-promote';
  topRow.innerHTML = `
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
    <span>Make top-level (no parent)</span>
  `;
  topRow.addEventListener('click', () => commitReparent(selected.id, null));
  list.appendChild(topRow);

  // Candidate parents: every top-level task that isn't the selected
  // task or one of its descendants. (We could allow nesting under any
  // task, but v1 keeps initiatives flat at the parent level.)
  const candidates = tasks.filter(t => !t.parentId && !excluded.has(t.id));
  if (candidates.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'tasks-dashboard-move-empty';
    empty.textContent = 'No other initiatives yet.';
    list.appendChild(empty);
  } else {
    for (const candidate of candidates) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'tasks-dashboard-move-option';
      // Disable the current parent so the picker is honest about what's
      // a no-op — keeps the option visible but un-clickable.
      const isCurrentParent = candidate.id === selected.parentId;
      if (isCurrentParent) {
        row.classList.add('is-current');
        row.disabled = true;
      }
      row.innerHTML = `
        <span class="tasks-dashboard-move-dot status-${(candidate.status || 'pending').replace('_', '-')}"></span>
        <span class="tasks-dashboard-move-title"></span>
        ${isCurrentParent ? '<span class="tasks-dashboard-move-current">Current</span>' : ''}
      `;
      row.querySelector('.tasks-dashboard-move-title').textContent = candidate.title || 'Untitled';
      row.addEventListener('click', () => commitReparent(selected.id, candidate.id));
      list.appendChild(row);
    }
  }

  popover.removeAttribute('hidden');
}

function closeMovePopover() {
  const popover = document.getElementById('tasks-dashboard-move-popover');
  if (popover) popover.setAttribute('hidden', '');
}

function commitReparent(taskId, newParentId) {
  const projectPath = state.getProjectPath();
  if (!projectPath) return;
  ipcRenderer.send(IPC.UPDATE_TASK, {
    projectPath,
    taskId,
    updates: { parentId: newParentId }
  });
  closeMovePopover();
}

/**
 * Walk the children of a task and collect all descendant IDs. Used by
 * the reparent picker to exclude cycle-creating targets.
 */
function collectDescendantIds(taskId) {
  const out = new Set();
  const childrenByParent = new Map();
  for (const t of tasks) {
    if (!t.parentId) continue;
    if (!childrenByParent.has(t.parentId)) childrenByParent.set(t.parentId, []);
    childrenByParent.get(t.parentId).push(t.id);
  }
  const stack = [taskId];
  while (stack.length > 0) {
    const cur = stack.pop();
    const kids = childrenByParent.get(cur) || [];
    for (const k of kids) {
      if (!out.has(k)) {
        out.add(k);
        stack.push(k);
      }
    }
  }
  return out;
}

/* -------------------- Full-page initiative view -------------------- */

function setupInitiativeView() {
  initiativeViewEl = document.getElementById('tasks-initiative-view');
  if (!initiativeViewEl) return;

  const backBtn = document.getElementById('tasks-initiative-back');
  if (backBtn) backBtn.addEventListener('click', closeInitiativeView);

  const runBtn = document.getElementById('tasks-initiative-run');
  if (runBtn) runBtn.addEventListener('click', () => {
    if (activeInitiativeId) runTaskById(activeInitiativeId);
  });

  const addBtn = document.getElementById('tasks-initiative-add-subtask');
  if (addBtn) addBtn.addEventListener('click', () => {
    if (!activeInitiativeId) return;
    require('./tasksPanel');
    // Reuse the sidebar's "add subtask" flow — it already knows how to
    // open the task modal with parent context pre-filled.
    const taskModalBtn = document.getElementById('tasks-add-btn');
    // Simplest path: open the task modal directly with a synthetic
    // "subtask of <initiative>" state. We piggyback on the existing
    // showAddSubtaskModal path by dispatching a click on a parent's
    // subtask button... but that's brittle. Instead just send the IPC
    // and let the user fill in the modal? Simpler still: open the
    // task-modal manually, set its mode, and use the existing form
    // submit handler which will read pendingParentId.
    require('./tasksPanel').openAddSubtaskModalForParent(activeInitiativeId);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isInitiativeViewOpen()) {
      // Don't intercept while the task-run modal is on top.
      const runModal = document.getElementById('task-run-modal');
      if (runModal && runModal.classList.contains('visible')) return;
      const editModal = document.getElementById('task-modal');
      if (editModal && editModal.classList.contains('visible')) return;
      const movePop = document.getElementById('tasks-dashboard-move-popover');
      if (movePop && !movePop.hasAttribute('hidden')) return;
      closeInitiativeView();
    }
  });
}

function isInitiativeViewOpen() {
  return !!initiativeViewEl && initiativeViewEl.classList.contains('visible');
}

function expandSelectedAsInitiative() {
  if (!selectedTaskId) return;
  openInitiativeView(selectedTaskId);
}

function openInitiativeView(taskId) {
  if (!initiativeViewEl) return;
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;

  // If the user expands a subtask, surface its parent instead — the
  // initiative view is the parent's space. Sub-of-sub falls back to
  // the immediate parent (we don't walk all the way up — uncommon
  // enough, and the parent link in the detail aside is right there).
  let target = task;
  if (task.parentId) {
    const parent = tasks.find(t => t.id === task.parentId);
    if (parent) target = parent;
  }

  activeInitiativeId = target.id;
  initiativeViewEl.classList.add('visible');
  renderInitiativeView();
}

function closeInitiativeView() {
  if (!initiativeViewEl) return;
  activeInitiativeId = null;
  initiativeViewEl.classList.remove('visible');
}

function renderInitiativeView() {
  if (!initiativeViewEl || !activeInitiativeId) return;
  const task = tasks.find(t => t.id === activeInitiativeId);
  if (!task) {
    // Task was deleted — bail out of the view rather than render a stale
    // shell.
    closeInitiativeView();
    return;
  }

  const titleEl = document.getElementById('tasks-initiative-title');
  if (titleEl) {
    titleEl.textContent = task.title || 'Untitled';
    // Editable headline. Title is single-line.
    titleEl.dataset.editable = '1';
    titleEl.dataset.taskId = task.id;
    titleEl.dataset.field = 'title';
    titleEl.dataset.multiline = '0';
    titleEl.dataset.placeholder = 'Untitled initiative';
  }

  const leftEl = document.getElementById('tasks-initiative-left');
  const rightEl = document.getElementById('tasks-initiative-right');
  if (leftEl) leftEl.innerHTML = renderInitiativeLeft(task);
  if (rightEl) renderInitiativeRight(rightEl, task);

  // Wire click-to-edit on every element marked data-editable. Done
  // after innerHTML so handlers attach to fresh elements; safe to call
  // multiple times because attachInlineEditors guards against
  // double-binding via a marker class.
  attachInlineEditors(initiativeViewEl);
  attachReferenceHandlers(initiativeViewEl);
  attachDateInputs(initiativeViewEl);
}

function renderInitiativeLeft(task) {
  const statusLabel = STATUS_LABELS[task.status] || task.status;
  const statusClass = `status-${(task.status || 'pending').replace('_', '-')}`;
  const priority = task.priority || 'medium';

  // Sections are always shown so the user can fill them in inline —
  // an empty placeholder is more inviting than a missing section.
  const editableSections = [
    { label: 'Description', field: 'description', text: task.description, placeholder: 'Describe the initiative…' },
    { label: 'Acceptance criteria', field: 'acceptanceCriteria', text: task.acceptanceCriteria, placeholder: 'When is this done?' },
    { label: 'Notes', field: 'notes', text: task.notes, placeholder: 'Add notes, links, decisions…' }
  ];
  const readOnlySections = [];
  if (task.userRequest) readOnlySections.push({ label: 'Original request', text: task.userRequest });
  if (task.context) readOnlySections.push({ label: 'Context', text: task.context });

  return `
    <div class="tasks-initiative-meta">
      <button type="button" class="tasks-initiative-status ${statusClass}" data-status-cycle="1" data-task-id="${escapeHtml(task.id)}" title="Click to cycle status">${statusLabel}</button>
      <button type="button" class="tasks-initiative-priority priority-${priority}" data-priority-cycle="1" data-task-id="${escapeHtml(task.id)}" title="Click to cycle priority">${priority.toUpperCase()}</button>
      ${task.category ? `<span class="tasks-initiative-category">${escapeHtml(task.category)}</span>` : ''}
    </div>
    ${editableSections.map(s => `
      <div class="tasks-initiative-section">
        <h4>${s.label}</h4>
        <p data-editable="1" data-task-id="${escapeHtml(task.id)}" data-field="${s.field}" data-multiline="1" data-placeholder="${escapeHtml(s.placeholder)}">${s.text ? escapeHtml(s.text) : `<span class="tasks-initiative-placeholder">${escapeHtml(s.placeholder)}</span>`}</p>
      </div>
    `).join('')}
    ${renderScheduleSection(task)}
    ${renderReferencesSection(task)}
    ${readOnlySections.map(s => `
      <div class="tasks-initiative-section tasks-initiative-section-readonly">
        <h4>${s.label}</h4>
        <p>${escapeHtml(s.text)}</p>
      </div>
    `).join('')}
    <div class="tasks-initiative-footer">
      <span>#${escapeHtml(task.id)}</span>
      ${task.startDate ? `<span>Starts ${escapeHtml(task.startDate)}</span>` : ''}
      ${task.endDate ? `<span class="${isOverdue(task) ? 'overdue' : ''}">${isOverdue(task) ? 'Overdue' : 'Due'} ${escapeHtml(task.endDate)}</span>` : ''}
      ${task.createdAt ? `<span>Created ${formatDate(task.createdAt)}</span>` : ''}
      ${task.updatedAt && task.updatedAt !== task.createdAt ? `<span>Updated ${formatDate(task.updatedAt)}</span>` : ''}
      ${task.completedAt ? `<span>Completed ${formatDate(task.completedAt)}</span>` : ''}
    </div>
  `;
}

function renderInitiativeRight(rightEl, task) {
  const children = tasks.filter(t => t.parentId === task.id);
  rightEl.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'tasks-initiative-right-header';
  const completed = children.filter(c => c.status === 'completed').length;
  header.innerHTML = `
    <h3>Subtasks</h3>
    <span class="tasks-initiative-right-count">${completed}/${children.length}</span>
  `;
  rightEl.appendChild(header);

  if (children.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'tasks-initiative-empty';
    empty.textContent = 'No subtasks yet. Use "Add subtask" above to break this initiative down.';
    rightEl.appendChild(empty);
    return;
  }

  for (const child of children) {
    rightEl.appendChild(renderInitiativeSubtaskCard(child));
  }
}

function renderInitiativeSubtaskCard(child) {
  const card = document.createElement('article');
  const statusClass = `status-${(child.status || 'pending').replace('_', '-')}`;
  card.className = `tasks-initiative-subcard ${statusClass}`;
  card.dataset.taskId = child.id;

  const statusLabel = STATUS_LABELS[child.status] || child.status;
  const priority = child.priority || 'medium';
  const descPlaceholder = 'Describe this subtask…';
  const critPlaceholder = 'When is this done?';
  const notesPlaceholder = 'Notes, links, references…';

  card.innerHTML = `
    <div class="tasks-initiative-subcard-head">
      <button type="button" class="tasks-initiative-subcard-status ${statusClass}" data-status-cycle="1" data-task-id="${escapeHtml(child.id)}" title="Click to cycle status">${statusLabel}</button>
      <h4 class="tasks-initiative-subcard-title" data-editable="1" data-task-id="${escapeHtml(child.id)}" data-field="title" data-multiline="0" data-placeholder="Untitled"></h4>
      <div class="tasks-initiative-subcard-actions">
        ${child.status !== 'completed' ? `
          <button class="tasks-initiative-subcard-btn" data-action="complete" title="Mark complete">✓</button>
          ${child.status === 'pending' ? `<button class="tasks-initiative-subcard-btn" data-action="run" title="Run subtask">▶</button>` : ''}
        ` : `
          <button class="tasks-initiative-subcard-btn" data-action="reopen" title="Reopen">↺</button>
        `}
        <button class="tasks-initiative-subcard-btn" data-action="delete" title="Delete subtask">✕</button>
      </div>
    </div>
    <div class="tasks-initiative-subcard-meta">
      <button type="button" class="tasks-initiative-subcard-priority priority-${priority}" data-priority-cycle="1" data-task-id="${escapeHtml(child.id)}" title="Click to cycle priority">${priority.toUpperCase()}</button>
      ${child.category ? `<span class="tasks-initiative-subcard-category">${escapeHtml(child.category)}</span>` : ''}
      ${child.endDate ? `<span class="tasks-initiative-subcard-due${isOverdue(child) ? ' overdue' : ''}" title="${isOverdue(child) ? 'Overdue · due ' : 'Due '}${escapeHtml(child.endDate)}">${escapeHtml(formatDueShort(child.endDate))}</span>` : ''}
    </div>
    <p class="tasks-initiative-subcard-desc" data-editable="1" data-task-id="${escapeHtml(child.id)}" data-field="description" data-multiline="1" data-placeholder="${escapeHtml(descPlaceholder)}">${
      child.description
        ? escapeHtml(child.description)
        : `<span class="tasks-initiative-placeholder">${escapeHtml(descPlaceholder)}</span>`
    }</p>
    <details class="tasks-initiative-subcard-details" ${child.acceptanceCriteria ? 'open' : ''}>
      <summary>Acceptance criteria</summary>
      <p data-editable="1" data-task-id="${escapeHtml(child.id)}" data-field="acceptanceCriteria" data-multiline="1" data-placeholder="${escapeHtml(critPlaceholder)}">${
        child.acceptanceCriteria
          ? escapeHtml(child.acceptanceCriteria)
          : `<span class="tasks-initiative-placeholder">${escapeHtml(critPlaceholder)}</span>`
      }</p>
    </details>
    <details class="tasks-initiative-subcard-details" ${child.notes ? 'open' : ''}>
      <summary>Notes</summary>
      <p data-editable="1" data-task-id="${escapeHtml(child.id)}" data-field="notes" data-multiline="1" data-placeholder="${escapeHtml(notesPlaceholder)}">${
        child.notes
          ? escapeHtml(child.notes)
          : `<span class="tasks-initiative-placeholder">${escapeHtml(notesPlaceholder)}</span>`
      }</p>
    </details>
    <details class="tasks-initiative-subcard-details" ${(child.references && child.references.length) ? 'open' : ''}>
      <summary>References${child.references && child.references.length ? ` <span class="tasks-initiative-references-count">${child.references.length}</span>` : ''}</summary>
      ${renderReferencesSection(child, { compact: true })}
    </details>
  `;
  card.querySelector('.tasks-initiative-subcard-title').textContent = child.title || 'Untitled';

  card.querySelectorAll('.tasks-initiative-subcard-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      handleInitiativeSubtaskAction(child, action);
    });
  });

  return card;
}

function handleInitiativeSubtaskAction(child, action) {
  const projectPath = state.getProjectPath();
  if (!projectPath) return;
  if (action === 'run') {
    runTaskById(child.id);
    return;
  }
  if (action === 'delete') {
    require('./taskConfirmModal').open({
      title: child.title,
      onConfirm: () => {
        ipcRenderer.send(IPC.DELETE_TASK, { projectPath, taskId: child.id });
      }
    });
    return;
  }
  if (action === 'complete' || action === 'reopen') {
    const newStatus = action === 'complete' ? 'completed' : 'pending';
    ipcRenderer.send(IPC.UPDATE_TASK, {
      projectPath,
      taskId: child.id,
      updates: { status: newStatus }
    });
  }
}

/* -------------------- Inline editors (initiative view) -------------------- */

const STATUS_CYCLE = ['pending', 'in_progress', 'completed'];
const PRIORITY_CYCLE = ['low', 'medium', 'high'];

/**
 * Walk the initiative view container and wire click-to-edit on every
 * element flagged with `data-editable="1"`. Uses a marker class to
 * avoid double-binding — safe to call after every renderInitiativeView.
 * Also handles the status / priority cycle buttons in the same pass.
 */
function attachInlineEditors(root) {
  if (!root) return;

  root.querySelectorAll('[data-editable="1"]').forEach(el => {
    if (el.classList.contains('inline-bound')) return;
    el.classList.add('inline-bound', 'tasks-initiative-editable');
    el.title = el.dataset.multiline === '1'
      ? 'Click to edit · Cmd+Enter saves · Esc cancels'
      : 'Click to edit · Enter saves · Esc cancels';
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      startInlineEdit(el);
    });
  });

  root.querySelectorAll('[data-status-cycle="1"]').forEach(el => {
    if (el.classList.contains('cycle-bound')) return;
    el.classList.add('cycle-bound');
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      cycleField(el.dataset.taskId, 'status', STATUS_CYCLE);
    });
  });

  root.querySelectorAll('[data-priority-cycle="1"]').forEach(el => {
    if (el.classList.contains('cycle-bound')) return;
    el.classList.add('cycle-bound');
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      cycleField(el.dataset.taskId, 'priority', PRIORITY_CYCLE);
    });
  });
}

function cycleField(taskId, field, cycle) {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;
  const projectPath = state.getProjectPath();
  if (!projectPath) return;
  const current = task[field] || cycle[0];
  const idx = cycle.indexOf(current);
  const next = cycle[(idx + 1) % cycle.length];
  const updates = { [field]: next };
  // Side-effect that the rest of the codebase relies on: setting a
  // task to completed also stamps completedAt; un-completing should
  // clear it. tasksManager already does this for the status field, so
  // we just send the new status.
  ipcRenderer.send(IPC.UPDATE_TASK, {
    projectPath,
    taskId,
    updates
  });
}

/**
 * Swap a rendered text element for a matching input/textarea so the
 * user can edit in place. Saves on blur (single-line) or Cmd+Enter
 * (multi-line). Esc cancels and restores the original element.
 *
 * The original element is hidden rather than removed so we can restore
 * it on cancel without re-rendering the whole view (which would lose
 * scroll position and collapsed `<details>` state on neighbours).
 */
function startInlineEdit(el) {
  if (el.dataset.editing === '1') return;
  el.dataset.editing = '1';
  inlineEditorActive = true;

  const taskId = el.dataset.taskId;
  const field = el.dataset.field;
  const multiline = el.dataset.multiline === '1';
  const placeholder = el.dataset.placeholder || '';
  const task = tasks.find(t => t.id === taskId);
  const original = (task && task[field]) || '';

  const editor = multiline
    ? document.createElement('textarea')
    : document.createElement('input');
  if (!multiline) editor.type = 'text';
  editor.value = original;
  editor.placeholder = placeholder;
  editor.className = 'tasks-initiative-inline-editor'
    + (multiline ? ' multiline' : '')
    + (field === 'title' ? ' title' : '');
  if (multiline) {
    editor.rows = Math.min(10, Math.max(3, (original.match(/\n/g) || []).length + 2));
  }

  el.style.display = 'none';
  el.parentNode.insertBefore(editor, el.nextSibling);

  requestAnimationFrame(() => {
    editor.focus();
    if (!multiline) editor.select();
  });

  let committed = false;
  const finish = (save) => {
    if (committed) return;
    committed = true;
    const newValue = editor.value;
    editor.remove();
    el.style.display = '';
    delete el.dataset.editing;
    inlineEditorActive = false;

    if (save && newValue !== original) {
      const projectPath = state.getProjectPath();
      if (projectPath && taskId) {
        ipcRenderer.send(IPC.UPDATE_TASK, {
          projectPath,
          taskId,
          updates: { [field]: newValue }
        });
        // Optimistic: paint the new value immediately so there's no
        // visible flash before the TASKS_DATA round-trip lands. The
        // subsequent renderInitiativeView (triggered by the
        // round-trip) will reconcile.
        if (newValue) {
          el.textContent = newValue;
        } else {
          el.innerHTML = `<span class="tasks-initiative-placeholder">${escapeHtml(placeholder)}</span>`;
        }
      }
    }
  };

  editor.addEventListener('blur', () => finish(true));
  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
    } else if (e.key === 'Enter') {
      if (!multiline) {
        e.preventDefault();
        finish(true);
      } else if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        finish(true);
      }
    }
  });
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* -------------------- Schedule (start / due dates) -------------------- */

function renderScheduleSection(task) {
  const taskIdEsc = escapeHtml(task.id);
  const start = task.startDate || '';
  const end = task.endDate || '';
  const overdueClass = isOverdue(task) ? ' overdue' : '';
  return `
    <div class="tasks-initiative-section tasks-initiative-schedule-section">
      <h4>Schedule</h4>
      <div class="tasks-initiative-schedule-row">
        <label class="tasks-initiative-schedule-field">
          <span>Start</span>
          <input type="date" data-date-field="startDate" data-task-id="${taskIdEsc}" value="${escapeHtml(start)}">
        </label>
        <label class="tasks-initiative-schedule-field${overdueClass}">
          <span>Due</span>
          <input type="date" data-date-field="endDate" data-task-id="${taskIdEsc}" value="${escapeHtml(end)}">
        </label>
      </div>
    </div>
  `;
}

function attachDateInputs(root) {
  if (!root) return;
  root.querySelectorAll('input[type="date"][data-date-field]').forEach(input => {
    if (input.classList.contains('date-bound')) return;
    input.classList.add('date-bound');
    input.addEventListener('change', () => {
      const taskId = input.dataset.taskId;
      const field = input.dataset.dateField;
      const projectPath = state.getProjectPath();
      if (!projectPath || !taskId || !field) return;
      ipcRenderer.send(IPC.UPDATE_TASK, {
        projectPath,
        taskId,
        updates: { [field]: input.value || null }
      });
    });
  });
}

function isOverdue(task) {
  if (!task || !task.endDate) return false;
  if (task.status === 'completed') return false;
  const today = todayYMD();
  return task.endDate < today;
}

function todayYMD() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDueShort(ymd) {
  if (!ymd) return '';
  const today = todayYMD();
  if (ymd === today) return 'Due today';
  // Parse as local-midnight to avoid TZ drift on diff math
  const [y, m, d] = ymd.split('-').map(Number);
  const target = new Date(y, (m || 1) - 1, d || 1);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const diffDays = Math.round((target - now) / (1000 * 60 * 60 * 24));
  if (diffDays === 1) return 'Due tomorrow';
  if (diffDays === -1) return '1d overdue';
  if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`;
  if (diffDays < 7) return `Due in ${diffDays}d`;
  return `Due ${target.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

/* -------------------- Task references (lemo-4) -------------------- */

/**
 * HTML for the References section. Lives inline below the task's
 * editable sections (left pane) and inside an expandable <details> on
 * each subtask card. References are pointers, not copies — clicking
 * opens via shell.openPath (files / folders) or shell.openExternal (URLs).
 */
function renderReferencesSection(task, opts = {}) {
  const refs = Array.isArray(task.references) ? task.references : [];
  const compact = !!opts.compact;
  const sectionTag = compact ? 'div' : 'div';
  const sectionClass = compact
    ? 'tasks-initiative-references-section compact'
    : 'tasks-initiative-section tasks-initiative-references-section';
  const taskIdEsc = escapeHtml(task.id);

  const heading = compact
    ? ''
    : `<h4><span>References</span>${refs.length ? `<span class="tasks-initiative-references-count">${refs.length}</span>` : ''}</h4>`;

  return `
    <${sectionTag} class="${sectionClass}" data-task-id="${taskIdEsc}">
      ${heading}
      <div class="tasks-initiative-references-list">
        ${refs.length === 0
          ? '<div class="tasks-initiative-references-empty">No references yet — add specs, screenshots, Loom links.</div>'
          : refs.map((ref, i) => renderReferenceRow(task.id, ref, i)).join('')}
      </div>
      <div class="tasks-initiative-references-actions">
        <button type="button" class="tasks-initiative-references-add" data-ref-action="add-file" data-task-id="${taskIdEsc}">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          Add file
        </button>
        <button type="button" class="tasks-initiative-references-add" data-ref-action="add-url" data-task-id="${taskIdEsc}">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
          Add URL
        </button>
      </div>
      <div class="tasks-initiative-references-url-input" data-task-id="${taskIdEsc}" hidden>
        <input type="url" placeholder="https://..." spellcheck="false" />
        <button type="button" data-ref-action="commit-url" data-task-id="${taskIdEsc}">Add</button>
        <button type="button" data-ref-action="cancel-url" data-task-id="${taskIdEsc}">Cancel</button>
      </div>
    </${sectionTag}>
  `;
}

function renderReferenceRow(taskId, ref, index) {
  const kind = ref.kind === 'url' ? 'url' : 'file';
  const label = ref.label || prettyRefLabel(ref);
  const iconSvg = kind === 'url'
    ? '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>'
    : '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
  return `
    <div class="tasks-initiative-reference" data-task-id="${escapeHtml(taskId)}" data-ref-index="${index}" data-ref-kind="${kind}" data-ref-value="${escapeHtml(ref.value)}">
      <span class="tasks-initiative-reference-icon">${iconSvg}</span>
      <button type="button" class="tasks-initiative-reference-open" data-ref-action="open" data-task-id="${escapeHtml(taskId)}" title="${escapeHtml(ref.value)}">
        ${escapeHtml(label)}
      </button>
      <button type="button" class="tasks-initiative-reference-remove" data-ref-action="remove" data-task-id="${escapeHtml(taskId)}" title="Remove">✕</button>
    </div>
  `;
}

function prettyRefLabel(ref) {
  if (ref.kind === 'url') {
    try { return new URL(ref.value).hostname.replace(/^www\./, '') + new URL(ref.value).pathname.replace(/\/$/, ''); }
    catch { return ref.value; }
  }
  const parts = String(ref.value).split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] || ref.value;
}

function attachReferenceHandlers(root) {
  if (!root) return;
  root.querySelectorAll('[data-ref-action]').forEach(el => {
    if (el.classList.contains('ref-bound')) return;
    el.classList.add('ref-bound');
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = el.dataset.refAction;
      const taskId = el.dataset.taskId;
      if (!taskId) return;
      switch (action) {
        case 'add-file': return openFilePickerForTask(taskId);
        case 'add-url': return revealUrlInputForTask(taskId);
        case 'commit-url': return commitUrlForTask(taskId);
        case 'cancel-url': return hideUrlInputForTask(taskId);
        case 'open': {
          const row = el.closest('.tasks-initiative-reference');
          if (!row) return;
          return openReference({ kind: row.dataset.refKind, value: row.dataset.refValue });
        }
        case 'remove': {
          const row = el.closest('.tasks-initiative-reference');
          if (!row) return;
          return removeReferenceAt(taskId, parseInt(row.dataset.refIndex, 10));
        }
      }
    });
  });

  // Wire Enter / Esc on the URL inputs so the keyboard flow matches
  // the rest of the inline editors.
  root.querySelectorAll('.tasks-initiative-references-url-input input').forEach(input => {
    if (input.classList.contains('ref-bound')) return;
    input.classList.add('ref-bound');
    input.addEventListener('keydown', (e) => {
      const taskId = input.parentElement && input.parentElement.dataset.taskId;
      if (!taskId) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        commitUrlForTask(taskId);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        hideUrlInputForTask(taskId);
      }
    });
  });
}

async function openFilePickerForTask(taskId) {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;
  const projectPath = state.getProjectPath();
  let picked;
  try {
    picked = await ipcRenderer.invoke(IPC.PICK_REFERENCE_FILE, {
      defaultPath: projectPath || undefined
    });
  } catch (err) {
    console.warn('reference picker failed:', err);
    return;
  }
  if (!picked || picked.length === 0) return;
  const additions = picked.map(p => ({ kind: 'file', value: p }));
  saveReferences(taskId, [...(task.references || []), ...additions]);
}

function revealUrlInputForTask(taskId) {
  const wrapper = document.querySelector(
    `.tasks-initiative-references-url-input[data-task-id="${cssEscape(taskId)}"]`
  );
  if (!wrapper) return;
  wrapper.hidden = false;
  const input = wrapper.querySelector('input');
  if (input) {
    input.value = '';
    requestAnimationFrame(() => input.focus());
  }
}

function hideUrlInputForTask(taskId) {
  const wrapper = document.querySelector(
    `.tasks-initiative-references-url-input[data-task-id="${cssEscape(taskId)}"]`
  );
  if (!wrapper) return;
  wrapper.hidden = true;
  const input = wrapper.querySelector('input');
  if (input) input.value = '';
}

function commitUrlForTask(taskId) {
  const wrapper = document.querySelector(
    `.tasks-initiative-references-url-input[data-task-id="${cssEscape(taskId)}"]`
  );
  if (!wrapper) return;
  const input = wrapper.querySelector('input');
  const url = (input && input.value || '').trim();
  if (!url) {
    hideUrlInputForTask(taskId);
    return;
  }
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;
  saveReferences(taskId, [...(task.references || []), { kind: 'url', value: url }]);
  hideUrlInputForTask(taskId);
}

function removeReferenceAt(taskId, index) {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;
  const refs = (task.references || []).slice();
  if (index < 0 || index >= refs.length) return;
  refs.splice(index, 1);
  saveReferences(taskId, refs);
}

function saveReferences(taskId, references) {
  const projectPath = state.getProjectPath();
  if (!projectPath) return;
  ipcRenderer.send(IPC.UPDATE_TASK, {
    projectPath,
    taskId,
    updates: { references }
  });
}

function openReference(ref) {
  if (!ref || !ref.value) return;
  ipcRenderer.invoke(IPC.OPEN_REFERENCE, ref).then(result => {
    if (result && !result.ok) {
      console.warn('open-reference failed:', result.error);
    }
  }).catch(err => {
    console.warn('open-reference IPC failed:', err);
  });
}

/**
 * Attribute-selector-safe escape — task IDs contain hyphens and dots
 * (e.g. "lemo-4.2") which are valid in CSS selectors only when escaped.
 */
function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === 'function') {
    return window.CSS.escape(value);
  }
  return String(value).replace(/[!"#$%&'()*+,./:;<=>?@\[\\\]^`{|}~]/g, '\\$&');
}

function setupDropTargets() {
  for (const status of STATUS_COLUMNS) {
    const col = columnEls[status];
    if (!col) continue;

    col.addEventListener('dragover', (e) => {
      if (!dragSource) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      // Auto-scroll the column when the pointer is near the top or
      // bottom edge — fixes the "can't drop near top/bottom of a long
      // list" frustration without requiring keyboard shortcuts.
      maybeAutoScroll(col, e.clientY);
      const after = getCardAfterY(col, e.clientY);
      const dragging = document.querySelector('.tasks-dashboard-card.dragging');
      if (!dragging) return;
      if (after == null) {
        col.appendChild(dragging);
      } else {
        col.insertBefore(dragging, after);
      }
    });

    col.addEventListener('dragenter', (e) => {
      if (!dragSource) return;
      e.preventDefault();
      col.classList.add('drag-over');
    });

    col.addEventListener('dragleave', (e) => {
      // dragleave fires for child enters; only clear when leaving the column itself
      if (e.target === col) col.classList.remove('drag-over');
    });

    col.addEventListener('drop', (e) => {
      e.preventDefault();
      col.classList.remove('drag-over');
      if (!dragSource) return;
      commitOrder();
    });
  }
}

function onDragStart(e, task) {
  dragSource = task.id;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', task.id);
  // give the browser a tick before adding the dragging class so the drag image
  // captures the un-styled card (avoids a transparent ghost on some platforms)
  requestAnimationFrame(() => {
    const el = document.querySelector(`.tasks-dashboard-card[data-task-id="${task.id}"]`);
    if (el) el.classList.add('dragging');
  });
}

function onDragEnd() {
  dragSource = null;
  stopAutoScroll();
  document.querySelectorAll('.tasks-dashboard-card.dragging').forEach(el => {
    el.classList.remove('dragging');
  });
  document.querySelectorAll('.tasks-dashboard-cards.drag-over').forEach(el => {
    el.classList.remove('drag-over');
  });
}

/**
 * Auto-scroll a column while a drag is hovering near its top or bottom
 * edge. Speed scales with how deep into the edge zone the pointer is so
 * users get a smooth ramp-up — slow when nudging the boundary, fast when
 * pinned to the very edge. Runs on requestAnimationFrame, cancelled on
 * dragend (or when the pointer leaves the edge zone).
 */
const AUTO_SCROLL_EDGE = 60;   // px from edge where auto-scroll engages
const AUTO_SCROLL_MAX_PX = 18; // max px per frame
function maybeAutoScroll(col, clientY) {
  const rect = col.getBoundingClientRect();
  let delta = 0;
  if (clientY < rect.top + AUTO_SCROLL_EDGE) {
    const intensity = 1 - (clientY - rect.top) / AUTO_SCROLL_EDGE;
    delta = -Math.max(2, Math.round(AUTO_SCROLL_MAX_PX * intensity));
  } else if (clientY > rect.bottom - AUTO_SCROLL_EDGE) {
    const intensity = 1 - (rect.bottom - clientY) / AUTO_SCROLL_EDGE;
    delta = Math.max(2, Math.round(AUTO_SCROLL_MAX_PX * intensity));
  } else {
    stopAutoScroll();
    return;
  }
  startAutoScroll(col, delta);
}

function startAutoScroll(col, delta) {
  stopAutoScroll();
  const step = () => {
    col.scrollTop += delta;
    autoScrollFrame = requestAnimationFrame(step);
  };
  autoScrollFrame = requestAnimationFrame(step);
}

function stopAutoScroll() {
  if (autoScrollFrame != null) {
    cancelAnimationFrame(autoScrollFrame);
    autoScrollFrame = null;
  }
}

/**
 * Find the card the dragged item should be inserted *before*, based on
 * vertical midpoint. Returns null when the drop should land at the end.
 */
function getCardAfterY(container, y) {
  const cards = Array.from(
    container.querySelectorAll('.tasks-dashboard-card:not(.dragging):not(.filtered-out)')
  );
  for (const card of cards) {
    const box = card.getBoundingClientRect();
    if (y < box.top + box.height / 2) return card;
  }
  return null;
}

/**
 * Read the current DOM order across all three columns and send the new order
 * (with each task's column → status) to the main process. The main process
 * rewrites tasks.json and pushes a fresh TASKS_DATA, which re-renders the UI.
 */
function commitOrder() {
  const projectPath = state.getProjectPath();
  if (!projectPath) return;

  const order = [];
  for (const status of STATUS_COLUMNS) {
    const col = columnEls[status];
    if (!col) continue;
    col.querySelectorAll('.tasks-dashboard-card').forEach(card => {
      order.push({ id: card.dataset.taskId, status });
    });
  }

  ipcRenderer.send(IPC.REORDER_TASKS, { projectPath, order });
}

function selectTask(taskId) {
  selectedTaskId = taskId;
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;
  // Selecting a card always exits form mode — the aside has one job at a time.
  if (isFormOpen()) hideForm();
  document.querySelectorAll('.tasks-dashboard-card.selected').forEach(el => {
    el.classList.remove('selected');
  });
  const card = document.querySelector(`.tasks-dashboard-card[data-task-id="${taskId}"]`);
  if (card) card.classList.add('selected');
  renderDetail(task);
}

function clearSelection() {
  selectedTaskId = null;
  document.querySelectorAll('.tasks-dashboard-card.selected').forEach(el => {
    el.classList.remove('selected');
  });
  if (isFormOpen()) return; // keep showing the form if it's open
  if (detailEmptyEl) detailEmptyEl.style.display = '';
  if (detailContentEl) detailContentEl.style.display = 'none';
}

/* ---------- Inline form (right aside) ---------- */

function isFormOpen() {
  return !!(detailFormEl && detailFormEl.style.display !== 'none');
}

function setupForm() {
  if (!detailFormEl) return;

  detailFormEl.querySelector('.tasks-dashboard-form-close')
    .addEventListener('click', () => hideForm());
  detailFormEl.querySelector('.tasks-dashboard-form-cancel')
    .addEventListener('click', () => hideForm());

  detailFormEl.addEventListener('submit', (e) => {
    e.preventDefault();
    submitForm();
  });
}

function showForm() {
  if (!detailFormEl) return;
  // Form replaces both the empty state and the detail view in the aside.
  if (detailEmptyEl) detailEmptyEl.style.display = 'none';
  if (detailContentEl) detailContentEl.style.display = 'none';
  detailFormEl.style.display = '';
  detailFormEl.reset();
  // Default the priority/category since reset puts the first option
  detailFormEl.querySelector('#tasks-dashboard-form-priority').value = 'medium';
  detailFormEl.querySelector('#tasks-dashboard-form-category').value = 'feature';
  requestAnimationFrame(() => {
    detailFormEl.querySelector('#tasks-dashboard-form-title')?.focus();
  });
}

function hideForm() {
  if (!detailFormEl) return;
  detailFormEl.style.display = 'none';
  // Restore the previous aside state: detail view if a card is selected,
  // otherwise the empty/add state.
  if (selectedTaskId) {
    const task = tasks.find(t => t.id === selectedTaskId);
    if (task) {
      renderDetail(task);
      return;
    }
  }
  if (detailEmptyEl) detailEmptyEl.style.display = '';
  if (detailContentEl) detailContentEl.style.display = 'none';
}

function requestDeleteSelected() {
  if (!selectedTaskId) return;
  const projectPath = state.getProjectPath();
  if (!projectPath) return;
  const task = tasks.find(t => t.id === selectedTaskId);
  const confirmModal = require('./taskConfirmModal');
  const idToDelete = selectedTaskId;
  confirmModal.open({
    title: task ? task.title : null,
    onConfirm: () => {
      ipcRenderer.send(IPC.DELETE_TASK, { projectPath, taskId: idToDelete });
      // Clear local selection right away — the next TASKS_DATA push will
      // refresh the columns and the aside falls back to the empty/add state.
      if (selectedTaskId === idToDelete) clearSelection();
    }
  });
}

function submitForm() {
  const projectPath = state.getProjectPath();
  if (!projectPath || !detailFormEl) return;

  const title = detailFormEl.querySelector('#tasks-dashboard-form-title').value.trim();
  if (!title) return;

  const task = {
    title,
    description: detailFormEl.querySelector('#tasks-dashboard-form-description').value.trim(),
    priority: detailFormEl.querySelector('#tasks-dashboard-form-priority').value,
    category: detailFormEl.querySelector('#tasks-dashboard-form-category').value,
    startDate: detailFormEl.querySelector('#tasks-dashboard-form-start-date').value || null,
    endDate: detailFormEl.querySelector('#tasks-dashboard-form-end-date').value || null
  };

  ipcRenderer.send(IPC.ADD_TASK, { projectPath, task });
  hideForm();
}

function renderDetail(task) {
  if (!detailEl || !task) return;

  detailEmptyEl.style.display = 'none';
  detailContentEl.style.display = '';

  const pill = detailContentEl.querySelector('.tasks-dashboard-detail-status-pill');
  pill.textContent = STATUS_LABELS[task.status] || task.status;
  pill.className = `tasks-dashboard-detail-status-pill status-${(task.status || 'pending').replace('_', '-')}`;

  // Parent reference: if this task is a subtask, render a clickable
  // crumb up to the initiative. Clicking selects the parent task —
  // same as if the user had clicked the parent's card directly.
  const parentEl = detailContentEl.querySelector('.tasks-dashboard-detail-parent');
  const parentLink = detailContentEl.querySelector('.tasks-dashboard-detail-parent-link');
  if (parentEl && parentLink) {
    if (task.parentId) {
      const parent = tasks.find(t => t.id === task.parentId);
      if (parent) {
        parentLink.textContent = parent.title || 'Untitled';
        // Clone-replace to clear stale listeners from a previous render.
        const fresh = parentLink.cloneNode(true);
        parentLink.parentNode.replaceChild(fresh, parentLink);
        fresh.addEventListener('click', (e) => {
          e.stopPropagation();
          selectTask(parent.id);
        });
        parentEl.style.display = '';
      } else {
        parentEl.style.display = 'none';
      }
    } else {
      parentEl.style.display = 'none';
    }
  }

  detailContentEl.querySelector('.tasks-dashboard-detail-title').textContent = task.title || 'Untitled';

  const meta = detailContentEl.querySelector('.tasks-dashboard-detail-meta');
  meta.innerHTML = '';
  appendMetaPill(meta, `Priority: ${task.priority || 'medium'}`, `priority-${task.priority || 'medium'}`);
  if (task.category) appendMetaPill(meta, task.category, 'category');

  setSection(
    detailContentEl.querySelector('.tasks-dashboard-detail-description'),
    null,
    task.description || 'No description provided.'
  );

  setSection(
    detailContentEl.querySelector('.tasks-dashboard-detail-userrequest-text'),
    detailContentEl.querySelector('.tasks-dashboard-detail-userrequest'),
    task.userRequest
  );
  setSection(
    detailContentEl.querySelector('.tasks-dashboard-detail-criteria-text'),
    detailContentEl.querySelector('.tasks-dashboard-detail-criteria'),
    task.acceptanceCriteria
  );
  setSection(
    detailContentEl.querySelector('.tasks-dashboard-detail-notes-text'),
    detailContentEl.querySelector('.tasks-dashboard-detail-notes'),
    task.notes
  );
  setSection(
    detailContentEl.querySelector('.tasks-dashboard-detail-context-text'),
    detailContentEl.querySelector('.tasks-dashboard-detail-context'),
    task.context
  );

  // Subtasks section — only render if this task is a parent. Each row
  // is clickable to drill into the child; the status dot mirrors the
  // child's current status so the user can see initiative progress at
  // a glance without leaving the detail aside.
  const subtasksSection = detailContentEl.querySelector('.tasks-dashboard-detail-subtasks');
  const subtasksList = detailContentEl.querySelector('.tasks-dashboard-detail-subtasks-list');
  const subtasksCount = detailContentEl.querySelector('.tasks-dashboard-detail-subtasks-count');
  if (subtasksSection && subtasksList) {
    const children = tasks.filter(t => t.parentId === task.id);
    if (children.length === 0) {
      subtasksSection.style.display = 'none';
    } else {
      subtasksSection.style.display = '';
      const completed = children.filter(c => c.status === 'completed').length;
      if (subtasksCount) {
        subtasksCount.textContent = ` (${completed}/${children.length})`;
      }
      subtasksList.innerHTML = '';
      for (const child of children) {
        const row = document.createElement('div');
        row.className = `tasks-dashboard-detail-subtask status-${(child.status || 'pending').replace('_', '-')}`;
        row.dataset.taskId = child.id;
        const completedCls = child.status === 'completed' ? ' completed' : '';
        row.innerHTML = `
          <span class="tasks-dashboard-detail-subtask-dot status-${(child.status || 'pending').replace('_', '-')}"></span>
          <span class="tasks-dashboard-detail-subtask-title${completedCls}"></span>
          <button class="tasks-dashboard-detail-subtask-run" title="Run subtask" tabindex="-1">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
          </button>
        `;
        // Set title via textContent so untrusted task data can't inject markup.
        row.querySelector('.tasks-dashboard-detail-subtask-title').textContent = child.title || 'Untitled';
        row.addEventListener('click', () => selectTask(child.id));
        const childRunBtn = row.querySelector('.tasks-dashboard-detail-subtask-run');
        if (child.status !== 'completed' && childRunBtn) {
          childRunBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            runTaskById(child.id);
          });
        } else if (childRunBtn) {
          childRunBtn.style.display = 'none';
        }
        subtasksList.appendChild(row);
      }
    }
  }

  detailContentEl.querySelector('.tasks-dashboard-detail-id').textContent = `#${task.id}`;
  const dates = [];
  if (task.startDate) dates.push(`Starts ${task.startDate}`);
  if (task.endDate) dates.push(`${isOverdue(task) ? 'Overdue' : 'Due'} ${task.endDate}`);
  if (task.createdAt) dates.push(`Created ${formatDate(task.createdAt)}`);
  if (task.updatedAt && task.updatedAt !== task.createdAt) dates.push(`Updated ${formatDate(task.updatedAt)}`);
  if (task.completedAt) dates.push(`Completed ${formatDate(task.completedAt)}`);
  const datesEl = detailContentEl.querySelector('.tasks-dashboard-detail-dates');
  datesEl.textContent = dates.join(' · ');
  datesEl.classList.toggle('overdue', isOverdue(task));
}

function appendMetaPill(container, text, cls) {
  const span = document.createElement('span');
  span.className = `tasks-dashboard-detail-meta-pill ${cls || ''}`.trim();
  span.textContent = text;
  container.appendChild(span);
}

function setSection(textEl, sectionEl, value) {
  if (!textEl) return;
  if (value == null || value === '') {
    textEl.textContent = '';
    if (sectionEl) sectionEl.style.display = 'none';
    return;
  }
  textEl.textContent = value;
  if (sectionEl) sectionEl.style.display = '';
}

function formatDate(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/* ---------- Filter (dashboard-only) ---------- */

function isFilterActive() {
  return filters.categories.size > 0 || filters.priorities.size > 0;
}

function filterMatches(task) {
  if (filters.categories.size > 0 && !filters.categories.has(task.category)) return false;
  if (filters.priorities.size > 0 && !filters.priorities.has(task.priority)) return false;
  return true;
}

function setupFilter() {
  filterBtnEl = document.getElementById('tasks-dashboard-filter-btn');
  filterPopoverEl = document.getElementById('tasks-dashboard-filter-popover');
  filterBadgeEl = document.getElementById('tasks-dashboard-filter-badge');
  if (!filterBtnEl || !filterPopoverEl) return;

  filterBtnEl.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFilterPopover();
  });

  filterPopoverEl.addEventListener('click', (e) => e.stopPropagation());

  filterPopoverEl.querySelectorAll('input[type="checkbox"][data-filter-dim]').forEach(input => {
    input.addEventListener('change', () => {
      const dim = input.dataset.filterDim;
      const value = input.value;
      const set = filters[dim];
      if (!set) return;
      if (input.checked) set.add(value); else set.delete(value);
      updateFilterUI();
      render();
    });
  });

  const clearBtn = document.getElementById('tasks-dashboard-filter-clear');
  if (clearBtn) clearBtn.addEventListener('click', clearFilters);

  // Outside-click closes the popover (only while it's open and dashboard
  // is visible).
  document.addEventListener('click', (e) => {
    if (!isFilterPopoverOpen()) return;
    if (filterPopoverEl.contains(e.target)) return;
    if (filterBtnEl.contains(e.target)) return;
    closeFilterPopover();
  });
}

function isFilterPopoverOpen() {
  return filterPopoverEl && !filterPopoverEl.hasAttribute('hidden');
}

function toggleFilterPopover() {
  // Only one popover open at a time
  if (isSortPopoverOpen()) closeSortPopover();
  if (isFilterPopoverOpen()) closeFilterPopover(); else openFilterPopover();
}

function openFilterPopover() {
  if (!filterPopoverEl || !filterBtnEl) return;
  filterPopoverEl.removeAttribute('hidden');
  filterBtnEl.classList.add('active');
}

function closeFilterPopover() {
  if (!filterPopoverEl || !filterBtnEl) return;
  filterPopoverEl.setAttribute('hidden', '');
  filterBtnEl.classList.remove('active');
}

function clearFilters() {
  filters.categories.clear();
  filters.priorities.clear();
  if (filterPopoverEl) {
    filterPopoverEl.querySelectorAll('input[type="checkbox"][data-filter-dim]').forEach(input => {
      input.checked = false;
    });
  }
  updateFilterUI();
  render();
}

function updateFilterUI() {
  if (!filterBtnEl) return;
  const count = filters.categories.size + filters.priorities.size;
  if (count > 0) {
    filterBtnEl.classList.add('has-filters');
    if (filterBadgeEl) {
      filterBadgeEl.textContent = String(count);
      filterBadgeEl.removeAttribute('hidden');
    }
  } else {
    filterBtnEl.classList.remove('has-filters');
    if (filterBadgeEl) filterBadgeEl.setAttribute('hidden', '');
  }
}

/* ---------- Sort ---------- */

function compareTasks(a, b) {
  if (sort.mode === 'priority') {
    const pa = PRIORITY_ORDER[a.priority] ?? 99;
    const pb = PRIORITY_ORDER[b.priority] ?? 99;
    if (pa !== pb) return pa - pb;
    // Stable tiebreaker — preserve file order for tasks with same priority
    return tasks.indexOf(a) - tasks.indexOf(b);
  }
  if (sort.mode === 'category') {
    const cmp = (a.category || '').localeCompare(b.category || '');
    if (cmp !== 0) return cmp;
    return tasks.indexOf(a) - tasks.indexOf(b);
  }
  return 0;
}

function setupSort() {
  sortBtnEl = document.getElementById('tasks-dashboard-sort-btn');
  sortPopoverEl = document.getElementById('tasks-dashboard-sort-popover');
  sortLabelEl = document.getElementById('tasks-dashboard-sort-label');
  if (!sortBtnEl || !sortPopoverEl) return;

  sortBtnEl.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSortPopover();
  });
  sortPopoverEl.addEventListener('click', (e) => e.stopPropagation());

  sortPopoverEl.querySelectorAll('input[name="tasks-dashboard-sort"]').forEach(input => {
    input.addEventListener('change', () => {
      if (!input.checked) return;
      sort.mode = input.dataset.sortMode || 'default';
      updateSortUI();
      render();
      // If the user already opted into "Apply to tasks.json", commit the new
      // order to disk immediately when they pick a different sort mode.
      if (sort.applyToFile) commitSortToFile();
    });
  });

  const applyToggle = document.getElementById('tasks-dashboard-sort-apply');
  if (applyToggle) {
    applyToggle.addEventListener('change', () => {
      sort.applyToFile = applyToggle.checked;
      updateSortUI();
      // Flipping the toggle on with an active sort persists the current view.
      if (sort.applyToFile && sort.mode !== 'default') commitSortToFile();
    });
  }

  const resetBtn = document.getElementById('tasks-dashboard-sort-reset');
  if (resetBtn) resetBtn.addEventListener('click', resetSort);

  document.addEventListener('click', (e) => {
    if (!isSortPopoverOpen()) return;
    if (sortPopoverEl.contains(e.target)) return;
    if (sortBtnEl.contains(e.target)) return;
    closeSortPopover();
  });
}

function isSortPopoverOpen() {
  return sortPopoverEl && !sortPopoverEl.hasAttribute('hidden');
}

function toggleSortPopover() {
  // Only one popover open at a time
  if (isFilterPopoverOpen()) closeFilterPopover();
  if (isSortPopoverOpen()) closeSortPopover(); else openSortPopover();
}

function openSortPopover() {
  if (!sortPopoverEl || !sortBtnEl) return;
  sortPopoverEl.removeAttribute('hidden');
  sortBtnEl.classList.add('active');
}

function closeSortPopover() {
  if (!sortPopoverEl || !sortBtnEl) return;
  sortPopoverEl.setAttribute('hidden', '');
  sortBtnEl.classList.remove('active');
}

function resetSort() {
  sort.mode = 'default';
  // Note: we deliberately don't flip `applyToFile` off — that's a user
  // preference about persistence, not a sort selection. Leaving it as-is
  // means a future sort pick will still respect the user's last choice.
  if (sortPopoverEl) {
    const def = sortPopoverEl.querySelector('input[data-sort-mode="default"]');
    if (def) def.checked = true;
  }
  updateSortUI();
  render();
}

function updateSortUI() {
  if (!sortBtnEl) return;
  const active = sort.mode !== 'default';
  sortBtnEl.classList.toggle('has-sort', active);
  if (sortLabelEl) {
    if (active) {
      sortLabelEl.textContent = sort.mode === 'priority' ? 'Priority' : 'Type';
      sortLabelEl.removeAttribute('hidden');
    } else {
      sortLabelEl.setAttribute('hidden', '');
    }
  }
  const applySub = document.getElementById('tasks-dashboard-sort-apply-sub');
  if (applySub) {
    applySub.textContent = sort.applyToFile
      ? 'On — saved to tasks.json'
      : 'Off — dashboard only';
  }
}

/**
 * Commit the current sorted view to tasks.json. Per-column sorted order is
 * concatenated in column order (pending → in_progress → completed) so the
 * resulting array is coherent. Backend's reorderTasks rewrites the file.
 */
function commitSortToFile() {
  const projectPath = state.getProjectPath();
  if (!projectPath) return;

  const buckets = { pending: [], in_progress: [], completed: [] };
  for (const task of tasks) {
    const status = STATUS_COLUMNS.includes(task.status) ? task.status : 'pending';
    buckets[status].push(task);
  }
  for (const status of STATUS_COLUMNS) {
    buckets[status].sort(compareTasks);
  }

  const order = [];
  for (const status of STATUS_COLUMNS) {
    for (const task of buckets[status]) {
      order.push({ id: task.id, status });
    }
  }

  ipcRenderer.send(IPC.REORDER_TASKS, { projectPath, order });
}

module.exports = {
  init,
  show,
  hide,
  toggle,
  isVisible: () => isVisible,
  // Exported so the sidebar can launch the initiative view directly,
  // without first showing the dashboard. The view is a fullscreen
  // overlay (position: fixed, z-index 9200) and doesn't need the
  // dashboard's structure to be visible.
  openInitiativeView
};
