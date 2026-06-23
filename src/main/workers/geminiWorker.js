/**
 * GeminiWorker — WorkerInterface adapter for the Google Gemini CLI.
 *
 * Mirrors `codexWorker.js`: permissive decision detection (any quiet tail
 * shaped like a prompt counts), no posture flag overrides today (the CLI
 * doesn't expose a daily-driver "skip permissions" knob). Spawn flows
 * through the injected `exec` adapter so the Frame PTY pipeline stays
 * authoritative.
 *
 * Supervisor reference: not yet ported; the supervisor's gemini worker
 * is out of scope for the parity push. The heuristic was authored by
 * inspecting Gemini CLI's TUI output.
 */

const { WorkerInterface } = require('./types');
const { EventQueue } = require('./_eventQueue');
const { WorkerEventKind, Posture } = require('../../shared/workerTypes');

const POSTURE_FLAGS = Object.freeze({
  [Posture.CAUTIOUS]: '',
  [Posture.DEFAULT]: '',
  [Posture.DANGEROUSLY_SKIP]: '',
});

// Gemini CLI TUI fingerprints.
const FINGERPRINTS = Object.freeze([
  /^gemini>\s*$/m,        // bare prompt
  /\bgemini\b/i,          // banner / status
  /press enter/i,
]);

// Permissive approval set.
const APPROVAL_PATTERNS = Object.freeze([
  /\?\s*$/m,
  /\(y\/n\)/i,
  /\(yes\/no\)/i,
  /accept\?/i,
  /allow\?/i,
]);

class GeminiWorker extends WorkerInterface {
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
    if (!exec) throw new Error('GeminiWorker.start: exec adapter required');
    const terminalId = ctx.terminalId;
    if (!terminalId) throw new Error('GeminiWorker.start: ctx.terminalId required');

    const projectPath = ctx.projectPath || ctx.workdir || null;
    const check = await exec.checkAvailable({ toolId: 'gemini', projectPath });
    if (!check || !check.available) {
      throw new Error(`gemini CLI not available${check && check.name ? ` (${check.name})` : ''}`);
    }

    const override = GeminiWorker.mapPostureToFlag(posture);
    let resolvedCommand = check.resolvedCommand;
    if (override && resolvedCommand && !resolvedCommand.includes(override)) {
      resolvedCommand = `${resolvedCommand} ${override}`;
    }

    // Subscribe-before-send so we don't lose the ready event to a fast CLI.
    const readyPromise = exec.waitForReady(terminalId);
    exec.sendCommand(resolvedCommand, terminalId);

    const ready = await readyPromise;
    if (!ready) {
      throw new Error(`${check.name || 'gemini'} didn't become ready — prompt not sent`);
    }

    const session = {
      sessionId: ctx.sessionId || null,
      terminalId,
      tool: 'gemini',
      model: ctx.model || null,
      workdir: projectPath || process.cwd(),
      _task: task,
      _posture: posture,
    };

    const queue = new EventQueue();
    const unsubscribe = exec.subscribeToStatus && exec.subscribeToStatus(terminalId, (id, status) => {
      if (id !== terminalId) return;
      const ev = GeminiWorker.mapStatusToEvent(status);
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

GeminiWorker.toolId = 'gemini';
GeminiWorker.FINGERPRINTS = FINGERPRINTS;
GeminiWorker.APPROVAL_PATTERNS = APPROVAL_PATTERNS;
GeminiWorker.POSTURE_FLAGS = POSTURE_FLAGS;

module.exports = { GeminiWorker };
