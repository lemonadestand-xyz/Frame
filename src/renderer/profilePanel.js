/**
 * Project Profile panel — inline editor for `.frame/profile.json`.
 *
 * Mounts as a tab inside the projects sidebar view (alongside *Workspace*).
 * Renders a structured form (policy / budgets / capabilities / role channel)
 * side-by-side with the raw JSON. Editing one re-syncs the other on blur
 * (form → JSON instant; JSON → form on Save).
 *
 * When `.frame/profile.json` is missing on disk (`fileExists === false`),
 * the panel surfaces a nudge banner with a "Generate default" button
 * (B-T11) that calls SAVE_PROFILE with the in-memory default profile.
 * The fileExists signal — distinct from the source string — lets the
 * banner stay quiet when the file is present but malformed (the user
 * should fix the file, not overwrite it).
 *
 * Pure helpers (profileToFormData / formDataToProfile / parseJsonSafely /
 * shouldShowNudge) are exported separately so the module can be unit-
 * tested under jest's node environment (no DOM mocking needed).
 */

const { IPC } = require('../shared/ipcChannels');

let _ipcRenderer = null;
try { _ipcRenderer = require('electron').ipcRenderer; } catch { /* test env */ }

// ─── Pure helpers (jest-friendly) ──────────────────────────

/**
 * Project a profile object into a flat form-data shape the structured form
 * binds to. The flat shape lets the form's inputs read/write via simple
 * keys; convertable back via formDataToProfile.
 */
function profileToFormData(profile) {
  const p = profile || {};
  const policy = p.policy || {};
  const budgets = p.budgets || {};
  return {
    id: p.id || '',
    escalateCategories: (policy.escalate_categories || []).join(', '),
    costCeilingUsd: policy.cost_ceiling_usd == null ? '' : String(policy.cost_ceiling_usd),
    iterationCap: budgets.iteration_cap == null ? '' : String(budgets.iteration_cap),
    spendPerTaskUsd: budgets.spend_per_task_usd == null ? '' : String(budgets.spend_per_task_usd),
    spendPerDayUsd: budgets.spend_per_day_usd == null ? '' : String(budgets.spend_per_day_usd),
    capabilities: (p.capabilities || []).join(', '),
    contextSources: (p.context_sources || []).join('\n'),
  };
}

/**
 * Fold form-data back onto a profile object. Unknown / unmanaged fields on
 * the source profile (e.g. roles, people, ledger, escalation block) are
 * preserved untouched — the form only owns the subset it surfaces.
 */
function formDataToProfile(formData, basis) {
  const out = JSON.parse(JSON.stringify(basis || {}));
  out.id = (formData.id || '').trim();
  out.policy = out.policy || {};
  out.policy.escalate_categories = _parseCsv(formData.escalateCategories);
  out.policy.cost_ceiling_usd = _parseFloatOrNull(formData.costCeilingUsd);
  out.budgets = out.budgets || {};
  out.budgets.iteration_cap = _parseIntOrNull(formData.iterationCap);
  out.budgets.spend_per_task_usd = _parseFloatOrNull(formData.spendPerTaskUsd);
  out.budgets.spend_per_day_usd = _parseFloatOrNull(formData.spendPerDayUsd);
  out.capabilities = _parseCsv(formData.capabilities);
  out.context_sources = _parseLines(formData.contextSources);
  return out;
}

function parseJsonSafely(raw) {
  if (typeof raw !== 'string') return { ok: false, error: 'not a string', value: null };
  try { return { ok: true, error: null, value: JSON.parse(raw) }; }
  catch (err) { return { ok: false, error: err.message, value: null }; }
}

/**
 * Decide whether the "no profile yet — generate default?" banner shows.
 * Trigger condition: the project has no `.frame/profile.json` on disk
 * AND no supervisor YAML is available either. A malformed/invalid file
 * is still a file — show the warning, not the nudge. When a supervisor
 * YAML *is* discoverable, show the supervisor banner instead.
 */
function shouldShowNudge(loaded) {
  if (!loaded || typeof loaded !== 'object') return false;
  if (loaded.fileExists !== false) return false;
  if (loaded.supervisorAvailable === true) return false;
  return true;
}

/**
 * Decide whether the "supervisor profile found — migrate?" banner shows.
 * Triggers when the loader reported `source: 'supervisor'` AND no
 * `.frame/profile.json` is on disk — i.e. the canonical YAML was
 * translated on the fly and the user has a one-click migration path.
 */
function shouldShowSupervisorBanner(loaded) {
  if (!loaded || typeof loaded !== 'object') return false;
  return loaded.fileExists === false && loaded.supervisorAvailable === true;
}

/**
 * Build the IPC payload sent on "Generate default" click. The default profile
 * was already returned by LOAD_PROFILE when fileExists=false; the button just
 * persists it via SAVE_PROFILE.
 */
function buildNudgeSavePayload(state) {
  if (!state || typeof state !== 'object') return null;
  if (!state.projectPath || !state.profile) return null;
  return { projectPath: state.projectPath, profile: state.profile };
}

/**
 * Render the nudge banner HTML. Exposed for tests so we can assert the
 * button is present, has the right class, and includes the "Generate default"
 * label without standing up a DOM.
 */
function renderNudgeBannerHtml() {
  return `
    <div class="profile-tab-nudge" role="status">
      <span class="profile-tab-nudge-icon">⚠️</span>
      <span class="profile-tab-nudge-text">
        No <code>.frame/profile.json</code> for this project yet — running under the permissive default.
      </span>
      <button type="button" class="btn profile-tab-nudge-generate">Generate default</button>
    </div>
  `;
}

/**
 * Render the "supervisor profile found" banner. Surfaces when a canonical
 * supervisor YAML matches this workdir but no `.frame/profile.json`
 * exists yet — the Migrate button persists the in-memory translated
 * profile (already returned by LOAD_PROFILE).
 */
function renderSupervisorBannerHtml() {
  return `
    <div class="profile-tab-supervisor-banner" role="status">
      <span class="profile-tab-nudge-icon">✨</span>
      <span class="profile-tab-nudge-text">
        Supervisor profile found for this workdir — translated on the fly.
        Save it as <code>.frame/profile.json</code> to keep it with the repo.
      </span>
      <button type="button" class="btn btn-primary profile-tab-supervisor-migrate">Migrate</button>
    </div>
  `;
}

function _parseCsv(s) {
  if (!s) return [];
  return String(s).split(',').map((t) => t.trim()).filter(Boolean);
}
function _parseLines(s) {
  if (!s) return [];
  return String(s).split(/\r?\n/).map((t) => t.trim()).filter(Boolean);
}
function _parseIntOrNull(s) {
  if (s === '' || s == null) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}
function _parseFloatOrNull(s) {
  if (s === '' || s == null) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

// ─── Inline mount (DOM-bound) ──────────────────────────────

/**
 * Mount the Profile editor into a host container. Loads the profile via
 * IPC, renders the structured form + raw JSON side-by-side, wires the
 * nudge banner (when the project has no profile.json on disk), and
 * persists edits via SAVE_PROFILE.
 *
 * @param {HTMLElement} container
 * @param {{projectPath: string}} opts
 * @returns {{refresh: () => Promise<void>}}
 */
function mount(container, { projectPath } = {}) {
  if (!container) return { refresh: async () => {} };
  let state = { projectPath, profile: null, source: 'default', fileExists: false, warnings: [] };

  async function _load() {
    if (!projectPath || !_ipcRenderer) {
      state = { projectPath, profile: null, source: 'default', fileExists: false, supervisorAvailable: false, warnings: [] };
      return;
    }
    try {
      const loaded = await _ipcRenderer.invoke(IPC.LOAD_PROFILE, { projectPath });
      state = {
        projectPath,
        profile: loaded.profile,
        source: loaded.source,
        fileExists: loaded.fileExists === true,
        supervisorAvailable: loaded.supervisorAvailable === true,
        warnings: loaded.warnings || [],
      };
    } catch (err) {
      state = { projectPath, profile: null, source: 'default', fileExists: false, supervisorAvailable: false, warnings: [String(err && err.message)] };
    }
  }

  function _draw() {
    if (!state.profile) {
      container.innerHTML = `<div class="profile-tab-empty">${projectPath ? 'Loading profile…' : 'Select a project to view its profile.'}</div>`;
      return;
    }
    const formData = profileToFormData(state.profile);
    const jsonText = JSON.stringify(state.profile, null, 2);
    const nudge = shouldShowNudge(state);
    const supervisorBanner = shouldShowSupervisorBanner(state);
    const sourceLabel = state.fileExists
      ? '.frame/profile.json'
      : (state.supervisorAvailable ? 'supervisor YAML (translated)' : 'default (no file)');
    container.innerHTML = `
      ${supervisorBanner ? renderSupervisorBannerHtml() : ''}
      ${nudge ? _renderNudgeBanner() : ''}
      ${state.fileExists && state.warnings.length > 0 ? _renderWarnings(state.warnings) : ''}
      <div class="profile-tab-meta">
        <span class="profile-tab-source" data-source="${_escape(state.source)}">${_escape(sourceLabel)}</span>
      </div>
      <div class="profile-tab-body">
        <div class="profile-tab-form">${_renderForm(formData)}</div>
        <div class="profile-tab-json">
          <label class="profile-tab-json-label" for="profile-tab-json-text">Raw JSON</label>
          <textarea id="profile-tab-json-text" class="profile-tab-json-text" spellcheck="false">${_escape(jsonText)}</textarea>
          <div class="profile-tab-json-error" id="profile-tab-json-error"></div>
        </div>
      </div>
      <div class="profile-tab-actions">
        <span class="profile-tab-status" id="profile-tab-status"></span>
        <button type="button" class="btn profile-tab-reload">Reload</button>
        <button type="button" class="btn btn-primary profile-tab-save">Save profile</button>
      </div>
    `;
    _wireHandlers();
  }

  function _wireHandlers() {
    const jsonEl = container.querySelector('#profile-tab-json-text');
    const errorEl = container.querySelector('#profile-tab-json-error');
    const statusEl = container.querySelector('#profile-tab-status');
    const saveBtn = container.querySelector('.profile-tab-save');
    const reloadBtn = container.querySelector('.profile-tab-reload');
    const generateBtn = container.querySelector('.profile-tab-nudge-generate');

    // Form input → JSON sync on blur
    container.querySelectorAll('[data-field]').forEach((input) => {
      input.addEventListener('blur', () => {
        const fd = _readFormData(container);
        const next = formDataToProfile(fd, state.profile);
        state.profile = next;
        if (jsonEl) jsonEl.value = JSON.stringify(next, null, 2);
        if (errorEl) errorEl.textContent = '';
      });
    });

    // JSON edit → re-validate on every keystroke; form re-sync on Save.
    if (jsonEl) {
      jsonEl.addEventListener('input', () => {
        const r = parseJsonSafely(jsonEl.value);
        if (errorEl) errorEl.textContent = r.ok ? '' : `Invalid JSON: ${r.error}`;
      });
    }

    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        // Prefer the JSON view as source of truth — the user may have
        // edited fields not surfaced in the form.
        const r = parseJsonSafely(jsonEl.value);
        if (!r.ok) {
          if (errorEl) errorEl.textContent = `Cannot save — invalid JSON: ${r.error}`;
          return;
        }
        saveBtn.disabled = true;
        if (statusEl) statusEl.textContent = 'Saving…';
        const res = await _ipcRenderer.invoke(IPC.SAVE_PROFILE, {
          projectPath: state.projectPath, profile: r.value,
        });
        saveBtn.disabled = false;
        if (!res || !res.success) {
          if (statusEl) statusEl.textContent = '';
          if (errorEl) errorEl.textContent = `Save failed: ${(res && res.error) || 'unknown error'}`;
          return;
        }
        if (statusEl) statusEl.textContent = 'Saved';
        state.profile = r.value;
        state.source = 'file';
        state.fileExists = true;
        // Re-render after a beat so the user sees the "Saved" flash.
        setTimeout(() => { _draw(); }, 200);
      });
    }

    if (reloadBtn) {
      reloadBtn.addEventListener('click', async () => {
        await refresh();
      });
    }

    if (generateBtn) {
      generateBtn.addEventListener('click', async () => {
        if (!_ipcRenderer) return;
        const payload = buildNudgeSavePayload(state);
        if (!payload) {
          if (errorEl) errorEl.textContent = 'Generate failed: no project / profile in scope';
          return;
        }
        generateBtn.disabled = true;
        const res = await _ipcRenderer.invoke(IPC.SAVE_PROFILE, payload);
        generateBtn.disabled = false;
        if (!res || !res.success) {
          if (errorEl) errorEl.textContent = `Generate failed: ${(res && res.error) || 'unknown error'}`;
          return;
        }
        state.source = 'file';
        state.fileExists = true;
        state.supervisorAvailable = false;
        _draw();
      });
    }

    const migrateBtn = container.querySelector('.profile-tab-supervisor-migrate');
    if (migrateBtn) {
      migrateBtn.addEventListener('click', async () => {
        if (!_ipcRenderer) return;
        // The translated profile is already in state.profile (LOAD_PROFILE
        // returned source='supervisor'). Persisting it is one SAVE_PROFILE.
        const payload = buildNudgeSavePayload(state);
        if (!payload) {
          if (errorEl) errorEl.textContent = 'Migrate failed: no project / profile in scope';
          return;
        }
        migrateBtn.disabled = true;
        const res = await _ipcRenderer.invoke(IPC.SAVE_PROFILE, payload);
        migrateBtn.disabled = false;
        if (!res || !res.success) {
          if (errorEl) errorEl.textContent = `Migrate failed: ${(res && res.error) || 'unknown error'}`;
          return;
        }
        state.source = 'file';
        state.fileExists = true;
        state.supervisorAvailable = false;
        _draw();
      });
    }
  }

  async function refresh() {
    container.innerHTML = `<div class="profile-tab-loading">Loading profile…</div>`;
    await _load();
    _draw();
  }

  refresh();
  return { refresh };
}

// Internal alias so the existing inline-mount path uses the same renderer
// that the test helper exposes.
function _renderNudgeBanner() {
  return renderNudgeBannerHtml();
}

function _renderWarnings(warnings) {
  return `
    <div class="profile-tab-warnings" role="status">
      <strong>Warnings while loading profile:</strong>
      <ul>${warnings.map((w) => `<li>${_escape(w)}</li>`).join('')}</ul>
    </div>
  `;
}

function _renderForm(fd) {
  return `
    <div class="profile-tab-row">
      <label class="profile-tab-label" for="pp-id">Project id</label>
      <input id="pp-id" class="profile-tab-input" data-field="id" type="text" value="${_escape(fd.id)}" />
      <div class="profile-tab-hint">Logical id — must match the supervisor app's id for this project.</div>
    </div>
    <fieldset class="profile-tab-fieldset">
      <legend>Policy</legend>
      <div class="profile-tab-row">
        <label class="profile-tab-label" for="pp-escalate">Escalate categories</label>
        <input id="pp-escalate" class="profile-tab-input" data-field="escalateCategories" type="text" value="${_escape(fd.escalateCategories)}" placeholder="dependency, schema, deployment" />
      </div>
      <div class="profile-tab-row">
        <label class="profile-tab-label" for="pp-ceiling">Cost ceiling (USD)</label>
        <input id="pp-ceiling" class="profile-tab-input" data-field="costCeilingUsd" type="text" value="${_escape(fd.costCeilingUsd)}" placeholder="e.g. 5.0" />
      </div>
    </fieldset>
    <fieldset class="profile-tab-fieldset">
      <legend>Budgets</legend>
      <div class="profile-tab-row">
        <label class="profile-tab-label" for="pp-iter">Iteration cap</label>
        <input id="pp-iter" class="profile-tab-input" data-field="iterationCap" type="text" value="${_escape(fd.iterationCap)}" />
      </div>
      <div class="profile-tab-row">
        <label class="profile-tab-label" for="pp-spend-task">Spend per task (USD)</label>
        <input id="pp-spend-task" class="profile-tab-input" data-field="spendPerTaskUsd" type="text" value="${_escape(fd.spendPerTaskUsd)}" />
      </div>
      <div class="profile-tab-row">
        <label class="profile-tab-label" for="pp-spend-day">Spend per day (USD)</label>
        <input id="pp-spend-day" class="profile-tab-input" data-field="spendPerDayUsd" type="text" value="${_escape(fd.spendPerDayUsd)}" />
      </div>
    </fieldset>
    <fieldset class="profile-tab-fieldset">
      <legend>Capabilities</legend>
      <div class="profile-tab-row">
        <label class="profile-tab-label" for="pp-cap">Enabled</label>
        <input id="pp-cap" class="profile-tab-input" data-field="capabilities" type="text" value="${_escape(fd.capabilities)}" placeholder="spec_reader, knowledge_search, web_research" />
      </div>
      <div class="profile-tab-row">
        <label class="profile-tab-label" for="pp-ctx">Context sources</label>
        <textarea id="pp-ctx" class="profile-tab-input profile-tab-textarea" data-field="contextSources" rows="4" placeholder="One per line. Use bm:project-id for Basic Memory refs.">${_escape(fd.contextSources)}</textarea>
      </div>
    </fieldset>
  `;
}

function _readFormData(container) {
  const fd = {};
  container.querySelectorAll('[data-field]').forEach((input) => {
    fd[input.dataset.field] = input.value;
  });
  return fd;
}

function _escape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = {
  mount,
  // pure helpers exposed for tests
  profileToFormData,
  formDataToProfile,
  parseJsonSafely,
  shouldShowNudge,
  shouldShowSupervisorBanner,
  buildNudgeSavePayload,
  renderNudgeBannerHtml,
  renderSupervisorBannerHtml,
};
