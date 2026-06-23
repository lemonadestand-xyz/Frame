/**
 * ClaudeCodeWorker — WorkerInterface adapter for the `claude` CLI.
 *
 * Wraps the existing Frame claude-code spawn + event-parsing path that lives
 * across `aiToolManager` (resolves the CLI invocation), the renderer's
 * `multiTerminalUI` (owns the PTY), and `laneStatus` (classifies the buffer
 * tail). The worker doesn't re-implement any of that — it routes through an
 * injected `exec` adapter so the same IPC contract drives the spawn, then
 * publishes lane-status transitions as `WorkerEvent`s via `EventQueue`.
 *
 * The exec adapter shape (see `src/renderer/agentDispatch.js`):
 *   {
 *     checkAvailable({ toolId, projectPath }) -> { available, resolvedCommand, name },
 *     sendCommand(command, terminalId)                       -> void,
 *     waitForReady(terminalId)                               -> Promise<bool>,
 *     subscribeToStatus(terminalId, cb)                      -> unsubscribeFn,
 *     answer(terminalId, reply)                              -> void,   // optional
 *     stop(terminalId)                                       -> void,   // optional
 *   }
 *
 * Decision-detection heuristic is the same Claude-specific approval pattern
 * set that laneStatus uses today (see APPROVAL_PATTERNS).
 *
 * Supervisor reference: `supervisor/worker/claude_code.py:115-276`.
 */

const { WorkerInterface } = require('./types');
const { EventQueue } = require('./_eventQueue');
const { WorkerEventKind, Posture } = require('../../shared/workerTypes');

// Posture → CLI flag. Cautious / default ship the bare binary (the user's
// configured presets layer on top via aiToolManager.composeFlagSuffix);
// DANGEROUSLY_SKIP forces `--dangerously-skip-permissions` regardless of
// the user's preset toggle so the supervisor can override a cautious user.
const POSTURE_FLAGS = Object.freeze({
  [Posture.CAUTIOUS]: '',
  [Posture.DEFAULT]: '',
  [Posture.DANGEROUSLY_SKIP]: '--dangerously-skip-permissions',
});

// Claude Code TUI fingerprints — a quiet lane carrying any of these is an
// agent at its input box rather than a bare shell.
const FINGERPRINTS = Object.freeze([
  /╭─/,                 // input box / dialog frame
  /│\s*>/,              // prompt line inside the box
  /esc to interrupt/i,  // while working
  /✻/,                  // spinner/notice glyph
  /⏺/,                  // tool-call bullet
]);

// Claude Code permission-prompt fingerprints — quiet agent + one of these
// = `agent-approval` (a DECISION event for the supervisor to resolve).
const APPROVAL_PATTERNS = Object.freeze([
  /Do you want/i,
  /\(y\/n\)/i,
  /❯\s*\d+\./,
  /Esc to cancel/i,
]);

class ClaudeCodeWorker extends WorkerInterface {
  /**
   * Classify a buffer-tail string. Used by the worker's events() stream
   * AND directly exercised by unit tests so the heuristic stays auditable.
   * Returns one of WorkerEventKind values or null when nothing matches.
   */
  static parseEventFromTail(tail) {
    if (!tail || typeof tail !== 'string') return null;
    if (APPROVAL_PATTERNS.some((re) => re.test(tail))) return WorkerEventKind.DECISION;
    if (FINGERPRINTS.some((re) => re.test(tail))) return WorkerEventKind.PROGRESS;
    return null;
  }

  /**
   * Map a Posture value onto the CLI flag the spawn should pass. Returns
   * the empty string for postures with no override (the user's saved
   * presets via aiToolManager still apply on top of this).
   */
  static mapPostureToFlag(posture) {
    return POSTURE_FLAGS[posture] || '';
  }

  /**
   * Translate a lane-status payload (the shape laneStatus.onChange emits)
   * into a WorkerEvent. Returns null when the status carries no
   * worker-actionable change.
   */
  static mapStatusToEvent(status) {
    if (!status || !status.agentName) return null;
    switch (status.status) {
      case 'agent-working':
        return { kind: WorkerEventKind.PROGRESS, ts: new Date().toISOString(), payload: { status: 'working' } };
      case 'agent-approval':
        return { kind: WorkerEventKind.DECISION, ts: new Date().toISOString(), payload: { status: 'awaiting_approval' } };
      case 'agent-input':
        return { kind: WorkerEventKind.DONE, ts: new Date().toISOString(), payload: { status: 'idle_at_input' } };
      default:
        return null;
    }
  }

  constructor() {
    super();
    this._sessions = new Map(); // terminalId → { queue, unsubscribe, exec, session }
  }

  /**
   * @param {{task, ctx, posture, exec}} arg
   *   - task.prompt        injected by the renderer after start() resolves
   *   - ctx.terminalId     existing lane to spawn into
   *   - ctx.workdir        project path (passed to checkAvailable)
   *   - ctx.projectPath    same as workdir (kept for symmetry with ctx use)
   *   - posture            Posture value; selects the override flag
   *   - exec               injected adapter; see file header
   */
  async start({ task = {}, ctx = {}, posture = Posture.DEFAULT, exec } = {}) {
    if (!exec) throw new Error('ClaudeCodeWorker.start: exec adapter required');
    const terminalId = ctx.terminalId;
    if (!terminalId) throw new Error('ClaudeCodeWorker.start: ctx.terminalId required');

    const projectPath = ctx.projectPath || ctx.workdir || null;
    const check = await exec.checkAvailable({ toolId: 'claude', projectPath });
    if (!check || !check.available) {
      throw new Error(`claude CLI not available${check && check.name ? ` (${check.name})` : ''}`);
    }

    // Layer the posture override onto whatever flags the user configured.
    // composeFlagSuffix already lives behind CHECK_AI_TOOL_AVAILABLE, so the
    // resolvedCommand carries the user's flags; we splice the posture flag
    // when the supervisor demands one and it isn't already there.
    const override = ClaudeCodeWorker.mapPostureToFlag(posture);
    let resolvedCommand = check.resolvedCommand;
    if (override && resolvedCommand && !resolvedCommand.includes(override)) {
      resolvedCommand = `${resolvedCommand} ${override}`;
    }

    // Subscribe before sending: a fast CLI could reach its input box between
    // "send" and "listen" and we'd miss the agent-ready event. This mirrors
    // the pre-refactor _waitForAgentReady call ordering.
    const readyPromise = exec.waitForReady(terminalId);
    exec.sendCommand(resolvedCommand, terminalId);

    const ready = await readyPromise;
    if (!ready) {
      throw new Error(`${check.name || 'claude'} didn't become ready — prompt not sent`);
    }

    const session = {
      sessionId: ctx.sessionId || null,
      terminalId,
      tool: 'claude',
      model: ctx.model || null,
      workdir: projectPath || process.cwd(),
      _task: task,
      _posture: posture,
    };

    const queue = new EventQueue();
    const unsubscribe = exec.subscribeToStatus && exec.subscribeToStatus(terminalId, (id, status) => {
      if (id !== terminalId) return;
      const ev = ClaudeCodeWorker.mapStatusToEvent(status);
      if (ev) queue.push(ev);
    });
    this._sessions.set(terminalId, { queue, unsubscribe, exec, session });

    // Seed a `progress` event so consumers iterating events() see something
    // immediately after start() resolves — mirrors what supervisor does.
    queue.push({ kind: WorkerEventKind.PROGRESS, ts: new Date().toISOString(), payload: { status: 'started' } });

    return session;
  }

  async *events(session) {
    if (!session || !session.terminalId) return;
    const entry = this._sessions.get(session.terminalId);
    if (!entry) return;
    for await (const ev of entry.queue) {
      yield ev;
    }
  }

  async answer(session, _decisionId, reply) {
    const entry = this._sessions.get(session && session.terminalId);
    if (!entry || !entry.exec || typeof entry.exec.answer !== 'function') return;
    entry.exec.answer(session.terminalId, reply);
  }

  async revise(session, instructions) {
    const entry = this._sessions.get(session && session.terminalId);
    if (!entry || !entry.exec || typeof entry.exec.sendCommand !== 'function') {
      return { status: 'failed', summary: 'no exec adapter', costUsd: null, sessionId: session && session.sessionId };
    }
    // Revise rides the same PTY: just send the instructions as the next
    // prompt. The lane's existing agent picks them up; we return an
    // optimistic TaskResult so callers don't block on a CLI we can't
    // observe round-trip from here.
    entry.exec.sendCommand(instructions, session.terminalId);
    return {
      status: 'done',
      summary: 'revise dispatched',
      costUsd: null,
      sessionId: session.sessionId,
    };
  }

  async stop(session) {
    const entry = this._sessions.get(session && session.terminalId);
    if (!entry) return;
    if (typeof entry.unsubscribe === 'function') {
      try { entry.unsubscribe(); } catch { /* ignore */ }
    }
    try { entry.queue.close(); } catch { /* ignore */ }
    if (entry.exec && typeof entry.exec.stop === 'function') {
      try { entry.exec.stop(session.terminalId); } catch { /* ignore */ }
    }
    this._sessions.delete(session.terminalId);
  }
}

ClaudeCodeWorker.toolId = 'claude';
ClaudeCodeWorker.FINGERPRINTS = FINGERPRINTS;
ClaudeCodeWorker.APPROVAL_PATTERNS = APPROVAL_PATTERNS;
ClaudeCodeWorker.POSTURE_FLAGS = POSTURE_FLAGS;

module.exports = { ClaudeCodeWorker };
