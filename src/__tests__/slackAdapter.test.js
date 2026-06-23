/**
 * SlackAdapter tests — Block Kit construction, webhook fallback, callback.
 *
 * Network and HTTP server are stubbed via the constructor's `hooks` —
 * no real sockets or webhooks fire during the test run.
 */

const { EventEmitter } = require('events');
const { SlackAdapter, DEFAULT_CALLBACK_PORT } = require('../main/adapters/slackAdapter');

function makeFakeServer() {
  const ee = new EventEmitter();
  ee.listening = false;
  ee.close = (cb) => { ee.listening = false; if (cb) cb(); };
  ee.listen = (port, host, cb) => {
    ee.listening = true;
    if (cb) cb();
  };
  return ee;
}

function makeFakeHttp() {
  let lastHandler = null;
  return {
    createServer: (handler) => {
      lastHandler = handler;
      return makeFakeServer();
    },
    _lastHandler: () => lastHandler,
  };
}

describe('SlackAdapter.buildBlockKitMessage', () => {
  it('emits header + question + suggested-answer + actions blocks', () => {
    const adapter = new SlackAdapter({ webhook_url: 'https://x', callback_port: 7333 });
    const msg = adapter.buildBlockKitMessage({
      id: 'esc-1',
      slug: 'demo',
      category: 'scope',
      draftedQuestion: 'pick A or B?',
      draftAnswer: 'A',
      options: ['A', 'B'],
    });
    expect(Array.isArray(msg.blocks)).toBe(true);
    expect(msg.blocks[0].type).toBe('header');
    const question = msg.blocks.find((b) => b.type === 'section' && b.text?.text?.includes('pick A or B'));
    expect(question).toBeDefined();
    const actions = msg.blocks.find((b) => b.type === 'actions');
    expect(actions).toBeDefined();
    expect(actions.elements).toHaveLength(2);
    expect(actions.elements[0].value).toBe('A');
  });

  it('escapes < > & in user-supplied text', () => {
    const adapter = new SlackAdapter({ webhook_url: 'https://x' });
    const msg = adapter.buildBlockKitMessage({
      id: 'x',
      slug: 'demo',
      draftedQuestion: '<script>alert(1)</script>',
    });
    const stringified = JSON.stringify(msg);
    expect(stringified).not.toMatch(/<script>alert/);
    expect(stringified).toContain('&lt;script&gt;');
  });
});

describe('SlackAdapter.present', () => {
  it('falls back to UI when webhook_url is empty', async () => {
    const fallback = {
      present: jest.fn().mockResolvedValue({ id: 'fb', answer: 'ok', answeredBy: 'ui' }),
    };
    const adapter = new SlackAdapter({}, { fallback });
    const result = await adapter.present({
      id: 'esc-empty',
      slug: 'demo',
      projectPath: '/tmp/proj',
      draftedQuestion: 'q?',
    });
    expect(fallback.present).toHaveBeenCalled();
    expect(result.answeredBy).toBe('ui');
  });

  it('falls back to UI when the webhook POST fails (non-2xx)', async () => {
    const fallback = { present: jest.fn().mockResolvedValue({ id: 'x', answer: 'ok', answeredBy: 'ui' }) };
    const fakeFetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });
    const adapter = new SlackAdapter(
      { webhook_url: 'https://hooks.slack/abc' },
      { fallback, fetchImpl: fakeFetch, http: makeFakeHttp() },
    );
    const result = await adapter.present({
      id: 'esc-bad',
      slug: 'demo',
      projectPath: '/tmp/proj',
      draftedQuestion: 'q?',
    });
    expect(fakeFetch).toHaveBeenCalledWith('https://hooks.slack/abc', expect.any(Object));
    expect(fallback.present).toHaveBeenCalled();
    expect(result.answeredBy).toBe('ui');
  });

  it('resolves when the callback server handler fires for a matching id', async () => {
    const fakeFetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const fakeHttp = makeFakeHttp();
    const adapter = new SlackAdapter(
      { webhook_url: 'https://hooks.slack/abc' },
      { fetchImpl: fakeFetch, http: fakeHttp },
    );
    const presentPromise = adapter.present({
      id: 'esc-callback',
      slug: 'demo',
      projectPath: '/tmp/proj',
      draftedQuestion: 'q?',
      options: ['yes', 'no'],
    });
    // Drive the present() lifecycle past the POST.
    await new Promise((r) => setImmediate(r));
    adapter._testAnswer('esc-callback', 'yes');
    const result = await presentPromise;
    expect(result).toEqual({ id: 'esc-callback', answer: 'yes', answeredBy: 'slack' });
  });

  it('falls back when the callback server fails to bind', async () => {
    const fallback = { present: jest.fn().mockResolvedValue({ id: 'x', answer: 'ok', answeredBy: 'ui' }) };
    const failingHttp = {
      createServer: () => {
        const ee = new EventEmitter();
        ee.listening = false;
        ee.listen = () => setImmediate(() => ee.emit('error', new Error('EADDRINUSE')));
        ee.close = (cb) => { if (cb) cb(); };
        return ee;
      },
    };
    const adapter = new SlackAdapter(
      { webhook_url: 'https://hooks.slack/abc', callback_port: 7333 },
      { fallback, fetchImpl: jest.fn().mockResolvedValue({ ok: true }), http: failingHttp },
    );
    const result = await adapter.present({
      id: 'esc-bind-fail',
      slug: 'demo',
      projectPath: '/tmp/proj',
      draftedQuestion: 'q?',
    });
    expect(fallback.present).toHaveBeenCalled();
    expect(result.answeredBy).toBe('ui');
  });
});

describe('SlackAdapter callback HTTP handler', () => {
  it('resolves pending decisions on a POST with matching decisionId', async () => {
    const fakeFetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const fakeHttp = makeFakeHttp();
    const adapter = new SlackAdapter(
      { webhook_url: 'https://hooks.slack/abc' },
      { fetchImpl: fakeFetch, http: fakeHttp },
    );
    const presentPromise = adapter.present({
      id: 'esc-http',
      slug: 'demo',
      projectPath: '/tmp/proj',
      draftedQuestion: 'q?',
    });
    await new Promise((r) => setImmediate(r));
    // Drive the captured handler with a fake POST request.
    const handler = fakeHttp._lastHandler();
    expect(typeof handler).toBe('function');
    const dataListeners = [];
    const endListeners = [];
    const req = {
      method: 'POST',
      on: (event, fn) => {
        if (event === 'data') dataListeners.push(fn);
        if (event === 'end') endListeners.push(fn);
      },
    };
    const res = { statusCode: 0, setHeader: jest.fn(), end: jest.fn() };
    handler(req, res);
    dataListeners.forEach((fn) => fn(Buffer.from(JSON.stringify({ decisionId: 'esc-http', reply: 'merged' }))));
    endListeners.forEach((fn) => fn());
    const result = await presentPromise;
    expect(result.answer).toBe('merged');
    expect(res.statusCode).toBe(200);
  });

  it('rejects non-POST requests with 405', () => {
    const adapter = new SlackAdapter({ webhook_url: 'https://x' });
    const req = { method: 'GET', on: () => {} };
    const res = { statusCode: 0, setHeader: jest.fn(), end: jest.fn() };
    adapter._handleCallback(req, res);
    expect(res.statusCode).toBe(405);
  });
});

describe('SlackAdapter defaults', () => {
  it('uses 7333 as the default callback port', () => {
    const adapter = new SlackAdapter({ webhook_url: 'https://x' });
    expect(adapter.callbackPort).toBe(DEFAULT_CALLBACK_PORT);
    expect(DEFAULT_CALLBACK_PORT).toBe(7333);
  });
});
