/**
 * Supervisor registry — process-global map of `(projectPath, slug) → SupervisorLoop`.
 *
 * Cross-project orchestration emerges naturally: any caller can start a
 * supervisor on any (projectPath, slug); the registry serves the
 * cross-project UI's `getAcrossProjects()` snapshot.
 *
 * One supervisor per (projectPath, slug). Re-starting an already-running
 * supervisor is a no-op.
 */

const { SupervisorLoop } = require('./supervisorLoop');

const REGISTRY = new Map(); // key: `${projectPath}::${slug}` → SupervisorLoop
const LISTENERS = new Set();

function _key(projectPath, slug) { return `${projectPath}::${slug}`; }

function startSupervisor({ projectPath, slug, executors, capabilities, tickIntervalMs }) {
  const key = _key(projectPath, slug);
  let loop = REGISTRY.get(key);
  if (loop && loop.getState().status === 'running') return loop;
  if (!loop) {
    loop = new SupervisorLoop({
      projectPath,
      slug,
      executors,
      capabilities,
      tickIntervalMs,
      onStateChange: () => _broadcast(),
      onAudit: () => { /* per-tick fire is fine; broadcast on state too */ },
    });
    REGISTRY.set(key, loop);
  }
  loop.start();
  _broadcast();
  return loop;
}

async function stopSupervisor(projectPath, slug) {
  const loop = REGISTRY.get(_key(projectPath, slug));
  if (!loop) return;
  await loop.stop();
  _broadcast();
}

async function pauseAll() {
  const snap = [];
  for (const [k, loop] of REGISTRY.entries()) {
    if (loop.getState().status === 'running') {
      snap.push(k);
      await loop.stop();
    }
  }
  _broadcast();
  return snap;
}

function getSupervisor(projectPath, slug) { return REGISTRY.get(_key(projectPath, slug)) || null; }

function listAll() { return [...REGISTRY.values()].map((l) => l.getState()); }

function getAcrossProjects() {
  const grouped = new Map();
  for (const loop of REGISTRY.values()) {
    const s = loop.getState();
    if (!grouped.has(s.projectPath)) grouped.set(s.projectPath, []);
    grouped.get(s.projectPath).push(s);
  }
  const projects = [];
  let totalActive = 0;
  let totalEscalations = 0;
  for (const [projectPath, specs] of grouped.entries()) {
    const activeCount = specs.filter((s) => s.status === 'running').length;
    const escalationCount = specs.filter(
      (s) => s.lastVerdict?.route === 'escalate'
    ).length;
    totalActive += activeCount;
    totalEscalations += escalationCount;
    projects.push({ projectPath, activeCount, escalationCount, specs });
  }
  return { projects, totalActive, totalEscalations, anyRunning: totalActive > 0 };
}

function subscribe(listener) {
  if (typeof listener !== 'function') return () => {};
  LISTENERS.add(listener);
  return () => LISTENERS.delete(listener);
}

function _broadcast() {
  const snapshot = getAcrossProjects();
  for (const fn of LISTENERS) {
    try { fn(snapshot); } catch { /* swallow */ }
  }
}

function _resetForTests() {
  for (const loop of REGISTRY.values()) {
    try { loop.stop(); } catch { /* ignore */ }
  }
  REGISTRY.clear();
  LISTENERS.clear();
}

module.exports = {
  startSupervisor,
  stopSupervisor,
  pauseAll,
  getSupervisor,
  listAll,
  getAcrossProjects,
  subscribe,
  _resetForTests,
};
