/**
 * Autopilot runner
 *
 * Drives `/spec.implement` repeatedly on a target spec until its tasks are
 * exhausted, retrying once with a diagnostic appendix when a turn lands
 * without reducing the pending count, and pausing after a bounded number of
 * such retries. See `.frame/specs/autopilot-runner/spec.md` for the
 * product-level shape.
 *
 * Module-scope state:
 *   `runs: Map<projectPath, AutopilotRun[]>`
 *   `nextRunId: number`
 *
 * Run shape (also broadcast to the renderer via AUTOPILOT_STATE):
 *   {
 *     id, scope, projectPath, slug,
 *     status: 'starting' | 'running' | 'paused' | 'stopped' | 'completed' | 'failed',
 *     turnsTotal, consecutiveNoProgress, lastTurnReason,
 *     pausedReason, caps, startedAt, updatedAt,
 *     terminalId
 *   }
 *
 * Everything I/O-touching is injected via `deps` so unit tests can drive
 * the loop without a PTY, without an Electron window, and without sleeping.
 */

const fs = require('fs');
const path = require('path');

const { IPC } = require('../shared/ipcChannels');
const config = require('./autopilot.config');
const signals = require('./autopilot.signals');

// ─── Module state ──────────────────────────────────────────

const runs = new Map();       // projectPath → AutopilotRun[]
let nextRunId = 1;
let stateListener = null;     // optional: (snapshot) => void

function _emit() {
  if (typeof stateListener === 'function') {
    try { stateListener(getAutopilotState()); } catch (err) {
      console.error('autopilot: state listener threw', err);
    }
  }
}

function setStateListener(fn) {
  stateListener = (typeof fn === 'function') ? fn : null;
}

function _runsFor(projectPath) {
  if (!runs.has(projectPath)) runs.set(projectPath, []);
  return runs.get(projectPath);
}

function _findRun(projectPath, runId) {
  return _runsFor(projectPath).find((r) => r.id === runId) || null;
}

function _serializeRun(r) {
  return {
    id: r.id,
    scope: r.scope,
    projectPath: r.projectPath,
    slug: r.slug,
    status: r.status,
    turnsTotal: r.turnsTotal,
    consecutiveNoProgress: r.consecutiveNoProgress,
    lastTurnReason: r.lastTurnReason,
    pausedReason: r.pausedReason,
    caps: r.caps,
    startedAt: r.startedAt,
    updatedAt: r.updatedAt,
    terminalId: r.terminalId,
  };
}

function getAutopilotState() {
  const out = { activeRuns: [] };
  for (const [, arr] of runs) {
    for (const r of arr) out.activeRuns.push(_serializeRun(r));
  }
  return out;
}

// ─── Diagnostic appendix ───────────────────────────────────

const DIAGNOSTIC_APPENDIX_PREFIX = '\n\n---\n## Autopilot diagnostic — previous attempt did not land\n';

function _buildDiagnosticAppendix(run) {
  return (
    DIAGNOSTIC_APPENDIX_PREFIX +
    `Your previous attempt did not reduce the pending-task count for this spec.\n` +
    `Pending tasks before that turn: ${run._lastBeforePending}.\n` +
    `Pending tasks after that turn: ${run._lastAfterPending}.\n\n` +
    `Re-read the task you just tried. Identify why it did not land. Do not retry the same approach — propose and execute a different one. ` +
    `If the task is genuinely blocked, surface that explicitly instead of silently moving on.\n`
  );
}

function _appendDiagnosticToPromptFile(absPromptPath, text) {
  if (!absPromptPath) return false;
  try {
    fs.appendFileSync(absPromptPath, text, 'utf8');
    return true;
  } catch (err) {
    console.error('autopilot: failed to append diagnostic', err);
    return false;
  }
}

// Per-spec audit log: one JSONL line per autopilot event so the spec
// section can show a turn-by-turn audit trail without having to scrape
// terminal buffers. Best-effort — failures are logged, never thrown.
function _appendAuditEvent(projectPath, slug, event) {
  if (!projectPath || !slug) return false;
  try {
    const dir = path.join(projectPath, '.frame', 'specs', slug);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'autopilot-events.jsonl');
    fs.appendFileSync(file, JSON.stringify(event) + '\n', 'utf8');
    return true;
  } catch (err) {
    console.error('autopilot: failed to append audit event', err);
    return false;
  }
}

// ─── Default deps ──────────────────────────────────────────
//
// Real deps wire to ptyManager + specManager. Tests inject fakes.

function _defaultDeps() {
  const specManager = require('./specManager');
  const ptyManager = require('./ptyManager');
  const orchestration = require('./orchestrationManager');
  return {
    buildSpecCommandFile: (projectPath, slug, command) =>
      specManager.buildSpecCommandFile(projectPath, slug, command, 'claude-code'),
    // Autopilot uses the "undone" count (pending + in_progress) rather than
    // strict pending. An in_progress task no one is driving — e.g. one
    // promoted by a bulk action — is still work the loop should claim.
    readPendingCount: (projectPath, slug) => specManager.readUndoneCount(projectPath, slug),
    reconcilePhase: (projectPath, slug) => specManager.reconcilePhase(projectPath, slug),
    listSpecs: (projectPath) => specManager.listSpecs(projectPath),
    getSpecFootprint: (projectPath, slug) => specManager.getSpecFootprint(projectPath, slug),
    findFootprintConflictAmong: orchestration.findFootprintConflictAmong,
    appendDiagnostic: _appendDiagnosticToPromptFile,
    appendAuditEvent: _appendAuditEvent,
    tasksJSONMtime: signals.tasksJSONMtime,
    waitForLaneIdle: signals.waitForLaneIdle,
    dispatchToLane: (run, instruction) => {
      if (!run.terminalId) return false;
      try {
        ptyManager.writeToTerminal(run.terminalId, instruction + '\r');
        return true;
      } catch (err) {
        console.error('autopilot: dispatch failed', err);
        return false;
      }
    },
    getLastOutputAt: (terminalId) => {
      try { return ptyManager.getLastOutputAt(terminalId); } catch { return null; }
    },
  };
}

// ─── Core: _executeTurn ────────────────────────────────────

/**
 * Run one turn. Returns:
 *   - 'progress'  — pending count decreased; loop should continue
 *   - 'noprogress' — pending count unchanged; loop should retry next iter
 *   - 'error' — dispatch / staging failed
 *
 * Caller (loop) decides whether 'noprogress' becomes a 'retry' or an
 * 'escalate' based on `run.consecutiveNoProgress` vs caps.max_turns_per_task.
 */
async function _executeTurn(run, deps) {
  const { projectPath, slug } = run;

  const staged = deps.buildSpecCommandFile(projectPath, slug, 'spec.implement');
  if (!staged || !staged.success) {
    run.lastTurnReason = 'staging-failed';
    return 'error';
  }

  const absPromptPath = path.join(projectPath, staged.relPath);
  if (run.consecutiveNoProgress > 0) {
    deps.appendDiagnostic(absPromptPath, _buildDiagnosticAppendix(run));
  }

  const beforePending = deps.readPendingCount(projectPath, slug);
  const baselineMtime = deps.tasksJSONMtime(projectPath);

  const dispatched = deps.dispatchToLane(run, staged.instruction);
  if (!dispatched) {
    run.lastTurnReason = 'dispatch-failed';
    return 'error';
  }

  await deps.waitForLaneIdle({
    getLastOutputAt: () => deps.getLastOutputAt(run.terminalId),
    idleMs: run.caps._idleMs || signals.DEFAULT_IDLE_MS,
    pollMs: run.caps._pollMs || signals.DEFAULT_POLL_MS,
    timeoutMs: run.caps._waitTimeoutMs || signals.DEFAULT_TIMEOUT_MS,
  });

  const afterPending = deps.readPendingCount(projectPath, slug);
  const afterMtime = deps.tasksJSONMtime(projectPath);

  run._lastBeforePending = beforePending;
  run._lastAfterPending = afterPending;
  run._lastBaselineMtime = baselineMtime;
  run._lastAfterMtime = afterMtime;
  run.turnsTotal += 1;
  run.updatedAt = new Date().toISOString();

  try { deps.reconcilePhase(projectPath, slug); } catch (err) {
    console.error('autopilot: reconcilePhase threw', err);
  }

  const outcome = (afterPending < beforePending) ? 'progress' : 'noprogress';
  if (outcome === 'progress') {
    run.consecutiveNoProgress = 0;
    run.lastTurnReason = 'progress';
  } else {
    run.consecutiveNoProgress += 1;
    run.lastTurnReason = 'noprogress';
  }

  if (deps.appendAuditEvent) {
    deps.appendAuditEvent(projectPath, slug, {
      ts: new Date().toISOString(),
      runId: run.id,
      turn: run.turnsTotal,
      outcome,
      beforePending,
      afterPending,
      tasksMtime: afterMtime,
      diagnosticInjected: run.consecutiveNoProgress > 0 && outcome === 'noprogress'
        ? true
        : (outcome === 'progress' && run._lastBeforePending != null && run.turnsTotal > 1 ? null : false),
      retryAttempt: outcome === 'noprogress' ? run.consecutiveNoProgress : 0,
    });
  }

  return outcome;
}

// ─── Core: _runSpecLoop ────────────────────────────────────

async function _runSpecLoop(run, deps) {
  run.status = 'running';
  if (deps.appendAuditEvent) {
    deps.appendAuditEvent(run.projectPath, run.slug, {
      ts: new Date().toISOString(),
      runId: run.id,
      event: 'run-started',
      caps: run.caps,
    });
  }
  _emit();

  while (!run.stopRequested) {
    // TODO(autopilot-runner T09): wire a real per-run USD spend signal here.
    // `claudeUsageManager` currently exposes only Anthropic's session-window
    // utilization percentages (`five_hour` / `seven_day`), not per-message
    // cost, so `caps.budget_usd` cannot be enforced precisely yet.
    // For now we treat `budget_usd != null` as a request to additionally
    // tighten `max_total_turns` to whatever the caller passed, and rely on
    // the turn-count cap below as the hard guardrail.
    if (run.caps.budget_usd != null && !run._budgetWarned) {
      run._budgetWarned = true;
      console.warn(
        `autopilot: budget_usd=${run.caps.budget_usd} requested but no per-run ` +
        `cost signal is available; falling back to max_total_turns=${run.caps.max_total_turns}.`,
      );
    }
    if (run.turnsTotal >= run.caps.max_total_turns) {
      run.status = 'paused';
      run.pausedReason = run.caps.budget_usd != null ? 'budget_proxy_turns' : 'max_total_turns';
      _emit();
      return;
    }

    const pendingNow = deps.readPendingCount(run.projectPath, run.slug);
    if (pendingNow === 0) {
      try { deps.reconcilePhase(run.projectPath, run.slug); } catch (err) {
        console.error('autopilot: final reconcilePhase threw', err);
      }
      run.status = 'completed';
      run.updatedAt = new Date().toISOString();
      if (deps.appendAuditEvent) {
        deps.appendAuditEvent(run.projectPath, run.slug, {
          ts: run.updatedAt, runId: run.id, event: 'run-completed', turns: run.turnsTotal,
        });
      }
      _emit();
      return;
    }

    const outcome = await _executeTurn(run, deps);
    _emit();

    if (outcome === 'error') {
      run.status = 'failed';
      run.pausedReason = run.lastTurnReason || 'unknown-error';
      if (deps.appendAuditEvent) {
        deps.appendAuditEvent(run.projectPath, run.slug, {
          ts: new Date().toISOString(), runId: run.id, event: 'run-failed', reason: run.pausedReason,
        });
      }
      _emit();
      return;
    }

    if (outcome === 'noprogress' && run.consecutiveNoProgress > run.caps.max_turns_per_task) {
      run.status = 'paused';
      run.pausedReason = 'max_turns_per_task';
      if (deps.appendAuditEvent) {
        deps.appendAuditEvent(run.projectPath, run.slug, {
          ts: new Date().toISOString(), runId: run.id, event: 'run-paused', reason: 'max_turns_per_task',
          consecutiveNoProgress: run.consecutiveNoProgress,
        });
      }
      _emit();
      return;
    }
  }

  // Loop exited because stop was requested
  run.status = 'stopped';
  run.updatedAt = new Date().toISOString();
  if (deps.appendAuditEvent) {
    deps.appendAuditEvent(run.projectPath, run.slug, {
      ts: run.updatedAt, runId: run.id, event: 'run-stopped',
    });
  }
  _emit();
}

// ─── Core: _runProjectLoop (cross-spec scheduler) ──────────

const PROJECT_LOOP_POLL_MS = 1500;

function _projectLoopSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// In-memory snapshot of the project's currently-running spec sub-runs.
function _activeSpecRunsFor(projectPath) {
  const arr = runs.get(projectPath) || [];
  return arr.filter((r) => r.scope === 'spec' && ['starting', 'running'].includes(r.status));
}

async function _runProjectLoop(run, deps) {
  const pollMs = (run.caps && run.caps._projectPollMs) || PROJECT_LOOP_POLL_MS;
  run.status = 'running';
  if (deps.appendAuditEvent) {
    deps.appendAuditEvent(run.projectPath, '_project', {
      ts: new Date().toISOString(),
      runId: run.id,
      event: 'project-run-started',
      caps: run.caps,
      assignments: run.terminalAssignments ? Object.keys(run.terminalAssignments) : [],
    });
  }
  _emit();

  while (!run.stopRequested) {
    const specs = (() => {
      try { return deps.listSpecs(run.projectPath) || []; } catch { return []; }
    })();

    const candidates = specs
      .filter((s) => ['tasks_generated', 'implementing'].includes(s.phase))
      .filter((s) => deps.readPendingCount(run.projectPath, s.slug) > 0)
      .filter((s) => !!(run.terminalAssignments && run.terminalAssignments[s.slug]));

    // Already-active sub-runs as conflict candidates for the footprint
    // guard. We compare new spec footprints against in-flight ones.
    const inFlight = _activeSpecRunsFor(run.projectPath);
    const inFlightFootprints = inFlight.map((sr) => ({
      slug: sr.slug,
      footprint: (() => { try { return deps.getSpecFootprint(run.projectPath, sr.slug) || []; } catch { return []; } })(),
    }));
    const inFlightSlugs = new Set(inFlight.map((sr) => sr.slug));

    const eligible = candidates
      .filter((s) => !inFlightSlugs.has(s.slug))
      .filter((s) => {
        const fp = (() => { try { return deps.getSpecFootprint(run.projectPath, s.slug) || []; } catch { return []; } })();
        const conflict = deps.findFootprintConflictAmong(s.slug, fp, inFlightFootprints);
        return !conflict;
      });

    const capacity = run.caps.max_parallel_specs - inFlight.length;

    if (eligible.length === 0 && inFlight.length === 0) {
      // Nothing eligible AND nothing running → project is either done or
      // every remaining spec is blocked (no lane assignment / footprint
      // collision with itself only). Exit cleanly.
      run.status = 'completed';
      run.updatedAt = new Date().toISOString();
      if (deps.appendAuditEvent) {
        deps.appendAuditEvent(run.projectPath, '_project', {
          ts: run.updatedAt, runId: run.id, event: 'project-run-completed',
          remainingSpecs: candidates.length,
        });
      }
      _emit();
      return;
    }

    if (capacity > 0 && eligible.length > 0) {
      const next = eligible[0];
      const termId = run.terminalAssignments[next.slug];
      const sub = startAutopilot({
        projectPath: run.projectPath,
        scope: 'spec',
        slug: next.slug,
        terminalId: termId,
        caps: { ...run.caps },
        deps,
      });
      if (Array.isArray(run.childRunIds)) run.childRunIds.push(sub.runId);
      if (deps.appendAuditEvent) {
        deps.appendAuditEvent(run.projectPath, '_project', {
          ts: new Date().toISOString(),
          runId: run.id,
          event: 'project-spawned-sub',
          slug: next.slug,
          subRunId: sub.runId,
          terminalId: termId,
        });
      }
      _emit();
      // Loop again immediately to see if there's more capacity / more
      // eligible specs.
      continue;
    }

    // Either capacity is full, or eligible list is empty but sub-runs are
    // still in flight. Wait briefly and re-evaluate.
    await _projectLoopSleep(pollMs);
  }

  // Stop requested: cascade stops to all child sub-runs and exit.
  if (Array.isArray(run.childRunIds)) {
    for (const childId of run.childRunIds) {
      stopAutopilot({ projectPath: run.projectPath, runId: childId });
    }
  }
  run.status = 'stopped';
  run.updatedAt = new Date().toISOString();
  if (deps.appendAuditEvent) {
    deps.appendAuditEvent(run.projectPath, '_project', {
      ts: run.updatedAt, runId: run.id, event: 'project-run-stopped',
    });
  }
  _emit();
}

// ─── Public API ────────────────────────────────────────────

function startAutopilot({ projectPath, scope = 'spec', slug, caps: capsOverride, terminalId, terminalAssignments, globalCaps, deps } = {}) {
  if (!projectPath) throw new Error('startAutopilot: projectPath is required');
  if (scope === 'spec' && !slug) throw new Error('startAutopilot: slug is required for scope=spec');

  const effectiveDeps = deps || _defaultDeps();

  const baseCaps = (scope === 'spec')
    ? config.readCaps({ projectPath, slug, globalCaps })
    : { ...config.DEFAULTS, ...(globalCaps || {}) };
  const caps = { ...baseCaps, ...(capsOverride || {}) };
  if (scope === 'project' && caps.max_parallel_specs == null) {
    caps.max_parallel_specs = 2;
  }

  const run = {
    id: `run-${nextRunId++}`,
    scope,
    projectPath,
    slug: slug || null,
    status: 'starting',
    turnsTotal: 0,
    consecutiveNoProgress: 0,
    lastTurnReason: null,
    pausedReason: null,
    caps,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    terminalId: terminalId || null,
    // Project-scope only: slug → terminalId map provided by renderer so
    // sub-runs know which lane to drive without main owning lane state.
    terminalAssignments: (scope === 'project' && terminalAssignments && typeof terminalAssignments === 'object')
      ? { ...terminalAssignments }
      : null,
    stopRequested: false,
    // Project-scope only: ids of sub-runs the project loop spawned. Used
    // by stopAutopilot to cascade stops down to children.
    childRunIds: scope === 'project' ? [] : null,
  };

  _runsFor(projectPath).push(run);
  _emit();

  if (scope === 'spec') {
    run._loopPromise = _runSpecLoop(run, effectiveDeps).catch((err) => {
      console.error('autopilot: spec loop crashed', err);
      run.status = 'failed';
      run.pausedReason = 'loop-crashed';
      _emit();
    });
  } else if (scope === 'project') {
    run._loopPromise = _runProjectLoop(run, effectiveDeps).catch((err) => {
      console.error('autopilot: project loop crashed', err);
      run.status = 'failed';
      run.pausedReason = 'loop-crashed';
      _emit();
    });
  }

  return { runId: run.id, run: _serializeRun(run), loopPromise: run._loopPromise };
}

function stopAutopilot({ projectPath, runId } = {}) {
  const run = _findRun(projectPath, runId);
  if (!run) return false;
  run.stopRequested = true;
  if (run.status === 'starting') {
    run.status = 'stopped';
  }
  // Stop is Stop — clear the pre-arm intent so Frame doesn't silently
  // re-arm on the next phase reconcile. User can re-tick the checkbox
  // to opt back in.
  if (run.scope === 'spec' && run.slug) {
    try { config.writeAutoOnTasks(run.projectPath, run.slug, false); }
    catch (err) { console.error('autopilot: failed to clear auto_on_tasks on stop', err); }
  }
  _emit();
  return true;
}

// ─── Pre-arm trigger ──────────────────────────────────────
//
// Called by specManager.reconcilePhase when a spec advances to
// `tasks_generated`. We push an IPC event to the renderer; the renderer
// resolves lane attachment and calls startAutopilot itself (main does
// not own lane state). Also writes an audit log entry so the Audit tab
// surfaces *why* a run started without a click.
function emitArmRequest(projectPath, slug) {
  if (!projectPath || !slug) return false;
  if (!config.readAutoOnTasks(projectPath, slug)) return false;
  _appendAuditEvent(projectPath, slug, {
    ts: new Date().toISOString(),
    event: 'armed',
    reason: 'phase=tasks_generated; auto_on_tasks=true',
  });
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.webContents.send(IPC.AUTOPILOT_ARM_REQUEST, { projectPath, slug }); }
    catch (err) { console.error('autopilot: failed to push ARM request', err); }
  }
  return true;
}

function clearAutopilotState() {
  runs.clear();
  nextRunId = 1;
}

function readAuditEvents(projectPath, slug, { limit = 200 } = {}) {
  if (!projectPath || !slug) return [];
  try {
    const file = path.join(projectPath, '.frame', 'specs', slug, 'autopilot-events.jsonl');
    if (!fs.existsSync(file)) return [];
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
    const sliced = lines.slice(-limit);
    return sliced.map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } catch (err) {
    console.error('autopilot: readAuditEvents failed', err);
    return [];
  }
}

// ─── Electron integration ──────────────────────────────────

let mainWindow = null;

function init(window) {
  mainWindow = window || null;
  setStateListener((snapshot) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.AUTOPILOT_STATE, snapshot);
    }
  });
}

function setupIPC(ipcMain) {
  ipcMain.handle(IPC.AUTOPILOT_START, (event, args = {}) => {
    try {
      const { runId, run } = startAutopilot(args);
      return { success: true, runId, run };
    } catch (err) {
      return { success: false, error: err.message || String(err) };
    }
  });
  ipcMain.handle(IPC.AUTOPILOT_STOP, (event, args = {}) => {
    return { success: stopAutopilot(args) };
  });
  ipcMain.handle(IPC.AUTOPILOT_GET, () => getAutopilotState());
  ipcMain.handle(IPC.AUTOPILOT_AUDIT, (event, args = {}) => {
    const { projectPath, slug, limit } = args;
    return readAuditEvents(projectPath, slug, { limit });
  });
  ipcMain.handle(IPC.SET_AUTO_ON_TASKS, (event, args = {}) => {
    const { projectPath, slug, value } = args;
    const ok = config.writeAutoOnTasks(projectPath, slug, value === true);
    return { success: ok };
  });
  ipcMain.handle(IPC.GET_AUTO_ON_TASKS, (event, args = {}) => {
    const { projectPath, slug } = args;
    return config.readAutoOnTasks(projectPath, slug);
  });
}

module.exports = {
  init,
  setupIPC,
  startAutopilot,
  stopAutopilot,
  emitArmRequest,
  getAutopilotState,
  setStateListener,
  clearAutopilotState,
  readAuditEvents,
  // exported for tests
  _internal: {
    _executeTurn,
    _runSpecLoop,
    _runProjectLoop,
    _buildDiagnosticAppendix,
    _appendDiagnosticToPromptFile,
    _appendAuditEvent,
    _defaultDeps,
  },
};
