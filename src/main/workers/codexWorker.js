/**
 * CodexWorker — WorkerInterface adapter for the OpenAI Codex CLI.
 *
 * Same shape as `claudeCodeWorker.js`: routes through an injected `exec`
 * adapter so the existing Frame spawn pipeline keeps driving the PTY. The
 * v1 decision-detection heuristic is intentionally permissive — Codex
 * doesn't ship a single canonical approval dialog, so we flag any quiet
 * tail that ends in a question mark or carries one of the prompt-shaped
 * patterns below. The supervisor's classifier can re-judge once it picks
 * the event up; under-detection here is worse than over-detection.
 *
 * Supervisor reference: not yet ported; the supervisor's own codex worker
 * lives outside the parity scope and Frame's heuristic was chosen by
 * inspection of the CLI's TUI output.
 */

const { WorkerInterface } = require('./types');
const { EventQueue } = require('./_eventQueue');
const { WorkerEventKind, Posture } = require('../../shared/workerTypes');

// Codex CLI doesn't expose a `--dangerously-skip-permissions` analogue. The
// posture flag table is intentionally empty for now; the user's saved
// presets (none, today) still apply via aiToolManager.composeFlagSuffix.
const POSTURE_FLAGS = Object.freeze({
  [Posture.CAUTIOUS]: '',
  [Posture.DEFAULT]: '',
  [Posture.DANGEROUSLY_SKIP]: '',
});

// Codex TUI fingerprints. The shipped wrapper is `./.frame/bin/codex` which
// exec's the real binary; fingerprints below are observed in the
// underlying CLI's TUI.
const FINGERPRINTS = Object.freeze([
  /^codex>\s*$/m,         // bare codex prompt
  /\bcodex\b/i,           // banner / status line
  /esc to cancel/i,       // shared with claude — same readline lib
]);

// Permissive approval set — anything resembling a question. Errs on
// over-detection by design.
const APPROVAL_PATTERNS = Object.freeze([
  /\?\s*$/m,              // ends in a question mark
  /\(y\/n\)/i,
  /\(yes\/no\)/i,
  /confirm/i,
  /proceed\?/i,
]);

class CodexWorker extends WorkerInterface {
  static parseEventFromTail(tail) {
    if (!tail || typeof tail !== 'string') return null;
    if (APPROVAL_PATTERNS.some((re) => re.test(tail))) return WorkerEventKind.DECISION;
    if (FINGERPRINTS.some((re) => re.test(tail))) return WorkerEventKind.PROGRESS;
    return null;
  }

  static mapPostureToFlag(posture) {
    return POSTURE_FLAGS[posture] || '';
  }

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
    this._sessions = new Map();
  }

  async start({ task = {}, ctx = {}, posture = Posture.DEFAULT, exec } = {}) {
    if (!exec) throw new Error('CodexWorker.start: exec adapter required');
    const terminalId = ctx.terminalId;
    if (!terminalId) throw new Error('CodexWorker.start: ctx.terminalId required');

    const projectPath = ctx.projectPath || ctx.workdir || null;
    const check = await exec.checkAvailable({ toolId: 'codex', projectPath });
    if (!check || !check.available) {
      throw new Error(`codex CLI not available${check && check.name ? ` (${check.name})` : ''}`);
    }

    const override = CodexWorker.mapPostureToFlag(posture);
    let resolvedCommand = check.resolvedCommand;
    if (override && resolvedCommand && !resolvedCommand.includes(override)) {
      resolvedCommand = `${resolvedCommand} ${override}`;
    }

    // Subscribe-before-send so we don't lose the ready event to a fast CLI.
    const readyPromise = exec.waitForReady(terminalId);
    exec.sendCommand(resolvedCommand, terminalId);

    const ready = await readyPromise;
    if (!ready) {
      throw new Error(`${check.name || 'codex'} didn't become ready — prompt not sent`);
    }

    const session = {
      sessionId: ctx.sessionId || null,
      terminalId,
      tool: 'codex',
      model: ctx.model || null,
      workdir: projectPath || process.cwd(),
      _task: task,
      _posture: posture,
    };

    const queue = new EventQueue();
    const unsubscribe = exec.subscribeToStatus && exec.subscribeToStatus(terminalId, (id, status) => {
      if (id !== terminalId) return;
      const ev = CodexWorker.mapStatusToEvent(status);
      if (ev) queue.push(ev);
    });
    this._sessions.set(terminalId, { queue, unsubscribe, exec, session });
    queue.push({ kind: WorkerEventKind.PROGRESS, ts: new Date().toISOString(), payload: { status: 'started' } });
    return session;
  }

  async *events(session) {
    if (!session || !session.terminalId) return;
    const entry = this._sessions.get(session.terminalId);
    if (!entry) return;
    for await (const ev of entry.queue) yield ev;
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
    entry.exec.sendCommand(instructions, session.terminalId);
    return { status: 'done', summary: 'revise dispatched', costUsd: null, sessionId: session.sessionId };
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

CodexWorker.toolId = 'codex';
CodexWorker.FINGERPRINTS = FINGERPRINTS;
CodexWorker.APPROVAL_PATTERNS = APPROVAL_PATTERNS;
CodexWorker.POSTURE_FLAGS = POSTURE_FLAGS;

module.exports = { CodexWorker };
