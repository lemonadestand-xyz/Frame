/**
 * Projects Section
 *
 * The Projects sidebar rail view. Three tabs:
 *
 *   • Workspace — the workspace project list (`projectListUI`, drag-to-reorder)
 *     plus the "Add new Project" button. Default tab.
 *   • Profile   — the per-project profile editor (profilePanel) for
 *     `.frame/profile.json`. Mirrors the supervisor's per-project YAML editor.
 *   • Memory    — the per-project memory notes (memoryTab in `scope: 'project'`)
 *     showing every note in `~/memory/<project.memoryId>/` regardless of spec.
 *
 * The tab strip is built dynamically (no index.html changes). The
 * "Workspace" tab keeps the existing DOM intact; Profile + Memory swap
 * their own content containers in. Tab state is per-session.
 */

const openProjectModal = require('./openProjectModal');
const projectListUI = require('./projectListUI');
const profilePanel = require('./profilePanel');
const memoryTab = require('./memoryTab');
const state = require('./state');

const TAB_WORKSPACE = 'workspace';
const TAB_PROFILE = 'profile';
const TAB_MEMORY = 'memory';

let section = null;
let tabsEl = null;
let workspaceEls = []; // DOM nodes to show/hide on Workspace tab (projects-list + add-btn)
let profileTabEl = null; // container for the Profile tab content
let memoryTabEl = null;  // container for the Memory tab content
let profileHandle = null; // { refresh } from profilePanel.mount
let memoryHandle = null;  // { refresh } from memoryTab.mount
let activeTab = TAB_WORKSPACE;

/**
 * Move keyboard focus into the project list. Used by the "Focus Project List"
 * command — switches to the Workspace tab first so the list is visible.
 */
function focusList() {
  if (activeTab !== TAB_WORKSPACE) switchTab(TAB_WORKSPACE);
  projectListUI.focus();
}

/** Programmatic tab open — used by the command palette / focus commands. */
function openProfile() {
  switchTab(TAB_PROFILE);
}

function openMemory() {
  switchTab(TAB_MEMORY);
}

function switchTab(tab) {
  if (tab !== TAB_WORKSPACE && tab !== TAB_PROFILE && tab !== TAB_MEMORY) return;
  activeTab = tab;
  if (tabsEl) {
    tabsEl.querySelectorAll('.project-section-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
      btn.setAttribute('aria-selected', btn.dataset.tab === tab ? 'true' : 'false');
    });
  }
  const showWorkspace = tab === TAB_WORKSPACE;
  for (const el of workspaceEls) {
    if (!el) continue;
    el.style.display = showWorkspace ? '' : 'none';
  }
  if (profileTabEl) profileTabEl.style.display = tab === TAB_PROFILE ? '' : 'none';
  if (memoryTabEl) memoryTabEl.style.display = tab === TAB_MEMORY ? '' : 'none';
  if (tab === TAB_PROFILE) _ensureProfileMounted();
  if (tab === TAB_MEMORY) _ensureMemoryMounted();
}

function _ensureProfileMounted() {
  if (!profileTabEl) return;
  const projectPath = state.getProjectPath();
  if (!projectPath) {
    profileTabEl.innerHTML = `<div class="profile-tab-empty">Select a project to view its profile.</div>`;
    profileHandle = null;
    return;
  }
  // Re-mount when the project changes; refresh otherwise. The mounted
  // handle's `projectPath` is captured in closure inside profilePanel.mount,
  // so a different project requires a fresh mount.
  const dataProject = profileTabEl.getAttribute('data-mounted-for');
  if (dataProject !== projectPath || !profileHandle) {
    profileTabEl.setAttribute('data-mounted-for', projectPath);
    profileHandle = profilePanel.mount(profileTabEl, { projectPath });
  } else {
    profileHandle.refresh();
  }
}

function _ensureMemoryMounted() {
  if (!memoryTabEl) return;
  const projectPath = state.getProjectPath();
  if (!projectPath) {
    memoryTabEl.innerHTML = `<div class="memory-tab-empty">Select a project to view its memory.</div>`;
    memoryHandle = null;
    return;
  }
  const dataProject = memoryTabEl.getAttribute('data-mounted-for');
  if (dataProject !== projectPath || !memoryHandle) {
    memoryTabEl.setAttribute('data-mounted-for', projectPath);
    memoryHandle = memoryTab.mount(memoryTabEl, { projectPath, scope: 'project' });
  } else {
    memoryHandle.refresh();
  }
}

function _buildTabStrip() {
  if (!section) return;
  if (section.querySelector('.project-section-tabs')) return; // already built
  tabsEl = document.createElement('div');
  tabsEl.className = 'project-section-tabs';
  tabsEl.setAttribute('role', 'tablist');
  tabsEl.innerHTML = `
    <button type="button" class="project-section-tab active" data-tab="${TAB_WORKSPACE}" role="tab" aria-selected="true" tabindex="-1">Workspace</button>
    <button type="button" class="project-section-tab" data-tab="${TAB_PROFILE}" role="tab" aria-selected="false" tabindex="-1">Profile</button>
    <button type="button" class="project-section-tab" data-tab="${TAB_MEMORY}" role="tab" aria-selected="false" tabindex="-1">Memory</button>
  `;
  // Insert below the header, above the list.
  const header = section.querySelector('.project-section-header');
  if (header && header.nextSibling) {
    section.insertBefore(tabsEl, header.nextSibling);
  } else {
    section.appendChild(tabsEl);
  }
  tabsEl.querySelectorAll('.project-section-tab').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function _buildProfileTabContainer() {
  if (!section) return;
  if (section.querySelector('#project-section-profile-tab')) return;
  profileTabEl = document.createElement('div');
  profileTabEl.id = 'project-section-profile-tab';
  profileTabEl.className = 'project-section-profile-tab';
  profileTabEl.setAttribute('role', 'tabpanel');
  profileTabEl.style.display = 'none';
  section.appendChild(profileTabEl);
}

function _buildMemoryTabContainer() {
  if (!section) return;
  if (section.querySelector('#project-section-memory-tab')) return;
  memoryTabEl = document.createElement('div');
  memoryTabEl.id = 'project-section-memory-tab';
  memoryTabEl.className = 'project-section-memory-tab memory-tab-mount';
  memoryTabEl.setAttribute('role', 'tabpanel');
  memoryTabEl.style.display = 'none';
  section.appendChild(memoryTabEl);
}

function init() {
  section = document.getElementById('project-section');
  if (!section) return;

  const addBtn = document.getElementById('project-add-btn');
  if (addBtn) addBtn.addEventListener('click', () => openProjectModal.open());

  _buildTabStrip();
  _buildProfileTabContainer();
  _buildMemoryTabContainer();

  // Workspace tab is composed of the existing #projects-list (inside the
  // section) and #project-add-btn (sibling outside). Track both so we can
  // toggle them together on tab switch.
  const list = section.querySelector('#projects-list');
  workspaceEls = [list, addBtn].filter(Boolean);

  // Re-mount the profile/memory tabs whenever the active project changes
  // — even if not currently visible, so the next switch lands on the
  // right project's data.
  state.onProjectChange(() => {
    if (activeTab === TAB_PROFILE) _ensureProfileMounted();
    else if (profileTabEl) {
      profileTabEl.removeAttribute('data-mounted-for');
      profileTabEl.innerHTML = '';
      profileHandle = null;
    }
    if (activeTab === TAB_MEMORY) _ensureMemoryMounted();
    else if (memoryTabEl) {
      memoryTabEl.removeAttribute('data-mounted-for');
      memoryTabEl.innerHTML = '';
      memoryHandle = null;
    }
  });
}

module.exports = {
  init,
  focusList,
  openProfile,
  openMemory,
  switchTab,
  // exposed for tests
  TAB_WORKSPACE,
  TAB_PROFILE,
  TAB_MEMORY,
};
