/**
 * Project List UI Module
 * Renders project list in sidebar
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');

let projectsListElement = null;
let activeProjectPath = null;
let onProjectSelectCallback = null;
let projects = []; // Store projects list for navigation
let focusedIndex = -1; // Currently focused project index

/**
 * Initialize project list UI
 */
function init(containerId, onSelectCallback) {
  projectsListElement = document.getElementById(containerId);
  onProjectSelectCallback = onSelectCallback;
  setupIPC();
}

/**
 * Load projects from workspace
 */
function loadProjects() {
  ipcRenderer.send(IPC.LOAD_WORKSPACE);
}

/**
 * Render project list
 */
function renderProjects(projectsList) {
  if (!projectsListElement) return;

  projectsListElement.innerHTML = '';

  if (!projectsList || projectsList.length === 0) {
    projects = [];
    const noProjectsMsg = document.createElement('div');
    noProjectsMsg.className = 'no-projects-message';
    noProjectsMsg.textContent = 'No projects yet. Add a project to get started.';
    projectsListElement.appendChild(noProjectsMsg);
    return;
  }

  // Sort by lastOpenedAt (most recent first), then by name
  const sortedProjects = [...projectsList].sort((a, b) => {
    if (a.lastOpenedAt && b.lastOpenedAt) {
      return new Date(b.lastOpenedAt) - new Date(a.lastOpenedAt);
    }
    if (a.lastOpenedAt) return -1;
    if (b.lastOpenedAt) return 1;
    return a.name.localeCompare(b.name);
  });

  // Store sorted projects for navigation
  projects = sortedProjects;

  sortedProjects.forEach((project, index) => {
    const projectItem = createProjectItem(project, index);
    projectsListElement.appendChild(projectItem);
  });

  // Update focused index based on active project
  focusedIndex = projects.findIndex(p => p.path === activeProjectPath);
}

/**
 * Create a project item element
 */
function createProjectItem(project, index) {
  const item = document.createElement('div');
  item.className = 'project-item';
  item.dataset.path = project.path;
  item.dataset.index = index;
  item.tabIndex = 0; // Make focusable

  if (project.path === activeProjectPath) {
    item.classList.add('active');
  }

  // Project icon
  const icon = document.createElement('span');
  icon.className = 'project-icon';
  icon.textContent = project.isFrameProject ? '📦' : '📁';
  item.appendChild(icon);

  // Project name — double-click also enters rename mode for users who
  // prefer that over the pencil button.
  const name = document.createElement('span');
  name.className = 'project-name';
  name.textContent = project.name;
  name.title = `${project.path}\n\nDouble-click to rename`;
  name.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    startRename(item, project);
  });
  item.appendChild(name);

  // Frame badge
  if (project.isFrameProject) {
    const badge = document.createElement('span');
    badge.className = 'frame-badge';
    badge.textContent = 'Frame';
    item.appendChild(badge);
  }

  // Rename button (visible on hover) — pencil icon, sits next to the
  // remove button to keep all per-row actions in one cluster.
  const renameBtn = document.createElement('button');
  renameBtn.className = 'project-rename-btn';
  renameBtn.title = 'Rename';
  renameBtn.innerHTML = `
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 20h9"/>
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
    </svg>`;
  renameBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    startRename(item, project);
  });
  item.appendChild(renameBtn);

  // Remove button (visible on hover)
  const removeBtn = document.createElement('button');
  removeBtn.className = 'project-remove-btn';
  removeBtn.title = 'Remove from list';
  removeBtn.innerHTML = '&times;';
  removeBtn.addEventListener('click', (e) => {
    e.stopPropagation(); // Prevent project selection
    confirmRemoveProject(project.path, project.name);
  });
  item.appendChild(removeBtn);

  // Click handler
  item.addEventListener('click', () => {
    selectProject(project.path);
  });

  return item;
}

/**
 * Swap the project-name span for an inline <input> so the user can rename
 * without leaving the sidebar. Submit on Enter or blur; cancel on Escape.
 * Clicking the input itself does not bubble to the project row (which
 * would select the project and discard the edit).
 */
function startRename(itemEl, project) {
  const nameEl = itemEl.querySelector('.project-name');
  if (!nameEl) return;
  // Avoid stacking inputs if a previous rename hasn't unmounted yet
  // (e.g. user rapid-clicks the pencil).
  if (itemEl.querySelector('.project-name-input')) return;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'project-name-input';
  input.value = project.name;
  input.setAttribute('aria-label', 'Project name');

  nameEl.replaceWith(input);

  // Block clicks from triggering project selection while editing.
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('dblclick', (e) => e.stopPropagation());

  let committed = false;
  const commit = () => {
    if (committed) return;
    committed = true;
    const newName = input.value.trim();
    if (newName && newName !== project.name) {
      ipcRenderer.send(IPC.RENAME_PROJECT, {
        projectPath: project.path,
        newName
      });
      // The main process will re-broadcast WORKSPACE_UPDATED, which
      // re-renders the whole list with the new name. No optimistic update
      // needed.
    } else {
      // No change — restore the static name span.
      restoreNameSpan(input, project);
    }
  };
  const cancel = () => {
    if (committed) return;
    committed = true;
    restoreNameSpan(input, project);
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
      input.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
      input.blur();
    }
  });
  input.addEventListener('blur', commit);

  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
}

function restoreNameSpan(input, project) {
  const span = document.createElement('span');
  span.className = 'project-name';
  span.textContent = project.name;
  span.title = `${project.path}\n\nDouble-click to rename`;
  span.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    const item = span.closest('.project-item');
    if (item) startRename(item, project);
  });
  input.replaceWith(span);
}

/**
 * Show confirmation dialog and remove project
 */
function confirmRemoveProject(projectPath, projectName) {
  const confirmed = window.confirm(
    `Remove "${projectName}" from the project list?\n\nThis will only remove it from Frame's list. The project files will not be deleted.`
  );

  if (confirmed) {
    // If removing the active project, select another one
    if (projectPath === activeProjectPath) {
      const otherProject = projects.find(p => p.path !== projectPath);
      if (otherProject) {
        selectProject(otherProject.path);
      } else {
        activeProjectPath = null;
        if (onProjectSelectCallback) {
          onProjectSelectCallback(null);
        }
      }
    }
    removeProject(projectPath);
  }
}

/**
 * Select a project. Clicking the currently-active project deselects it
 * (returns to the no-project state so the user can reach the global
 * dashboard / Frame-only actions without manually clearing).
 */
function selectProject(projectPath) {
  if (projectPath && projectPath === activeProjectPath) {
    setActiveProject(null);
    if (onProjectSelectCallback) onProjectSelectCallback(null);
    return;
  }

  setActiveProject(projectPath);

  // Clear the project's "needs attention" dot (lemo-7) the moment the
  // user actually switches to it. Lazy-required to dodge any load-
  // order circularity with the notifier module.
  try {
    require('./terminalNotifier').clearProjectIndicator(projectPath);
  } catch (err) {
    // Notifier not initialized yet — fine, paint pass on next event
    // covers it.
  }

  if (onProjectSelectCallback) {
    onProjectSelectCallback(projectPath);
  }
}

/**
 * Set active project (visual only)
 */
function setActiveProject(projectPath) {
  activeProjectPath = projectPath;

  // Update visual state
  if (projectsListElement) {
    const items = projectsListElement.querySelectorAll('.project-item');
    items.forEach(item => {
      if (item.dataset.path === projectPath) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });
  }
}

/**
 * Get active project path
 */
function getActiveProject() {
  return activeProjectPath;
}

/**
 * Add project to workspace
 */
function addProject(projectPath, projectName, isFrameProject = false) {
  ipcRenderer.send(IPC.ADD_PROJECT_TO_WORKSPACE, {
    projectPath,
    name: projectName,
    isFrameProject
  });
}

/**
 * Remove project from workspace
 */
function removeProject(projectPath) {
  ipcRenderer.send(IPC.REMOVE_PROJECT_FROM_WORKSPACE, projectPath);
}

/**
 * Setup IPC listeners
 */
function setupIPC() {
  ipcRenderer.on(IPC.WORKSPACE_DATA, (event, projects) => {
    renderProjects(projects);
  });

  ipcRenderer.on(IPC.WORKSPACE_UPDATED, (event, projects) => {
    renderProjects(projects);
  });
}

/**
 * Select next project in list
 */
function selectNextProject() {
  if (projects.length === 0) return;

  const currentIndex = projects.findIndex(p => p.path === activeProjectPath);
  const nextIndex = currentIndex < projects.length - 1 ? currentIndex + 1 : 0;
  selectProject(projects[nextIndex].path);
}

/**
 * Select previous project in list
 */
function selectPrevProject() {
  if (projects.length === 0) return;

  const currentIndex = projects.findIndex(p => p.path === activeProjectPath);
  const prevIndex = currentIndex > 0 ? currentIndex - 1 : projects.length - 1;
  selectProject(projects[prevIndex].path);
}

/**
 * Focus project list for keyboard navigation
 */
function focus() {
  if (!projectsListElement || projects.length === 0) return;

  // Focus current active project or first project
  const currentIndex = projects.findIndex(p => p.path === activeProjectPath);
  focusedIndex = currentIndex >= 0 ? currentIndex : 0;

  const items = projectsListElement.querySelectorAll('.project-item');
  if (items[focusedIndex]) {
    items[focusedIndex].focus();
    items[focusedIndex].classList.add('focused');
  }

  // Setup keyboard navigation (one-time)
  if (!projectsListElement.dataset.keyboardSetup) {
    projectsListElement.dataset.keyboardSetup = 'true';
    projectsListElement.addEventListener('keydown', handleKeydown);
  }
}

/**
 * Handle keyboard navigation in project list
 */
function handleKeydown(e) {
  const items = projectsListElement.querySelectorAll('.project-item');

  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    items[focusedIndex]?.classList.remove('focused');

    if (e.key === 'ArrowDown') {
      focusedIndex = focusedIndex < projects.length - 1 ? focusedIndex + 1 : 0;
    } else {
      focusedIndex = focusedIndex > 0 ? focusedIndex - 1 : projects.length - 1;
    }

    items[focusedIndex]?.focus();
    items[focusedIndex]?.classList.add('focused');
  }

  if (e.key === 'Enter' && focusedIndex >= 0) {
    e.preventDefault();
    selectProject(projects[focusedIndex].path);
  }

  if (e.key === 'Escape') {
    e.preventDefault();
    items[focusedIndex]?.classList.remove('focused');
    // Return focus to terminal
    if (typeof window.terminalFocus === 'function') {
      window.terminalFocus();
    }
  }
}

/**
 * Blur/unfocus project list
 */
function blur() {
  const items = projectsListElement?.querySelectorAll('.project-item');
  items?.forEach(item => item.classList.remove('focused'));
}

module.exports = {
  init,
  loadProjects,
  renderProjects,
  selectProject,
  setActiveProject,
  getActiveProject,
  addProject,
  removeProject,
  selectNextProject,
  selectPrevProject,
  focus,
  blur
};
