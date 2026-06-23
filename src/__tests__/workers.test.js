const { WorkerInterface } = require('../main/workers/types');
const registry = require('../main/workers/registry');
const { Posture, WorkerEventKind } = require('../shared/workerTypes');

beforeEach(() => registry._resetForTests());

describe('WorkerInterface abstract', () => {
  it('throws on every method when not overridden', async () => {
    const w = new WorkerInterface();
    await expect(w.start({})).rejects.toThrow(/abstract/);
    await expect(w.answer({}, 'x', 'y')).rejects.toThrow(/abstract/);
    await expect(w.revise({}, 'x')).rejects.toThrow(/abstract/);
    await expect(w.stop({})).rejects.toThrow(/abstract/);
    // events is an async generator; verify it throws on first next()
    await expect((async () => {
      const it = w.events({});
      await it.next();
    })()).rejects.toThrow(/abstract/);
  });
});

describe('workers/registry', () => {
  class StubWorker extends WorkerInterface {
    async start() { return { tool: 'stub', terminalId: 't1' }; }
  }

  it('registers and constructs by name', () => {
    registry.register('stub', StubWorker);
    expect(registry.hasWorker('stub')).toBe(true);
    const inst = registry.getWorker('stub');
    expect(inst).toBeInstanceOf(StubWorker);
  });

  it('throws on unknown worker name', () => {
    expect(() => registry.getWorker('nope')).toThrow(/unknown worker: nope/);
  });

  it('listWorkers reports every registered name', () => {
    registry.register('a', StubWorker);
    registry.register('b', StubWorker);
    expect(registry.listWorkers().sort()).toEqual(['a', 'b']);
  });

  it('rejects bad arguments', () => {
    expect(() => registry.register('', StubWorker)).toThrow();
    expect(() => registry.register('ok', null)).toThrow();
  });
});

describe('EventQueue', () => {
  const { EventQueue } = require('../main/workers/_eventQueue');

  it('yields events pushed before iteration starts', async () => {
    const q = new EventQueue();
    q.push({ kind: 'progress' });
    q.push({ kind: 'done' });
    q.close();
    const out = [];
    for await (const ev of q) out.push(ev.kind);
    expect(out).toEqual(['progress', 'done']);
  });

  it('yields events pushed after waiter is parked', async () => {
    const q = new EventQueue();
    const collected = [];
    const iter = (async () => {
      for await (const ev of q) collected.push(ev.kind);
    })();
    await new Promise((r) => setTimeout(r, 5));
    q.push({ kind: 'progress' });
    q.push({ kind: 'done' });
    q.close();
    await iter;
    expect(collected).toEqual(['progress', 'done']);
  });

  it('propagates errors via throw()', async () => {
    const q = new EventQueue();
    q.error(new Error('boom'));
    await expect((async () => {
      for await (const _ev of q) { /* drain */ }
    })()).rejects.toThrow(/boom/);
  });
});

describe('FakeWorker', () => {
  const { FakeWorker } = require('../main/workers/fakeWorker');

  it('emits progress → tool_use × N → done', async () => {
    const w = new FakeWorker({ toolUseCount: 3 });
    const session = await w.start({});
    const kinds = [];
    for await (const ev of w.events(session)) kinds.push(ev.kind);
    expect(kinds[0]).toBe('progress');
    expect(kinds.filter((k) => k === 'tool_use')).toHaveLength(3);
    expect(kinds[kinds.length - 1]).toBe('done');
  });

  it('revise returns a TaskResult', async () => {
    const w = new FakeWorker();
    const session = await w.start({});
    // drain initial events
    for await (const _ev of w.events(session)) { /* drain */ }
    const result = await w.revise(session, 'fix the thing');
    expect(result.status).toBe('done');
    expect(result.sessionId).toBe(session.sessionId);
  });
});

describe('ClaudeCodeWorker', () => {
  const { ClaudeCodeWorker } = require('../main/workers/claudeCodeWorker');
  const { Posture, WorkerEventKind } = require('../shared/workerTypes');

  function makeExec(opts = {}) {
    const sent = [];
    const sub = { cb: null };
    return {
      _sent: sent,
      _sub: sub,
      async checkAvailable() {
        return opts.available === false
          ? { available: false, resolvedCommand: null, name: 'Claude Code' }
          : { available: true, resolvedCommand: opts.resolved || 'claude', name: 'Claude Code' };
      },
      sendCommand(cmd, terminalId) { sent.push({ cmd, terminalId }); },
      async waitForReady() { return opts.ready !== false; },
      subscribeToStatus(_id, cb) { sub.cb = cb; return () => { sub.cb = null; }; },
    };
  }

  it('static identity & posture flag table', () => {
    expect(ClaudeCodeWorker.toolId).toBe('claude');
    expect(ClaudeCodeWorker.mapPostureToFlag(Posture.DANGEROUSLY_SKIP)).toBe('--dangerously-skip-permissions');
    expect(ClaudeCodeWorker.mapPostureToFlag(Posture.DEFAULT)).toBe('');
    expect(ClaudeCodeWorker.mapPostureToFlag(Posture.CAUTIOUS)).toBe('');
    expect(ClaudeCodeWorker.mapPostureToFlag('nonsense')).toBe('');
  });

  it('parseEventFromTail classifies approval / fingerprint / unknown', () => {
    expect(ClaudeCodeWorker.parseEventFromTail('Do you want to continue?')).toBe(WorkerEventKind.DECISION);
    expect(ClaudeCodeWorker.parseEventFromTail('(y/n)')).toBe(WorkerEventKind.DECISION);
    expect(ClaudeCodeWorker.parseEventFromTail('╭─ working ─╮')).toBe(WorkerEventKind.PROGRESS);
    expect(ClaudeCodeWorker.parseEventFromTail('│ > tell me about...')).toBe(WorkerEventKind.PROGRESS);
    expect(ClaudeCodeWorker.parseEventFromTail('esc to interrupt')).toBe(WorkerEventKind.PROGRESS);
    expect(ClaudeCodeWorker.parseEventFromTail('something random')).toBe(null);
    expect(ClaudeCodeWorker.parseEventFromTail('')).toBe(null);
    expect(ClaudeCodeWorker.parseEventFromTail(null)).toBe(null);
  });

  it('mapStatusToEvent translates lane-status payloads', () => {
    expect(ClaudeCodeWorker.mapStatusToEvent({ agentName: 'claude', status: 'agent-working' }).kind).toBe(WorkerEventKind.PROGRESS);
    expect(ClaudeCodeWorker.mapStatusToEvent({ agentName: 'claude', status: 'agent-approval' }).kind).toBe(WorkerEventKind.DECISION);
    expect(ClaudeCodeWorker.mapStatusToEvent({ agentName: 'claude', status: 'agent-input' }).kind).toBe(WorkerEventKind.DONE);
    expect(ClaudeCodeWorker.mapStatusToEvent({ agentName: null, status: 'agent-working' })).toBe(null);
    expect(ClaudeCodeWorker.mapStatusToEvent({ agentName: 'claude', status: 'idle' })).toBe(null);
    expect(ClaudeCodeWorker.mapStatusToEvent(null)).toBe(null);
  });

  it('start sends the resolved command + spliced posture flag and seeds a progress event', async () => {
    const w = new ClaudeCodeWorker();
    const exec = makeExec({ resolved: 'claude' });
    const session = await w.start({
      task: { prompt: 'hello' },
      ctx: { terminalId: 't1', projectPath: '/tmp' },
      posture: Posture.DANGEROUSLY_SKIP,
      exec,
    });
    expect(session.terminalId).toBe('t1');
    expect(session.tool).toBe('claude');
    expect(exec._sent[0].cmd).toBe('claude --dangerously-skip-permissions');

    // First event yielded should be the seeded `progress` start signal.
    const it = w.events(session);
    const first = await it.next();
    expect(first.value.kind).toBe(WorkerEventKind.PROGRESS);
    await w.stop(session);
  });

  it("start doesn't double-add the posture flag if it's already in resolvedCommand", async () => {
    const w = new ClaudeCodeWorker();
    const exec = makeExec({ resolved: 'claude --dangerously-skip-permissions' });
    await w.start({
      ctx: { terminalId: 't2', projectPath: '/tmp' },
      posture: Posture.DANGEROUSLY_SKIP,
      exec,
    });
    expect(exec._sent[0].cmd).toBe('claude --dangerously-skip-permissions');
    await w.stop({ terminalId: 't2' });
  });

  it('start throws if CHECK_AI_TOOL_AVAILABLE reports unavailable', async () => {
    const w = new ClaudeCodeWorker();
    const exec = makeExec({ available: false });
    await expect(w.start({ ctx: { terminalId: 't3' }, exec }))
      .rejects.toThrow(/not available/);
  });

  it('start throws if the lane never reaches agent-ready', async () => {
    const w = new ClaudeCodeWorker();
    const exec = makeExec({ ready: false });
    await expect(w.start({ ctx: { terminalId: 't4' }, exec }))
      .rejects.toThrow(/didn't become ready/);
  });

  it('events stream forwards subsequent status changes as WorkerEvents', async () => {
    const w = new ClaudeCodeWorker();
    const exec = makeExec();
    const session = await w.start({ ctx: { terminalId: 't5' }, exec });
    const kinds = [];
    const drain = (async () => {
      for await (const ev of w.events(session)) {
        kinds.push(ev.kind);
        if (kinds.length >= 3) break;
      }
    })();
    exec._sub.cb('t5', { agentName: 'claude', status: 'agent-working' });
    exec._sub.cb('t5', { agentName: 'claude', status: 'agent-approval' });
    await drain;
    expect(kinds[0]).toBe(WorkerEventKind.PROGRESS); // seeded
    expect(kinds).toContain(WorkerEventKind.DECISION);
    await w.stop(session);
  });

  it('revise sends instructions and returns a TaskResult', async () => {
    const w = new ClaudeCodeWorker();
    const exec = makeExec();
    const session = await w.start({ ctx: { terminalId: 't6', sessionId: 'sess-x' }, exec });
    const result = await w.revise(session, 'fix the typo');
    expect(result.status).toBe('done');
    expect(result.sessionId).toBe('sess-x');
    const reviseCall = exec._sent.find(c => c.cmd === 'fix the typo');
    expect(reviseCall).toBeTruthy();
    await w.stop(session);
  });

  it('stop unsubscribes and clears session entries', async () => {
    const w = new ClaudeCodeWorker();
    const exec = makeExec();
    const session = await w.start({ ctx: { terminalId: 't7' }, exec });
    expect(exec._sub.cb).toBeTruthy();
    await w.stop(session);
    expect(exec._sub.cb).toBeNull();
  });
});

describe.each([
  ['CodexWorker', () => require('../main/workers/codexWorker').CodexWorker, 'codex', 'Codex'],
  ['GeminiWorker', () => require('../main/workers/geminiWorker').GeminiWorker, 'gemini', 'Gemini'],
])('%s', (label, getCtor, expectedToolId, displayName) => {
  const { WorkerEventKind, Posture } = require('../shared/workerTypes');

  function makeExec(opts = {}) {
    const sent = [];
    const sub = { cb: null };
    return {
      _sent: sent,
      _sub: sub,
      async checkAvailable() {
        return opts.available === false
          ? { available: false, resolvedCommand: null, name: displayName }
          : { available: true, resolvedCommand: opts.resolved || expectedToolId, name: displayName };
      },
      sendCommand(cmd, terminalId) { sent.push({ cmd, terminalId }); },
      async waitForReady() { return opts.ready !== false; },
      subscribeToStatus(_id, cb) { sub.cb = cb; return () => { sub.cb = null; }; },
    };
  }

  it('static identity & posture flag table (permissive: all postures map to empty)', () => {
    const Ctor = getCtor();
    expect(Ctor.toolId).toBe(expectedToolId);
    expect(Ctor.mapPostureToFlag(Posture.DEFAULT)).toBe('');
    expect(Ctor.mapPostureToFlag(Posture.CAUTIOUS)).toBe('');
    expect(Ctor.mapPostureToFlag(Posture.DANGEROUSLY_SKIP)).toBe('');
    expect(Ctor.mapPostureToFlag('garbage')).toBe('');
  });

  it('parseEventFromTail: permissive question mark → DECISION, fingerprint → PROGRESS', () => {
    const Ctor = getCtor();
    expect(Ctor.parseEventFromTail('Should I run the command?')).toBe(WorkerEventKind.DECISION);
    expect(Ctor.parseEventFromTail('(y/n)')).toBe(WorkerEventKind.DECISION);
    expect(Ctor.parseEventFromTail('plain text with no shape')).toBe(null);
    expect(Ctor.parseEventFromTail(null)).toBe(null);
  });

  it('start sends the resolved command and seeds a progress event', async () => {
    const Ctor = getCtor();
    const w = new Ctor();
    const exec = makeExec();
    const session = await w.start({ ctx: { terminalId: 't1', projectPath: '/tmp' }, exec });
    expect(session.tool).toBe(expectedToolId);
    expect(exec._sent[0].cmd).toBe(expectedToolId);
    const it = w.events(session);
    const first = await it.next();
    expect(first.value.kind).toBe(WorkerEventKind.PROGRESS);
    await w.stop(session);
  });

  it('start throws if CLI is unavailable / lane never readies', async () => {
    const Ctor = getCtor();
    await expect(new Ctor().start({ ctx: { terminalId: 'tA' }, exec: makeExec({ available: false }) }))
      .rejects.toThrow(/not available/);
    await expect(new Ctor().start({ ctx: { terminalId: 'tB' }, exec: makeExec({ ready: false }) }))
      .rejects.toThrow(/didn't become ready/);
  });

  it('events stream forwards status transitions', async () => {
    const Ctor = getCtor();
    const w = new Ctor();
    const exec = makeExec();
    const session = await w.start({ ctx: { terminalId: 'tC' }, exec });
    const kinds = [];
    const drain = (async () => {
      for await (const ev of w.events(session)) {
        kinds.push(ev.kind);
        if (kinds.length >= 2) break;
      }
    })();
    exec._sub.cb('tC', { agentName: expectedToolId, status: 'agent-approval' });
    await drain;
    expect(kinds).toContain(WorkerEventKind.DECISION);
    await w.stop(session);
  });
});

describe('workers/index registers the production workers', () => {
  it('registers claude / codex / gemini / fake', () => {
    // Re-require the bootstrap so it (re-)populates the registry after
    // the per-test reset.
    jest.isolateModules(() => {
      const bootstrap = require('../main/workers');
      const r = require('../main/workers/registry');
      // bootstrap re-uses the same singleton — it should now contain the
      // four built-ins.
      const names = bootstrap.listWorkers().sort();
      expect(names).toEqual(['claude', 'codex', 'fake', 'gemini']);
      expect(r.hasWorker('claude')).toBe(true);
    });
  });
});

describe('workerTypes enums', () => {
  it('Posture has the three values matching supervisor types.py', () => {
    expect(Posture.CAUTIOUS).toBe('cautious');
    expect(Posture.DEFAULT).toBe('default');
    expect(Posture.DANGEROUSLY_SKIP).toBe('dangerously_skip');
  });

  it('WorkerEventKind covers progress/tool_use/decision/done/error', () => {
    expect(Object.values(WorkerEventKind).sort()).toEqual(
      ['decision', 'done', 'error', 'progress', 'tool_use']
    );
  });
});
