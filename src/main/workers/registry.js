/**
 * Worker registry — single process-wide map.
 *
 * Concrete workers (ClaudeCodeWorker / CodexWorker / GeminiWorker / FakeWorker)
 * register on require via `src/main/workers/index.js`. Callers look up by
 * tool name; the supervisor loop and the existing agentDispatch shim both
 * consume the registry.
 */

const REGISTRY = new Map();

function register(name, Ctor) {
  if (!name || typeof name !== 'string') throw new Error('worker name required');
  if (typeof Ctor !== 'function') throw new Error('worker Ctor required');
  REGISTRY.set(name, Ctor);
}

function getWorker(name) {
  const Ctor = REGISTRY.get(name);
  if (!Ctor) throw new Error(`unknown worker: ${name}`);
  return new Ctor();
}

function listWorkers() { return [...REGISTRY.keys()]; }

function hasWorker(name) { return REGISTRY.has(name); }

// Test-only — never used in production.
function _resetForTests() { REGISTRY.clear(); }

module.exports = { register, getWorker, listWorkers, hasWorker, _resetForTests };
