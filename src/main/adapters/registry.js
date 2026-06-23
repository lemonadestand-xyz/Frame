/**
 * Adapter registry — picks the right escalation channel per role.
 *
 * Mirrors the supervisor's role-based adapter routing
 * (supervisor/adapters/__init__.py:40-67 + profile.roles[].channel).
 *
 * UI adapter is always registered. Slack + Email register only when the
 * project's profile declares the corresponding `escalation.<channel>`
 * block — opt-in, so a missing config never wakes up a callback server
 * or .eml writer on disk.
 */

const { UIAdapter } = require('./uiAdapter');
const { SlackAdapter } = require('./slackAdapter');
const { EmailAdapter } = require('./emailAdapter');

function buildAdapters(profile, hooks = {}) {
  const reg = { ui: new UIAdapter(hooks.ui || {}) };
  const esc = (profile && profile.escalation) || {};
  if (esc.slack && esc.slack.webhook_url) {
    reg.slack = new SlackAdapter(esc.slack, { fallback: reg.ui, ...(hooks.slack || {}) });
  }
  if (esc.email && esc.email.to) {
    reg.email = new EmailAdapter(esc.email, { fallback: reg.ui, ...(hooks.email || {}) });
  }
  return reg;
}

function routeAdapter(adapters, escalation, profile) {
  const role = (profile?.roles || []).find((r) => r.name === escalation.role);
  const channel = role?.channel || 'ui';
  const adapter = adapters[channel];
  if (adapter) return adapter;
  return adapters.ui; // safe fallback
}

module.exports = { buildAdapters, routeAdapter };
