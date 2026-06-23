/**
 * Escalation adapter base class.
 *
 * Concrete adapters (UI, Slack, Email) implement `present` + `awaitResponse`.
 * Mirrors supervisor/adapters/__init__.py:40-67 (ConsoleAdapter) and
 * supervisor/adapters/mobile_api.py:24-44 (MobileApiAdapter).
 *
 * @typedef {Object} Escalation
 * @property {string} id
 * @property {string} slug
 * @property {string} projectPath
 * @property {string} [taskId]
 * @property {string} category
 * @property {string} draftedQuestion
 * @property {string} draftAnswer
 * @property {string[]} [options]
 * @property {string} role
 * @property {string} createdAt
 * @property {string} [answeredAt]
 * @property {string} [answer]
 * @property {string} [answeredBy]
 */

class EscalationAdapter {
  static channel = '';
  // eslint-disable-next-line no-unused-vars
  async present(_escalation) { throw new Error(`${this.constructor.name}.present: abstract`); }
  // eslint-disable-next-line no-unused-vars
  async awaitResponse(_escalationId) { throw new Error(`${this.constructor.name}.awaitResponse: abstract`); }
}

module.exports = { EscalationAdapter };
