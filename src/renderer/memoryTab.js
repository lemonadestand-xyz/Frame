/**
 * Memory tab — renderer for the spec section's *Memory* tab.
 *
 * Read-only list of Basic Memory notes for the project, defaulting to the
 * subset that mention the current spec via `metadata.spec_slug`. A "Show all
 * project notes" toggle expands the view to every category/spec across the
 * project. A search box at the top swaps the listing path:
 *
 *   • Empty query → `LIST_MEMORY` IPC → all notes (filtered by spec_slug)
 *   • Non-empty   → `SEARCH_MEMORY` IPC → keyword-scored top-k
 *                  (with the same spec_slug filter unless "show all" is on)
 *
 * Memory writes are owned by the supervisor loop / memoryMirror; this
 * surface intentionally does not edit.
 *
 * The renderer keeps DOM building in `renderHtml` (a pure helper exposed for
 * tests) — IPC + lifecycle live in `mount`.
 */

const { IPC } = require('../shared/ipcChannels');

let _ipcRenderer = null;
try { _ipcRenderer = require('electron').ipcRenderer; } catch { /* test env */ }

const SEARCH_DEBOUNCE_MS = 200;
const SEARCH_TOP_K = 25;

// ─── Pure helpers ────────────────────────────────────────

/**
 * Filter notes by spec_slug. When `showAll` is true OR `scope === 'project'`,
 * returns the entire notes array unchanged (no spec scoping).
 */
function filterNotes(notes, { slug, showAll, scope } = {}) {
  if (!Array.isArray(notes)) return [];
  if (scope === 'project') return notes.slice();
  if (showAll) return notes.slice();
  if (!slug) return [];
  return notes.filter((n) => n && n.metadata && n.metadata.spec_slug === slug);
}

/**
 * Render the notes list as HTML. Pure — no IPC, no DOM globals required.
 * `notes` are the already-filtered notes; `opts.slug` controls the empty
 * state copy. `opts.query` is the active search query (empty string when
 * not searching) — controls the empty-state copy.
 */
function renderHtml(notes, opts = {}) {
  const { slug, showAll = false, query = '', scope = 'spec' } = opts;
  // Project scope has no "filter to this spec" affordance — show all by default.
  const showToggle = scope !== 'project';
  const effectivelyShowingAll = scope === 'project' || showAll;
  const toggleLabel = showAll ? 'Show only this spec' : 'Show all project notes';
  const scopeLabel = scope === 'project' ? ' (project)' : '';
  const summary = query
    ? `${notes.length} match${notes.length === 1 ? '' : 'es'} for "${_escape(query)}"${scopeLabel}`
    : `${notes.length} note${notes.length === 1 ? '' : 's'}${slug && !effectivelyShowingAll ? ` for ${slug}` : scopeLabel}`;
  const header = `
    <div class="memory-tab-controls">
      <input type="text" class="memory-tab-search" data-action="search" placeholder="Search memory…" value="${_escape(query)}" />
      ${showToggle ? `<button type="button" class="btn memory-tab-toggle" data-action="toggle-show-all">${_escape(toggleLabel)}</button>` : ''}
    </div>
    <div class="memory-tab-header">
      <span class="memory-tab-summary">${_replaceSummarySlug(summary, slug)}</span>
    </div>
  `;
  if (notes.length === 0) {
    let hint;
    if (query) hint = `No notes matched <code>${_escape(query)}</code>.`;
    else if (effectivelyShowingAll) hint = 'No notes yet for this project. The supervisor loop writes durable decisions here automatically as escalations are answered.';
    else hint = `No notes tagged with <code>spec_slug: ${_escape(slug || '')}</code> yet. Toggle <em>${_escape(toggleLabel)}</em> to see the full project memory.`;
    return `${header}<div class="memory-tab-empty">${hint}</div>`;
  }
  const rows = notes.map(_renderRow).join('');
  return `${header}<div class="memory-tab-list">${rows}</div>`;
}

// Wraps the slug-in-summary text in a <code> tag without polluting renderHtml
// with conditional logic that's harder to test. The summary string is already
// escaped except for the slug substring, which we know is safe (it came from
// the spec system) but still escape defensively.
function _replaceSummarySlug(summary, slug) {
  if (!slug) return summary;
  return summary.replace(` for ${slug}`, ` for <code>${_escape(slug)}</code>`);
}

function _renderRow(note) {
  const cat = note.category || 'note';
  const title = note.title || (note.path ? note.path.split('/').pop() : 'untitled');
  const created = note.metadata?.created_at || '';
  const slugMeta = note.metadata?.spec_slug || '';
  const bodyPreview = (note.body || '').replace(/^#\s+.*\n+/, '').slice(0, 280);
  const score = (typeof note.score === 'number') ? note.score : null;
  return `
    <div class="memory-tab-row" data-category="${_escape(cat)}">
      <div class="memory-tab-row-head">
        <span class="memory-tab-cat memory-tab-cat-${_escape(cat)}">${_escape(cat)}</span>
        <span class="memory-tab-title">${_escape(title)}</span>
        ${slugMeta ? `<span class="memory-tab-slug">${_escape(slugMeta)}</span>` : ''}
        ${score != null ? `<span class="memory-tab-score" title="Keyword score">${score}</span>` : ''}
        ${created ? `<span class="memory-tab-ts">${_escape(_formatTs(created))}</span>` : ''}
      </div>
      ${bodyPreview ? `<div class="memory-tab-body">${_escape(bodyPreview)}${(note.body || '').length > 280 ? '…' : ''}</div>` : ''}
    </div>
  `;
}

function _formatTs(iso) {
  try { return new Date(iso).toLocaleString(); }
  catch { return iso; }
}

function _escape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── UI mount ────────────────────────────────────────────

/**
 * Mount the Memory tab into an existing container element. Loads notes
 * via LIST_MEMORY (or SEARCH_MEMORY when the search box is non-empty),
 * renders the list, wires the search box and the "show all" toggle.
 *
 * @param {HTMLElement} container
 * @param {{projectPath: string, slug: string}} opts
 * @returns {{refresh: () => Promise<void>}}
 */
function mount(container, { projectPath, slug, scope = 'spec' } = {}) {
  if (!container) return { refresh: async () => {} };
  let showAll = false;
  let query = '';
  let notes = [];
  let searchTimer = null;

  async function _load() {
    if (!projectPath || !_ipcRenderer) { notes = []; return; }
    try {
      if (query) {
        const results = await _ipcRenderer.invoke(IPC.SEARCH_MEMORY, {
          projectPath, query, k: SEARCH_TOP_K,
        });
        notes = Array.isArray(results) ? results : [];
      } else {
        const all = await _ipcRenderer.invoke(IPC.LIST_MEMORY, { projectPath });
        notes = Array.isArray(all) ? all : [];
      }
    } catch {
      notes = [];
    }
  }

  function _filterForView() {
    // Search results are already content-matched; only apply the spec_slug
    // filter when "show all" is off so the user can scope queries.
    return filterNotes(notes, { slug, showAll, scope });
  }

  function _draw() {
    const filtered = _filterForView();
    container.innerHTML = renderHtml(filtered, { slug, showAll, query, scope });
    _attachHandlers();
  }

  function _attachHandlers() {
    const toggle = container.querySelector('[data-action="toggle-show-all"]');
    if (toggle) {
      toggle.addEventListener('click', () => {
        showAll = !showAll;
        _draw();
      });
    }
    const search = container.querySelector('[data-action="search"]');
    if (search) {
      // Preserve focus + caret position across the re-render.
      const wasFocused = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.action === 'search';
      if (wasFocused) {
        search.focus();
        const len = search.value.length;
        try { search.setSelectionRange(len, len); } catch { /* readonly inputs */ }
      }
      search.addEventListener('input', (e) => {
        const next = String(e.target.value || '').trim();
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(async () => {
          query = next;
          await _load();
          _draw();
        }, SEARCH_DEBOUNCE_MS);
      });
    }
  }

  async function refresh() {
    container.innerHTML = '<div class="memory-tab-loading">Loading memory notes…</div>';
    await _load();
    _draw();
  }

  refresh();
  return { refresh };
}

module.exports = {
  mount,
  // pure helpers exposed for tests
  filterNotes,
  renderHtml,
};
