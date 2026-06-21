/**
 * Global Dashboard — Task Detail & Add-Task
 *
 * Inline editing surface for a single task pulled from any tracked
 * project's snapshot. Routes mutations through the existing
 * tasksManager IPC, targeting the task's real project path, then asks
 * the global dashboard manager to refresh that single project's
 * snapshot so the UI reflects the change.
 *
 * Also owns the "+ Add task" modal for creating a new task assigned
 * to any tracked project.
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');

let asideEl = null;
let asideBodyEl = null;
let asideCloseEl = null;
let modalEl = null;
let modalCloseEl = null;
let modalCancelEl = null;
let modalConfirmEl = null;
let modalProjectEl = null;
let modalTitleEl = null;
let modalDescriptionEl = null;
let modalPriorityEl = null;
let modalCategoryEl = null;
let modalStartEl = null;
let modalDueEl = null;
let modalParentEl = null;

let context = { registry: { projects: {} }, openTaskId: null, openProjectPath: null };
let parentDataProvider = null; // function returning array of tasks for the active project
let initialized = false;

function init() {
  if (initialized) return;
  initialized = true;

  asideEl = document.getElementById('global-task-detail');
  asideBodyEl = document.getElementById('global-task-detail-body');
  asideCloseEl = document.getElementById('global-task-detail-close');

  modalEl = document.getElementById('global-task-add-modal');
  modalCloseEl = document.getElementById('global-task-add-close');
  modalCancelEl = document.getElementById('global-task-add-cancel');
  modalConfirmEl = document.getElementById('global-task-add-confirm');
  modalProjectEl = document.getElementById('global-task-add-project');
  modalTitleEl = document.getElementById('global-task-add-title');
  modalDescriptionEl = document.getElementById('global-task-add-description');
  modalPriorityEl = document.getElementById('global-task-add-priority');
  modalCategoryEl = document.getElementById('global-task-add-category');
  modalStartEl = document.getElementById('global-task-add-start');
  modalDueEl = document.getElementById('global-task-add-due');
  modalParentEl = document.getElementById('global-task-add-parent');

  if (asideCloseEl) asideCloseEl.addEventListener('click', closeDetail);
  if (modalCloseEl) modalCloseEl.addEventListener('click', closeAdd);
  if (modalCancelEl) modalCancelEl.addEventListener('click', closeAdd);
  if (modalConfirmEl) modalConfirmEl.addEventListener('click', commitAdd);
  if (modalEl) modalEl.addEventListener('click', (e) => {
    if (e.target === modalEl) closeAdd();
  });
  if (modalProjectEl) modalProjectEl.addEventListener('change', () => refreshParentOptions(modalProjectEl.value));

  ipcRenderer.on(IPC.GLOBAL_DASHBOARD_DATA, (event, data) => {
    if (!data || typeof data !== 'object') return;
    context.registry = data;
    // If a detail aside is open, repaint it with the fresh snapshot —
    // this is how the user sees their inline edits reflected.
    if (context.openTaskId && context.openProjectPath) {
      const task = findTaskInRegistry(context.openProjectPath, context.openTaskId);
      if (task) renderDetail(task, context.openProjectPath);
      else closeDetail();
    }
  });
}

function setRegistry(registry) {
  context.registry = registry || { projects: {} };
}

function setParentDataProvider(fn) {
  parentDataProvider = fn;
}

/* -------------------- Task detail aside -------------------- */

function openTaskDetail(task, projectPath) {
  if (!asideEl || !task || !projectPath) return;
  context.openTaskId = task.id;
  context.openProjectPath = projectPath;
  renderDetail(task, projectPath);
  asideEl.classList.add('visible');
}

function closeDetail() {
  if (asideEl) asideEl.classList.remove('visible');
  context.openTaskId = null;
  context.openProjectPath = null;
}

function findTaskInRegistry(projectPath, taskId) {
  const proj = context.registry.projects && context.registry.projects[projectPath];
  const tasks = (proj && proj.taskSnapshot && proj.taskSnapshot.tasks) || [];
  return tasks.find(t => t.id === taskId) || null;
}

function projectTasks(projectPath) {
  const proj = context.registry.projects && context.registry.projects[projectPath];
  return (proj && proj.taskSnapshot && proj.taskSnapshot.tasks) || [];
}

function renderDetail(task, projectPath) {
  if (!asideBodyEl) return;
  const projectName = (context.registry.projects[projectPath] || {}).name || projectPath;
  asideBodyEl.innerHTML = '';

  // Header: project + status + priority
  const header = document.createElement('div');
  header.className = 'global-task-detail-header';
  const project = document.createElement('span');
  project.className = 'global-task-detail-project';
  project.textContent = projectName;
  header.appendChild(project);
  header.appendChild(cyclePill('status', task, projectPath, ['pending', 'in_progress', 'completed']));
  header.appendChild(cyclePill('priority', task, projectPath, ['low', 'medium', 'high']));
  if (task.category) {
    const cat = document.createElement('span');
    cat.className = 'global-task-detail-category';
    cat.textContent = task.category;
    header.appendChild(cat);
  }
  asideBodyEl.appendChild(header);

  // Title (editable, single-line)
  asideBodyEl.appendChild(editableField({
    field: 'title',
    label: 'Title',
    value: task.title || '',
    placeholder: 'Untitled',
    multiline: false,
    task,
    projectPath
  }));

  // Description
  asideBodyEl.appendChild(editableField({
    field: 'description',
    label: 'Description',
    value: task.description || '',
    placeholder: 'Add a description…',
    multiline: true,
    task,
    projectPath
  }));

  // Acceptance criteria
  asideBodyEl.appendChild(editableField({
    field: 'acceptanceCriteria',
    label: 'Acceptance criteria',
    value: task.acceptanceCriteria || '',
    placeholder: 'When is this done?',
    multiline: true,
    task,
    projectPath
  }));

  // Notes
  asideBodyEl.appendChild(editableField({
    field: 'notes',
    label: 'Notes',
    value: task.notes || '',
    placeholder: 'Notes, decisions, links…',
    multiline: true,
    task,
    projectPath
  }));

  // Schedule (start / due dates)
  asideBodyEl.appendChild(scheduleField(task, projectPath));

  // Subtasks
  asideBodyEl.appendChild(subtasksSection(task, projectPath));

  // Parent breadcrumb (if subtask)
  if (task.parentId) {
    const parent = projectTasks(projectPath).find(t => t.id === task.parentId);
    if (parent) {
      const crumb = document.createElement('div');
      crumb.className = 'global-task-detail-parent-crumb';
      crumb.innerHTML = '<span class="label">Subtask of</span> ';
      const link = document.createElement('button');
      link.className = 'global-task-detail-parent-link';
      link.textContent = parent.title || parent.id;
      link.addEventListener('click', () => openTaskDetail(parent, projectPath));
      crumb.appendChild(link);
      asideBodyEl.appendChild(crumb);
    }
  }

  // Footer: actions
  const footer = document.createElement('div');
  footer.className = 'global-task-detail-footer';
  const openInProj = document.createElement('button');
  openInProj.className = 'global-task-detail-action';
  openInProj.textContent = 'Open in project context';
  openInProj.addEventListener('click', () => openInProjectContext(task, projectPath));
  footer.appendChild(openInProj);
  const del = document.createElement('button');
  del.className = 'global-task-detail-action danger';
  del.textContent = 'Delete';
  del.addEventListener('click', () => deleteTask(task, projectPath));
  footer.appendChild(del);
  asideBodyEl.appendChild(footer);
}

/* ---- Inline editing primitives ---- */

function editableField({ field, label, value, placeholder, multiline, task, projectPath }) {
  const wrap = document.createElement('div');
  wrap.className = 'global-task-detail-field';
  const lab = document.createElement('label');
  lab.className = 'global-task-detail-label';
  lab.textContent = label;
  wrap.appendChild(lab);
  const input = multiline ? document.createElement('textarea') : document.createElement('input');
  if (!multiline) input.type = 'text';
  input.className = `global-task-detail-input${multiline ? ' multiline' : ''}${field === 'title' ? ' title' : ''}`;
  input.value = value;
  input.placeholder = placeholder;
  input.addEventListener('blur', () => {
    if (input.value === value) return;
    sendUpdate(projectPath, task.id, { [field]: input.value });
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !multiline) {
      e.preventDefault();
      input.blur();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      input.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      input.value = value;
      input.blur();
    }
  });
  wrap.appendChild(input);
  return wrap;
}

function scheduleField(task, projectPath) {
  const wrap = document.createElement('div');
  wrap.className = 'global-task-detail-field';
  const lab = document.createElement('label');
  lab.className = 'global-task-detail-label';
  lab.textContent = 'Schedule';
  wrap.appendChild(lab);
  const row = document.createElement('div');
  row.className = 'global-task-detail-schedule';
  for (const fld of [{ key: 'startDate', label: 'Start' }, { key: 'endDate', label: 'Due' }]) {
    const lblWrap = document.createElement('label');
    lblWrap.className = 'global-task-detail-schedule-field';
    const small = document.createElement('span');
    small.textContent = fld.label;
    const input = document.createElement('input');
    input.type = 'date';
    input.value = task[fld.key] || '';
    input.addEventListener('change', () => {
      sendUpdate(projectPath, task.id, { [fld.key]: input.value || null });
    });
    lblWrap.appendChild(small);
    lblWrap.appendChild(input);
    row.appendChild(lblWrap);
  }
  wrap.appendChild(row);
  return wrap;
}

function cyclePill(field, task, projectPath, cycle) {
  const value = task[field] || cycle[0];
  const display = field === 'status'
    ? value.replace('_', ' ')
    : value.toUpperCase();
  const btn = document.createElement('button');
  btn.className = `global-task-detail-pill ${field}-${value.replace('_', '-')}`;
  btn.textContent = display;
  btn.title = `Click to cycle ${field}`;
  btn.addEventListener('click', () => {
    const next = cycle[(cycle.indexOf(value) + 1) % cycle.length];
    sendUpdate(projectPath, task.id, { [field]: next });
  });
  return btn;
}

/* ---- Subtasks section ---- */

function subtasksSection(parent, projectPath) {
  const wrap = document.createElement('div');
  wrap.className = 'global-task-detail-field';
  const head = document.createElement('div');
  head.className = 'global-task-detail-subtasks-head';
  const lab = document.createElement('label');
  lab.className = 'global-task-detail-label';
  const children = projectTasks(projectPath).filter(t => t.parentId === parent.id);
  const completed = children.filter(c => c.status === 'completed').length;
  lab.textContent = children.length === 0
    ? 'Subtasks'
    : `Subtasks (${completed}/${children.length})`;
  head.appendChild(lab);
  const add = document.createElement('button');
  add.className = 'global-task-detail-subtask-add';
  add.textContent = '+ Add subtask';
  add.addEventListener('click', () => openAdd({
    defaultProjectPath: projectPath,
    defaultParentId: parent.id
  }));
  head.appendChild(add);
  wrap.appendChild(head);

  if (children.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'global-task-detail-subtasks-empty';
    empty.textContent = 'No subtasks yet.';
    wrap.appendChild(empty);
    return wrap;
  }
  const list = document.createElement('div');
  list.className = 'global-task-detail-subtasks-list';
  for (const c of children) {
    const row = document.createElement('div');
    row.className = `global-task-detail-subtask status-${(c.status || 'pending').replace('_', '-')}`;
    const dot = document.createElement('span');
    dot.className = `global-task-detail-subtask-dot status-${(c.status || 'pending').replace('_', '-')}`;
    row.appendChild(dot);
    const title = document.createElement('span');
    title.className = 'global-task-detail-subtask-title';
    if (c.status === 'completed') title.classList.add('completed');
    title.textContent = c.title || 'Untitled';
    row.appendChild(title);
    if (c.endDate) {
      const due = document.createElement('span');
      due.className = 'global-task-detail-subtask-due';
      due.textContent = c.endDate;
      row.appendChild(due);
    }
    row.addEventListener('click', () => openTaskDetail(c, projectPath));
    list.appendChild(row);
  }
  wrap.appendChild(list);
  return wrap;
}

/* ---- Mutation helpers ---- */

function sendUpdate(projectPath, taskId, updates) {
  ipcRenderer.send(IPC.UPDATE_TASK, { projectPath, taskId, updates });
  // After tasksManager finishes, ask the dashboard to refresh that
  // single project so the snapshot picks up the change.
  setTimeout(() => {
    ipcRenderer.send(IPC.REFRESH_GLOBAL_PROJECT, { projectPath });
  }, 60);
}

function deleteTask(task, projectPath) {
  if (!confirm(`Delete task "${task.title || task.id}"? Subtasks become top-level.`)) return;
  ipcRenderer.send(IPC.DELETE_TASK, { projectPath, taskId: task.id });
  closeDetail();
  setTimeout(() => {
    ipcRenderer.send(IPC.REFRESH_GLOBAL_PROJECT, { projectPath });
  }, 80);
}

function openInProjectContext(task, projectPath) {
  // Switch the active project, close the dashboard, then open the
  // initiative view in the per-project tasks dashboard. Lazy-required
  // to dodge load-order coupling.
  try {
    const state = require('./state');
    state.setProjectPath(projectPath);
  } catch (err) {
    console.warn('Failed to switch project:', err);
  }
  try {
    require('./globalDashboard').hide();
  } catch (_) { /* ignore */ }
  try {
    const tasksDashboard = require('./tasksDashboard');
    // The per-project dashboard ingests its data via TASKS_DATA push,
    // so we give it a moment to load before drilling into the initiative.
    setTimeout(() => {
      try { tasksDashboard.show(); } catch (_) { /* ignore */ }
      setTimeout(() => {
        try { tasksDashboard.openInitiativeView(task.id); } catch (_) { /* ignore */ }
      }, 200);
    }, 200);
  } catch (err) {
    console.warn('Failed to open initiative view:', err);
  }
}

/* -------------------- Add-task modal -------------------- */

function openAdd({ defaultProjectPath = null, defaultParentId = null } = {}) {
  if (!modalEl) return;
  refreshProjectOptions(defaultProjectPath);
  refreshParentOptions(defaultProjectPath || modalProjectEl.value, defaultParentId);
  modalTitleEl.value = '';
  modalDescriptionEl.value = '';
  modalPriorityEl.value = 'medium';
  modalCategoryEl.value = 'feature';
  modalStartEl.value = '';
  modalDueEl.value = '';
  modalEl.classList.add('visible');
  requestAnimationFrame(() => modalTitleEl.focus());
}

function closeAdd() {
  if (modalEl) modalEl.classList.remove('visible');
}

function refreshProjectOptions(preferredPath) {
  if (!modalProjectEl) return;
  const projects = Object.values(context.registry.projects || {})
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  modalProjectEl.innerHTML = '';
  for (const p of projects) {
    const opt = document.createElement('option');
    opt.value = p.path;
    opt.textContent = p.name || p.path;
    modalProjectEl.appendChild(opt);
  }
  if (preferredPath && projects.some(p => p.path === preferredPath)) {
    modalProjectEl.value = preferredPath;
  }
}

function refreshParentOptions(projectPath, defaultParentId = null) {
  if (!modalParentEl) return;
  modalParentEl.innerHTML = '';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = '— top-level —';
  modalParentEl.appendChild(none);
  if (!projectPath) return;
  const tasks = projectTasks(projectPath);
  for (const t of tasks) {
    // Only allow top-level tasks as parents to keep the tree shallow
    // for v1; nested-subtask creation can come later.
    if (t.parentId) continue;
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = `${(t.title || t.id).slice(0, 60)} (#${t.id.slice(0, 8)})`;
    modalParentEl.appendChild(opt);
  }
  if (defaultParentId) modalParentEl.value = defaultParentId;
}

function commitAdd() {
  if (!modalTitleEl || !modalProjectEl) return;
  const projectPath = modalProjectEl.value;
  const title = modalTitleEl.value.trim();
  if (!projectPath || !title) return;
  const task = {
    title,
    description: modalDescriptionEl.value.trim(),
    priority: modalPriorityEl.value,
    category: modalCategoryEl.value,
    startDate: modalStartEl.value || null,
    endDate: modalDueEl.value || null
  };
  const parentId = modalParentEl.value;
  if (parentId) task.parentId = parentId;
  ipcRenderer.send(IPC.ADD_TASK, { projectPath, task });
  closeAdd();
  setTimeout(() => {
    ipcRenderer.send(IPC.REFRESH_GLOBAL_PROJECT, { projectPath });
  }, 80);
}

module.exports = {
  init,
  setRegistry,
  setParentDataProvider,
  openTaskDetail,
  openAdd,
  closeDetail
};
