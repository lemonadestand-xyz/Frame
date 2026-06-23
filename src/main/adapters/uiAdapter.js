/**
 * UI escalation adapter — writes the escalation to disk, emits an IPC
 * event for the renderer modal, and resolves on the matching answer event.
 *
 * The renderer (escalationModal.js, deferred to the UI phase) listens on
 * SUPERVISOR_ESCALATION_OPEN and answers via SUPERVISOR_ESCALATION_ANSWERED.
 *
 * For headless / test contexts, the constructor accepts `emit` and
 * `register` injection points so the adapter never directly imports
 * Electron's ipcMain.
 */

const fs = require('fs');
const path = require('path');
const { EscalationAdapter } = require('./types');

class UIAdapter extends EscalationAdapter {
  /**
   * @param {{emit?: (channel, payload) => void,
   *          onAnswered?: (handler) => () => void}} hooks
   *   `emit(channel, payload)` is called with SUPERVISOR_ESCALATION_OPEN.
   *   `onAnswered(handler)` registers a listener that's called with
   *   `{id, answer, answeredBy}`; returns an unsubscribe.
   */
  constructor({ emit = () => {}, onAnswered = null } = {}) {
    super();
    this._emit = emit;
    this._onAnswered = onAnswered;
    this._pending = new Map(); // id → {resolve, reject}
    this._unsubAnswered = null;
    if (typeof onAnswered === 'function') {
      this._unsubAnswered = onAnswered((payload) => this._handleAnswered(payload));
    }
  }

  /**
   * Write the escalation to .frame/specs/<slug>/escalations/<id>.json
   * and fire the IPC event.
   * @param {import('./types').Escalation} escalation
   * @returns {Promise<{id, answer, answeredBy}>}
   */
  async present(escalation) {
    if (!escalation || !escalation.slug || !escalation.projectPath) {
      throw new Error('escalation requires slug + projectPath');
    }
    const id = escalation.id || `esc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const enriched = {
      id,
      createdAt: new Date().toISOString(),
      role: escalation.role || 'user',
      options: escalation.options || [],
      ...escalation,
    };
    const dir = path.join(escalation.projectPath, '.frame', 'specs', escalation.slug, 'escalations');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${id}.json`),
      JSON.stringify(enriched, null, 2) + '\n', 'utf8');
    try { this._emit('SUPERVISOR_ESCALATION_OPEN', enriched); } catch { /* swallow */ }
    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject, escalation: enriched });
    });
  }

  async awaitResponse(escalationId) {
    return new Promise((resolve, reject) => {
      const existing = this._pending.get(escalationId);
      if (existing) {
        // Already pending — chain
        const prev = existing;
        this._pending.set(escalationId, {
          resolve: (v) => { prev.resolve(v); resolve(v); },
          reject: (e) => { prev.reject(e); reject(e); },
          escalation: existing.escalation,
        });
        return;
      }
      this._pending.set(escalationId, { resolve, reject, escalation: null });
    });
  }

  _handleAnswered({ id, answer, answeredBy } = {}) {
    const entry = this._pending.get(id);
    if (!entry) return;
    this._pending.delete(id);
    // Move the escalation file to answered/.
    try {
      const esc = entry.escalation;
      if (esc) {
        const baseDir = path.join(esc.projectPath, '.frame', 'specs', esc.slug, 'escalations');
        const answeredDir = path.join(baseDir, 'answered');
        fs.mkdirSync(answeredDir, { recursive: true });
        const src = path.join(baseDir, `${id}.json`);
        if (fs.existsSync(src)) {
          const final = { ...esc, answer, answeredBy: answeredBy || 'user', answeredAt: new Date().toISOString() };
          fs.writeFileSync(path.join(answeredDir, `${id}.json`), JSON.stringify(final, null, 2) + '\n', 'utf8');
          fs.unlinkSync(src);
        }
      }
    } catch { /* swallow — disk failure shouldn't prevent the loop from continuing */ }
    entry.resolve({ id, answer, answeredBy: answeredBy || 'user' });
  }

  /** Test seam — push an answer manually. */
  _testAnswer(id, answer) { this._handleAnswered({ id, answer }); }

  dispose() {
    if (typeof this._unsubAnswered === 'function') this._unsubAnswered();
  }
}

UIAdapter.channel = 'ui';

module.exports = { UIAdapter };
