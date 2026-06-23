/**
 * Abstract Worker base class.
 *
 * Concrete implementations (ClaudeCodeWorker, CodexWorker, GeminiWorker,
 * FakeWorker) register with `src/main/workers/registry.js`. The supervisor
 * loop dispatches through the registry, not the concrete classes.
 *
 * Contract mirrors `supervisor/types.py:230-239`'s WorkerInterface.
 */

class WorkerInterface {
  /**
   * Spawn the underlying tool and return a SessionHandle.
   * @param {{task, ctx, posture}} _arg
   * @returns {Promise<import('../../shared/workerTypes').SessionHandle>}
   */
  // eslint-disable-next-line no-unused-vars
  async start(_arg) { throw new Error(`${this.constructor.name}.start: abstract`); }

  /**
   * AsyncIterator of WorkerEvent over the session's lifetime.
   * @param {import('../../shared/workerTypes').SessionHandle} _session
   * @returns {AsyncIterator<import('../../shared/workerTypes').WorkerEvent>}
   */
  // eslint-disable-next-line no-unused-vars, require-yield
  async *events(_session) { throw new Error(`${this.constructor.name}.events: abstract`); }

  /**
   * Resolve a pending DECISION event with a reply string.
   */
  // eslint-disable-next-line no-unused-vars
  async answer(_session, _decisionId, _reply) {
    throw new Error(`${this.constructor.name}.answer: abstract`);
  }

  /**
   * Resume the session with corrective instructions; return TaskResult.
   */
  // eslint-disable-next-line no-unused-vars
  async revise(_session, _instructions) {
    throw new Error(`${this.constructor.name}.revise: abstract`);
  }

  // eslint-disable-next-line no-unused-vars
  async stop(_session) { throw new Error(`${this.constructor.name}.stop: abstract`); }
}

WorkerInterface.name = '';

module.exports = { WorkerInterface };
