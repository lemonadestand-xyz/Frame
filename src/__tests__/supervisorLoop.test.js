const fs = require('fs');
const os = require('os');
const path = require('path');
const { SupervisorLoop } = require('../main/supervisorLoop');
const runner = require('../main/supervisorClaudeRunner');

function tmpProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-suploop-'));
  fs.mkdirSync(path.join(root, '.frame', 'specs', 'demo'), { recursive: true });
  return root;
}

const LANE = { terminalId: 'frame-1' };

afterEach(() => runner.resetRunner());

function makeExecutors(initial) {
  const state = { ...initial };
  return {
    state,
    readStatus: async () => ({ ...state.status, slug: 'demo' }),
    readTasks: async () => state.tasks.slice(),
    readLane: async () => state.lane,
    readDoc: async (_p, _s, doc) => state.docs[doc] || '',
    readRecentAudit: async () => [],
    readProfile: async () => ({ id: 'demo' }),
    presentEscalation: async (esc) => { state.escalations.push(esc); return { answer: 'ok' }; },
    advancePhase: async (_p, _s, next) => { state.status.phase = next; },
    implementNextTurn: async () => {
      const t = state.tasks.find((t) => t.status === 'pending' || t.status === 'in_progress');
      if (t) t.status = 'completed';
    },
    readLastOutcomeEntry: async () => 'SUMMARY: shipped foo',
    readFootprint: async () => [],
    readChangedFiles: async () => [],
    markDone: async () => { state.status.phase = 'done'; },
  };
}

describe('SupervisorLoop — end-to-end on FakeWorker analogue', () => {
  it('drives a spec from specified → planned → tasks_generated → implementing → done', async () => {
    const projectPath = tmpProject();
    const tasks = [
      { id: 'T01', status: 'pending', source: 'spec:demo:T01' },
      { id: 'T02', status: 'pending', source: 'spec:demo:T02' },
    ];
    const initial = {
      status: { phase: 'specified', slug: 'demo' },
      tasks,
      lane: LANE,
      docs: {
        'spec.md': '# Demo\n\n## Goal\nShip it.\n',
        'plan.md': '## Architecture\nfoo\n## Footprint\n- src/foo.js\n',
      },
      escalations: [],
    };
    const ex = makeExecutors(initial);
    // Bypass the policy fast-path's auto-advance by making each phase the
    // policy can handle. The fast path drives: specified → planned, planned
    // → tasks_generated, tasks_generated → implement, then critic → done.

    const loop = new SupervisorLoop({
      projectPath, slug: 'demo', executors: ex,
      tickIntervalMs: 1, maxTotalTicks: 30,
    });
    await loop.start();
    // Drain ticks
    const start = Date.now();
    while (loop.getState().status === 'running' && Date.now() - start < 4000) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(loop.getState().status).toBe('completed');
    expect(ex.state.status.phase).toBe('done');
    expect(ex.state.tasks.every((t) => t.status === 'completed')).toBe(true);
    // Audit JSONL exists
    const audit = fs.readFileSync(path.join(projectPath, '.frame', 'specs', 'demo', 'supervisor-audit.jsonl'), 'utf8');
    expect(audit.split('\n').filter(Boolean).length).toBeGreaterThan(0);
  });

  it('escalates when spec.md has unanswered open questions', async () => {
    const projectPath = tmpProject();
    const initial = {
      status: { phase: 'specified', slug: 'demo' },
      tasks: [],
      lane: LANE,
      docs: {
        'spec.md': '## Open Questions\n1. Should X happen?\n',
        'plan.md': '',
      },
      escalations: [],
    };
    const ex = makeExecutors(initial);
    const loop = new SupervisorLoop({
      projectPath, slug: 'demo', executors: ex,
      tickIntervalMs: 1, maxTotalTicks: 5,
    });
    await loop.start();
    // After the first tick we should see an escalation surfaced.
    const start = Date.now();
    while (ex.state.escalations.length === 0 && Date.now() - start < 1000) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(ex.state.escalations.length).toBeGreaterThan(0);
    expect(ex.state.escalations[0].category).toBe('scope');
    await loop.stop();
  });

  it('graceful stop halts before the next dispatch', async () => {
    const projectPath = tmpProject();
    let implCalls = 0;
    const ex = {
      readStatus: async () => ({ phase: 'tasks_generated', slug: 'demo' }),
      readTasks: async () => [{ id: 'T01', status: 'pending', source: 'spec:demo:T01' }],
      readLane: async () => LANE,
      readDoc: async () => '',
      readRecentAudit: async () => [],
      readProfile: async () => ({ id: 'demo' }),
      implementNextTurn: async () => { implCalls += 1; },
    };
    const loop = new SupervisorLoop({
      projectPath, slug: 'demo', executors: ex,
      tickIntervalMs: 50, maxTotalTicks: 5,
    });
    await loop.start();
    await new Promise((r) => setTimeout(r, 30));
    await loop.stop();
    const calls = implCalls;
    await new Promise((r) => setTimeout(r, 150));
    expect(implCalls).toBe(calls); // no new dispatches after stop
    expect(loop.getState().status).toBe('paused');
  });
});
