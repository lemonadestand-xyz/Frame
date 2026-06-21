/**
 * Global Dashboard (cross-project view)
 *
 * Renders the indexed cache from globalDashboardManager. Supports:
 *  - All projects view: unified task list with project chips + due chips
 *  - Single project view: editable description + freeform key/value
 *    metadata + project-filtered task list
 *  - Sidebar visibility toggles (filterHidden) and Remove
 *  - Manual Sync (re-reads tasks.json from every tracked project)
 *  - Backfill prompt on first open
 *  - Post-Frame-init enroll prompt
 *
 * v1 explicitly does not include the LLM weekly/daily summary buttons.
 * They depend on the same terminal-injection plumbing as task-discuss-button
 * (still pending) and will land alongside it.
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const dashboardDetail = require('./globalDashboardDetail');

let registry = { version: '1.0', projects: {}, lastSyncedAt: null };
let activeProjectPath = null; // null = "All projects" view
const filters = { statuses: new Set(), due: new Set() };
let sortMode = 'due';
let viewMode = 'list'; // 'list' | 'board'
let visible = false;
let sidebarOpen = false;
let filtersOpen = false;
let syncTotal = 0;
let boardDragSource = null; // { taskId, projectPath, fromStatus }

let viewEl = null;
let sideListEl = null;
let contentEl = null;
let lastSyncedEl = null;
let allCountEl = null;
let modalEl = null;
let modalListEl = null;
let modalTitleEl = null;
let modalBodyEl = null;
let modalConfirmEl = null;
let modalCancelEl = null;
let modalMode = 'backfill'; // 'backfill' | 'enroll'
let modalContext = null;

function init() {
  viewEl = document.getElementById('global-dashboard');
  sideListEl = document.getElementById('global-dashboard-side-list');
  contentEl = document.getElementById('global-dashboard-content');
  lastSyncedEl = document.getElementById('global-dashboard-last-synced');
  allCountEl = viewEl ? viewEl.querySelector('[data-count-all]') : null;
  modalEl = document.getElementById('global-dashboard-modal');
  modalListEl = document.getElementById('global-dashboard-modal-list');
  modalTitleEl = document.getElementById('global-dashboard-modal-title');
  modalBodyEl = document.getElementById('global-dashboard-modal-body');
  modalConfirmEl = document.getElementById('global-dashboard-modal-confirm');
  modalCancelEl = document.getElementById('global-dashboard-modal-cancel');
  if (!viewEl) return;

  wireToolbar();
  wireFiltersAndSort();
  wireModal();
  wireIPC();
  dashboardDetail.init();
}

function wireToolbar() {
  const closeBtn = document.getElementById('global-dashboard-close');
  if (closeBtn) closeBtn.addEventListener('click', hide);

  const syncBtn = document.getElementById('global-dashboard-sync');
  if (syncBtn) syncBtn.addEventListener('click', () => {
    syncBtn.classList.add('syncing');
    syncBtn.disabled = true;
    ipcRenderer.send(IPC.SYNC_GLOBAL_DASHBOARD);
  });

  const addBtn = document.getElementById('global-dashboard-add');
  if (addBtn) addBtn.addEventListener('click', addProjectViaPicker);

  // All-projects sidebar entry
  const allEntry = viewEl.querySelector('.global-dashboard-side-item.all-projects');
  if (allEntry) {
    allEntry.addEventListener('click', () => {
      activeProjectPath = null;
      render();
    });
  }

  // Sidebar toggle (Projects pane)
  const sideBtn = document.getElementById('global-dashboard-toggle-side');
  if (sideBtn) sideBtn.addEventListener('click', () => {
    sidebarOpen = !sidebarOpen;
    applyPanelVisibility();
  });

  // Filter accordion toggle
  const filterBtn = document.getElementById('global-dashboard-toggle-filters');
  if (filterBtn) filterBtn.addEventListener('click', () => {
    filtersOpen = !filtersOpen;
    applyPanelVisibility();
  });

  // View mode (List / Board)
  viewEl.querySelectorAll('[data-view-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      viewMode = btn.dataset.viewMode;
      viewEl.querySelectorAll('[data-view-mode]').forEach(b => {
        b.classList.toggle('active', b.dataset.viewMode === viewMode);
      });
      renderContent();
    });
  });

  // Open the cross-project chat panel on top of the dashboard.
  // Lazy-required to dodge a circular dep at load time.
  const chatBtn = document.getElementById('global-dashboard-open-chat');
  if (chatBtn) chatBtn.addEventListener('click', () => {
    try { require('./chatPanel').show(); } catch (err) {
      console.warn('chatPanel.show failed:', err);
    }
  });

  // + Add task — opens modal targeting the active project (when one is
  // selected in the sidebar) or any tracked project.
  const addTaskBtn = document.getElementById('global-dashboard-add-task');
  if (addTaskBtn) addTaskBtn.addEventListener('click', () => {
    dashboardDetail.openAdd({ defaultProjectPath: activeProjectPath || null });
  });
}

function applyPanelVisibility() {
  if (!viewEl) return;
  viewEl.classList.toggle('sidebar-open', sidebarOpen);
  viewEl.classList.toggle('filters-open', filtersOpen);
  const sideBtn = document.getElementById('global-dashboard-toggle-side');
  if (sideBtn) sideBtn.classList.toggle('active', sidebarOpen);
  const filterBtn = document.getElementById('global-dashboard-toggle-filters');
  if (filterBtn) filterBtn.classList.toggle('active', filtersOpen);
}

function wireFiltersAndSort() {
  viewEl.querySelectorAll('input[data-global-filter-status]').forEach(input => {
    input.addEventListener('change', () => {
      if (input.checked) filters.statuses.add(input.value);
      else filters.statuses.delete(input.value);
      renderContent();
    });
  });
  viewEl.querySelectorAll('input[data-global-filter-due]').forEach(input => {
    input.addEventListener('change', () => {
      if (input.checked) filters.due.add(input.value);
      else filters.due.delete(input.value);
      renderContent();
    });
  });
  const sortEl = document.getElementById('global-dashboard-sort');
  if (sortEl) {
    sortEl.addEventListener('change', () => {
      sortMode = sortEl.value;
      renderContent();
    });
  }
}

function wireModal() {
  if (!modalEl) return;
  if (modalCancelEl) modalCancelEl.addEventListener('click', closeModal);
  const closeBtn = document.getElementById('global-dashboard-modal-close');
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (modalConfirmEl) modalConfirmEl.addEventListener('click', commitModalSelection);
  modalEl.addEventListener('click', (e) => {
    if (e.target === modalEl) closeModal();
  });
}

function wireIPC() {
  ipcRenderer.on(IPC.GLOBAL_DASHBOARD_DATA, (event, data) => {
    if (data && typeof data === 'object') {
      registry = data;
      dashboardDetail.setRegistry(registry);
      if (visible) render();
    }
  });

  ipcRenderer.on(IPC.GLOBAL_DASHBOARD_SYNC_PROGRESS, (event, { index, total, done }) => {
    const syncBtn = document.getElementById('global-dashboard-sync');
    if (!syncBtn) return;
    const label = syncBtn.querySelector('.global-dashboard-sync-label');
    if (!done && total) syncTotal = total;
    if (done) {
      syncBtn.classList.remove('syncing');
      syncBtn.disabled = false;
      if (label) label.textContent = 'Sync';
      const count = syncTotal || total || 0;
      try {
        require('./tasksPanel').showToast(
          count > 0 ? `Synced ${count} project${count === 1 ? '' : 's'}` : 'Sync complete',
          'success'
        );
      } catch (_) { /* tasksPanel unavailable — silent */ }
      syncTotal = 0;
      return;
    }
    if (label && total > 0) label.textContent = `Syncing ${index}/${total}…`;
  });

  ipcRenderer.on(IPC.PROMPT_GLOBAL_DASHBOARD_ENROLL, (event, { projectPath, projectName }) => {
    openEnrollPrompt({ projectPath, projectName });
  });
}

function show() {
  if (!viewEl) return;
  visible = true;
  viewEl.classList.add('visible');
  ipcRenderer.send(IPC.LOAD_GLOBAL_DASHBOARD);
  // Backfill flow: if registry is empty, offer to enroll workspace projects
  setTimeout(checkBackfill, 50);
}

function hide() {
  if (!viewEl) return;
  visible = false;
  viewEl.classList.remove('visible');
}

function toggle() {
  if (visible) hide(); else show();
}

function checkBackfill() {
  const projects = Object.values(registry.projects || {});
  if (projects.length > 0) return;
  ipcRenderer.once(IPC.WORKSPACE_DATA, (event, projectsList) => {
    if (!Array.isArray(projectsList) || projectsList.length === 0) return;
    openBackfillPrompt(projectsList);
  });
  ipcRenderer.send(IPC.LOAD_WORKSPACE);
}

function openBackfillPrompt(projectsList) {
  modalMode = 'backfill';
  modalContext = projectsList;
  if (modalTitleEl) modalTitleEl.textContent = 'Track projects in the global dashboard';
  if (modalBodyEl) modalBodyEl.textContent = 'Select the projects you want to track in the cross-project dashboard. Tracked projects show up in the sidebar and contribute to the unified task list.';
  if (modalConfirmEl) modalConfirmEl.textContent = 'Track selected';
  renderModalList(projectsList.map(p => ({
    path: p.path,
    name: p.name || p.path,
    checked: !!p.isFrameProject
  })));
  modalEl.classList.add('visible');
}

function openEnrollPrompt({ projectPath, projectName }) {
  modalMode = 'enroll';
  modalContext = { projectPath, projectName };
  if (modalTitleEl) modalTitleEl.textContent = `Track "${projectName}" in the global dashboard?`;
  if (modalBodyEl) modalBodyEl.textContent = 'This project was just initialized as a Frame project. Add it to your cross-project dashboard so its tasks roll up alongside everything else.';
  if (modalConfirmEl) modalConfirmEl.textContent = 'Track project';
  renderModalList([{ path: projectPath, name: projectName, checked: true, single: true }]);
  modalEl.classList.add('visible');
}

function renderModalList(items) {
  if (!modalListEl) return;
  modalListEl.innerHTML = '';
  for (const item of items) {
    const row = document.createElement('label');
    row.className = 'global-dashboard-modal-row';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.dataset.path = item.path;
    if (item.name) checkbox.dataset.name = item.name;
    checkbox.checked = item.checked !== false;
    const name = document.createElement('span');
    name.className = 'global-dashboard-modal-row-name';
    name.textContent = item.name;
    const pathEl = document.createElement('span');
    pathEl.className = 'global-dashboard-modal-row-path';
    pathEl.textContent = item.path;
    row.appendChild(checkbox);
    row.appendChild(name);
    row.appendChild(pathEl);
    modalListEl.appendChild(row);
  }
}

function commitModalSelection() {
  if (!modalListEl) return;
  const picks = [];
  modalListEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    if (cb.checked) {
      picks.push({
        projectPath: cb.dataset.path,
        name: cb.dataset.name || undefined
      });
    }
  });
  if (picks.length > 0) {
    ipcRenderer.send(IPC.ADD_GLOBAL_PROJECT, picks);
  }
  closeModal();
}

function closeModal() {
  if (modalEl) modalEl.classList.remove('visible');
  modalContext = null;
}

async function addProjectViaPicker() {
  const picked = await ipcRenderer.invoke(IPC.PICK_FOLDER);
  if (!picked) return;
  ipcRenderer.send(IPC.ADD_GLOBAL_PROJECT, { projectPath: picked });
}

function render() {
  if (!visible) return;
  renderSidebar();
  renderLastSynced();
  renderContent();
}

function renderSidebar() {
  if (!sideListEl) return;
  sideListEl.innerHTML = '';
  const projects = sortedTrackedProjects();
  for (const proj of projects) {
    const item = document.createElement('div');
    item.className = 'global-dashboard-side-item';
    if (proj.path === activeProjectPath) item.classList.add('active');
    if (proj.filterHidden) item.classList.add('hidden');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'global-dashboard-side-visibility';
    checkbox.checked = !proj.filterHidden;
    checkbox.title = proj.filterHidden ? 'Hidden from view' : 'Visible in view';
    checkbox.addEventListener('click', (e) => e.stopPropagation());
    checkbox.addEventListener('change', () => {
      ipcRenderer.send(IPC.SET_GLOBAL_PROJECT_FILTER, {
        projectPath: proj.path,
        filterHidden: !checkbox.checked
      });
    });

    const name = document.createElement('span');
    name.className = 'global-dashboard-side-name';
    name.textContent = proj.name || proj.path;
    if (proj.pathMissing) name.classList.add('missing');

    const count = document.createElement('span');
    count.className = 'global-dashboard-side-count';
    count.textContent = countOpenTasks(proj);

    const remove = document.createElement('button');
    remove.className = 'global-dashboard-side-remove';
    remove.title = 'Untrack this project';
    remove.textContent = '✕';
    remove.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!confirm(`Untrack ${proj.name}? Its metadata in the dashboard will be discarded (tasks.json is untouched).`)) return;
      if (activeProjectPath === proj.path) activeProjectPath = null;
      ipcRenderer.send(IPC.REMOVE_GLOBAL_PROJECT, { projectPath: proj.path });
    });

    item.appendChild(checkbox);
    item.appendChild(name);
    item.appendChild(count);
    item.appendChild(remove);
    item.addEventListener('click', () => {
      activeProjectPath = proj.path;
      render();
    });
    sideListEl.appendChild(item);
  }

  // Toggle 'active' on the All-projects entry
  const allEntry = viewEl.querySelector('.global-dashboard-side-item.all-projects');
  if (allEntry) allEntry.classList.toggle('active', activeProjectPath === null);

  if (allCountEl) {
    const total = projects
      .filter(p => !p.filterHidden)
      .reduce((sum, p) => sum + countOpenTasks(p), 0);
    allCountEl.textContent = String(total);
  }
}

function renderLastSynced() {
  if (!lastSyncedEl) return;
  if (!registry.lastSyncedAt) {
    lastSyncedEl.textContent = 'Not synced yet';
    return;
  }
  lastSyncedEl.textContent = `Last synced ${formatRelative(registry.lastSyncedAt)}`;
}

function renderContent() {
  if (!contentEl) return;
  contentEl.innerHTML = '';
  if (activeProjectPath) {
    const proj = registry.projects[activeProjectPath];
    if (!proj) {
      activeProjectPath = null;
      renderContent();
      return;
    }
    contentEl.appendChild(renderProjectDetail(proj));
    return;
  }
  contentEl.appendChild(renderAllProjects());
}

function renderAllProjects() {
  const wrap = document.createElement('div');
  wrap.className = 'global-dashboard-all';

  const rows = collectVisibleTasks();
  if (rows.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'global-dashboard-empty';
    empty.textContent = registry.projects && Object.keys(registry.projects).length === 0
      ? 'No projects tracked yet. Use "Add project" or wait for the backfill prompt.'
      : 'No tasks match the current filters.';
    wrap.appendChild(empty);
    return wrap;
  }

  if (viewMode === 'board') {
    wrap.appendChild(renderBoard(rows));
    return wrap;
  }

  const list = document.createElement('div');
  list.className = 'global-dashboard-task-list';
  for (const row of rows) list.appendChild(renderTaskRow(row));
  wrap.appendChild(list);
  return wrap;
}

function renderBoard(rows, opts = {}) {
  const columns = [
    { key: 'pending', label: 'Pending' },
    { key: 'in_progress', label: 'In progress' },
    { key: 'completed', label: 'Completed' }
  ];
  const grouped = { pending: [], in_progress: [], completed: [] };
  for (const row of rows) {
    const status = row.task.status || 'pending';
    if (grouped[status]) grouped[status].push(row);
  }

  const board = document.createElement('div');
  board.className = 'global-dashboard-board';
  for (const col of columns) {
    const colEl = document.createElement('div');
    colEl.className = `global-dashboard-board-col status-${col.key.replace('_', '-')}`;
    colEl.dataset.colStatus = col.key;

    const head = document.createElement('div');
    head.className = 'global-dashboard-board-col-head';
    head.innerHTML = `<span class="global-dashboard-board-col-title">${col.label}</span><span class="global-dashboard-board-col-count">${grouped[col.key].length}</span>`;
    colEl.appendChild(head);

    const body = document.createElement('div');
    body.className = 'global-dashboard-board-col-body';
    body.dataset.colStatus = col.key;
    if (grouped[col.key].length === 0) {
      const empty = document.createElement('div');
      empty.className = 'global-dashboard-board-empty';
      empty.textContent = 'Drop here';
      body.appendChild(empty);
    } else {
      for (const row of grouped[col.key]) body.appendChild(renderBoardCard(row, opts));
    }
    wireBoardDropTarget(body);
    colEl.appendChild(body);
    board.appendChild(colEl);
  }
  return board;
}

function renderBoardCard(row, opts = {}) {
  const card = document.createElement('div');
  card.className = `global-dashboard-board-card priority-${row.task.priority || 'medium'}`;
  card.title = 'Click to open · drag to move between columns';
  card.draggable = true;
  card.dataset.taskId = row.task.id;
  card.dataset.projectPath = row.projectPath;
  card.dataset.fromStatus = row.task.status || 'pending';
  card.addEventListener('click', () => {
    if (boardDragSource) return;
    dashboardDetail.openTaskDetail(row.task, row.projectPath);
  });
  card.addEventListener('dragstart', (e) => onBoardDragStart(e, row, card));
  card.addEventListener('dragend', () => onBoardDragEnd(card));
  const title = document.createElement('div');
  title.className = 'global-dashboard-board-card-title';
  if (row.task.status === 'completed') title.classList.add('completed');
  title.textContent = row.task.title || 'Untitled';
  card.appendChild(title);

  const meta = document.createElement('div');
  meta.className = 'global-dashboard-board-card-meta';
  const priority = document.createElement('span');
  priority.className = `global-dashboard-task-priority priority-${row.task.priority || 'medium'}`;
  priority.textContent = (row.task.priority || 'medium').toUpperCase();
  meta.appendChild(priority);
  if (row.task.endDate) {
    const due = document.createElement('span');
    const overdue = isOverdue(row.task);
    due.className = `global-dashboard-task-due${overdue ? ' overdue' : ''}`;
    due.textContent = formatDueShort(row.task.endDate);
    meta.appendChild(due);
  }
  if (!opts.hideProject) {
    const project = document.createElement('button');
    project.type = 'button';
    project.className = 'global-dashboard-task-project';
    project.textContent = row.projectName;
    project.title = row.projectPath;
    project.addEventListener('click', (e) => {
      e.stopPropagation();
      activeProjectPath = row.projectPath;
      render();
    });
    meta.appendChild(project);
  }
  card.appendChild(meta);
  return card;
}

function renderProjectDetail(proj) {
  const wrap = document.createElement('div');
  wrap.className = 'global-dashboard-project-detail';

  // Header card with name + path + missing warning
  const header = document.createElement('div');
  header.className = 'global-dashboard-project-header';
  const title = document.createElement('input');
  title.type = 'text';
  title.className = 'global-dashboard-project-name-input';
  title.value = proj.name || proj.path;
  title.title = 'Click to rename';
  title.addEventListener('blur', () => {
    const v = title.value.trim();
    if (!v || v === proj.name) return;
    ipcRenderer.send(IPC.UPDATE_GLOBAL_PROJECT_METADATA, {
      projectPath: proj.path,
      name: v
    });
  });
  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); title.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); title.value = proj.name || proj.path; title.blur(); }
  });
  header.appendChild(title);
  const path = document.createElement('span');
  path.className = 'global-dashboard-project-path';
  path.textContent = proj.path;
  header.appendChild(path);
  if (proj.pathMissing) {
    const warn = document.createElement('div');
    warn.className = 'global-dashboard-project-missing';
    warn.textContent = 'Project folder is missing. Move it back, or remove this project from the dashboard.';
    header.appendChild(warn);
  }
  wrap.appendChild(header);

  // Metadata editor
  wrap.appendChild(renderMetadataEditor(proj));

  // Project-scoped task list
  const tasksHeader = document.createElement('h4');
  tasksHeader.className = 'global-dashboard-section-label';
  tasksHeader.textContent = 'Tasks';
  wrap.appendChild(tasksHeader);

  const rows = collectVisibleTasks().filter(r => r.projectPath === proj.path);
  if (rows.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'global-dashboard-empty';
    empty.textContent = 'No tasks in this project match the current filters.';
    wrap.appendChild(empty);
  } else if (viewMode === 'board') {
    wrap.appendChild(renderBoard(rows, { hideProject: true }));
  } else {
    const list = document.createElement('div');
    list.className = 'global-dashboard-task-list';
    for (const row of rows) list.appendChild(renderTaskRow(row, { hideProject: true }));
    wrap.appendChild(list);
  }

  return wrap;
}

function renderMetadataEditor(proj) {
  const wrap = document.createElement('div');
  wrap.className = 'global-dashboard-metadata';

  const descLabel = document.createElement('label');
  descLabel.className = 'global-dashboard-metadata-label';
  descLabel.textContent = 'Description';
  const desc = document.createElement('textarea');
  desc.className = 'global-dashboard-metadata-desc';
  desc.value = proj.description || '';
  desc.placeholder = 'What is this project about? Why does it exist?';
  desc.addEventListener('blur', () => {
    if (desc.value === (proj.description || '')) return;
    ipcRenderer.send(IPC.UPDATE_GLOBAL_PROJECT_METADATA, {
      projectPath: proj.path,
      description: desc.value
    });
  });
  wrap.appendChild(descLabel);
  wrap.appendChild(desc);

  const metaLabel = document.createElement('label');
  metaLabel.className = 'global-dashboard-metadata-label';
  metaLabel.textContent = 'Metadata';
  wrap.appendChild(metaLabel);

  const rows = document.createElement('div');
  rows.className = 'global-dashboard-metadata-rows';
  const entries = Object.entries(proj.metadata || {});

  const renderRow = (key, value) => {
    const row = document.createElement('div');
    row.className = 'global-dashboard-metadata-row';
    const k = document.createElement('input');
    k.type = 'text';
    k.placeholder = 'Key (e.g. budget)';
    k.value = key;
    k.className = 'global-dashboard-metadata-key';
    const v = document.createElement('input');
    v.type = 'text';
    v.placeholder = 'Value';
    v.value = value;
    v.className = 'global-dashboard-metadata-value';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'global-dashboard-metadata-remove';
    remove.textContent = '✕';
    remove.title = 'Remove field';
    const commit = () => commitMetadata(proj.path, rows);
    k.addEventListener('blur', commit);
    v.addEventListener('blur', commit);
    remove.addEventListener('click', () => {
      row.remove();
      commitMetadata(proj.path, rows);
    });
    row.appendChild(k);
    row.appendChild(v);
    row.appendChild(remove);
    return row;
  };

  for (const [k, v] of entries) rows.appendChild(renderRow(k, v));
  wrap.appendChild(rows);

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'global-dashboard-metadata-add';
  addBtn.textContent = '+ Add field';
  addBtn.addEventListener('click', () => {
    const row = renderRow('', '');
    rows.appendChild(row);
    const key = row.querySelector('.global-dashboard-metadata-key');
    if (key) key.focus();
  });
  wrap.appendChild(addBtn);

  return wrap;
}

function commitMetadata(projectPath, rowsEl) {
  const obj = {};
  rowsEl.querySelectorAll('.global-dashboard-metadata-row').forEach(row => {
    const k = row.querySelector('.global-dashboard-metadata-key').value.trim();
    const v = row.querySelector('.global-dashboard-metadata-value').value;
    if (k) obj[k] = v;
  });
  ipcRenderer.send(IPC.UPDATE_GLOBAL_PROJECT_METADATA, {
    projectPath,
    metadata: obj
  });
}

function renderTaskRow(row, opts = {}) {
  const el = document.createElement('div');
  el.className = `global-dashboard-task status-${(row.task.status || 'pending').replace('_', '-')} priority-${row.task.priority || 'medium'}`;
  el.title = 'Click to open task';
  el.addEventListener('click', () => dashboardDetail.openTaskDetail(row.task, row.projectPath));

  const status = document.createElement('span');
  status.className = `global-dashboard-task-dot status-${(row.task.status || 'pending').replace('_', '-')}`;
  status.title = (row.task.status || 'pending').replace('_', ' ');
  el.appendChild(status);

  const title = document.createElement('span');
  title.className = 'global-dashboard-task-title';
  if (row.task.status === 'completed') title.classList.add('completed');
  title.textContent = row.task.title || 'Untitled';
  el.appendChild(title);

  const priority = document.createElement('span');
  priority.className = `global-dashboard-task-priority priority-${row.task.priority || 'medium'}`;
  priority.textContent = (row.task.priority || 'medium').toUpperCase();
  el.appendChild(priority);

  if (row.task.endDate) {
    const due = document.createElement('span');
    const overdue = isOverdue(row.task);
    due.className = `global-dashboard-task-due${overdue ? ' overdue' : ''}`;
    due.textContent = formatDueShort(row.task.endDate);
    due.title = overdue ? `Overdue · due ${row.task.endDate}` : `Due ${row.task.endDate}`;
    el.appendChild(due);
  }

  if (!opts.hideProject) {
    const project = document.createElement('button');
    project.type = 'button';
    project.className = 'global-dashboard-task-project';
    project.textContent = row.projectName;
    project.title = row.projectPath;
    project.addEventListener('click', (e) => {
      e.stopPropagation();
      activeProjectPath = row.projectPath;
      render();
    });
    el.appendChild(project);
  }

  return el;
}

/* -------------------- Board drag-and-drop (status moves) -------------------- */

function onBoardDragStart(e, row, card) {
  boardDragSource = {
    taskId: row.task.id,
    projectPath: row.projectPath,
    fromStatus: row.task.status || 'pending'
  };
  e.dataTransfer.effectAllowed = 'move';
  try {
    e.dataTransfer.setData('text/plain', row.task.id);
  } catch (_) { /* ignore */ }
  // Class added on next frame so the drag image captures the un-styled card.
  requestAnimationFrame(() => card.classList.add('dragging'));
}

function onBoardDragEnd(card) {
  card.classList.remove('dragging');
  // Clear lingering hover state on all columns
  if (viewEl) {
    viewEl.querySelectorAll('.global-dashboard-board-col-body.drag-over').forEach(el => {
      el.classList.remove('drag-over');
    });
  }
  // Defer clearing the source so the click handler can suppress its
  // open-task-detail callback when the drag ended on the same card.
  setTimeout(() => { boardDragSource = null; }, 50);
}

function wireBoardDropTarget(bodyEl) {
  bodyEl.addEventListener('dragover', (e) => {
    if (!boardDragSource) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    bodyEl.classList.add('drag-over');
  });
  bodyEl.addEventListener('dragenter', (e) => {
    if (!boardDragSource) return;
    e.preventDefault();
    bodyEl.classList.add('drag-over');
  });
  bodyEl.addEventListener('dragleave', (e) => {
    if (e.target !== bodyEl) return;
    bodyEl.classList.remove('drag-over');
  });
  bodyEl.addEventListener('drop', (e) => {
    e.preventDefault();
    bodyEl.classList.remove('drag-over');
    if (!boardDragSource) return;
    const targetStatus = bodyEl.dataset.colStatus;
    const { taskId, projectPath, fromStatus } = boardDragSource;
    if (!targetStatus || targetStatus === fromStatus) return;
    ipcRenderer.send(IPC.UPDATE_TASK, {
      projectPath,
      taskId,
      updates: { status: targetStatus }
    });
    setTimeout(() => {
      ipcRenderer.send(IPC.REFRESH_GLOBAL_PROJECT, { projectPath });
    }, 60);
  });
}

/* -------------------- Aggregation helpers -------------------- */

function sortedTrackedProjects() {
  const entries = Object.values(registry.projects || {});
  return entries.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

function countOpenTasks(proj) {
  const snap = proj.taskSnapshot;
  if (!snap || !Array.isArray(snap.tasks)) return 0;
  return snap.tasks.filter(t => t.status !== 'completed').length;
}

function collectVisibleTasks() {
  const rows = [];
  for (const proj of Object.values(registry.projects || {})) {
    if (proj.filterHidden) continue;
    if (!proj.taskSnapshot || !Array.isArray(proj.taskSnapshot.tasks)) continue;
    for (const task of proj.taskSnapshot.tasks) {
      if (!passesFilters(task)) continue;
      rows.push({ task, projectPath: proj.path, projectName: proj.name || proj.path });
    }
  }
  rows.sort(compareRows);
  return rows;
}

function passesFilters(task) {
  if (filters.statuses.size > 0 && !filters.statuses.has(task.status)) return false;
  if (filters.due.has('overdue') && !isOverdue(task)) return false;
  if (filters.due.has('upcoming')) {
    if (!task.endDate) return false;
    const today = todayYMD();
    const limit = ymdShift(today, 7);
    if (task.endDate < today || task.endDate > limit) return false;
  }
  return true;
}

function compareRows(a, b) {
  if (sortMode === 'due') {
    const ad = a.task.endDate || '9999-12-31';
    const bd = b.task.endDate || '9999-12-31';
    if (ad !== bd) return ad < bd ? -1 : 1;
    return priorityOrder(a.task) - priorityOrder(b.task);
  }
  if (sortMode === 'priority') {
    return priorityOrder(a.task) - priorityOrder(b.task);
  }
  if (sortMode === 'project') {
    return (a.projectName || '').localeCompare(b.projectName || '');
  }
  if (sortMode === 'updated') {
    const au = Date.parse(a.task.updatedAt || a.task.createdAt || 0) || 0;
    const bu = Date.parse(b.task.updatedAt || b.task.createdAt || 0) || 0;
    return bu - au;
  }
  return 0;
}

function priorityOrder(task) {
  switch (task.priority) {
    case 'high': return 0;
    case 'medium': return 1;
    case 'low': return 2;
    default: return 3;
  }
}

function isOverdue(task) {
  if (!task || !task.endDate) return false;
  if (task.status === 'completed') return false;
  return task.endDate < todayYMD();
}

function todayYMD() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function ymdShift(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const ny = dt.getFullYear();
  const nm = String(dt.getMonth() + 1).padStart(2, '0');
  const nd = String(dt.getDate()).padStart(2, '0');
  return `${ny}-${nm}-${nd}`;
}

function formatDueShort(ymd) {
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

function formatRelative(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

module.exports = { init, show, hide, toggle };
