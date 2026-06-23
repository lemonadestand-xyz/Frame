/**
 * Adapter registry tests — opt-in registration semantics.
 *
 * `buildAdapters` always includes the UI adapter; Slack and Email register
 * only when the corresponding profile.escalation.<channel> config is present
 * (Slack needs `webhook_url`, Email needs `to`). Role-based routing falls
 * back to UI when the chosen channel isn't registered.
 */

const { buildAdapters, routeAdapter } = require('../main/adapters/registry');
const { UIAdapter } = require('../main/adapters/uiAdapter');
const { SlackAdapter } = require('../main/adapters/slackAdapter');
const { EmailAdapter } = require('../main/adapters/emailAdapter');

describe('buildAdapters', () => {
  it('always registers a UIAdapter', () => {
    const reg = buildAdapters({});
    expect(reg.ui).toBeInstanceOf(UIAdapter);
    expect(reg.slack).toBeUndefined();
    expect(reg.email).toBeUndefined();
  });

  it('registers Slack only when escalation.slack.webhook_url is set', () => {
    const noSlack = buildAdapters({ escalation: { slack: { callback_port: 9000 } } });
    expect(noSlack.slack).toBeUndefined();
    const withSlack = buildAdapters({ escalation: { slack: { webhook_url: 'https://hooks.slack/x' } } });
    expect(withSlack.slack).toBeInstanceOf(SlackAdapter);
  });

  it('registers Email only when escalation.email.to is set', () => {
    const noEmail = buildAdapters({ escalation: { email: { subject_prefix: '[Frame]' } } });
    expect(noEmail.email).toBeUndefined();
    const withEmail = buildAdapters({ escalation: { email: { to: 'chris@example.com' } } });
    expect(withEmail.email).toBeInstanceOf(EmailAdapter);
  });

  it('passes the UI adapter as fallback to Slack/Email so failures route home', () => {
    const reg = buildAdapters({
      escalation: {
        slack: { webhook_url: 'https://hooks.slack/x' },
        email: { to: 'a@b.example' },
      },
    });
    expect(reg.slack._fallback).toBe(reg.ui);
    expect(reg.email._fallback).toBe(reg.ui);
  });
});

describe('routeAdapter', () => {
  it('falls back to UI when the role channel is not registered', () => {
    const reg = buildAdapters({});
    const profile = { roles: [{ name: 'chris', channel: 'slack' }] };
    const chosen = routeAdapter(reg, { role: 'chris' }, profile);
    expect(chosen).toBe(reg.ui);
  });

  it('returns the matching channel adapter when registered', () => {
    const profile = {
      escalation: { slack: { webhook_url: 'https://hooks.slack/x' } },
      roles: [{ name: 'chris', channel: 'slack' }],
    };
    const reg = buildAdapters(profile);
    const chosen = routeAdapter(reg, { role: 'chris' }, profile);
    expect(chosen).toBe(reg.slack);
  });
});
