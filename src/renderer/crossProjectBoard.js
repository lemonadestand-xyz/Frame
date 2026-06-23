/**
 * Cross-project supervisor board — aggregated dashboard.
 *
 * Renders one section per Frame-project the user has open, with each
 * project's specs as rows showing supervisor state (route, confidence,
 * undone count, pending escalation). Layout borrows from the supervisor
 * PWA's Kanban "Needs you" treatment for escalation rows.
 *
 * Mount with `attach(rootEl, { onOpenSpec })`. The board self-subscribes
 * to supervisorClient and re-renders on every state change.
 */

const supervisorClient = require('./supervisorClient');

const PHASE_TAG = {
  draft: { label: 'draft', color: '#888' },
  specified: { label: 'spec', color: '#aaa' },
  planned: { label: 'planned', color: '#aaa' },
  tasks_generated: { label: 'tasks', color: '#88a8ff' },
  implementing: { label: 'impl', color: '#3fb27f' },
  done: { label: 'done', color: '#3fb27f' },
};

const ROUTE_TAG = {
  advance: { label: 'advance', color: '#88a8ff' },
  implement: { label: 'implement', color: '#3fb27f' },
  research: { label: 'research', color: '#e7d49e' },
  escalate: { label: 'needs you', color: '#e0556b' },
  critic: { label: 'critic', color: '#88a8ff' },
  done: { label: 'done', color: '#3fb27f' },
};

function attach(rootEl, { onOpenSpec } = {}) {
  if (!rootEl) return () => {};
  supervisorClient.init();
  let unsub = null;

  const render = (snapshot) => {
    if (rootEl.isConnected === false) return;
    rootEl.innerHTML = _renderBoard(snapshot);
    rootEl.querySelectorAll('[data-action="pause-spec"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        supervisorClient.stop({
          projectPath: btn.dataset.projectPath,
          slug: btn.dataset.slug,
        });
      });
    });
    rootEl.querySelectorAll('[data-action="open-spec"]').forEach((row) => {
      row.addEventListener('click', () => {
        if (typeof onOpenSpec === 'function') {
          onOpenSpec({ projectPath: row.dataset.projectPath, slug: row.dataset.slug });
        }
      });
    });
    const pauseAllBtn = rootEl.querySelector('[data-action="pause-all"]');
    if (pauseAllBtn) {
      pauseAllBtn.addEventListener('click', () => supervisorClient.pauseAll());
    }
  };

  unsub = supervisorClient.onChange(render);
  render(supervisorClient.getSnapshot());

  return () => { if (unsub) unsub(); };
}

function _renderBoard(snapshot) {
  const projects = snapshot.projects || [];
  if (projects.length === 0) {
    return `
      <div class="xp-board">
        <div class="xp-board-toolbar">
          <span class="xp-board-title">ACROSS PROJECTS</span>
          <span class="xp-board-meta">no active supervisors</span>
        </div>
        <div class="xp-board-empty">No supervisor runs in flight. Open a spec and enable Auto to start one.</div>
      </div>`;
  }
  return `
    <div class="xp-board">
      <div class="xp-board-toolbar">
        <span class="xp-board-title">ACROSS PROJECTS</span>
        <span class="xp-board-meta">${snapshot.totalActive} active · ${snapshot.totalEscalations} needs you</span>
        <button type="button" class="btn btn-secondary xp-board-pause-all" data-action="pause-all">Pause all</button>
      </div>
      ${projects.map(_renderProject).join('')}
    </div>
  `;
}

function _renderProject(p) {
  const label = _basename(p.projectPath);
  return `
    <section class="xp-project">
      <header class="xp-project-header">
        <span class="xp-project-label">${_escape(label)}</span>
        <span class="xp-project-counts">${p.activeCount} active${p.escalationCount > 0 ? ` · ${p.escalationCount} needs you` : ''}</span>
      </header>
      <div class="xp-spec-grid">
        ${(p.specs || []).map((s) => _renderSpec(p.projectPath, s)).join('') || '<div class="xp-empty">no specs</div>'}
      </div>
    </section>
  `;
}

function _renderSpec(projectPath, spec) {
  const phase = PHASE_TAG[spec.lastVerdict?.phase || spec.phase || 'specified'] || PHASE_TAG.specified;
  const route = ROUTE_TAG[spec.lastVerdict?.route] || null;
  const isEscalation = spec.lastVerdict?.route === 'escalate';
  return `
    <div class="xp-spec ${isEscalation ? 'xp-spec-escalation' : ''}" data-action="open-spec" data-project-path="${_escape(projectPath)}" data-slug="${_escape(spec.slug)}">
      <div class="xp-spec-tags">
        <span class="xp-tag" style="background:${phase.color}22;color:${phase.color}">${phase.label}</span>
        ${route ? `<span class="xp-tag" style="background:${route.color}22;color:${route.color}">${route.label}</span>` : ''}
        ${spec.lastVerdict?.confidence != null ? `<span class="xp-confidence">${Math.round(spec.lastVerdict.confidence * 100)}%</span>` : ''}
      </div>
      <div class="xp-spec-title">${_escape(spec.slug)}</div>
      ${spec.lastVerdict?.reasoning ? `<div class="xp-spec-reasoning">${_escape(spec.lastVerdict.reasoning)}</div>` : ''}
      ${isEscalation && spec.lastVerdict?.draftedQuestion ? `<div class="xp-spec-escalation-q">${_escape(spec.lastVerdict.draftedQuestion)}</div>` : ''}
      <div class="xp-spec-footer">
        <span class="xp-spec-meta">tick ${spec.tickCount || 0}${spec.lastTickAt ? ` · ${_relativeTime(spec.lastTickAt)}` : ''}</span>
        ${spec.status === 'running' ? `<button type="button" class="xp-spec-action" data-action="pause-spec" data-project-path="${_escape(projectPath)}" data-slug="${_escape(spec.slug)}" onclick="event.stopPropagation()">Pause</button>` : `<span class="xp-spec-status">${_escape(spec.status || 'idle')}</span>`}
      </div>
    </div>
  `;
}

function _basename(p) {
  if (!p) return 'project';
  const parts = String(p).split(/[\\/]/);
  return parts[parts.length - 1] || parts[parts.length - 2] || p;
}

function _relativeTime(iso) {
  try {
    const ts = new Date(iso).getTime();
    const ago = Math.max(0, (Date.now() - ts) / 1000);
    if (ago < 60) return `${Math.round(ago)}s ago`;
    if (ago < 3600) return `${Math.round(ago / 60)}m ago`;
    return `${Math.round(ago / 3600)}h ago`;
  } catch { return ''; }
}

function _escape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

module.exports = { attach };
