/**
 * Cross-Project Chat Panel
 *
 * Lives inside the Global Dashboard overlay. Distinct from per-project
 * execution terminals — this is the overview-session chat.
 *
 * Flow:
 *   1. User picks projects (defaults to all tracked + visible)
 *   2. Renderer asks main to bootstrap a staging dir under
 *      ~/.frame/chat-sessions/<id>/ with CLAUDE.md + context snapshots
 *   3. We spawn a pty in that dir, attach a fresh xterm, and dispatch
 *      the selected AI tool's start command
 *   4. The agent writes proposed action items to ./suggestions/*.json;
 *      main watches that dir and pushes us new suggestions, which we
 *      render as Apply / Dismiss cards
 *
 * Each open chat session owns one pty + one xterm. Closing the panel
 * destroys them. Sessions persist on disk so the user can resume.
 */

const { ipcRenderer, clipboard } = require('electron');
const { Terminal } = require('xterm');
const { FitAddon } = require('xterm-addon-fit');
const { IPC } = require('../shared/ipcChannels');

let panelEl = null;
let sessionListEl = null;
let pickerEl = null;
let pickerListEl = null;
let pickerConfirmEl = null;
let pickerCancelEl = null;
let chatBodyEl = null;
let chatHeaderEl = null;
let terminalHostEl = null;
let suggestionsEl = null;
let suggestionsCountEl = null;

let active = null; // { sessionId, terminalId, terminal, fitAddon, listeners }
let sessions = []; // listing of all sessions
let registry = { projects: {} };
let initialized = false;

function init() {
  if (initialized) return;
  initialized = true;
  panelEl = document.getElementById('chat-panel');
  if (!panelEl) return;
  sessionListEl = document.getElementById('chat-session-list');
  pickerEl = document.getElementById('chat-picker');
  pickerListEl = document.getElementById('chat-picker-list');
  pickerConfirmEl = document.getElementById('chat-picker-confirm');
  pickerCancelEl = document.getElementById('chat-picker-cancel');
  chatBodyEl = document.getElementById('chat-body');
  chatHeaderEl = document.getElementById('chat-active-header');
  terminalHostEl = document.getElementById('chat-terminal-host');
  suggestionsEl = document.getElementById('chat-suggestions');
  suggestionsCountEl = document.getElementById('chat-suggestions-count');

  wireUI();
  wireIPC();
}

function wireUI() {
  const newBtn = document.getElementById('chat-new-btn');
  if (newBtn) newBtn.addEventListener('click', openPicker);

  const emptyNewBtn = document.getElementById('chat-empty-new');
  if (emptyNewBtn) emptyNewBtn.addEventListener('click', openPicker);

  const panelCloseBtn = document.getElementById('chat-panel-close');
  if (panelCloseBtn) panelCloseBtn.addEventListener('click', hide);

  const closeBtn = document.getElementById('chat-picker-close');
  if (closeBtn) closeBtn.addEventListener('click', closePicker);
  if (pickerCancelEl) pickerCancelEl.addEventListener('click', closePicker);
  if (pickerConfirmEl) pickerConfirmEl.addEventListener('click', startNewSessionFromPicker);
  if (pickerEl) pickerEl.addEventListener('click', (e) => {
    if (e.target === pickerEl) closePicker();
  });

  const closeActive = document.getElementById('chat-active-close');
  if (closeActive) closeActive.addEventListener('click', closeActiveSession);
}

function wireIPC() {
  ipcRenderer.on(IPC.CHAT_SESSIONS_DATA, (event, payload) => {
    sessions = Array.isArray(payload) ? payload : [];
    renderSessionList();
    renderSuggestionsForActive();
  });

  ipcRenderer.on(IPC.CHAT_SUGGESTIONS_DATA, (event, { sessionId, suggestions }) => {
    const s = sessions.find(s => s.id === sessionId);
    if (s) s.suggestions = suggestions;
    if (active && active.sessionId === sessionId) renderSuggestionsForActive();
    renderSessionList();
  });

  ipcRenderer.on(IPC.GLOBAL_DASHBOARD_DATA, (event, data) => {
    if (data && typeof data === 'object') {
      registry = data;
      if (pickerEl && !pickerEl.classList.contains('visible')) return;
      renderPickerList();
    }
  });
}

/**
 * Called by globalDashboard when the user clicks the Chat button.
 * Loads sessions and ensures we have a fresh registry for the picker.
 */
function show() {
  if (!panelEl) init();
  panelEl.classList.add('visible');
  ipcRenderer.send(IPC.LIST_CHAT_SESSIONS);
  ipcRenderer.send(IPC.LOAD_GLOBAL_DASHBOARD);
}

function hide() {
  if (!panelEl) return;
  panelEl.classList.remove('visible');
}

function toggle() {
  if (panelEl && panelEl.classList.contains('visible')) hide(); else show();
}

/* -------------------- Project picker -------------------- */

function openPicker() {
  if (!pickerEl) return;
  ipcRenderer.send(IPC.LOAD_GLOBAL_DASHBOARD);
  renderPickerList();
  pickerEl.classList.add('visible');
}

function closePicker() {
  if (pickerEl) pickerEl.classList.remove('visible');
}

function renderPickerList() {
  if (!pickerListEl) return;
  const projects = Object.values(registry.projects || {}).sort((a, b) =>
    (a.name || '').localeCompare(b.name || '')
  );
  pickerListEl.innerHTML = '';
  if (projects.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'chat-picker-empty';
    empty.textContent = 'No projects tracked yet. Add some in the dashboard first.';
    pickerListEl.appendChild(empty);
    return;
  }
  for (const p of projects) {
    const row = document.createElement('label');
    row.className = 'chat-picker-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.dataset.path = p.path;
    cb.checked = !p.filterHidden;
    const name = document.createElement('span');
    name.className = 'chat-picker-name';
    name.textContent = p.name || p.path;
    const count = document.createElement('span');
    count.className = 'chat-picker-count';
    const tasks = (p.taskSnapshot && p.taskSnapshot.tasks) || [];
    const open = tasks.filter(t => t.status !== 'completed').length;
    count.textContent = `${open} open`;
    row.appendChild(cb);
    row.appendChild(name);
    row.appendChild(count);
    pickerListEl.appendChild(row);
  }
}

async function startNewSessionFromPicker() {
  if (!pickerListEl) return;
  const picks = [];
  pickerListEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    if (cb.checked) picks.push(cb.dataset.path);
  });
  if (picks.length === 0) return;
  closePicker();
  const result = await ipcRenderer.invoke(IPC.CREATE_CHAT_SESSION, {
    projectPaths: picks
  });
  if (!result || !result.ok) {
    console.warn('chat session create failed:', result && result.error);
    return;
  }
  openSession(result.session);
}

/* -------------------- Sessions list -------------------- */

function renderSessionList() {
  if (!sessionListEl) return;
  sessionListEl.innerHTML = '';
  if (sessions.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'chat-session-empty';
    empty.textContent = 'No chats yet. Start a new one to plan across projects.';
    sessionListEl.appendChild(empty);
    return;
  }
  for (const s of sessions) {
    const row = document.createElement('div');
    row.className = 'chat-session-row';
    if (active && active.sessionId === s.id) row.classList.add('active');
    row.dataset.sessionId = s.id;

    const title = document.createElement('div');
    title.className = 'chat-session-title';
    title.textContent = s.title || s.id;
    row.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'chat-session-meta';
    const projects = (s.projects || []).map(p => p.name).join(', ');
    meta.textContent = projects || '—';
    row.appendChild(meta);

    if (s.suggestions && s.suggestions.length > 0) {
      const badge = document.createElement('span');
      badge.className = 'chat-session-suggestions';
      badge.textContent = `${s.suggestions.length} suggestion${s.suggestions.length === 1 ? '' : 's'}`;
      row.appendChild(badge);
    }

    const del = document.createElement('button');
    del.className = 'chat-session-del';
    del.title = 'Delete session';
    del.textContent = '✕';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!confirm(`Delete chat session "${s.title}"? The on-disk folder will be removed.`)) return;
      if (active && active.sessionId === s.id) closeActiveSession();
      ipcRenderer.send(IPC.DELETE_CHAT_SESSION, { id: s.id });
    });
    row.appendChild(del);

    row.addEventListener('click', () => openSession(s));
    sessionListEl.appendChild(row);
  }
}

/* -------------------- Open / close active session -------------------- */

async function openSession(session) {
  // Tearing down a previous active session ensures only one xterm is
  // mounted at a time — chat panel is single-paned by design.
  if (active && active.sessionId === session.id) {
    showChatBody();
    return;
  }
  if (active) closeActiveSession();

  const startCommand = await ipcRenderer.invoke(IPC.GET_CHAT_START_COMMAND);
  const terminalId = await createTerminal(session.path);
  if (!terminalId) return;

  mountTerminal(terminalId, session);

  // Let the shell finish printing its prompt before we paste — some
  // shells re-render the prompt on first resize.
  setTimeout(() => {
    if (startCommand) {
      ipcRenderer.send(IPC.TERMINAL_INPUT_ID, {
        terminalId,
        data: `${startCommand}\n`
      });
    }
  }, 350);

  renderSessionList();
  renderSuggestionsForActive();
}

function createTerminal(cwd) {
  return new Promise(resolve => {
    const handler = (event, payload) => {
      ipcRenderer.removeListener(IPC.TERMINAL_CREATED, handler);
      if (payload && payload.success) resolve(payload.terminalId);
      else resolve(null);
    };
    ipcRenderer.on(IPC.TERMINAL_CREATED, handler);
    ipcRenderer.send(IPC.TERMINAL_CREATE, {
      cwd,
      projectPath: `chat:${cwd}` // synthetic — keeps it out of project-scoped lookups
    });
  });
}

function mountTerminal(terminalId, session) {
  if (!terminalHostEl) return;
  terminalHostEl.innerHTML = '';

  const term = new Terminal({
    cursorBlink: true,
    fontSize: 13,
    fontFamily: 'JetBrains Mono, Consolas, monospace',
    theme: { background: '#0e0e10' },
    scrollback: 20000,
    scrollOnUserInput: false
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(terminalHostEl);
  requestAnimationFrame(() => {
    try {
      fit.fit();
      ipcRenderer.send(IPC.TERMINAL_RESIZE_ID, {
        terminalId,
        cols: term.cols,
        rows: term.rows
      });
    } catch (_) { /* ignore */ }
  });

  // Pipe pty output → xterm
  const outputHandler = (event, { terminalId: id, data }) => {
    if (id !== terminalId) return;
    term.write(data);
  };
  ipcRenderer.on(IPC.TERMINAL_OUTPUT_ID, outputHandler);

  // Pipe xterm input → pty
  const inputDisposable = term.onData(data => {
    ipcRenderer.send(IPC.TERMINAL_INPUT_ID, { terminalId, data });
  });

  // Resize → pty
  const resizeDisposable = term.onResize(({ cols, rows }) => {
    ipcRenderer.send(IPC.TERMINAL_RESIZE_ID, { terminalId, cols, rows });
  });

  // Window resize → fit
  const onWinResize = () => {
    try { fit.fit(); } catch (_) { /* ignore */ }
  };
  window.addEventListener('resize', onWinResize);

  // Pty destroyed (e.g. shell exit) → mark active gone
  const destroyHandler = (event, { terminalId: id }) => {
    if (id !== terminalId) return;
    closeActiveSession();
  };
  ipcRenderer.on(IPC.TERMINAL_DESTROYED, destroyHandler);

  // Copy / paste keybinds — mirror main terminal manager behaviour
  term.attachCustomKeyEventHandler((event) => {
    const key = event.key.toLowerCase();
    if (event.type !== 'keydown') return true;
    if ((event.metaKey || (event.ctrlKey && event.shiftKey)) && key === 'c') {
      if (term.hasSelection()) {
        clipboard.writeText(term.getSelection());
        term.clearSelection();
      }
      return false;
    }
    if ((event.metaKey || (event.ctrlKey && event.shiftKey)) && key === 'v') {
      const text = clipboard.readText();
      if (text) ipcRenderer.send(IPC.TERMINAL_INPUT_ID, { terminalId, data: text });
      return false;
    }
    return true;
  });

  if (chatHeaderEl) {
    chatHeaderEl.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'chat-active-title';
    title.textContent = session.title;
    chatHeaderEl.appendChild(title);
    const meta = document.createElement('div');
    meta.className = 'chat-active-meta';
    meta.textContent = (session.projects || []).map(p => p.name).join(' · ');
    chatHeaderEl.appendChild(meta);
  }

  active = {
    sessionId: session.id,
    sessionPath: session.path,
    terminalId,
    terminal: term,
    fitAddon: fit,
    listeners: {
      output: outputHandler,
      input: inputDisposable,
      resize: resizeDisposable,
      destroy: destroyHandler,
      winResize: onWinResize
    }
  };

  showChatBody();
  term.focus();
}

function showChatBody() {
  if (panelEl) panelEl.classList.add('has-active');
}

function hideChatBody() {
  if (panelEl) panelEl.classList.remove('has-active');
}

function closeActiveSession() {
  if (!active) {
    hideChatBody();
    return;
  }
  // Re-entry guard: TERMINAL_DESTROYED from main will call us back; we
  // must not double-dispose. Snapshot + null active immediately so any
  // re-entry short-circuits at the !active check above.
  const { terminalId, terminal, listeners } = active;
  active = null;

  // Dispose renderer-side listeners FIRST so no more input / resize
  // can flow toward an about-to-be-destroyed pty.
  try { listeners.input.dispose(); } catch (_) { /* ignore */ }
  try { listeners.resize.dispose(); } catch (_) { /* ignore */ }
  window.removeEventListener('resize', listeners.winResize);
  try { ipcRenderer.removeListener(IPC.TERMINAL_OUTPUT_ID, listeners.output); } catch (_) { /* ignore */ }
  try { ipcRenderer.removeListener(IPC.TERMINAL_DESTROYED, listeners.destroy); } catch (_) { /* ignore */ }

  // Now ask main to kill the pty. It's safe even if main already
  // destroyed it (e.g., onExit-driven destroy) because destroyTerminal
  // is now idempotent.
  try { ipcRenderer.send(IPC.TERMINAL_DESTROY, terminalId); } catch (_) { /* ignore */ }

  try { terminal.dispose(); } catch (_) { /* ignore */ }
  if (terminalHostEl) terminalHostEl.innerHTML = '';
  hideChatBody();
  renderSessionList();
  renderSuggestionsForActive();
}

/* -------------------- Suggestions surface -------------------- */

function renderSuggestionsForActive() {
  if (!suggestionsEl) return;
  suggestionsEl.innerHTML = '';
  if (!active) {
    if (suggestionsCountEl) suggestionsCountEl.textContent = '';
    return;
  }
  const session = sessions.find(s => s.id === active.sessionId);
  const items = (session && session.suggestions) || [];
  if (suggestionsCountEl) {
    suggestionsCountEl.textContent = items.length === 0
      ? ''
      : `${items.length} pending`;
  }
  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'chat-suggestion-empty';
    empty.textContent = 'No suggestions yet. When the agent writes one to ./suggestions/, it shows up here.';
    suggestionsEl.appendChild(empty);
    return;
  }
  for (const s of items) suggestionsEl.appendChild(renderSuggestionCard(s));
}

function renderSuggestionCard(s) {
  const card = document.createElement('div');
  card.className = `chat-suggestion chat-suggestion-${s.type || 'unknown'}`;

  const head = document.createElement('div');
  head.className = 'chat-suggestion-head';
  const type = document.createElement('span');
  type.className = 'chat-suggestion-type';
  type.textContent = (s.type || 'unknown').replace('-', ' ');
  head.appendChild(type);
  const project = document.createElement('span');
  project.className = 'chat-suggestion-project';
  project.textContent = s.project || '—';
  head.appendChild(project);
  card.appendChild(head);

  const title = document.createElement('div');
  title.className = 'chat-suggestion-title';
  title.textContent = s.title || (s.taskId ? `Update #${s.taskId}` : 'Untitled');
  card.appendChild(title);

  if (s.description) {
    const desc = document.createElement('div');
    desc.className = 'chat-suggestion-desc';
    desc.textContent = s.description;
    card.appendChild(desc);
  }
  if (s.type === 'update-task' && s.updates) {
    const updates = document.createElement('div');
    updates.className = 'chat-suggestion-updates';
    updates.textContent = Object.entries(s.updates).map(([k, v]) => `${k} → ${JSON.stringify(v)}`).join(' · ');
    card.appendChild(updates);
  }
  if (s.rationale) {
    const why = document.createElement('div');
    why.className = 'chat-suggestion-rationale';
    why.textContent = `Why: ${s.rationale}`;
    card.appendChild(why);
  }

  const actions = document.createElement('div');
  actions.className = 'chat-suggestion-actions';
  const apply = document.createElement('button');
  apply.className = 'chat-suggestion-btn primary';
  apply.textContent = 'Apply';
  apply.addEventListener('click', async () => {
    apply.disabled = true;
    apply.textContent = 'Applying…';
    const result = await ipcRenderer.invoke(IPC.APPLY_CHAT_SUGGESTION, {
      sessionId: active.sessionId,
      suggestionId: s.id
    });
    if (!result || !result.ok) {
      apply.disabled = false;
      apply.textContent = 'Apply';
      alert(`Apply failed: ${result && result.error}`);
    }
  });
  actions.appendChild(apply);

  const dismiss = document.createElement('button');
  dismiss.className = 'chat-suggestion-btn';
  dismiss.textContent = 'Dismiss';
  dismiss.addEventListener('click', () => {
    ipcRenderer.send(IPC.DISMISS_CHAT_SUGGESTION, {
      sessionId: active.sessionId,
      suggestionId: s.id
    });
  });
  actions.appendChild(dismiss);

  card.appendChild(actions);
  return card;
}

module.exports = { init, show, hide, toggle };
