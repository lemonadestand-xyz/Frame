// Supervisor project filter — Phase M.
//
// Single source of truth for the "filter every supervisor surface to one
// project" selection (Fix 4 + Fix 5 of the Phase M spec). The header owns
// the dropdown; the kanban, projectTree, and memoryPanel all subscribe so a
// change propagates without point-to-point wiring through index.js.
//
// Persisted in localStorage so the filter survives Frame restarts. We
// intentionally use a plain string (the project NAME) rather than the full
// project record — names are stable across Frame restarts, paths can change.

const STORAGE_KEY = 'supervisor.projectFilter';

let _current = null;
let _loaded = false;
const _subscribers = new Set();

function load() {
  if (_loaded) return _current;
  _loaded = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    _current = raw || null;
  } catch { _current = null; }
  return _current;
}

function get() {
  return load();
}

function set(name) {
  load();
  const next = (name && String(name)) || null;
  if (next === _current) return;
  _current = next;
  try {
    if (next) window.localStorage.setItem(STORAGE_KEY, next);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch { /* private mode etc — non-fatal */ }
  // Notify in a try/catch so one broken subscriber can't break siblings.
  for (const cb of _subscribers) {
    try { cb(_current); } catch (err) { console.warn('[supervisor] filter sub failed:', err); }
  }
}

function subscribe(cb) {
  if (typeof cb !== 'function') return () => {};
  _subscribers.add(cb);
  return () => _subscribers.delete(cb);
}

/**
 * Same loose substring match the project tree uses (task objects don't
 * carry a project_id field; the closest signal is profile/title/id/brief
 * vs project name). Centralised here so kanban + tree agree.
 */
function matches(task, projectName) {
  if (!projectName) return true;
  const n = String(projectName).toLowerCase();
  if (!n) return true;
  return (
    (task.id || '').toLowerCase().includes(n) ||
    (task.title || '').toLowerCase().includes(n) ||
    (task.profile || '').toLowerCase().includes(n) ||
    (task.brief || '').toLowerCase().includes(n)
  );
}

module.exports = { get, set, subscribe, matches };
