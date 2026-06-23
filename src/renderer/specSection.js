/**
 * Spec Section Module
 *
 * Spec counterpart of taskSection.js: a spec detail surface that opens as a
 * navigable *section viewport* in the top bar, with a collapsible sibling rail
 * (sectionRail.js) listing the project's specs. Clicking another spec there
 * switches the viewport in place; the chip title tracks whatever is shown.
 * The detail mirrors specPanel.js (lifecycle stepper, next-action bar,
 * spec / plan / tasks / outcome tabs, interactive task rows) and reuses the
 * same CSS classes (spec-detail-*, spec-tab-*, spec-task-*).
 *
 * Opening a spec reuses the open spec viewport (navigates it) instead of
 * stacking tabs; a Cmd/Ctrl-click opens it in a new viewport when a second
 * context is genuinely wanted.
 */

const { ipcRenderer } = require('electron');
const { marked } = require('marked');
const { IPC } = require('../shared/ipcChannels');
const state = require('./state');
const sectionRail = require('./sectionRail');
const { FileText } = require('lucide');
const autopilotClient = require('./autopilotClient');
const { renderAutopilotPill } = require('./autopilotPill');
const { renderAutopilotToggle } = require('./autopilotToggle');
const memoryTab = require('./memoryTab');

let host = null;
let seq = 0;

const SPEC_PHASE_ORDER = ['implementing', 'tasks_generated', 'planned', 'specified', 'draft', 'done'];

// ─── Public API ─────────────────────────────────────

function setHost(h) {
  host = h;
}

/** Open a spec — reuses the open spec viewport, or creates one if none. */
function open(slug) {
  if (!host || !slug) return;
  host.openSection('spec', slug, api, { newTab: false });
}

/** Open a spec in a brand-new viewport tab. */
function openInNewTab(slug) {
  if (!host || !slug) return;
  host.openSection('spec', slug, api, { newTab: true });
}

/** Create a fresh spec viewport instance (the host calls this when needed). */
function createViewport() {
  const key = `spec-vp:${++seq}`;
  let slug = null;
  let activeSpec = null;
  let activeTab = 'spec';
  let allTasks = [];
  let specsList = [];
  let container = null;
  let autopilotToggleObj = null;
  let autopilotHeaderToggleObj = null;
  let autoOnTasksCached = false;     // pre-arm flag for this slug (refreshed in fetchDetail)
  let armPending = false;            // ARM_REQUEST landed but no lane attached yet
  let editingTab = null;        // 'spec' | 'plan' | 'tasks' | null
  let editingDraft = '';
  let auditEvents = null;       // null = not loaded yet; array once fetched
  let attachmentsList = [];     // string[] relative paths from LIST_SPEC_ATTACHMENTS

  const onTasksData = (event, payload) => {
    const tasks = payload && payload.tasks;
    allTasks = (tasks && Array.isArray(tasks.tasks)) ? tasks.tasks : [];
    // Inline editor active → defer the re-render so the user doesn't lose
    // their cursor position. Data is already cached; next save/cancel will
    // pick it up.
    if (editingTab) return;
    if (host) host.notifySectionChanged();
  };
  const onSpecData = async (event, payload) => {
    if (payload && Array.isArray(payload.specs)) specsList = payload.specs;
    await fetchDetail();
    if (editingTab) return;
    if (host) host.notifySectionChanged();
  };
  ipcRenderer.on(IPC.TASKS_DATA, onTasksData);
  ipcRenderer.on(IPC.SPEC_DATA, onSpecData);

  // Track this spec's assigned Frame so the next-action bar's busy lock
  // follows the live agent state (fires only on material changes).
  const unsubLaneActivity = require('./agentDispatch').onSpecLaneActivity((s) => {
    if (s === slug && host) host.notifySectionChanged();
  });

  // Re-render whenever autopilot state changes so the Auto toggle + pill
  // stay in sync with the main-process loop. Only nudge on a transition
  // that involves THIS spec.
  let lastAutopilotStatus = null;
  const unsubAutopilot = autopilotClient.onChange(() => {
    const pp = state.getProjectPath();
    if (!pp || !slug) return;
    const run = autopilotClient.getRunFor({ projectPath: pp, slug, scope: 'spec' });
    const next = run ? `${run.status}:${run.turnsTotal}` : null;
    if (next === lastAutopilotStatus) return;
    lastAutopilotStatus = next;
    // If the audit tab is open, refresh its data so each turn shows up.
    if (activeTab === 'audit') loadAuditEvents();
    if (editingTab) return;
    if (host) host.notifySectionChanged();
  });

  // Same hook for the supervisor — the Supervise button toggles based on
  // the supervisor's status so we need to re-render on every tick.
  let lastSupervisorStatus = null;
  const supervisorClient = require('./supervisorClient');
  const unsubSupervisor = supervisorClient.onChange(() => {
    const pp = state.getProjectPath();
    if (!pp || !slug) return;
    const sup = supervisorClient.getSpecState(pp, slug);
    const next = sup ? `${sup.status}:${sup.tickCount}` : null;
    if (next === lastSupervisorStatus) return;
    lastSupervisorStatus = next;
    if (editingTab) return;
    if (host) host.notifySectionChanged();
  });

  // Surface the "armed but no lane attached" chip whenever an ARM_REQUEST
  // fires for this slug without a lane to satisfy it. autopilotClient
  // dispatches a custom DOM event on the document so we don't need to
  // subscribe via an internal IPC.
  const onArmPending = (e) => {
    if (!e || !e.detail || e.detail.slug !== slug) return;
    armPending = true;
    if (host) host.notifySectionChanged();
  };
  document.addEventListener('autopilot-arm-pending', onArmPending);

  const projectPath = state.getProjectPath();
  if (projectPath) {
    ipcRenderer.send(IPC.LOAD_TASKS, projectPath);
    ipcRenderer.invoke(IPC.LIST_SPECS, projectPath).then((list) => {
      if (Array.isArray(list)) { specsList = list; if (host) host.notifySectionChanged(); }
    }).catch(() => { /* SPEC_DATA push will cover it */ });
  }

  async function fetchDetail() {
    const pp = state.getProjectPath();
    if (!pp || !slug) { activeSpec = null; return; }
    activeSpec = await ipcRenderer.invoke(IPC.GET_SPEC, { projectPath: pp, slug });
    autoOnTasksCached = await autopilotClient.getAutoOnTasks({ projectPath: pp, slug });
    armPending = autopilotClient.isArmPending(slug);
    try {
      const list = await ipcRenderer.invoke(IPC.LIST_SPEC_ATTACHMENTS, { projectPath: pp, slug });
      attachmentsList = Array.isArray(list) ? list : [];
    } catch {
      attachmentsList = [];
    }
  }

  function navigate(nextSlug) {
    slug = nextSlug;
    activeTab = 'spec';
    activeSpec = null;
    if (host) host.notifySectionChanged(); // show loading immediately
    fetchDetail().then(() => { if (host) host.notifySectionChanged(); });
  }

  function getChip() {
    const title = (activeSpec && activeSpec.status && activeSpec.status.title) || slug || 'Spec';
    return { type: 'spec', title };
  }

  function render(el) {
    container = el;
    el.innerHTML = '';

    const layout = document.createElement('div');
    layout.className = 'section-layout';

    const contentArea = document.createElement('div');
    contentArea.className = 'section-content-area';
    contentArea.innerHTML = `
      <div class="spec-section">
        <div class="spec-section-inner spec-detail" id="spec-section-content"></div>
      </div>
    `;
    layout.appendChild(contentArea);

    const railEl = document.createElement('div');
    sectionRail.render(railEl, {
      title: 'Specs',
      typeIcon: FileText,
      storageKey: 'frame-section-rail-specs',
      items: _railItems(),
      completedLabel: 'Done',
      emptyText: 'No active specs',
      onSelect: (s, { newTab }) => (newTab ? openInNewTab(s) : navigate(s)),
      onOpenDashboard: () => require('./specsDashboard').show()
    });
    layout.appendChild(railEl);

    el.appendChild(layout);
    _renderDetail(contentArea);
  }

  function _railItems() {
    return specsList
      .slice()
      .sort((a, b) => SPEC_PHASE_ORDER.indexOf(a.phase) - SPEC_PHASE_ORDER.indexOf(b.phase))
      .map((s) => {
        const { done, total } = _specProgress(s.slug);
        return {
          id: s.slug,
          active: s.slug === slug,
          completed: s.phase === 'done',
          className: 'lane-rail-spec',
          html: `
            <div class="lane-rail-item-title">${escapeHtml(s.title || s.slug)}</div>
            <div class="lane-rail-card-meta">
              <span class="spec-phase-badge phase-${escapeHtml(s.phase)}">${escapeHtml(String(s.phase).replace('_', ' '))}</span>
              ${total > 0 ? `<span class="lane-rail-progress-text">${done}/${total} tasks</span>` : ''}
            </div>
            ${total > 0 ? `<div class="lane-rail-progress"><div class="lane-rail-progress-fill" style="width:${Math.round((done / total) * 100)}%"></div></div>` : ''}
          `
        };
      });
  }

  function _specProgress(specSlug) {
    const prefix = `spec:${specSlug}:`;
    let done = 0;
    let total = 0;
    for (const t of allTasks) {
      if (t.source && t.source.startsWith(prefix)) {
        total++;
        if (t.status === 'completed') done++;
      }
    }
    return { done, total };
  }

  function _renderDetail(contentArea) {
    const contentEl = contentArea.querySelector('#spec-section-content');
    if (!contentEl) return;

    if (!activeSpec) {
      contentEl.innerHTML = `<div class="specs-empty"><p>${slug ? 'Loading spec…' : 'Select a spec'}</p></div>`;
      return;
    }

    const { status, spec, plan, tasks, outcome } = activeSpec;
    const aiLabel = status.ai_tool || '';
    const nextAction = nextActionForPhase(status.phase);
    const projectPath = state.getProjectPath();

    // Build the autopilot toggle + pill only while we're on the implement
    // step. The toggle object is held in closure so attachHandlers() can
    // run after innerHTML below. The supervisor verdict badge piggybacks
    // on the pill: whenever a supervisor loop has recorded a lastVerdict
    // we render it next to (or instead of) the autopilot run summary.
    autopilotToggleObj = null;
    autopilotHeaderToggleObj = null;
    let autopilotToggleHtml = '';
    let autopilotPillHtml = '';
    let autopilotHeaderToggleHtml = '';
    const supSpecForPill = projectPath
      ? require('./supervisorClient').getSpecState(projectPath, slug)
      : null;
    const supVerdict = supSpecForPill ? supSpecForPill.lastVerdict : null;
    if (nextAction && nextAction.command === 'spec.implement' && projectPath) {
      autopilotToggleObj = renderAutopilotToggle({
        projectPath,
        slug,
        scope: 'spec',
        surface: 'inline',
        getTerminalId: () => {
          const info = require('./agentDispatch').getSpecLaneInfo(slug);
          return info ? info.terminalId : null;
        },
      });
      autopilotToggleHtml = autopilotToggleObj.html;
      const run = autopilotClient.getRunFor({ projectPath, slug, scope: 'spec' });
      const totals = _specProgress(slug);
      autopilotPillHtml = renderAutopilotPill(run, { completed: totals.done, total: totals.total }, supVerdict);
    } else if (supVerdict) {
      // No autopilot run but the supervisor has emitted a verdict — surface
      // the verdict badge on its own.
      autopilotPillHtml = renderAutopilotPill(null, null, supVerdict);
    }
    // Header-level Auto toggle — visible from any phase so the user can
    // escalate to autopilot mid-flight without scrolling to the implement
    // card. Same component, same handlers, same scope.
    if (projectPath) {
      autopilotHeaderToggleObj = renderAutopilotToggle({
        projectPath,
        slug,
        scope: 'spec',
        surface: 'header',
        getTerminalId: () => {
          const info = require('./agentDispatch').getSpecLaneInfo(slug);
          return info ? info.terminalId : null;
        },
      });
      autopilotHeaderToggleHtml = `<span class="spec-header-autopilot">${autopilotHeaderToggleObj.html}</span>`;
    }
    // Pre-arm "no lane attached" passive chip — shown when an ARM_REQUEST
    // fired but we couldn't satisfy it. Clears once a lane attaches.
    const armPendingChip = armPending
      ? `<span class="spec-arm-pending-chip" title="Pre-armed for autopilot — open or attach a Frame to start.">Auto on tasks · no lane attached</span>`
      : '';

    // Supervisor toggle (replaces Auto for LLM-judged orchestration).
    // Reads supervisor state from supervisorClient — running specs show
    // a "Stop Supervisor" button; idle ones show "Supervise". The
    // supervisor IS the next-generation Auto; both buttons coexist
    // during the transition window.
    const supervisorClient = require('./supervisorClient');
    const supervisorState = supervisorClient.getSpecState(projectPath, slug);
    const supervisorActive = supervisorState && supervisorState.status === 'running';
    const supervisorBtnHtml = projectPath ? `<button type="button" class="btn btn-secondary spec-supervisor-btn ${supervisorActive ? 'spec-supervisor-btn-on' : ''}" id="spec-supervisor-btn" title="Run the LLM-judged supervisor loop on this spec — drives plan/tasks/implement to done.">${supervisorActive ? 'Stop Supervisor' : 'Supervise'}</button>` : '';

    const attachmentsChipHtml = renderAttachmentsChip(attachmentsList);

    contentEl.innerHTML = `
      <div class="spec-detail-header">
        <h3 class="spec-detail-title">${escapeHtml(status.title)}</h3>
        <div class="spec-detail-meta">
          ${require('./agentDispatch').specStatusDotHtml(status.slug)}
          <span class="spec-detail-slug">${escapeHtml(status.slug)}</span>
          ${aiLabel ? `<span class="spec-detail-ai">${escapeHtml(aiLabel)}</span>` : ''}
          ${autopilotPillHtml}
          ${armPendingChip}
          ${autopilotHeaderToggleHtml}
          ${supervisorBtnHtml}
          ${attachmentsChipHtml}
        </div>
      </div>
      ${renderStepper(status.phase)}
      ${nextAction ? renderNextActionBar(nextAction, require('./agentDispatch').getSpecLaneInfo(slug), autopilotToggleHtml, _shouldShowPreArmCheckbox(status.phase), autoOnTasksCached) : ''}
      <div class="spec-detail-tabs">
        ${renderTabButton('spec', 'Spec', !!spec)}
        ${renderTabButton('plan', 'Plan', !!plan)}
        ${renderTabButton('tasks', tasksTabLabel(), !!tasks || hasSpecTasks())}
        ${renderTabButton('outcome', 'Outcome', !!outcome)}
        ${renderTabButton('audit', 'Audit', hasAuditLog())}
        ${renderTabButton('memory', 'Memory', true)}
      </div>
      <div class="spec-detail-body" id="spec-section-detail-body">
        ${renderTabBody(activeTab)}
      </div>
    `;

    contentEl.querySelectorAll('.spec-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
    contentEl.querySelector('#spec-section-action-btn')?.addEventListener('click', () => {
      if (nextAction) runSpecCommand(nextAction.command);
    });
    if (autopilotToggleObj) autopilotToggleObj.attachHandlers(contentEl);
    if (autopilotHeaderToggleObj) autopilotHeaderToggleObj.attachHandlers(contentEl);
    const supervisorBtn = contentEl.querySelector('#spec-supervisor-btn');
    if (supervisorBtn) {
      supervisorBtn.addEventListener('click', async () => {
        const supervisorClient = require('./supervisorClient');
        const current = supervisorClient.getSpecState(projectPath, slug);
        if (current && current.status === 'running') {
          await supervisorClient.stop({ projectPath, slug });
          return;
        }
        const laneInfo = require('./agentDispatch').getSpecLaneInfo(slug);
        const terminalId = laneInfo ? laneInfo.terminalId : null;
        if (!terminalId) {
          supervisorBtn.classList.add('autopilot-toggle-error');
          supervisorBtn.title = 'Attach a Frame for this spec first.';
          setTimeout(() => supervisorBtn.classList.remove('autopilot-toggle-error'), 2500);
          return;
        }
        await supervisorClient.start({ projectPath, slug, terminalId });
      });
    }
    const preArmCheckbox = contentEl.querySelector('#spec-pre-arm-checkbox');
    if (preArmCheckbox) {
      preArmCheckbox.addEventListener('change', async () => {
        const next = preArmCheckbox.checked;
        const pp = state.getProjectPath();
        await autopilotClient.setAutoOnTasks({ projectPath: pp, slug, value: next });
        autoOnTasksCached = next;
      });
    }
    if (activeTab === 'tasks') attachTaskActionHandlers(contentEl);
    if (activeTab === 'memory') {
      const mount = contentEl.querySelector('#spec-memory-tab-mount');
      const pp = state.getProjectPath();
      if (mount && pp && slug) memoryTab.mount(mount, { projectPath: pp, slug });
    }
    attachAttachmentsChipHandler(contentEl);
    attachDocEditHandlers(contentEl);
  }

  function attachAttachmentsChipHandler(contentEl) {
    const chip = contentEl.querySelector('#spec-attachments-chip');
    if (!chip) return;
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleAttachmentsPopover(chip);
    });
  }

  function toggleAttachmentsPopover(chip) {
    // Close any existing popover first.
    const existing = document.querySelector('.spec-attachments-popover');
    if (existing) { existing.remove(); return; }
    if (!attachmentsList || attachmentsList.length === 0) return;

    const pp = state.getProjectPath();
    const pop = document.createElement('div');
    pop.className = 'spec-attachments-popover';
    pop.innerHTML = `
      <div class="spec-attachments-popover-header">Attachments</div>
      <ul class="spec-attachments-popover-list">
        ${attachmentsList.map((rel, i) => {
          const base = rel.split('/').pop();
          return `
            <li class="spec-attachments-popover-item" data-rel="${escapeHtml(rel)}">
              <span class="spec-attachments-popover-name">${escapeHtml(base)}</span>
              <button type="button" class="spec-attachments-popover-reveal" data-idx="${i}" title="Show in Finder">Show in Finder</button>
            </li>
          `;
        }).join('')}
      </ul>
    `;
    document.body.appendChild(pop);

    // Anchor below the chip
    const r = chip.getBoundingClientRect();
    pop.style.position = 'fixed';
    pop.style.top = `${Math.round(r.bottom + 6)}px`;
    pop.style.left = `${Math.round(r.left)}px`;

    const closeAndUnbind = () => {
      pop.remove();
      document.removeEventListener('click', onDocClick, true);
    };
    const onDocClick = (e) => {
      if (!pop.contains(e.target)) closeAndUnbind();
    };
    document.addEventListener('click', onDocClick, true);

    pop.querySelectorAll('.spec-attachments-popover-reveal').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = Number(btn.dataset.idx);
        const rel = attachmentsList[idx];
        if (!pp || !slug || !rel) return;
        // Resolve absolute path inside .frame/specs/<slug>/<rel>.
        // The renderer has node integration; shell.showItemInFolder reveals
        // the file in Finder/Explorer cross-platform.
        try {
          const electron = require('electron');
          const nodePath = require('path');
          const abs = nodePath.join(pp, '.frame', 'specs', slug, rel);
          electron.shell.showItemInFolder(abs);
        } catch (err) {
          console.error('show in Finder failed', err);
        }
      });
    });
  }

  function attachDocEditHandlers(contentEl) {
    contentEl.querySelectorAll('.spec-doc-edit-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        editingTab = btn.dataset.tab;
        editingDraft = (activeSpec && activeSpec[editingTab]) || '';
        activeTab = editingTab; // ensure the editor shows on this tab
        if (host) host.notifySectionChanged();
      });
    });
    const cancelBtn = contentEl.querySelector('#spec-doc-cancel-btn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        editingTab = null;
        editingDraft = '';
        if (host) host.notifySectionChanged();
      });
    }
    const saveBtn = contentEl.querySelector('#spec-doc-save-btn');
    const textarea = contentEl.querySelector('#spec-doc-textarea');
    if (saveBtn && textarea) {
      textarea.addEventListener('input', () => { editingDraft = textarea.value; });
      saveBtn.addEventListener('click', async () => {
        const pp = state.getProjectPath();
        if (!pp || !slug || !editingTab) return;
        saveBtn.disabled = true;
        const r = await ipcRenderer.invoke(IPC.WRITE_SPEC_DOC, {
          projectPath: pp, slug, docType: editingTab, content: textarea.value,
        });
        saveBtn.disabled = false;
        if (!r || !r.success) {
          window.alert(`Could not save: ${(r && r.error) || 'unknown error'}`);
          return;
        }
        editingTab = null;
        editingDraft = '';
        ipcRenderer.send(IPC.LOAD_TASKS, pp);
        await fetchDetail();
        if (host) host.notifySectionChanged();
      });

      // Paste / drop attachments inline → ATTACH_SPEC_FILE on the *existing*
      // spec slug, then insert the markdown reference at the cursor. Only on
      // spec.md / plan.md per the plan ("attachments belong to spec / plan
      // authoring") — tasks.md edit doesn't get this affordance.
      if (editingTab === 'spec' || editingTab === 'plan') {
        wireInlineAttach(textarea);
      }
    }
  }

  async function inlineAttach(originalName, payload) {
    const pp = state.getProjectPath();
    if (!pp || !slug) return null;
    const res = await ipcRenderer.invoke(IPC.ATTACH_SPEC_FILE, {
      projectPath: pp, slug,
      payload: { ...payload, originalName }
    });
    if (!res || !res.success) {
      window.alert(`Could not attach: ${(res && res.error) || 'unknown error'}`);
      return null;
    }
    return res.relativePath;
  }

  function insertAtCursor(textarea, snippet) {
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? textarea.value.length;
    const before = textarea.value.slice(0, start);
    const after = textarea.value.slice(end);
    textarea.value = `${before}${snippet}${after}`;
    const caret = start + snippet.length;
    textarea.selectionStart = textarea.selectionEnd = caret;
    editingDraft = textarea.value;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function buildMarkdownRef(displayName, relativePath) {
    const isImage = /\.(png|jpe?g|gif|webp|svg|bmp|heic|heif)$/i.test(displayName);
    return `${isImage ? '!' : ''}[${displayName}](${relativePath})`;
  }

  function wireInlineAttach(textarea) {
    textarea.addEventListener('paste', async (e) => {
      const items = e.clipboardData ? Array.from(e.clipboardData.items || []) : [];
      const fileItems = items.filter((it) => it.kind === 'file');
      if (fileItems.length === 0) return;
      e.preventDefault();
      for (const it of fileItems) {
        const blob = it.getAsFile();
        if (!blob) continue;
        const ext = blob.type ? `.${blob.type.split('/')[1] || 'bin'}` : '';
        const name = blob.name || `pasted-${Date.now()}${ext}`;
        const data = await blobToBase64(blob);
        const rel = await inlineAttach(name, { kind: 'buffer', data });
        if (rel) insertAtCursor(textarea, buildMarkdownRef(name, rel));
      }
    });

    ['dragenter', 'dragover'].forEach((evt) => {
      textarea.addEventListener(evt, (e) => {
        if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
        e.preventDefault();
        textarea.classList.add('drag-over');
      });
    });
    ['dragleave', 'dragend', 'drop'].forEach((evt) => {
      textarea.addEventListener(evt, () => textarea.classList.remove('drag-over'));
    });
    textarea.addEventListener('drop', async (e) => {
      if (!e.dataTransfer) return;
      const files = Array.from(e.dataTransfer.files || []);
      if (files.length === 0) return;
      e.preventDefault();
      for (const f of files) {
        const name = f.name || 'file';
        let rel;
        if (f.path) {
          rel = await inlineAttach(name, { kind: 'path', sourcePath: f.path });
        } else {
          const data = await blobToBase64(f);
          rel = await inlineAttach(name, { kind: 'buffer', data });
        }
        if (rel) insertAtCursor(textarea, buildMarkdownRef(name, rel));
      }
    });
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
      reader.onload = () => {
        const result = reader.result || '';
        const comma = String(result).indexOf(',');
        resolve(comma >= 0 ? String(result).slice(comma + 1) : String(result));
      };
      reader.readAsDataURL(blob);
    });
  }

  function switchTab(tab) {
    if (activeTab !== tab) {
      // Clearing the editor when navigating away avoids dangling drafts.
      editingTab = null;
      editingDraft = '';
    }
    activeTab = tab;
    if (!container) return;
    const contentEl = container.querySelector('#spec-section-content');
    if (!contentEl) return;
    contentEl.querySelectorAll('.spec-tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    const body = contentEl.querySelector('#spec-section-detail-body');
    if (body) body.innerHTML = renderTabBody(tab);
    if (tab === 'tasks') attachTaskActionHandlers(contentEl);
    if (tab === 'audit') loadAuditEvents();
    if (tab === 'memory') {
      const mount = contentEl.querySelector('#spec-memory-tab-mount');
      const pp = state.getProjectPath();
      if (mount && pp && slug) memoryTab.mount(mount, { projectPath: pp, slug });
    }
    attachDocEditHandlers(contentEl);
  }

  function renderTabButton(tab, label, hasContent) {
    const active = activeTab === tab ? 'active' : '';
    const empty = hasContent ? '' : 'empty';
    return `<button class="spec-tab-btn ${active} ${empty}" data-tab="${tab}">${label}${hasContent ? '' : ' <span class="spec-tab-empty-dot">·</span>'}</button>`;
  }

  function hasSpecTasks() {
    const prefix = `spec:${slug}:`;
    return allTasks.some(t => t && typeof t.source === 'string' && t.source.startsWith(prefix));
  }

  function tasksTabLabel() {
    const prefix = `spec:${slug}:`;
    const items = allTasks.filter(t => t && typeof t.source === 'string' && t.source.startsWith(prefix));
    if (items.length === 0) return 'Tasks';
    const completed = items.filter(t => t.status === 'completed').length;
    return `Tasks <span class="spec-tab-count">${completed}/${items.length}</span>`;
  }

  function renderTabBody(tab) {
    if (tab === 'audit') return renderAuditTabBody();
    if (tab === 'memory') {
      // The memoryTab module mounts itself imperatively into the body
      // container in switchTab() — return a placeholder so the layout
      // doesn't flash during the IPC round-trip.
      return `<div id="spec-memory-tab-mount" class="memory-tab-mount"><div class="memory-tab-loading">Loading memory notes…</div></div>`;
    }
    if (tab === 'tasks' && editingTab !== 'tasks') {
      return `
        ${renderTasksTabBody()}
        ${renderDocEditAffordance('tasks')}
      `;
    }
    if (editingTab === tab && ['spec', 'plan', 'tasks'].includes(tab)) {
      return renderDocEditor(tab);
    }
    const md = activeSpec?.[tab];
    if (md) {
      const editable = ['spec', 'plan', 'tasks'].includes(tab);
      return `${renderMarkdown(md)}${editable ? renderDocEditAffordance(tab) : ''}`;
    }
    if (tab === 'outcome') {
      return `<div class="spec-empty-tab">No outcomes yet — they're captured automatically as <code>/spec.implement</code> completes each task.</div>`;
    }
    if (['spec', 'plan', 'tasks'].includes(tab)) {
      const cmdMap = { spec: '/spec.new', plan: '/spec.plan', tasks: '/spec.tasks' };
      return `
        <div class="spec-empty-tab">No <code>${tab}.md</code> yet — run <code>${cmdMap[tab]}</code> from the terminal, or:</div>
        ${renderDocEditAffordance(tab, /* createMode */ true)}
      `;
    }
    return `<div class="spec-empty-tab">No content yet.</div>`;
  }

  function renderDocEditAffordance(tab, createMode = false) {
    const label = createMode ? `Create ${tab}.md` : `Edit ${tab}.md`;
    return `
      <div class="spec-doc-edit-row">
        <button class="btn btn-secondary spec-doc-edit-btn" id="spec-doc-edit-${tab}-btn" data-tab="${tab}">${label}</button>
      </div>
    `;
  }

  function renderDocEditor(tab) {
    const draft = editingDraft != null ? editingDraft : (activeSpec?.[tab] || '');
    const hint = (tab === 'tasks')
      ? 'Tip: each task line follows <code>- T01 · title</code>. Saving re-syncs into tasks.json.'
      : 'Plain markdown. Saving overwrites the file on disk.';
    return `
      <div class="spec-doc-editor">
        <textarea class="spec-doc-textarea" id="spec-doc-textarea">${escapeHtml(draft)}</textarea>
        <div class="spec-doc-editor-hint">${hint}</div>
        <div class="spec-doc-editor-actions">
          <button class="btn btn-secondary" id="spec-doc-cancel-btn">Cancel</button>
          <button class="btn btn-primary" id="spec-doc-save-btn">Save ${tab}.md</button>
        </div>
      </div>
    `;
  }

  function renderAuditTabBody() {
    if (auditEvents == null) {
      // Trigger an async fetch on first view; render placeholder for now.
      loadAuditEvents();
      return `<div class="spec-empty-tab">Loading autopilot audit log…</div>`;
    }
    if (auditEvents.length === 0) {
      return `<div class="spec-empty-tab">No autopilot runs recorded for this spec yet. Enable <strong>Auto</strong> to start one.</div>`;
    }
    const rows = auditEvents.slice().reverse().map(renderAuditRow).join('');
    return `<div class="spec-audit-log">${rows}</div>`;
  }

  function hasAuditLog() {
    // Heuristic: assume yes once we've loaded events at least once and got some.
    return Array.isArray(auditEvents) && auditEvents.length > 0;
  }

  async function loadAuditEvents() {
    const pp = state.getProjectPath();
    if (!pp || !slug) { auditEvents = []; return; }
    try {
      const events = await ipcRenderer.invoke(IPC.AUTOPILOT_AUDIT, { projectPath: pp, slug, limit: 500 });
      auditEvents = Array.isArray(events) ? events : [];
    } catch (err) {
      console.error('specSection: failed to load audit events', err);
      auditEvents = [];
    }
    if (host) host.notifySectionChanged();
  }

  function renderAuditRow(evt) {
    const ts = evt.ts ? new Date(evt.ts).toLocaleString() : '—';
    if (evt.event === 'run-started') {
      return `<div class="spec-audit-row spec-audit-meta"><span class="spec-audit-ts">${escapeHtml(ts)}</span> <strong>Run started</strong> (caps: max_turns_per_task=${escapeHtml(evt.caps?.max_turns_per_task)}, max_total_turns=${escapeHtml(evt.caps?.max_total_turns)})</div>`;
    }
    if (evt.event === 'run-completed') {
      return `<div class="spec-audit-row spec-audit-success"><span class="spec-audit-ts">${escapeHtml(ts)}</span> ✅ <strong>Run completed</strong> · ${escapeHtml(evt.turns)} turn(s)</div>`;
    }
    if (evt.event === 'run-failed') {
      return `<div class="spec-audit-row spec-audit-failed"><span class="spec-audit-ts">${escapeHtml(ts)}</span> ⚠ <strong>Run failed</strong> · ${escapeHtml(evt.reason)}</div>`;
    }
    if (evt.event === 'run-paused') {
      return `<div class="spec-audit-row spec-audit-paused"><span class="spec-audit-ts">${escapeHtml(ts)}</span> ⏸ <strong>Paused</strong> · ${escapeHtml(evt.reason)} (no-progress streak: ${escapeHtml(evt.consecutiveNoProgress)})</div>`;
    }
    if (evt.event === 'run-stopped') {
      return `<div class="spec-audit-row spec-audit-meta"><span class="spec-audit-ts">${escapeHtml(ts)}</span> ⏹ <strong>Stopped</strong> by user</div>`;
    }
    // Per-turn event
    const outcome = evt.outcome === 'progress' ? '🟢 progress' : '🟡 no progress';
    const retry = evt.retryAttempt > 0 ? ` · retry #${escapeHtml(evt.retryAttempt)}` : '';
    return `
      <div class="spec-audit-row spec-audit-turn-${escapeHtml(evt.outcome)}">
        <span class="spec-audit-ts">${escapeHtml(ts)}</span>
        <span class="spec-audit-turn">turn ${escapeHtml(evt.turn)}</span>
        ${outcome}
        <span class="spec-audit-detail">pending ${escapeHtml(evt.beforePending)} → ${escapeHtml(evt.afterPending)}${retry}</span>
      </div>
    `;
  }

  function renderTasksTabBody() {
    const prefix = `spec:${slug}:`;
    const items = allTasks
      .filter(t => t && typeof t.source === 'string' && t.source.startsWith(prefix))
      .sort((a, b) => (a.source || '').localeCompare(b.source || '', undefined, { numeric: true }));

    if (items.length === 0) {
      if (activeSpec?.tasks) {
        return `
          <div class="spec-empty-tab">
            Waiting for <code>/spec.tasks</code> output to sync into tasks.json.
            The raw <code>tasks.md</code> follows:
          </div>
          ${renderMarkdown(activeSpec.tasks)}
        `;
      }
      return `<div class="spec-empty-tab">No tasks yet — run <code>/spec.tasks</code> from the terminal.</div>`;
    }

    const total = items.length;
    const completed = items.filter(t => t.status === 'completed').length;
    const inProgress = items.filter(t => t.status === 'in_progress').length;
    const pct = Math.round((completed / total) * 100);

    return `
      <div class="spec-tasks-progress">
        <div class="spec-tasks-progress-text">
          <strong>${completed} / ${total}</strong> done${inProgress ? ` · ${inProgress} in progress` : ''}
        </div>
        <div class="spec-tasks-progress-bar"><div class="spec-tasks-progress-fill" style="width: ${pct}%"></div></div>
      </div>
      <div class="spec-tasks-list">
        ${items.map(renderSpecTaskRow).join('')}
      </div>
      <div class="spec-task-add-row">
        <input type="text" id="spec-task-add-input" class="spec-task-add-input" placeholder="Add a task…" maxlength="200" />
        <button class="btn btn-secondary spec-task-add-btn" id="spec-task-add-btn">+ Add</button>
      </div>
    `;
  }

  function attachTaskActionHandlers(contentEl) {
    contentEl.querySelectorAll('.spec-task-row').forEach(row => {
      const taskId = row.dataset.taskId;
      row.querySelectorAll('.spec-task-action-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const action = btn.dataset.action;
          if (action === 'remove') {
            const taskNum = btn.dataset.taskNum;
            const pp = state.getProjectPath();
            if (!pp || !slug || !taskNum) return;
            const confirmed = window.confirm(`Remove task ${taskNum}? It must be pending.`);
            if (!confirmed) return;
            const r = await ipcRenderer.invoke(IPC.REMOVE_SPEC_TASK, { projectPath: pp, slug, taskId: taskNum });
            if (!r || !r.success) {
              window.alert(`Could not remove: ${(r && r.error) || 'unknown error'}`);
              return;
            }
            ipcRenderer.send(IPC.LOAD_TASKS, pp);
            await fetchDetail();
            if (host) host.notifySectionChanged();
            return;
          }
          handleTaskAction(taskId, action);
        });
      });
    });
    // "+ Add task" row at the bottom of the tasks list
    const addBtn = contentEl.querySelector('#spec-task-add-btn');
    const addInput = contentEl.querySelector('#spec-task-add-input');
    if (addBtn && addInput) {
      const submit = async () => {
        const title = (addInput.value || '').trim();
        if (!title) return;
        const pp = state.getProjectPath();
        if (!pp || !slug) return;
        addBtn.disabled = true;
        const r = await ipcRenderer.invoke(IPC.ADD_SPEC_TASK, { projectPath: pp, slug, title });
        addBtn.disabled = false;
        if (!r || !r.success) {
          window.alert(`Could not add: ${(r && r.error) || 'unknown error'}`);
          return;
        }
        addInput.value = '';
        ipcRenderer.send(IPC.LOAD_TASKS, pp);
        await fetchDetail();
        if (host) host.notifySectionChanged();
      };
      addBtn.addEventListener('click', submit);
      addInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    }
  }

  async function runSpecCommand(command) {
    if (!slug) return;
    // Dispatch enters the target Frame itself, which takes the section off
    // the screen — its tab stays open, same as the old hideSections path.
    await require('./agentDispatch').dispatchSpecCommand({
      slug,
      title: (activeSpec && activeSpec.status && activeSpec.status.title) || slug,
      command
    });
  }

  function dispose() {
    ipcRenderer.removeListener(IPC.TASKS_DATA, onTasksData);
    ipcRenderer.removeListener(IPC.SPEC_DATA, onSpecData);
    unsubLaneActivity();
    unsubAutopilot();
    unsubSupervisor();
    document.removeEventListener('autopilot-arm-pending', onArmPending);
    container = null;
  }

  return { type: 'spec', key, viewClass: 'section-view', navigate, getChip, render, dispose };
}

// ─── Pure helpers ───────────────────────────────────

function nextActionForPhase(phase) {
  switch (phase) {
    case 'draft':
      return { command: 'spec.new', label: 'Write the Spec', hint: 'Frame turns your description into a structured spec.md.' };
    case 'specified':
      return { command: 'spec.plan', label: 'Generate Plan', hint: 'Frame breaks this spec into a technical plan (plan.md).' };
    case 'planned':
      return { command: 'spec.tasks', label: 'Break into Tasks', hint: 'Frame splits the plan into discrete, trackable tasks.' };
    case 'tasks_generated':
    case 'implementing':
      return { command: 'spec.implement', label: 'Implement Next Task', hint: 'Frame implements the next pending task — one per click.' };
    default:
      return null;
  }
}

function _shouldShowPreArmCheckbox(phase) {
  // Surface the "Run autopilot once tasks are ready" checkbox only during
  // the upstream phases — once tasks exist the header Auto toggle takes
  // over and the pre-arm intent is moot.
  return phase === 'draft' || phase === 'specified' || phase === 'planned';
}

function renderNextActionBar(action, lane, autopilotToggleHtml = '', showPreArm = false, preArmChecked = false) {
  const preArmHtml = showPreArm
    ? `
      <label class="spec-pre-arm-checkbox">
        <input type="checkbox" id="spec-pre-arm-checkbox" ${preArmChecked ? 'checked' : ''} />
        <span>Run autopilot once tasks are generated.</span>
      </label>`
    : '';
  // Live agent mid-turn in the assigned Frame → lock the button against
  // double-dispatch. Derived from getSpecLaneInfo on every render; lane
  // activity re-renders the section, so a dead agent or closed Frame
  // unlocks it again on its own.
  if (lane && lane.busy) {
    const verb = lane.status === 'agent-approval' ? 'Waiting for approval' : 'Working';
    return `
    <div class="spec-next-action spec-next-action-busy">
      <div class="spec-next-action-text">
        <strong>${escapeHtml(verb)} in ${escapeHtml(lane.name)}</strong>
        <span>Unlocks when the agent finishes its turn.</span>
        <code class="spec-next-action-cmd">/${escapeHtml(action.command)}</code>
        ${preArmHtml}
      </div>
      <div class="spec-next-action-buttons">
        <button class="btn btn-primary spec-action-btn" disabled>
          <span class="spec-action-spinner"></span>${escapeHtml(action.label)}
        </button>
        ${autopilotToggleHtml}
      </div>
    </div>
  `;
  }
  return `
    <div class="spec-next-action">
      <div class="spec-next-action-text">
        <strong>Next step: ${escapeHtml(action.label)}</strong>
        <span>${escapeHtml(action.hint)}</span>
        <code class="spec-next-action-cmd">/${escapeHtml(action.command)}</code>
        ${preArmHtml}
      </div>
      <div class="spec-next-action-buttons">
        <button class="btn btn-primary spec-action-btn" id="spec-section-action-btn">
          ${escapeHtml(action.label)}
        </button>
        ${autopilotToggleHtml}
      </div>
    </div>
  `;
}

const STEPPER_STEPS = ['Spec', 'Plan', 'Tasks', 'Implement', 'Done'];

function stepIndexForPhase(phase) {
  switch (phase) {
    case 'draft': return 0;
    case 'specified': return 1;
    case 'planned': return 2;
    case 'tasks_generated':
    case 'implementing': return 3;
    case 'done': return STEPPER_STEPS.length;
    default: return 0;
  }
}

function renderStepper(phase) {
  const activeIdx = stepIndexForPhase(phase);
  const check = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
  const parts = [];
  STEPPER_STEPS.forEach((label, i) => {
    if (i > 0) parts.push(`<div class="spec-step-line ${i <= activeIdx ? 'done' : ''}"></div>`);
    const stepState = i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'upcoming';
    parts.push(`
      <div class="spec-step ${stepState}">
        <span class="spec-step-marker">${stepState === 'done' ? check : ''}</span>
        <span class="spec-step-label">${label}</span>
      </div>
    `);
  });
  return `<div class="spec-stepper">${parts.join('')}</div>`;
}

function renderSpecTaskRow(task) {
  const taskNum = (task.source || '').split(':').pop() || '—';
  const isCompleted = task.status === 'completed';
  const isInProgress = task.status === 'in_progress';
  const isPending = task.status === 'pending';

  const statusIcon = isCompleted
    ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`
    : isInProgress
      ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`
      : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>`;

  const taskNumOnly = taskNum; // T-id only, no slug
  let actions = '';
  if (isPending) {
    actions = `
      <button class="spec-task-action-btn" data-action="start" title="Start working">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
      </button>
      <button class="spec-task-action-btn" data-action="complete" title="Mark complete">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
      </button>
      <button class="spec-task-action-btn spec-task-action-danger" data-action="remove" data-task-num="${escapeHtml(taskNumOnly)}" title="Remove pending task">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
      </button>
    `;
  } else if (isInProgress) {
    actions = `
      <button class="spec-task-action-btn" data-action="complete" title="Mark complete">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
      </button>
      <button class="spec-task-action-btn" data-action="pause" title="Move back to pending">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
      </button>
    `;
  } else {
    actions = `
      <button class="spec-task-action-btn" data-action="reopen" title="Reopen">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
      </button>
    `;
  }

  return `
    <div class="spec-task-row status-${task.status}" data-task-id="${escapeHtml(task.id)}">
      <span class="spec-task-status">${statusIcon}</span>
      <span class="spec-task-num">${escapeHtml(taskNum)}</span>
      <span class="spec-task-title">${escapeHtml(task.title)}</span>
      <span class="spec-task-actions">${actions}</span>
    </div>
  `;
}

function handleTaskAction(taskId, action) {
  const projectPath = state.getProjectPath();
  if (!projectPath || !taskId) return;
  const statusMap = { start: 'in_progress', complete: 'completed', pause: 'pending', reopen: 'pending' };
  const status = statusMap[action];
  if (!status) return;
  ipcRenderer.send(IPC.UPDATE_TASK, { projectPath, taskId, updates: { status } });
}

function renderMarkdown(md) {
  if (!md) return '';
  return marked
    .parse(md)
    .replace(/<script/gi, '&lt;script')
    .replace(/on\w+=/gi, 'data-safe-');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// Module-level helper exposed for unit tests. The buildMarkdownRef inside
// createViewport mirrors this verbatim.
function buildMarkdownRef(displayName, relativePath) {
  const isImage = /\.(png|jpe?g|gif|webp|svg|bmp|heic|heif)$/i.test(String(displayName || ''));
  return `${isImage ? '!' : ''}[${displayName}](${relativePath})`;
}

// "Attachments (N)" header chip. Returns empty string when N=0 so the
// header stays clean for specs without any uploads.
function renderAttachmentsChip(list) {
  const safeEscape = (s) => String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
  const n = Array.isArray(list) ? list.length : 0;
  if (n === 0) return '';
  return `<button type="button" class="spec-attachments-chip" id="spec-attachments-chip" title="View attached files">
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
    Attachments <span class="spec-attachments-chip-count">${safeEscape(String(n))}</span>
  </button>`;
}

const api = { setHost, open, openInNewTab, createViewport, buildMarkdownRef, renderAttachmentsChip };
module.exports = api;
