// Supervisor project tree — Phase B.
//
// Left rail listing Frame's workspace projects (from ~/.frame/workspaces.json
// via SUPERVISOR_LIST_WORKSPACE_PROJECTS). For each project, three lazy
// children:
//   queue/ — /api/workspace filtered by substring match on title/id/profile/
//            brief vs the project name (workspace tasks don't carry a
//            project_id field, so we mirror the loose-match the PWA's
//            project filter already does at supervisor/mobile/index.html:990).
//            Clicking a queue row scrolls + flashes the matching card in
//            the kanban via the onScrollToTask callback.
//   docs/  — SUPERVISOR_LIST_PROJECT_DOCS({project_id: name, project_path}).
//            Lists develop/*.md + ~/memory/<name>/**/*.md.
//   specs/ — SUPERVISOR_LIST_PROJECT_SPECS({project_path}). Lists
//            .frame/specs/<slug>/{spec,plan,tasks}.md — scanned from the
//            filesystem since no supervisor API exposes this.

const path = require('path');
const { ipcRenderer } = require('electron');
const SUP = require('../../shared/supervisor-ipc');
const { SUPERVISOR_API } = require('./header');

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

async function fetchJson(p) {
  const res = await fetch(`${SUPERVISOR_API}${p}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function openFile(absPath) {
  try {
    const editor = require('../editor');
    editor.openFile(absPath, 'supervisor');
  } catch (err) {
    console.warn('[supervisor] editor.openFile failed:', err);
  }
}

/**
 * Heuristic project-match: case-insensitive substring against title/id/
 * profile/brief. Mirrors the PWA's project filter — loose, but the only
 * option since the workspace payload has no project_id field.
 */
function taskMatchesProject(task, projectName) {
  if (!projectName) return false;
  const n = String(projectName).toLowerCase();
  if (!n) return false;
  return (
    (task.id || '').toLowerCase().includes(n) ||
    (task.title || '').toLowerCase().includes(n) ||
    (task.profile || '').toLowerCase().includes(n) ||
    (task.brief || '').toLowerCase().includes(n)
  );
}

function flatTasks(workspace) {
  const cols = (workspace && workspace.columns) || {};
  return [
    ...(cols.pending || []),
    ...(cols.active || []),
    ...(cols.awaiting || []),
    ...(cols.done || []),
  ];
}

function create(root, opts = {}) {
  let alive = true;
  const onScrollToTask = opts.onScrollToTask || (() => {});
  // Phase I: emit a selection event whenever the user clicks a project row so
  // the Profile tab can refocus on that project. We keep expand/collapse as
  // the same gesture — selecting a project is the same click that opens its
  // queue/docs/specs sub-tree, so users don't pay an extra click for the
  // profile flip.
  const onSelectProject = opts.onSelectProject || (() => {});
  let selectedRowEl = null;
  let selectedProject = null;

  root.innerHTML = '<div class="sup-tree-empty">Loading projects…</div>';

  function makeGroupNode(label, loader, renderChildren) {
    const wrap = document.createElement('div');
    wrap.className = 'sup-tree-node';
    wrap.innerHTML = `
      <div class="sup-tree-row group">
        <span class="sup-chev">▸</span>
        <span class="sup-label">${esc(label)}</span>
      </div>
      <div class="sup-tree-children"></div>
    `;
    const rowEl = wrap.querySelector('.sup-tree-row');
    const childrenEl = wrap.querySelector('.sup-tree-children');
    let loaded = false;
    rowEl.addEventListener('click', async (e) => {
      e.stopPropagation();
      const expanded = wrap.classList.toggle('expanded');
      rowEl.querySelector('.sup-chev').textContent = expanded ? '▾' : '▸';
      if (expanded && !loaded) {
        loaded = true;
        childrenEl.innerHTML = '<div class="sup-tree-loading">loading…</div>';
        try {
          const data = await loader();
          if (!alive) return;
          childrenEl.innerHTML = '';
          renderChildren(childrenEl, data);
        } catch (err) {
          childrenEl.innerHTML = `<div class="sup-tree-loading">error: ${esc(err.message || err)}</div>`;
        }
      }
    });
    return wrap;
  }

  function renderQueueChildren(childrenEl, tasks) {
    if (!tasks.length) {
      childrenEl.innerHTML = '<div class="sup-tree-loading">no matching tasks</div>';
      return;
    }
    tasks.slice(0, 50).forEach((t) => {
      const row = document.createElement('div');
      row.className = 'sup-tree-row leaf';
      row.title = `${t.id} — ${t.status || ''}`;
      row.innerHTML = `
        <span class="sup-label">${esc((t.title || t.id || '').slice(0, 48))}</span>
        <span class="sup-meta-chip">${esc(t.status || '')}</span>
      `;
      row.addEventListener('click', (ev) => {
        ev.stopPropagation();
        onScrollToTask(t.id);
      });
      childrenEl.appendChild(row);
    });
  }

  function renderDocsChildren(childrenEl, docs) {
    if (!docs.length) {
      childrenEl.innerHTML = '<div class="sup-tree-loading">no docs</div>';
      return;
    }
    docs.forEach((d) => {
      const row = document.createElement('div');
      row.className = 'sup-tree-row leaf';
      row.title = d.path;
      row.innerHTML = `<span class="sup-label">${esc(d.label)}</span>`;
      row.addEventListener('click', (ev) => {
        ev.stopPropagation();
        openFile(d.path);
      });
      childrenEl.appendChild(row);
    });
  }

  function renderSpecsChildren(childrenEl, specs) {
    if (!specs.length) {
      childrenEl.innerHTML = '<div class="sup-tree-loading">no specs</div>';
      return;
    }
    specs.forEach((s) => {
      const slugWrap = document.createElement('div');
      slugWrap.className = 'sup-tree-node';
      const phaseChip = s.phase ? `<span class="sup-meta-chip" title="${esc(s.phase)}">${esc(s.phase.slice(0, 18))}</span>` : '';
      slugWrap.innerHTML = `
        <div class="sup-tree-row group">
          <span class="sup-chev">▸</span>
          <span class="sup-label">${esc(s.slug)}</span>
          ${phaseChip}
        </div>
        <div class="sup-tree-children"></div>
      `;
      const slugRow = slugWrap.querySelector('.sup-tree-row');
      const slugKids = slugWrap.querySelector('.sup-tree-children');
      slugRow.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const expanded = slugWrap.classList.toggle('expanded');
        slugRow.querySelector('.sup-chev').textContent = expanded ? '▾' : '▸';
        if (expanded && !slugKids.children.length) {
          s.files.forEach((f) => {
            const r = document.createElement('div');
            r.className = 'sup-tree-row leaf';
            r.title = f.path;
            r.innerHTML = `<span class="sup-label">${esc(f.label)}</span>`;
            r.addEventListener('click', (e2) => {
              e2.stopPropagation();
              openFile(f.path);
            });
            slugKids.appendChild(r);
          });
        }
      });
      childrenEl.appendChild(slugWrap);
    });
  }

  function buildProjectNode(p) {
    const node = document.createElement('div');
    node.className = 'sup-tree-node';
    node.innerHTML = `
      <div class="sup-tree-row project">
        <span class="sup-chev">▸</span>
        <span class="sup-label">${esc(p.name)}</span>
      </div>
      <div class="sup-tree-children"></div>
    `;
    const rowEl = node.querySelector('.sup-tree-row');
    const childrenEl = node.querySelector('.sup-tree-children');
    let built = false;
    rowEl.addEventListener('click', () => {
      // Phase I: mark this project as the selected one before toggling
      // expansion. Selection is independent of expand/collapse — the
      // user can collapse a project and still have it remain selected —
      // but the same click drives both.
      if (selectedRowEl && selectedRowEl !== rowEl) {
        selectedRowEl.classList.remove('selected');
      }
      rowEl.classList.add('selected');
      selectedRowEl = rowEl;
      if (!selectedProject || selectedProject.path !== p.path) {
        selectedProject = p;
        onSelectProject(p);
      }
      const expanded = node.classList.toggle('expanded');
      rowEl.querySelector('.sup-chev').textContent = expanded ? '▾' : '▸';
      if (expanded && !built) {
        built = true;

        const queueNode = makeGroupNode(
          'queue',
          async () => {
            const ws = await fetchJson('/api/workspace');
            return flatTasks(ws).filter((t) => taskMatchesProject(t, p.name));
          },
          renderQueueChildren
        );
        const docsNode = makeGroupNode(
          'docs',
          () => ipcRenderer.invoke(SUP.SUPERVISOR_LIST_PROJECT_DOCS, {
            project_id: p.name,
            project_path: p.path,
          }),
          renderDocsChildren
        );
        const specsNode = makeGroupNode(
          '.frame/specs',
          () => ipcRenderer.invoke(SUP.SUPERVISOR_LIST_PROJECT_SPECS, {
            project_path: p.path,
          }),
          renderSpecsChildren
        );
        childrenEl.appendChild(queueNode);
        childrenEl.appendChild(docsNode);
        childrenEl.appendChild(specsNode);
      }
    });
    return node;
  }

  async function load() {
    try {
      const projects = await ipcRenderer.invoke(SUP.SUPERVISOR_LIST_WORKSPACE_PROJECTS);
      if (!alive) return;
      root.innerHTML = '';
      if (!projects || !projects.length) {
        root.innerHTML = '<div class="sup-tree-empty">No Frame projects in workspace.<br/><small>Add one from the Home board.</small></div>';
        return;
      }
      projects.forEach((p) => {
        root.appendChild(buildProjectNode(p));
      });
    } catch (err) {
      if (!alive) return;
      root.innerHTML = `<div class="sup-tree-empty">project list unavailable<br/><small>${esc(err.message || err)}</small></div>`;
    }
  }

  function start() {
    load();
  }

  function stop() {
    alive = false;
  }

  start();
  return { start, stop, refresh: load };
}

module.exports = { create };
