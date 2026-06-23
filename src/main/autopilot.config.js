/**
 * Autopilot config
 *
 * Three-tier caps loader for the autopilot runner. Resolution order:
 *   spec  (`.frame/specs/<slug>/autopilot.json`)
 *     > project  (`.frame/autopilot.json`)
 *     > global   (injected by caller; comes from userSettings 'autopilot.defaults')
 *     > DEFAULTS (this file)
 *
 * Kept Electron-free so it is unit-testable. The main process passes
 * `globalCaps` explicitly when calling `readCaps`.
 */

const fs = require('fs');
const path = require('path');

const DEFAULTS = Object.freeze({
  max_turns_per_task: 3,
  max_total_turns: 50,
  budget_usd: null,
  pause_on_phase_transition: [],
  stop_on_explicit_error: true,
});

function readJSONSafe(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
    return {};
  } catch (err) {
    return {};
  }
}

function readCaps({ projectPath, slug, globalCaps } = {}) {
  if (!projectPath) throw new Error('readCaps: projectPath is required');
  if (!slug) throw new Error('readCaps: slug is required');

  const specCaps = readJSONSafe(
    path.join(projectPath, '.frame', 'specs', slug, 'autopilot.json'),
  );
  const projCaps = readJSONSafe(
    path.join(projectPath, '.frame', 'autopilot.json'),
  );
  const global = (globalCaps && typeof globalCaps === 'object' && !Array.isArray(globalCaps))
    ? globalCaps
    : {};

  return { ...DEFAULTS, ...global, ...projCaps, ...specCaps };
}

// ─── auto_on_tasks: the pre-arm flag ───────────────────────
//
// Persists at the spec tier only. Default false (absent = false). Caps
// resolution above already merges spec-tier JSON last, so this field
// flows through `readCaps` automatically — these helpers are the thin
// getter/setter used by the IPC handler + arm trigger that don't care
// about the rest of the caps blob.

function _specAutopilotPath(projectPath, slug) {
  return path.join(projectPath, '.frame', 'specs', slug, 'autopilot.json');
}

function readAutoOnTasks(projectPath, slug) {
  if (!projectPath || !slug) return false;
  const parsed = readJSONSafe(_specAutopilotPath(projectPath, slug));
  return parsed.auto_on_tasks === true;
}

function writeAutoOnTasks(projectPath, slug, value) {
  if (!projectPath || !slug) return false;
  const filePath = _specAutopilotPath(projectPath, slug);
  // Preserve any other caps already written to this file.
  const existing = readJSONSafe(filePath);
  const next = { ...existing };
  if (value === true) next.auto_on_tasks = true;
  else delete next.auto_on_tasks;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    // If the file would otherwise be empty, omit it rather than dropping
    // a `{}` placeholder — keeps the spec dir clean for opt-out users.
    if (Object.keys(next).length === 0) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } else {
      fs.writeFileSync(filePath, JSON.stringify(next, null, 2) + '\n', 'utf-8');
    }
    return true;
  } catch (err) {
    return false;
  }
}

module.exports = { DEFAULTS, readJSONSafe, readCaps, readAutoOnTasks, writeAutoOnTasks };
