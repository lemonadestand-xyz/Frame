/**
 * Slack escalation adapter — v2 stub.
 *
 * Posts a Block Kit message to a Slack incoming webhook with the drafted
 * question + suggested answer + option buttons. Each button click POSTs
 * back to a tiny localhost HTTP server that this adapter spins up; the
 * server resolves the matching `present` promise.
 *
 * Opt-in via the profile:
 *
 *   escalation:
 *     slack:
 *       webhook_url: https://hooks.slack.com/services/...
 *       callback_port: 7333   # optional; default 7333, localhost-only
 *       callback_token: <opaque>  # optional shared secret
 *
 * Failure modes (network error, non-2xx from Slack, callback server bind
 * failure) fall back to the UIAdapter so the supervisor loop is never
 * blocked by a misconfigured Slack channel.
 *
 * Mirrors supervisor/adapters/slack.py:18-32.
 *
 * v1 status: stub — wired into the registry so the supervisor loop sees a
 * Slack adapter when the profile is configured, but full bidirectional
 * flow + production hardening (TLS-callback, request signing, retries) is
 * a v3 follow-up.
 */

const http = require('http');
const { EscalationAdapter } = require('./types');

const DEFAULT_CALLBACK_PORT = 7333;
const POST_TIMEOUT_MS = 8000;

class SlackAdapter extends EscalationAdapter {
  /**
   * @param {{webhook_url: string, callback_port?: number, callback_token?: string}} config
   * @param {{fallback?: EscalationAdapter, fetchImpl?: typeof globalThis.fetch, http?: typeof http}} hooks
   */
  constructor(config = {}, hooks = {}) {
    super();
    this.webhookUrl = config.webhook_url || '';
    this.callbackPort = Number.isInteger(config.callback_port) ? config.callback_port : DEFAULT_CALLBACK_PORT;
    this.callbackToken = config.callback_token || '';
    this._fallback = hooks.fallback || null;
    this._fetch = hooks.fetchImpl || ((typeof globalThis.fetch === 'function') ? globalThis.fetch.bind(globalThis) : null);
    this._http = hooks.http || http;
    this._pending = new Map(); // id → {resolve, reject, escalation}
    this._server = null;
  }

  /**
   * Lazily boot the localhost callback server. Idempotent: subsequent
   * calls return the same server (or rebind if it was closed).
   */
  ensureCallbackServer() {
    if (this._server && this._server.listening) return Promise.resolve(this._server);
    return new Promise((resolve, reject) => {
      const server = this._http.createServer((req, res) => this._handleCallback(req, res));
      server.on('error', (err) => reject(err));
      server.listen(this.callbackPort, '127.0.0.1', () => {
        this._server = server;
        resolve(server);
      });
    });
  }

  _handleCallback(req, res) {
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end('Method Not Allowed');
      return;
    }
    let body = '';
    req.on('data', (chunk) => { body += chunk.toString('utf8'); });
    req.on('end', () => {
      let payload;
      try { payload = JSON.parse(body || '{}'); }
      catch {
        res.statusCode = 400;
        res.end('Bad JSON');
        return;
      }
      if (this.callbackToken && payload.token !== this.callbackToken) {
        res.statusCode = 403;
        res.end('Forbidden');
        return;
      }
      const { decisionId, reply } = payload || {};
      this._resolveDecision(decisionId, reply, payload.answeredBy || 'slack');
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end('{"ok":true}\n');
    });
  }

  _resolveDecision(id, answer, answeredBy) {
    const entry = this._pending.get(id);
    if (!entry) return;
    this._pending.delete(id);
    entry.resolve({ id, answer, answeredBy });
  }

  buildBlockKitMessage(escalation) {
    const blocks = [
      {
        type: 'header',
        text: { type: 'plain_text', text: ':warning: Frame escalation', emoji: true },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*${_mdEscape(escalation.draftedQuestion || 'Drafted question missing')}*` },
      },
    ];
    if (escalation.draftAnswer) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `Suggested: ${_mdEscape(escalation.draftAnswer)}` },
      });
    }
    const fields = [];
    if (escalation.slug) fields.push({ type: 'mrkdwn', text: `*spec:* ${_mdEscape(escalation.slug)}` });
    if (escalation.category) fields.push({ type: 'mrkdwn', text: `*category:* ${_mdEscape(escalation.category)}` });
    if (fields.length > 0) blocks.push({ type: 'section', fields });

    const options = Array.isArray(escalation.options) ? escalation.options : [];
    if (options.length > 0) {
      blocks.push({
        type: 'actions',
        block_id: `escalation:${escalation.id}`,
        elements: options.map((opt) => ({
          type: 'button',
          text: { type: 'plain_text', text: String(opt) },
          value: String(opt),
          action_id: `reply_${_safeId(opt)}`,
        })),
      });
    }
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `Reply via Frame → \`localhost:${this.callbackPort}/callback\` · id ${_mdEscape(escalation.id)}` }],
    });
    return { blocks };
  }

  /**
   * Send the Block Kit message + start the callback server. On any
   * failure (no fetch impl, network error, non-2xx response), delegate
   * to the fallback adapter (UIAdapter) so the supervisor loop never
   * stalls.
   * @param {import('./types').Escalation} escalation
   */
  async present(escalation) {
    if (!this.webhookUrl || !this._fetch) {
      return this._fallbackOrThrow(escalation, 'slack adapter missing webhook_url or fetch impl');
    }
    const id = escalation.id || `esc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const enriched = { ...escalation, id };

    let serverErr = null;
    try { await this.ensureCallbackServer(); }
    catch (err) { serverErr = err; }
    if (serverErr) {
      return this._fallbackOrThrow(escalation, `slack callback server bind failed: ${serverErr.message}`);
    }

    let postOk = false;
    let postErr = null;
    try {
      const ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), POST_TIMEOUT_MS) : null;
      try {
        const res = await this._fetch(this.webhookUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(this.buildBlockKitMessage(enriched)),
          signal: ctrl ? ctrl.signal : undefined,
        });
        if (res && res.ok) postOk = true;
        else postErr = new Error(`slack webhook returned ${res?.status ?? 'unknown'}`);
      } finally {
        if (timer) clearTimeout(timer);
      }
    } catch (err) { postErr = err; }
    if (!postOk) return this._fallbackOrThrow(escalation, `slack webhook POST failed: ${postErr?.message || 'unknown'}`);

    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject, escalation: enriched });
    });
  }

  async awaitResponse(escalationId) {
    return new Promise((resolve, reject) => {
      const existing = this._pending.get(escalationId);
      if (existing) {
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

  _fallbackOrThrow(escalation, reason) {
    if (this._fallback && typeof this._fallback.present === 'function') {
      try {
        // eslint-disable-next-line no-console
        console.warn(`[slackAdapter] falling back to UI: ${reason}`);
      } catch { /* swallow */ }
      return this._fallback.present(escalation);
    }
    return Promise.reject(new Error(reason));
  }

  /** Test seam — push an answer manually. */
  _testAnswer(id, answer, answeredBy = 'slack') {
    this._resolveDecision(id, answer, answeredBy);
  }

  async dispose() {
    if (this._server && this._server.listening) {
      await new Promise((resolve) => this._server.close(() => resolve()));
    }
    this._server = null;
  }
}

SlackAdapter.channel = 'slack';

function _mdEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function _safeId(s) {
  return String(s).replace(/[^a-zA-Z0-9_]+/g, '_').slice(0, 32) || 'opt';
}

module.exports = { SlackAdapter, DEFAULT_CALLBACK_PORT };
