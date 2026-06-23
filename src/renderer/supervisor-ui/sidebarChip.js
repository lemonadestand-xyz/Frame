// Supervisor sidebar-footer heartbeat chip — Phase F.
//
// Mounts a tiny status indicator in Frame's sidebar so the user can see daemon
// liveness from any view (not just when the Supervisor tab is foregrounded).
// Single click opens the Supervisor section; the dot color mirrors the
// header's sup-dot semantics:
//   - muted (default): no heartbeat seen yet / supervisor never initialized
//   - alive (green):   daemon running, last heartbeat fresh
//   - dead  (red):     heartbeat seen but daemon offline / unreachable
//
// Subscribes to SUPERVISOR_STATE pushes from main. Those only start flowing
// after the renderer announces the supervisor root (kanban does this on
// mount). Until then the chip stays muted — which is the correct semantic:
// we genuinely don't know.
//
// Idempotent: mount() can be called multiple times; subsequent calls become
// no-ops. We never tear down — the chip lives for the whole Frame session.

const { ipcRenderer } = require('electron');
const SUP = require('../../shared/supervisor-ipc');

let mounted = false;
let dotEl = null;
let chipEl = null;
let lastHeartbeatAt = 0;
let staleTimer = null;

const STALE_AFTER_MS = 15000;

function injectStylesOnce() {
  if (document.querySelector('[data-supervisor-chip-styles]')) return;
  const style = document.createElement('style');
  style.dataset.supervisorChipStyles = '1';
  style.textContent = `
    .sup-sidebar-chip {
      flex-shrink: 0;
      margin: var(--space-md) var(--space-sm) 0;
      padding: 6px 10px;
      display: flex;
      align-items: center;
      gap: 8px;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-default);
      border-radius: var(--radius-sm);
      cursor: pointer;
      font-family: var(--font-mono);
      font-size: 10.5px;
      color: var(--text-secondary);
      letter-spacing: 0.04em;
      text-transform: uppercase;
      transition: background var(--transition-fast), border-color var(--transition-fast);
    }
    .sup-sidebar-chip:hover {
      background: var(--bg-hover);
      border-color: var(--border-strong);
      color: var(--text-primary);
    }
    .sup-sidebar-chip .sup-sidebar-chip-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--text-muted);
      box-shadow: 0 0 0 3px transparent;
      transition: background var(--transition-fast), box-shadow var(--transition-fast);
      flex-shrink: 0;
    }
    .sup-sidebar-chip .sup-sidebar-chip-dot.alive {
      background: var(--success);
      box-shadow: 0 0 0 3px var(--success-subtle);
    }
    .sup-sidebar-chip .sup-sidebar-chip-dot.dead {
      background: var(--error);
      box-shadow: 0 0 0 3px var(--error-subtle);
    }
    .sup-sidebar-chip .sup-sidebar-chip-label {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `;
  document.head.appendChild(style);
}

function setState(kind) {
  if (!dotEl) return;
  dotEl.classList.toggle('alive', kind === 'alive');
  dotEl.classList.toggle('dead', kind === 'dead');
  if (chipEl) {
    chipEl.title = kind === 'alive'
      ? 'Supervisor daemon running — click to open'
      : kind === 'dead'
        ? 'Supervisor daemon offline — click to open'
        : 'Supervisor — click to open';
  }
}

function applyHeartbeat(hb) {
  if (!hb) return;
  lastHeartbeatAt = Date.now();
  const isAlive = !!hb.alive || hb.state === 'running';
  setState(isAlive ? 'alive' : 'dead');
  armStaleTimer();
}

function armStaleTimer() {
  if (staleTimer) clearTimeout(staleTimer);
  staleTimer = setTimeout(() => {
    // No heartbeat in 15s → treat as unknown rather than asserting alive.
    if (Date.now() - lastHeartbeatAt >= STALE_AFTER_MS) setState('unknown');
  }, STALE_AFTER_MS);
}

function mount(anchor) {
  if (mounted) return;
  // Anchor lookup: prefer the caller-supplied element, fall back to
  // #sidebar-body (the sidebar panel container) so the call site can stay a
  // single line without binding to internal DOM ids.
  const host = anchor || document.getElementById('sidebar-body');
  if (!host) return;
  mounted = true;
  injectStylesOnce();

  chipEl = document.createElement('button');
  chipEl.type = 'button';
  chipEl.className = 'sup-sidebar-chip';
  chipEl.tabIndex = -1;
  chipEl.innerHTML = `
    <span class="sup-sidebar-chip-dot"></span>
    <span class="sup-sidebar-chip-label">Supervisor</span>
  `;
  dotEl = chipEl.querySelector('.sup-sidebar-chip-dot');
  chipEl.addEventListener('click', () => {
    try { require('./index').open(); } catch (err) {
      console.warn('[supervisor] sidebar chip open failed:', err);
    }
  });
  host.appendChild(chipEl);
  setState('unknown');

  ipcRenderer.on(SUP.SUPERVISOR_STATE, (_evt, payload) => {
    if (!payload) return;
    if (payload.kind === 'heartbeat') applyHeartbeat(payload.data);
  });
}

module.exports = { mount };
