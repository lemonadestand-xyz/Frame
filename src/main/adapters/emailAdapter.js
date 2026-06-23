/**
 * Email escalation adapter — v2 stub.
 *
 * Writes one RFC 5322-compliant `.eml` file per escalation under
 * `<projectPath>/.frame/runtime/email-drafts/<id>.eml` for the user to
 * send manually. Body includes the drafted question + suggested answer
 * + a short footer pointing back at Frame.
 *
 * Opt-in via the profile:
 *
 *   escalation:
 *     email:
 *       to: chris@example.com
 *       from: frame@example.com      # optional; default frame@localhost
 *       subject_prefix: "[Frame]"   # optional
 *
 * Response detection is deferred to v3 (would need IMAP polling). For
 * now the adapter resolves the present-promise when the user re-imports
 * the reply through Frame — which means `present` returns a Promise that
 * stays pending until something external triggers `_testAnswer(id, reply)`.
 *
 * On any disk-write failure the adapter delegates to the fallback (UI
 * adapter) so the supervisor loop is never blocked by a misconfigured
 * email channel.
 *
 * Mirrors supervisor/adapters/email.py:16-29.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EscalationAdapter } = require('./types');

class EmailAdapter extends EscalationAdapter {
  /**
   * @param {{to: string, from?: string, subject_prefix?: string}} config
   * @param {{fallback?: EscalationAdapter, draftsDir?: string}} hooks
   */
  constructor(config = {}, hooks = {}) {
    super();
    this.to = config.to || '';
    this.from = config.from || 'frame@localhost';
    this.subjectPrefix = config.subject_prefix || '[Frame]';
    this._fallback = hooks.fallback || null;
    this._draftsDirOverride = hooks.draftsDir || null;
    this._pending = new Map(); // id → {resolve, reject}
  }

  draftsDir(projectPath) {
    if (this._draftsDirOverride) return this._draftsDirOverride;
    return path.join(projectPath, '.frame', 'runtime', 'email-drafts');
  }

  /**
   * Compose an RFC 5322-compliant `.eml` for an escalation.
   * @param {import('./types').Escalation} escalation
   * @returns {{messageId: string, content: string}}
   */
  buildEml(escalation) {
    const id = escalation.id || `esc-${Date.now()}`;
    const slug = escalation.slug || 'unknown';
    const messageId = `<${id}.${crypto.randomBytes(6).toString('hex')}@frame.local>`;
    const subject = `${this.subjectPrefix} ${escalation.category || 'scope'} · ${escalation.draftedQuestion || 'drafted question'}`
      .replace(/[\r\n]+/g, ' ')
      .slice(0, 200);
    const date = new Date().toUTCString();
    const headers = [
      `From: ${this.from}`,
      `To: ${this.to}`,
      `Subject: ${_encodeHeader(subject)}`,
      `Date: ${date}`,
      `Message-ID: ${messageId}`,
      `MIME-Version: 1.0`,
      `Content-Type: text/plain; charset=utf-8`,
      `Content-Transfer-Encoding: 8bit`,
      `X-Frame-Escalation-Id: ${id}`,
      `X-Frame-Spec-Slug: ${slug}`,
      `X-Frame-Category: ${escalation.category || 'scope'}`,
    ];
    const body = [
      escalation.draftedQuestion || '(drafted question missing)',
      '',
      escalation.draftAnswer ? `Frame's suggested answer:\n  ${escalation.draftAnswer}` : '',
      escalation.options && escalation.options.length > 0
        ? `Options:\n${escalation.options.map((o) => `  - ${o}`).join('\n')}`
        : '',
      '',
      `Spec: ${slug}`,
      escalation.taskId ? `Task: ${escalation.taskId}` : '',
      '',
      '— Reply to this email and re-import via Frame to resolve the escalation.',
    ].filter((line) => line !== null && line !== undefined).join('\n');
    const content = `${headers.join('\r\n')}\r\n\r\n${body}\r\n`;
    return { messageId, content };
  }

  /**
   * Write the `.eml` to disk. Returns a Promise that resolves only when
   * a reply is fed back via `_testAnswer(id, ...)` (v3 will hook IMAP
   * polling here).
   * @param {import('./types').Escalation} escalation
   */
  async present(escalation) {
    if (!this.to) {
      return this._fallbackOrThrow(escalation, 'email adapter missing `to` address');
    }
    if (!escalation || !escalation.projectPath) {
      return this._fallbackOrThrow(escalation, 'email adapter requires escalation.projectPath');
    }
    const id = escalation.id || `esc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const enriched = { ...escalation, id };
    const dir = this.draftsDir(escalation.projectPath);
    try { fs.mkdirSync(dir, { recursive: true }); }
    catch (err) { return this._fallbackOrThrow(escalation, `email drafts dir create failed: ${err.message}`); }

    const { content, messageId } = this.buildEml(enriched);
    const filePath = path.join(dir, `${id}.eml`);
    try { fs.writeFileSync(filePath, content, 'utf8'); }
    catch (err) { return this._fallbackOrThrow(escalation, `email .eml write failed: ${err.message}`); }

    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject, escalation: enriched, filePath, messageId });
    });
  }

  async awaitResponse(escalationId) {
    return new Promise((resolve, reject) => {
      const existing = this._pending.get(escalationId);
      if (existing) {
        const prev = existing;
        this._pending.set(escalationId, {
          ...existing,
          resolve: (v) => { prev.resolve(v); resolve(v); },
          reject: (e) => { prev.reject(e); reject(e); },
        });
        return;
      }
      this._pending.set(escalationId, { resolve, reject, escalation: null });
    });
  }

  /** Test seam — push an answer manually. */
  _testAnswer(id, answer, answeredBy = 'email') {
    const entry = this._pending.get(id);
    if (!entry) return;
    this._pending.delete(id);
    entry.resolve({ id, answer, answeredBy });
  }

  _fallbackOrThrow(escalation, reason) {
    if (this._fallback && typeof this._fallback.present === 'function') {
      try { /* eslint-disable-next-line no-console */
        console.warn(`[emailAdapter] falling back to UI: ${reason}`);
      } catch { /* swallow */ }
      return this._fallback.present(escalation);
    }
    return Promise.reject(new Error(reason));
  }
}

EmailAdapter.channel = 'email';

function _encodeHeader(value) {
  // Plain ASCII passes through; non-ASCII gets RFC 2047 encoded-word
  // wrapping so the file is still a well-formed .eml in any MUA.
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  const b64 = Buffer.from(value, 'utf8').toString('base64');
  return `=?utf-8?B?${b64}?=`;
}

module.exports = { EmailAdapter };
