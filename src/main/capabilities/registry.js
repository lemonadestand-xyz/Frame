/**
 * Capability registry — built per project profile.
 *
 * Mirrors supervisor/capabilities.py:155-176. `buildRegistry(profile, deps)`
 * returns a map of `{name → Capability instance}` based on the profile's
 * enabled capabilities list. `runAll(registry, question, ctx, profile)` runs
 * each capability in parallel with a per-instance timeout, collecting an
 * Evidence[] from all of them. Timeouts and errors are caught and surfaced
 * as a single warning-shaped Evidence so the supervisor classifier's
 * re-classification stays simple.
 *
 * Per-capability audit: every `runAll` invocation appends one JSONL line
 * per capability to `<projectPath>/.frame/runtime/capability-audit.jsonl`
 * so the user can see, post-hoc, which capability returned how much
 * evidence and how long it took. The audit write is best-effort and
 * never throws back into the supervisor loop.
 */

const fs = require('fs');
const path = require('path');
const { Capability } = require('./types');

const AUDIT_RELATIVE_PATH = path.join('.frame', 'runtime', 'capability-audit.jsonl');

/**
 * @param {Object} profile  loaded ProjectProfile (from src/main/profile.js)
 * @param {Object} deps  { projectPath, memory? }
 * @returns {Object} { [name]: Capability }
 */
function buildRegistry(profile, deps) {
  const reg = {};
  const enabled = (profile && Array.isArray(profile.capabilities))
    ? profile.capabilities : [];
  for (const name of enabled) {
    const Ctor = REGISTERED[name];
    if (!Ctor) continue; // unknown capability names are ignored (loose match)
    try {
      reg[name] = new Ctor({ ...deps, profile });
    } catch (err) {
      // capability constructor failed; skip + emit a warning Evidence
      reg[name] = new _ConstructFailedCapability({ name, error: err.message });
    }
  }
  return reg;
}

/**
 * Run every capability in the registry in parallel, with timeout + error
 * fallback to a warning Evidence. Returns Evidence[] flattened.
 *
 * Emits one audit line per capability to
 * `<projectPath>/.frame/runtime/capability-audit.jsonl` if the project
 * path can be resolved from `ctx.projectPath` or the capability instance.
 */
async function runAll(registry, question, ctx, profile) {
  const caps = Object.entries(registry);
  if (caps.length === 0) return [];
  const projectPath = _resolveProjectPath(ctx, caps);
  const results = await Promise.all(caps.map(async ([regName, cap]) => {
    const name = regName || cap.constructor.name || 'capability';
    const timeoutMs = cap.constructor.timeoutMs || 2000;
    const startedAt = Date.now();
    let evidence;
    try {
      evidence = await _withTimeout(
        cap.run({ question, context: ctx, profile }),
        timeoutMs,
        name
      );
    } catch (err) {
      evidence = [{
        source: name,
        summary: `error: ${err.message || String(err)}`,
        refs: [],
        score: 0,
      }];
    }
    const duration_ms = Date.now() - startedAt;
    _writeAudit(projectPath, {
      capability: name,
      question: typeof question === 'string' ? question : String(question || ''),
      evidenceCount: Array.isArray(evidence) ? evidence.length : 0,
      duration_ms,
      ts: new Date().toISOString(),
    });
    return evidence;
  }));
  return results.flat();
}

function _resolveProjectPath(ctx, capsEntries) {
  if (ctx && typeof ctx.projectPath === 'string' && ctx.projectPath) {
    return ctx.projectPath;
  }
  for (const [, cap] of capsEntries) {
    if (cap && typeof cap.projectPath === 'string' && cap.projectPath) {
      return cap.projectPath;
    }
  }
  return null;
}

function _writeAudit(projectPath, record) {
  if (!projectPath) return; // nothing to write to
  try {
    const auditPath = path.join(projectPath, AUDIT_RELATIVE_PATH);
    fs.mkdirSync(path.dirname(auditPath), { recursive: true });
    fs.appendFileSync(auditPath, `${JSON.stringify(record)}\n`, 'utf8');
  } catch {
    // best-effort — never crash the supervisor loop on an audit-write fault
  }
}

function _withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Plug-in point — concrete capability classes register themselves by name.
// See src/main/capabilities/{specReader,knowledgeSearch,webResearch}.js
// once those land (T03–T07).
const REGISTERED = {};

function register(name, Ctor) {
  if (!name || typeof name !== 'string') throw new Error('capability name required');
  if (typeof Ctor !== 'function') throw new Error('capability Ctor required');
  REGISTERED[name] = Ctor;
}

function listRegistered() { return Object.keys(REGISTERED); }

function _resetForTests() {
  for (const key of Object.keys(REGISTERED)) delete REGISTERED[key];
}

class _ConstructFailedCapability extends Capability {
  constructor({ name, error }) {
    super();
    this._name = name;
    this._error = error;
  }
  async run() {
    return [{
      source: this._name,
      summary: `capability failed to initialise: ${this._error}`,
      refs: [],
      score: 0,
    }];
  }
}

module.exports = {
  buildRegistry,
  runAll,
  register,
  listRegistered,
  _resetForTests,
  AUDIT_RELATIVE_PATH,
};
