// Supervisor header — Phase C (reactive) + Phase M (project filter).
//
// Subscribes to SUPERVISOR_STATE pushes from main (fs.watch on heartbeat.json +
// audit.jsonl tail). The /api/heartbeat + /api/workspace fetches survive in
// two narrow roles:
//   1) initial paint on mount, so the header isn't blank for the first second
//   2) fallback polling that kicks in 5s after mount if no SUPERVISOR_STATE
//      push has arrived (means main never got STATE_INIT, the supervisor
//      isn't running, or the daemon's tick is genuinely slower than 5s).
//
// Phase M added the project-filter dropdown next to the in-flight count.
// Options are loaded lazily via SUPERVISOR_LIST_WORKSPACE_PROJECTS — the same
// merged project list the projectTree consumes. Selection persists in
// localStorage via projectFilter.set/get; the kanban + tree + memory panel
// all subscribe to projectFilter so changing the dropdown updates every
// supervisor surface without point-to-point wiring through index.js.

const { ipcRenderer } = require('electron');
const SUP = require('../../shared/supervisor-ipc');
const projectFilter = require('./projectFilter');

const SUPERVISOR_API = 'http://127.0.0.1:8766';
const FALLBACK_AFTER_MS = 5000;
const FALLBACK_HEARTBEAT_MS = 5000;
const FALLBACK_WORKSPACE_MS = 4000;

async function fetchJson(path) {
  const res = await fetch(`${SUPERVISOR_API}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function create(root) {
  let alive = true;
  let stateListener = null;
  let receivedPushAt = 0;
  let fallbackHbTimer = null;
  let fallbackWsTimer = null;
  let fallbackArmTimer = null;
  let supervisorRoot = null;
  let unsubFilter = null;

  root.innerHTML = `
    <div class="sup-live">
      <div class="sup-dot" id="sup-dot"></div>
      <div class="sup-brand">SUPERVISOR</div>
    </div>
    <div class="sup-meta">
      <span>daemon: <span class="v" id="sup-daemon">…</span></span>
      <span>in-flight: <span class="v" id="sup-inflight">0</span></span>
      <label class="sup-meta-proj">
        <span>project:</span>
        <select class="sup-meta-proj-sel" id="sup-meta-proj">
          <option value="">All projects</option>
        </select>
      </label>
      <span>cost today: <span class="v" id="sup-cost">$0.00</span></span>
    </div>
    <div class="sup-actions">
      <button class="sup-btn primary" id="sup-btn-submit" title="Submit a new task">▶ Submit task</button>
      <button class="sup-btn" id="sup-btn-daemon" title="Toggle daemon">⏸ Stop daemon</button>
      <button class="sup-btn" id="sup-btn-refresh" title="Force re-poll now">↻ Refresh</button>
    </div>
  `;

  const dotEl = root.querySelector('#sup-dot');
  const daemonEl = root.querySelector('#sup-daemon');
  const inflightEl = root.querySelector('#sup-inflight');
  const costEl = root.querySelector('#sup-cost');
  const daemonBtnEl = root.querySelector('#sup-btn-daemon');
  const projSelEl = root.querySelector('#sup-meta-proj');
  let daemonAlive = null;

  function applyDaemonButton() {
    if (daemonAlive === null) {
      daemonBtnEl.textContent = '… daemon';
      daemonBtnEl.disabled = true;
      daemonBtnEl.classList.remove('primary');
      return;
    }
    daemonBtnEl.disabled = false;
    if (daemonAlive) {
      daemonBtnEl.textContent = '⏸ Stop daemon';
      daemonBtnEl.classList.remove('primary');
      daemonBtnEl.title = 'Stop the daemon (confirms first)';
    } else {
      daemonBtnEl.textContent = '▶ Start daemon';
      daemonBtnEl.classList.add('primary');
      daemonBtnEl.title = 'Start the daemon';
    }
  }

  function applyHeartbeat(hb) {
    if (!alive || !hb) return;
    const isAlive = !!hb.alive || hb.state === 'running';
    dotEl.classList.toggle('alive', isAlive);
    dotEl.classList.toggle('dead', !isAlive);
    daemonEl.textContent = hb.state || (isAlive ? 'running' : 'offline');
    inflightEl.textContent = String((hb.in_flight || []).length);
    daemonAlive = isAlive;
    applyDaemonButton();
  }

  function applyWorkspaceTotals(ws) {
    if (!alive || !ws) return;
    const cost = (ws.totals && ws.totals.cost_today_usd) || 0;
    costEl.textContent = `$${Number(cost).toFixed(2)}`;
  }

  async function fetchHeartbeatOnce() {
    try {
      applyHeartbeat(await fetchJson('/api/heartbeat'));
    } catch (err) {
      if (!alive) return;
      dotEl.classList.remove('alive');
      dotEl.classList.add('dead');
      daemonEl.textContent = 'unreachable';
      daemonAlive = false;
      applyDaemonButton();
    }
  }

  async function fetchWorkspaceOnce() {
    try {
      applyWorkspaceTotals(await fetchJson('/api/workspace'));
    } catch (err) {
      // Quiet — keep the last good value
    }
  }

  function refresh() {
    fetchHeartbeatOnce();
    fetchWorkspaceOnce();
  }

  function startFallback() {
    if (fallbackHbTimer || fallbackWsTimer) return;
    fallbackHbTimer = setInterval(fetchHeartbeatOnce, FALLBACK_HEARTBEAT_MS);
    fallbackWsTimer = setInterval(fetchWorkspaceOnce, FALLBACK_WORKSPACE_MS);
  }

  function stopFallback() {
    if (fallbackHbTimer) clearInterval(fallbackHbTimer);
    if (fallbackWsTimer) clearInterval(fallbackWsTimer);
    fallbackHbTimer = null;
    fallbackWsTimer = null;
  }

  async function loadProjectOptions() {
    try {
      const projects = await ipcRenderer.invoke(
        SUP.SUPERVISOR_LIST_WORKSPACE_PROJECTS,
        { supervisorRoot: supervisorRoot || undefined }
      );
      if (!alive) return;
      const current = projectFilter.get() || '';
      const opts = ['<option value="">All projects</option>']
        .concat((projects || []).map((p) => (
          `<option value="${esc(p.name)}">${esc(p.name)}</option>`
        )));
      projSelEl.innerHTML = opts.join('');
      // Reapply persisted selection if it still exists in the list.
      if (current && (projects || []).some((p) => p.name === current)) {
        projSelEl.value = current;
      }
    } catch (err) {
      // Leave the default "All projects" option in place.
    }
  }

  function setSupervisorRoot(root_) {
    if (root_ === supervisorRoot) return;
    supervisorRoot = root_ || null;
    if (supervisorRoot) loadProjectOptions();
  }

  // Subscribe to main's reactive state pushes.
  stateListener = (_evt, payload) => {
    if (!payload || !alive) return;
    receivedPushAt = Date.now();
    stopFallback();
    if (payload.kind === 'heartbeat') applyHeartbeat(payload.data);
  };
  ipcRenderer.on(SUP.SUPERVISOR_STATE, stateListener);

  // Buttons + dropdown wiring.
  root.querySelector('#sup-btn-submit').addEventListener('click', () => {
    require('./submitTaskPanel').toggle();
  });
  daemonBtnEl.addEventListener('click', async () => {
    if (daemonAlive === null) return;
    if (daemonAlive) {
      if (!window.confirm('Stop the supervisor daemon? In-flight tasks finish first.')) return;
      daemonBtnEl.disabled = true;
      try {
        await ipcRenderer.invoke(SUP.SUPERVISOR_DAEMON_STOP);
      } catch (err) {
        console.warn('[supervisor] daemon stop failed:', err);
      }
      setTimeout(fetchHeartbeatOnce, 800);
    } else {
      daemonBtnEl.disabled = true;
      try {
        await ipcRenderer.invoke(SUP.SUPERVISOR_DAEMON_START);
      } catch (err) {
        console.warn('[supervisor] daemon start failed:', err);
      }
      setTimeout(fetchHeartbeatOnce, 800);
    }
  });
  root.querySelector('#sup-btn-refresh').addEventListener('click', refresh);
  projSelEl.addEventListener('change', () => {
    projectFilter.set(projSelEl.value || null);
  });
  // External changes (e.g. clicking a project in the tree) also reflect in
  // the dropdown so the visible state always matches the active filter.
  unsubFilter = projectFilter.subscribe((name) => {
    if (projSelEl.value !== (name || '')) projSelEl.value = name || '';
  });
  // Apply the persisted value on mount once options are present.
  const initial = projectFilter.get();
  if (initial) projSelEl.value = initial;

  // Initial paint + project list. Project list re-fetches once we learn
  // supervisorRoot (kanban hands it over) so supervisor-side profile names
  // get merged in.
  refresh();
  loadProjectOptions();

  fallbackArmTimer = setTimeout(() => {
    if (!alive) return;
    if (!receivedPushAt) startFallback();
  }, FALLBACK_AFTER_MS);

  function stop() {
    alive = false;
    if (stateListener) ipcRenderer.removeListener(SUP.SUPERVISOR_STATE, stateListener);
    stateListener = null;
    stopFallback();
    if (fallbackArmTimer) clearTimeout(fallbackArmTimer);
    fallbackArmTimer = null;
    if (unsubFilter) { unsubFilter(); unsubFilter = null; }
  }

  return { stop, refresh, setSupervisorRoot, refreshProjects: loadProjectOptions };
}

module.exports = { create, SUPERVISOR_API };
