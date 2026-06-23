/**
 * Autopilot signals
 *
 * Two primitives the autopilot loop combines to decide "the turn is done":
 *
 *  1) `tasksJSONMtime(projectPath)` — current mtime of the project's
 *     `tasks.json`. Compared against a baseline captured before dispatch.
 *  2) `waitForLaneIdle({ getLastOutputAt, ... })` — resolves when the lane
 *     terminal has been quiet for `idleMs` (the same idle threshold the
 *     orchestrator uses), or with `idle: false` on timeout.
 *
 * Keeping the two separate makes each piece unit-testable in isolation —
 * the loop's progress/no-progress decision is the conjunction.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_IDLE_MS = 20000;          // matches orchestrationManager.IDLE_MS
const DEFAULT_POLL_MS = 1000;
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;  // absolute ceiling per wait

function tasksJSONMtime(projectPath) {
  try {
    const p = path.join(projectPath, 'tasks.json');
    if (!fs.existsSync(p)) return null;
    return fs.statSync(p).mtimeMs;
  } catch (err) {
    return null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait until `getLastOutputAt()` reports the lane has been quiet for
 * `idleMs` (relative to `now()`). Returns `{ idle: true, idleForMs }` on
 * success or `{ idle: false, idleForMs: null }` if `timeoutMs` elapses
 * first.
 *
 * `getLastOutputAt` returning `null` is treated as "no output yet" — the
 * loop is willing to wait `idleMs` from `start()` before flipping to idle,
 * so a lane that never produced output still completes (this is the same
 * grace the orchestrator gives quiet processes).
 */
async function waitForLaneIdle({
  getLastOutputAt,
  now = Date.now,
  idleMs = DEFAULT_IDLE_MS,
  pollMs = DEFAULT_POLL_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  sleepFn = sleep,
} = {}) {
  if (typeof getLastOutputAt !== 'function') {
    throw new Error('waitForLaneIdle: getLastOutputAt is required');
  }
  const start = now();
  while ((now() - start) < timeoutMs) {
    const last = getLastOutputAt();
    const reference = (last == null) ? start : last;
    const idleForMs = now() - reference;
    if (idleForMs >= idleMs) {
      return { idle: true, idleForMs };
    }
    await sleepFn(pollMs);
  }
  return { idle: false, idleForMs: null };
}

module.exports = {
  tasksJSONMtime,
  waitForLaneIdle,
  DEFAULT_IDLE_MS,
  DEFAULT_POLL_MS,
  DEFAULT_TIMEOUT_MS,
};
