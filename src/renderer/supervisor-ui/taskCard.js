// Supervisor task card — Phase B (collapsed) + Phase M (slim + modal).
//
// Phase H wired full task detail into an inline expansion on the card body;
// Chris's PWA-parity smoke test 2026-06-23 found this overwhelming for the
// scanning use case (browsing 30+ cards at a glance). Phase M slims the card
// to title + project + status + an attention icon for tasks in the awaiting
// column, and moves the detail surface to taskDetailModal.js (mirrors the
// PWA's openTaskDetail behavior).
//
// We keep:
//   - "Tail log" affordance for in-flight cards (Phase C live PTY pane)
//   - Artifact links on done/failed cards (compact list under the body)
// Both live OUTSIDE the body wrapper so clicking them never triggers the
// modal-open click; the body click and the title click both trigger the
// modal so the entire card surface is a discoverable target.

const path = require('path');

const taskDetailModal = require('./taskDetailModal');

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function statusTag(t) {
  if (t.pending_human_response) return 'escalate';
  if (t.last_critique_verdict === 'revise') return 'revising';
  if (t.status === 'done') return 'done';
  if (t.status === 'failed') return 'failed';
  if (t.status === 'pending') return 'pending';
  return 'running';
}

function resolveDeliverable(p, supervisorRoot) {
  if (!p) return p;
  if (path.isAbsolute(p)) return p;
  if (!supervisorRoot) return p;
  return path.resolve(supervisorRoot, p);
}

/**
 * Render a single task card into `parentEl`.
 * @param {object} t              task object from /api/workspace
 * @param {string} columnKey      pending|active|awaiting|done|failed
 * @param {object} ctx            { supervisorRoot, onArtifactClick }
 * @returns {HTMLElement} the card element (for highlighting/scroll-to)
 */
function render(t, columnKey, ctx) {
  const card = document.createElement('div');
  const tag = statusTag(t);
  card.className = 'sup-card';
  if (tag === 'escalate') card.classList.add('esc');
  if (tag === 'done' || tag === 'failed') card.classList.add('done');
  card.dataset.taskId = t.id || '';

  // Project chip — pulled from the profile, which is the closest thing the
  // task object carries to a project label (the workspace payload has no
  // explicit project_id). Strip the "profiles/" prefix and trailing .yaml
  // for a compact chip.
  const projectName = (() => {
    if (!t.profile) return '';
    return String(t.profile)
      .replace(/^profiles\//, '')
      .replace(/\.ya?ml$/i, '');
  })();
  const projectChip = projectName
    ? `<span class="sup-card-project" title="${esc(t.profile || '')}">${esc(projectName)}</span>`
    : '';

  // Attention icon — surfaces a red dot ONLY when this task is waiting on a
  // human response (typically the awaiting column). Other escalation states
  // (revise verdicts, etc) are surfaced via the status badge color, not a
  // separate icon, to keep the visual budget tight.
  const attention = t.pending_human_response
    ? '<span class="sup-card-attention" title="Awaiting your response">●</span>'
    : '';

  // The body is the click target for opening the modal. Title + status badge
  // + project chip live inside; tail log + artifacts sit outside so their
  // own clicks don't fire the modal.
  card.innerHTML = `
    <div class="sup-card-body" data-role="card-body">
      <div class="sup-card-title-row">
        <span class="sup-card-title" title="${esc(t.title || '')}">${esc(t.title || t.id || '(untitled)')}</span>
        ${attention}
      </div>
      <div class="sup-card-chips">
        <span class="sup-tag ${tag}">${tag}</span>
        ${projectChip}
      </div>
    </div>
  `;

  const bodyEl = card.querySelector('[data-role="card-body"]');
  if (bodyEl) {
    bodyEl.addEventListener('click', (e) => {
      // Internal buttons / links bubble unaffected; everything else opens
      // the detail modal.
      if (e.target.closest('button, a')) return;
      try {
        taskDetailModal.open(t, {
          supervisorRoot: ctx && ctx.supervisorRoot,
          onOpenFile: ctx && ctx.onArtifactClick,
        });
      } catch (err) {
        console.warn('[supervisor] failed to open task detail modal:', err);
      }
    });
  }

  // "Tail log" affordance for in-flight cards (Phase C). The pane mounts a
  // PTY tailing the daemon's stdout for the task; orthogonal to the detail
  // modal so a user can keep both open.
  if (columnKey === 'active' && t.id && ctx && ctx.supervisorRoot) {
    const tailRow = document.createElement('div');
    tailRow.className = 'sup-card-tail-row';
    const tailBtn = document.createElement('button');
    tailBtn.type = 'button';
    tailBtn.className = 'sup-card-tail-btn';
    tailBtn.textContent = '▾ Tail log';
    tailRow.appendChild(tailBtn);

    const tailArea = document.createElement('div');
    tailArea.className = 'sup-card-tail-area';
    tailRow.appendChild(tailArea);

    let pane = null;
    let tailOpen = false;
    tailBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      tailOpen = !tailOpen;
      tailBtn.textContent = tailOpen ? '▴ Hide log' : '▾ Tail log';
      tailArea.classList.toggle('open', tailOpen);
      if (tailOpen) {
        const lop = require('./liveOutputPane');
        pane = lop.create(tailArea, { taskId: t.id, supervisorRoot: ctx.supervisorRoot });
        pane.start();
      } else if (pane) {
        pane.stop();
        pane = null;
        tailArea.innerHTML = '';
      }
    });
    card.appendChild(tailRow);
  }

  // Artifact links on done/failed cards — quick-jump to the most useful
  // deliverables without having to open the modal.
  const deliverables = Array.isArray(t.deliverables) ? t.deliverables : [];
  if (deliverables.length && (tag === 'done' || tag === 'failed')) {
    const artifactsEl = document.createElement('div');
    artifactsEl.className = 'sup-artifacts';
    deliverables.slice(0, 4).forEach((rel) => {
      const abs = resolveDeliverable(rel, ctx && ctx.supervisorRoot);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sup-artifact';
      const filename = path.basename(rel);
      btn.textContent = `▸ ${filename}`;
      btn.title = abs || rel;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (ctx && typeof ctx.onArtifactClick === 'function') {
          ctx.onArtifactClick(abs || rel);
        }
      });
      artifactsEl.appendChild(btn);
    });
    card.appendChild(artifactsEl);
  }

  return card;
}

// Phase H exported resetExpansion() for kanban.js to call on stop() — that
// cleared inline-expansion state. Phase M's modal owns its own lifecycle, so
// resetExpansion is a no-op now but stays exported for API compatibility.
function resetExpansion() {
  try { taskDetailModal.close(); } catch { /* no-op */ }
}

module.exports = { render, statusTag, resetExpansion };
