/**
 * FakeWorker — deterministic event sequence for tests.
 *
 * Emits `progress → tool_use × N → done` and resolves `answer`/`revise`/`stop`
 * synchronously. Used by every supervisor-loop test that needs to exercise
 * the WorkerInterface contract without spawning a real CLI.
 */

const { WorkerInterface } = require('./types');
const { EventQueue } = require('./_eventQueue');

class FakeWorker extends WorkerInterface {
  constructor({ toolUseCount = 2 } = {}) {
    super();
    this._toolUseCount = toolUseCount;
    this._queues = new Map();
    this._counter = 0;
  }

  async start({ task = {}, ctx = {}, posture = 'default' } = {}) {
    const terminalId = `fake-${++this._counter}`;
    const session = {
      sessionId: `sess-${this._counter}`,
      terminalId,
      tool: 'fake',
      model: 'fake-model',
      workdir: (ctx && ctx.workdir) || '/tmp',
      _task: task,
      _posture: posture,
    };
    const queue = new EventQueue();
    this._queues.set(terminalId, queue);
    // Emit the canned sequence in microtasks so the iterator's first
    // await actually awaits something.
    Promise.resolve().then(() => {
      queue.push({ kind: 'progress', ts: new Date().toISOString(), payload: { message: 'started' } });
      for (let i = 0; i < this._toolUseCount; i++) {
        queue.push({ kind: 'tool_use', ts: new Date().toISOString(), payload: { tool: 'echo', i } });
      }
      queue.push({ kind: 'done', ts: new Date().toISOString(), payload: { status: 'done', summary: 'fake done' } });
      queue.close();
    });
    return session;
  }

  async *events(session) {
    const queue = this._queues.get(session.terminalId);
    if (!queue) return;
    for await (const ev of queue) {
      yield ev;
    }
  }

  async answer(_session, _decisionId, _reply) { /* fake: no-op */ }

  async revise(session, _instructions) {
    return {
      status: 'done',
      summary: 'fake revise complete',
      costUsd: null,
      sessionId: session.sessionId,
    };
  }

  async stop(session) {
    const queue = this._queues.get(session.terminalId);
    if (queue) queue.close();
    this._queues.delete(session.terminalId);
  }
}

FakeWorker.name = 'fake';

module.exports = { FakeWorker };
