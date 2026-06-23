/**
 * Project profile loader + watcher.
 *
 * Per-project `.frame/profile.json` mirrors the supervisor's ProjectProfile
 * (supervisor/types.py:193-210). The supervisor uses YAML; Frame uses JSON
 * for the same schema to avoid a new dependency. A converter between the
 * two formats is a follow-up if interop is needed.
 *
 * Loose validation: unknown fields produce warnings, not errors — the loader
 * mirrors the supervisor's `load_profile()` (supervisor/config.py:16-59).
 *
 * Default profile is permissive (no escalate categories, no cost ceiling).
 * The supervisor loop's hard-policy fast path treats it as "use LLM judgment
 * for everything," matching today's autopilot behaviour.
 */

const fs = require('fs');
const path = require('path');
const { FRAME_DIR } = require('../shared/frameConstants');

const PROFILE_FILE = 'profile.json';

const KNOWN_TOP_KEYS = new Set([
  'id', 'project', 'worker', 'context_sources', 'policy', 'roles',
  'people', 'capabilities', 'budgets', 'ledger', 'store',
  'escalation', // child E config block
]);

const KNOWN_POLICY_KEYS = new Set(['escalate_categories', 'cost_ceiling_usd', 'rules']);
const KNOWN_RULE_ROUTES = new Set(['auto_answer', 'research', 'escalate']);
// Frame canonical keys + the supervisor-YAML equivalents, since migrated
// profiles carry `spend_ceiling_*` verbatim (see migrate-supervisor-profile.js).
const KNOWN_BUDGET_KEYS = new Set([
  'iteration_cap',
  'spend_per_task_usd', 'spend_per_day_usd',
  'spend_ceiling_task_usd', 'spend_ceiling_day_usd',
]);

// ─── Path helpers ──────────────────────────────────────────

function profilePath(projectPath) {
  return path.join(projectPath, FRAME_DIR, PROFILE_FILE);
}

// ─── Default profile ───────────────────────────────────────

function defaultProfile(projectPath) {
  const id = projectPath ? path.basename(projectPath) : 'unknown';
  return {
    id,
    worker: { auth: 'subscription', permission: 'default', workdir: '.', model: null },
    context_sources: [],
    policy: {
      escalate_categories: [],
      cost_ceiling_usd: null,
      rules: [],
    },
    roles: [
      { name: 'user', authority: ['*'], channel: 'ui', proactivity: 'wait' },
    ],
    people: {},
    capabilities: [],
    budgets: { iteration_cap: 3, spend_per_task_usd: null, spend_per_day_usd: null },
    ledger: { kind: null },
    store: { kind: 'local' },
  };
}

// ─── Validation (loose) ────────────────────────────────────

function validateProfile(profile) {
  const warnings = [];
  if (!profile || typeof profile !== 'object') {
    return { valid: false, warnings: ['profile must be an object'] };
  }
  for (const key of Object.keys(profile)) {
    if (!KNOWN_TOP_KEYS.has(key)) warnings.push(`unknown top-level key: ${key}`);
  }
  if (profile.policy && typeof profile.policy === 'object') {
    for (const key of Object.keys(profile.policy)) {
      if (!KNOWN_POLICY_KEYS.has(key)) warnings.push(`unknown policy key: ${key}`);
    }
    if (Array.isArray(profile.policy.rules)) {
      profile.policy.rules.forEach((rule, i) => {
        if (!rule || typeof rule !== 'object') {
          warnings.push(`policy.rules[${i}] must be an object`);
          return;
        }
        if (rule.route && !KNOWN_RULE_ROUTES.has(rule.route)) {
          warnings.push(`policy.rules[${i}].route invalid: ${rule.route}`);
        }
      });
    }
  }
  if (profile.budgets && typeof profile.budgets === 'object') {
    for (const key of Object.keys(profile.budgets)) {
      if (!KNOWN_BUDGET_KEYS.has(key)) warnings.push(`unknown budgets key: ${key}`);
    }
  }
  return { valid: true, warnings };
}

// ─── Load / save ───────────────────────────────────────────

function loadProfile(projectPath) {
  if (!projectPath) {
    return { profile: defaultProfile(projectPath), source: 'default', fileExists: false, warnings: [] };
  }
  const filePath = profilePath(projectPath);
  const fileExists = fs.existsSync(filePath);
  if (!fileExists) {
    // Discovery fallback: if a canonical supervisor YAML profile exists
    // for this workdir, translate on the fly so the supervisor-side
    // policy carries over even before the migration script has been
    // run. Does NOT write to disk — that is the migration's job.
    const fromSupervisor = _loadFromSupervisorFallback(projectPath);
    if (fromSupervisor) {
      return {
        profile: fromSupervisor,
        source: 'supervisor',
        fileExists: false,
        supervisorAvailable: true,
        warnings: [],
      };
    }
    return { profile: defaultProfile(projectPath), source: 'default', fileExists: false, warnings: [] };
  }
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return {
      profile: defaultProfile(projectPath),
      source: 'default',
      fileExists: true,
      warnings: [`failed to read profile.json: ${err.message}`],
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      profile: defaultProfile(projectPath),
      source: 'default',
      fileExists: true,
      warnings: [`malformed profile.json: ${err.message}; using default`],
    };
  }
  const { valid, warnings } = validateProfile(parsed);
  if (!valid) {
    return {
      profile: defaultProfile(projectPath),
      source: 'default',
      fileExists: true,
      warnings: warnings.concat(['profile validation failed; using default']),
    };
  }
  // Merge over defaults so missing keys don't trip downstream readers.
  const merged = { ...defaultProfile(projectPath), ...parsed };
  return { profile: merged, source: 'file', fileExists: true, warnings };
}

function saveProfile(projectPath, profile) {
  if (!projectPath) return { success: false, error: 'projectPath required' };
  if (!profile || typeof profile !== 'object') {
    return { success: false, error: 'profile must be an object' };
  }
  const { valid, warnings } = validateProfile(profile);
  if (!valid) return { success: false, error: warnings.join('; ') };
  const filePath = profilePath(projectPath);
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(profile, null, 2) + '\n', 'utf8');
    return { success: true, warnings };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
}

// ─── Watcher ───────────────────────────────────────────────

const WATCH_DEBOUNCE_MS = 250;

function watchProfile(projectPath, onChange) {
  if (!projectPath || typeof onChange !== 'function') return () => {};
  const dir = path.join(projectPath, FRAME_DIR);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch { /* ignore */ }
  let debounce = null;
  let watcher;
  try {
    watcher = fs.watch(dir, (_eventType, filename) => {
      if (filename && filename !== PROFILE_FILE) return;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        try { onChange(loadProfile(projectPath)); } catch { /* swallow */ }
      }, WATCH_DEBOUNCE_MS);
    });
  } catch {
    return () => {};
  }
  return () => {
    if (debounce) clearTimeout(debounce);
    try { watcher.close(); } catch { /* ignore */ }
  };
}

// ─── Supervisor discovery fallback ─────────────────────────
//
// When a project has no `.frame/profile.json` on disk, fall back to the
// matching supervisor YAML (translated on the fly). The translated
// profile is returned with `source: 'supervisor'` and
// `supervisorAvailable: true` so the renderer can offer a one-click
// migration instead of the bare "Generate default" path.

function _loadFromSupervisorFallback(projectPath) {
  try {
    const bridge = require('./supervisorProfileBridge');
    return bridge.translateSupervisorProfileForWorkdir(projectPath);
  } catch {
    return null;
  }
}

/**
 * Inspect the supervisor profiles dir for a YAML that matches this
 * workdir, without translating it. Returns the bridge's mapping row
 * (`{ projectId, name, profileName, workdir }`) when a match exists,
 * else null. Used by the renderer's "supervisor profile found" banner.
 */
function findSupervisorProfileForWorkdir(projectPath) {
  try {
    const bridge = require('./supervisorProfileBridge');
    const row = bridge.findMappingForWorkdir(projectPath);
    if (!row) return null;
    const parsed = bridge.readSupervisorProfile(row.profileName);
    if (!parsed) return null;
    return row;
  } catch {
    return null;
  }
}

module.exports = {
  loadProfile,
  saveProfile,
  defaultProfile,
  validateProfile,
  watchProfile,
  profilePath,
  findSupervisorProfileForWorkdir,
  PROFILE_FILE,
};
