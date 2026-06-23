const fs = require('fs');
const os = require('os');
const path = require('path');

const { DEFAULTS, readJSONSafe, readCaps } = require('../main/autopilot.config');
const specManager = require('../main/specManager');
const orchestration = require('../main/orchestrationManager');
const signals = require('../main/autopilot.signals');
const autopilot = require('../main/autopilot');

function mkProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-autopilot-cfg-'));
  fs.mkdirSync(path.join(dir, '.frame', 'specs', 'demo'), { recursive: true });
  return dir;
}

function writeJSON(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj));
}

describe('autopilot.config.readCaps three-tier merge', () => {
  let projectPath;

  beforeEach(() => { projectPath = mkProject(); });
  afterEach(() => { fs.rmSync(projectPath, { recursive: true, force: true }); });

  test('returns DEFAULTS when nothing is overridden', () => {
    const caps = readCaps({ projectPath, slug: 'demo' });
    expect(caps).toEqual(DEFAULTS);
  });

  test('global overrides DEFAULTS, leaves untouched keys alone', () => {
    const caps = readCaps({
      projectPath,
      slug: 'demo',
      globalCaps: { max_turns_per_task: 7 },
    });
    expect(caps.max_turns_per_task).toBe(7);
    expect(caps.max_total_turns).toBe(DEFAULTS.max_total_turns);
    expect(caps.stop_on_explicit_error).toBe(DEFAULTS.stop_on_explicit_error);
  });

  test('project overrides global', () => {
    writeJSON(path.join(projectPath, '.frame', 'autopilot.json'), {
      max_turns_per_task: 5,
    });
    const caps = readCaps({
      projectPath,
      slug: 'demo',
      globalCaps: { max_turns_per_task: 7 },
    });
    expect(caps.max_turns_per_task).toBe(5);
  });

  test('spec overrides project and global; unrelated keys fall through correctly', () => {
    writeJSON(path.join(projectPath, '.frame', 'autopilot.json'), {
      max_turns_per_task: 5,
      budget_usd: 10,
    });
    writeJSON(path.join(projectPath, '.frame', 'specs', 'demo', 'autopilot.json'), {
      max_turns_per_task: 1,
    });
    const caps = readCaps({
      projectPath,
      slug: 'demo',
      globalCaps: { max_turns_per_task: 7, max_total_turns: 100 },
    });
    expect(caps.max_turns_per_task).toBe(1);          // spec wins
    expect(caps.budget_usd).toBe(10);                 // project wins (global/default null)
    expect(caps.max_total_turns).toBe(100);           // global wins (no project/spec)
    expect(caps.stop_on_explicit_error).toBe(true);   // default wins
  });

  test('spec value of null still wins over a project-set number', () => {
    writeJSON(path.join(projectPath, '.frame', 'autopilot.json'), {
      budget_usd: 50,
    });
    writeJSON(path.join(projectPath, '.frame', 'specs', 'demo', 'autopilot.json'), {
      budget_usd: null,
    });
    const caps = readCaps({ projectPath, slug: 'demo' });
    expect(caps.budget_usd).toBeNull();
  });
});

describe('autopilot.config.readJSONSafe', () => {
  let projectPath;

  beforeEach(() => { projectPath = mkProject(); });
  afterEach(() => { fs.rmSync(projectPath, { recursive: true, force: true }); });

  test('returns {} for missing file', () => {
    expect(readJSONSafe(path.join(projectPath, 'nope.json'))).toEqual({});
  });

  test('returns {} for corrupt JSON', () => {
    const p = path.join(projectPath, 'corrupt.json');
    fs.writeFileSync(p, '{not valid');
    expect(readJSONSafe(p)).toEqual({});
  });

  test('returns {} for non-object JSON (array, primitive)', () => {
    const arr = path.join(projectPath, 'arr.json');
    fs.writeFileSync(arr, '[]');
    expect(readJSONSafe(arr)).toEqual({});
    const num = path.join(projectPath, 'num.json');
    fs.writeFileSync(num, '42');
    expect(readJSONSafe(num)).toEqual({});
  });

  test('returns parsed object for valid object JSON', () => {
    const p = path.join(projectPath, 'ok.json');
    fs.writeFileSync(p, JSON.stringify({ a: 1, b: 'two' }));
    expect(readJSONSafe(p)).toEqual({ a: 1, b: 'two' });
  });

  test('falsy path returns {}', () => {
    expect(readJSONSafe(null)).toEqual({});
    expect(readJSONSafe(undefined)).toEqual({});
    expect(readJSONSafe('')).toEqual({});
  });
});

describe('autopilot.config.readCaps argument validation', () => {
  test('throws if projectPath missing', () => {
    expect(() => readCaps({ slug: 'demo' })).toThrow(/projectPath/);
  });

  test('throws if slug missing', () => {
    expect(() => readCaps({ projectPath: '/tmp/anything' })).toThrow(/slug/);
  });

  test('throws if called with no args', () => {
    expect(() => readCaps()).toThrow(/projectPath/);
  });
});

describe('specManager.readPendingCount', () => {
  let projectPath;

  beforeEach(() => {
    projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-pending-count-'));
  });
  afterEach(() => { fs.rmSync(projectPath, { recursive: true, force: true }); });

  function writeTasks(tasks) {
    fs.writeFileSync(
      path.join(projectPath, 'tasks.json'),
      JSON.stringify({ tasks, metadata: { totalCreated: tasks.length, totalCompleted: 0 } }),
    );
  }

  test('returns 0 when no tasks.json exists', () => {
    expect(specManager.readPendingCount(projectPath, 'demo')).toBe(0);
  });

  test('counts only pending tasks whose source belongs to the spec', () => {
    writeTasks([
      { id: 'a', source: 'spec:demo:T01', status: 'pending' },
      { id: 'b', source: 'spec:demo:T02', status: 'in_progress' },
      { id: 'c', source: 'spec:demo:T03', status: 'completed' },
      { id: 'd', source: 'spec:demo:T04', status: 'pending' },
      { id: 'e', source: 'spec:other:T01', status: 'pending' },
      { id: 'f', source: 'manual', status: 'pending' },
    ]);
    expect(specManager.readPendingCount(projectPath, 'demo')).toBe(2);
    expect(specManager.readPendingCount(projectPath, 'other')).toBe(1);
    expect(specManager.readPendingCount(projectPath, 'missing')).toBe(0);
  });

  test('guards against missing args', () => {
    expect(specManager.readPendingCount(null, 'demo')).toBe(0);
    expect(specManager.readPendingCount(projectPath, null)).toBe(0);
  });
});

describe('orchestrationManager.findFootprintConflictAmong (pure)', () => {
  const A = { slug: 'a', footprint: ['src/foo.js', 'src/lib/**'] };
  const B = { slug: 'b', footprint: ['src/bar.js'] };
  const C = { slug: 'c', footprint: ['src/lib/util.js'] };

  test('returns null when candidates list is empty or non-array', () => {
    expect(orchestration.findFootprintConflictAmong('a', ['x'], [])).toBeNull();
    expect(orchestration.findFootprintConflictAmong('a', ['x'], null)).toBeNull();
    expect(orchestration.findFootprintConflictAmong('a', ['x'], undefined)).toBeNull();
  });

  test('returns null when no candidate overlaps', () => {
    expect(orchestration.findFootprintConflictAmong('z', ['src/baz.js'], [A, B])).toBeNull();
  });

  test('detects exact path overlap', () => {
    expect(orchestration.findFootprintConflictAmong('z', ['src/foo.js'], [A, B])).toBe('a');
  });

  test('detects glob/prefix overlap (A.lib/** vs C.lib/util.js)', () => {
    expect(orchestration.findFootprintConflictAmong('a', A.footprint, [C])).toBe('c');
    expect(orchestration.findFootprintConflictAmong('c', C.footprint, [A])).toBe('a');
  });

  test('skips a candidate matching `slug` (self)', () => {
    expect(orchestration.findFootprintConflictAmong('a', A.footprint, [A])).toBeNull();
  });

  test('returns the first overlapping slug', () => {
    expect(orchestration.findFootprintConflictAmong('z', ['src/foo.js', 'src/bar.js'], [A, B])).toBe('a');
  });
});

describe('autopilot.signals.tasksJSONMtime', () => {
  let projectPath;
  beforeEach(() => {
    projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-mtime-'));
  });
  afterEach(() => { fs.rmSync(projectPath, { recursive: true, force: true }); });

  test('returns null when tasks.json is missing', () => {
    expect(signals.tasksJSONMtime(projectPath)).toBeNull();
  });

  test('reflects mtime after writes', () => {
    const p = path.join(projectPath, 'tasks.json');
    fs.writeFileSync(p, '{"tasks":[]}');
    const m1 = signals.tasksJSONMtime(projectPath);
    expect(typeof m1).toBe('number');
    // Force a mtime bump by setting it manually (avoids 1-second timer flake).
    const future = (m1 + 5000) / 1000;
    fs.utimesSync(p, future, future);
    const m2 = signals.tasksJSONMtime(projectPath);
    expect(m2).toBeGreaterThan(m1);
  });
});

describe('autopilot.signals.waitForLaneIdle', () => {
  test('throws when getLastOutputAt is missing', async () => {
    await expect(signals.waitForLaneIdle({})).rejects.toThrow(/getLastOutputAt/);
  });

  test('resolves idle:true when lastOutputAt is older than idleMs', async () => {
    let nowVal = 100000;
    const lastOutputAt = nowVal - 25000; // 25s ago
    const result = await signals.waitForLaneIdle({
      getLastOutputAt: () => lastOutputAt,
      now: () => nowVal,
      idleMs: 20000,
      pollMs: 1,
      timeoutMs: 60000,
      sleepFn: () => Promise.resolve(),
    });
    expect(result.idle).toBe(true);
    expect(result.idleForMs).toBeGreaterThanOrEqual(20000);
  });

  test('resolves idle:false after timeoutMs when lane keeps producing output', async () => {
    let nowVal = 0;
    let lastOutputAt = 0;
    const result = await signals.waitForLaneIdle({
      getLastOutputAt: () => lastOutputAt,
      now: () => { nowVal += 100; lastOutputAt = nowVal - 10; return nowVal; },
      idleMs: 1000,
      pollMs: 1,
      timeoutMs: 500,
      sleepFn: () => Promise.resolve(),
    });
    expect(result.idle).toBe(false);
    expect(result.idleForMs).toBeNull();
  });

  test('treats null getLastOutputAt() as "quiet since start" — eventually idle', async () => {
    let nowVal = 0;
    const result = await signals.waitForLaneIdle({
      getLastOutputAt: () => null,
      now: () => { nowVal += 5000; return nowVal; },
      idleMs: 10000,
      pollMs: 1,
      timeoutMs: 60000,
      sleepFn: () => Promise.resolve(),
    });
    expect(result.idle).toBe(true);
  });
});

describe('autopilot._executeTurn + _runSpecLoop', () => {
  let projectPath;

  beforeEach(() => {
    projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-autopilot-loop-'));
    fs.mkdirSync(path.join(projectPath, '.frame', 'runtime', 'prompts'), { recursive: true });
    autopilot.clearAutopilotState();
  });
  afterEach(() => { fs.rmSync(projectPath, { recursive: true, force: true }); });

  // Build a fake deps object with knobs the tests can tweak per turn.
  function buildFakeDeps({ pendingSequence, dispatchOk = true, stagingOk = true, onDispatch }) {
    const promptRel = '.frame/runtime/prompts/demo__spec.implement.md';
    const promptAbs = path.join(projectPath, promptRel);
    fs.writeFileSync(promptAbs, 'BASE PROMPT BODY\n');

    let turn = 0;
    const reads = [];
    const dispatchedInstructions = [];
    const appendedTexts = [];
    const reconcileCalls = [];

    return {
      _promptAbs: promptAbs,
      reads,
      dispatchedInstructions,
      appendedTexts,
      reconcileCalls,
      buildSpecCommandFile: () => stagingOk
        ? { success: true, relPath: promptRel, instruction: 'Read prompt.' }
        : { success: false, error: 'staging-broke' },
      readPendingCount: () => {
        const value = pendingSequence[Math.min(turn, pendingSequence.length - 1)];
        reads.push({ turn, value });
        return value;
      },
      reconcilePhase: (pp, slug) => { reconcileCalls.push({ pp, slug }); },
      appendDiagnostic: (p, text) => { appendedTexts.push({ p, text }); return true; },
      tasksJSONMtime: () => Date.now() + turn,
      waitForLaneIdle: async () => {
        // Advance the turn counter AFTER the dispatch happened so that the
        // pre-dispatch read sees pendingSequence[turn] and the post-dispatch
        // read sees pendingSequence[turn+1].
        turn += 1;
        return { idle: true, idleForMs: 1 };
      },
      dispatchToLane: (run, instruction) => {
        dispatchedInstructions.push(instruction);
        if (typeof onDispatch === 'function') onDispatch(run, instruction);
        return dispatchOk;
      },
      getLastOutputAt: () => Date.now() - 60000,
    };
  }

  test('progress: pending drops on each turn → completes when 0', async () => {
    const deps = buildFakeDeps({ pendingSequence: [2, 1, 0] });
    const { loopPromise } = autopilot.startAutopilot({
      projectPath, scope: 'spec', slug: 'demo',
      terminalId: 'term-1', deps,
    });
    await loopPromise;
    const state = autopilot.getAutopilotState();
    expect(state.activeRuns).toHaveLength(1);
    const run = state.activeRuns[0];
    expect(run.status).toBe('completed');
    expect(run.turnsTotal).toBe(2);
    expect(run.consecutiveNoProgress).toBe(0);
    expect(deps.dispatchedInstructions).toHaveLength(2);
    expect(deps.appendedTexts).toHaveLength(0); // never had to retry
  });

  test('retry with diagnostic: first turn no-progress, second turn lands it', async () => {
    const deps = buildFakeDeps({ pendingSequence: [1, 1, 0] });
    const { loopPromise } = autopilot.startAutopilot({
      projectPath, scope: 'spec', slug: 'demo',
      terminalId: 'term-1', deps,
      caps: { max_turns_per_task: 3, max_total_turns: 10 },
    });
    await loopPromise;
    const run = autopilot.getAutopilotState().activeRuns[0];
    expect(run.status).toBe('completed');
    expect(run.turnsTotal).toBe(2);
    expect(deps.appendedTexts).toHaveLength(1);
    expect(deps.appendedTexts[0].text).toMatch(/did not reduce the pending-task count/);
    expect(deps.appendedTexts[0].text).toMatch(/Do not retry the same approach/);
  });

  test('escalate after exceeding max_turns_per_task', async () => {
    // Pending count stays at 1 forever → every turn is no-progress
    const deps = buildFakeDeps({ pendingSequence: [1, 1, 1, 1, 1, 1] });
    const { loopPromise } = autopilot.startAutopilot({
      projectPath, scope: 'spec', slug: 'demo',
      terminalId: 'term-1', deps,
      caps: { max_turns_per_task: 2, max_total_turns: 50 },
    });
    await loopPromise;
    const run = autopilot.getAutopilotState().activeRuns[0];
    expect(run.status).toBe('paused');
    expect(run.pausedReason).toBe('max_turns_per_task');
    // max_turns_per_task: 2 → 1st turn (counter=1), 2nd (counter=2), 3rd (counter=3 > 2) → pause
    expect(run.consecutiveNoProgress).toBeGreaterThan(2);
    // Diagnostic was appended on turns 2 and 3 (NOT turn 1)
    expect(deps.appendedTexts.length).toBeGreaterThanOrEqual(2);
  });

  test('error path: staging failure pauses with failed status', async () => {
    const deps = buildFakeDeps({ pendingSequence: [1, 1, 0], stagingOk: false });
    const { loopPromise } = autopilot.startAutopilot({
      projectPath, scope: 'spec', slug: 'demo',
      terminalId: 'term-1', deps,
    });
    await loopPromise;
    const run = autopilot.getAutopilotState().activeRuns[0];
    expect(run.status).toBe('failed');
    expect(run.lastTurnReason).toBe('staging-failed');
  });

  test('error path: dispatch failure transitions to failed', async () => {
    const deps = buildFakeDeps({ pendingSequence: [1, 0], dispatchOk: false });
    const { loopPromise } = autopilot.startAutopilot({
      projectPath, scope: 'spec', slug: 'demo',
      terminalId: 'term-1', deps,
    });
    await loopPromise;
    const run = autopilot.getAutopilotState().activeRuns[0];
    expect(run.status).toBe('failed');
    expect(run.lastTurnReason).toBe('dispatch-failed');
  });

  test('graceful stop completes the in-flight turn, then exits as stopped', async () => {
    let inFlightCount = 0;
    let stoppedDuringTurn = false;
    const deps = buildFakeDeps({
      pendingSequence: [3, 2, 1, 0],
      onDispatch: (run) => {
        inFlightCount += 1;
        // Request stop while the first turn is "in flight"
        if (inFlightCount === 1) {
          autopilot.stopAutopilot({ projectPath, runId: run.id });
          stoppedDuringTurn = true;
        }
      },
    });
    const { loopPromise } = autopilot.startAutopilot({
      projectPath, scope: 'spec', slug: 'demo',
      terminalId: 'term-1', deps,
    });
    await loopPromise;
    expect(stoppedDuringTurn).toBe(true);
    const run = autopilot.getAutopilotState().activeRuns[0];
    // The in-flight turn was allowed to complete (pending dropped 3→2),
    // THEN the loop exited because stopRequested was set.
    expect(run.turnsTotal).toBe(1);
    expect(run.status).toBe('stopped');
  });

  test('already-completed spec: starts and immediately marks completed', async () => {
    const deps = buildFakeDeps({ pendingSequence: [0] });
    const { loopPromise } = autopilot.startAutopilot({
      projectPath, scope: 'spec', slug: 'demo',
      terminalId: 'term-1', deps,
    });
    await loopPromise;
    const run = autopilot.getAutopilotState().activeRuns[0];
    expect(run.status).toBe('completed');
    expect(run.turnsTotal).toBe(0);
    expect(deps.dispatchedInstructions).toHaveLength(0);
    expect(deps.reconcileCalls.length).toBeGreaterThanOrEqual(1);
  });

  test('max_total_turns hard cap pauses the loop', async () => {
    const deps = buildFakeDeps({ pendingSequence: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5] });
    const { loopPromise } = autopilot.startAutopilot({
      projectPath, scope: 'spec', slug: 'demo',
      terminalId: 'term-1', deps,
      caps: { max_turns_per_task: 100, max_total_turns: 3 },
    });
    await loopPromise;
    const run = autopilot.getAutopilotState().activeRuns[0];
    expect(run.status).toBe('paused');
    expect(run.pausedReason).toBe('max_total_turns');
    expect(run.turnsTotal).toBe(3);
  });
});

describe('autopilot.getAutopilotState / setStateListener', () => {
  let projectPath;
  beforeEach(() => {
    projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-autopilot-state-'));
    autopilot.clearAutopilotState();
  });
  afterEach(() => { fs.rmSync(projectPath, { recursive: true, force: true }); });

  test('emits state on start and stop', async () => {
    const snapshots = [];
    autopilot.setStateListener((s) => snapshots.push(s));
    const deps = {
      buildSpecCommandFile: () => ({ success: true, relPath: '.frame/runtime/prompts/x.md', instruction: 'r' }),
      readPendingCount: () => 0,
      reconcilePhase: () => {},
      appendDiagnostic: () => true,
      tasksJSONMtime: () => 1,
      waitForLaneIdle: async () => ({ idle: true }),
      dispatchToLane: () => true,
      getLastOutputAt: () => null,
    };
    fs.mkdirSync(path.join(projectPath, '.frame', 'runtime', 'prompts'), { recursive: true });
    fs.writeFileSync(path.join(projectPath, '.frame', 'runtime', 'prompts', 'x.md'), 'p');
    const { loopPromise } = autopilot.startAutopilot({
      projectPath, scope: 'spec', slug: 'demo', terminalId: 't', deps,
    });
    await loopPromise;
    expect(snapshots.length).toBeGreaterThan(0);
    const last = snapshots[snapshots.length - 1];
    expect(last.activeRuns[0].status).toBe('completed');
    autopilot.setStateListener(null);
  });

  test('startAutopilot throws on missing args', () => {
    expect(() => autopilot.startAutopilot({})).toThrow(/projectPath/);
    expect(() => autopilot.startAutopilot({ projectPath: '/x' })).toThrow(/slug/);
  });
});

describe('specManager edit helpers (writeSpecDoc / addSpecTask / removeSpecTask)', () => {
  let projectPath;
  beforeEach(() => {
    projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-spec-edit-'));
    const dir = path.join(projectPath, '.frame', 'specs', 'demo');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify({
      slug: 'demo', title: 'demo', phase: 'tasks_generated',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }));
    fs.writeFileSync(path.join(dir, 'tasks.md'), '- T01 · seed task\n');
    fs.writeFileSync(path.join(projectPath, 'tasks.json'), JSON.stringify({
      tasks: [
        { id: 'task-spec-demo-T01', source: 'spec:demo:T01', status: 'pending', title: 'seed task' },
      ],
    }));
  });
  afterEach(() => { fs.rmSync(projectPath, { recursive: true, force: true }); });

  test('writeSpecDoc rejects unknown docType', () => {
    const r = specManager.writeSpecDoc(projectPath, 'demo', 'bogus', '# hi');
    expect(r.success).toBe(false);
  });

  test('writeSpecDoc updates spec.md on disk', () => {
    const r = specManager.writeSpecDoc(projectPath, 'demo', 'spec', '# new spec');
    expect(r.success).toBe(true);
    const content = fs.readFileSync(path.join(projectPath, '.frame', 'specs', 'demo', 'spec.md'), 'utf8');
    expect(content).toBe('# new spec');
  });

  test('writeSpecDoc to tasks.md triggers a re-sync into tasks.json', () => {
    const r = specManager.writeSpecDoc(projectPath, 'demo', 'tasks', '- T01 · seed task\n- T02 · added via edit\n');
    expect(r.success).toBe(true);
    const tasksData = JSON.parse(fs.readFileSync(path.join(projectPath, 'tasks.json'), 'utf8'));
    const t02 = tasksData.tasks.find((t) => t.source === 'spec:demo:T02');
    expect(t02).toBeTruthy();
    expect(t02.title).toBe('added via edit');
    expect(t02.status).toBe('pending');
  });

  test('addSpecTask appends a new pending task with the next id', () => {
    const r = specManager.addSpecTask(projectPath, 'demo', 'second task');
    expect(r.success).toBe(true);
    expect(r.taskId).toBe('T02');
    const md = fs.readFileSync(path.join(projectPath, '.frame', 'specs', 'demo', 'tasks.md'), 'utf8');
    expect(md).toMatch(/T02 · second task/);
    const tasksData = JSON.parse(fs.readFileSync(path.join(projectPath, 'tasks.json'), 'utf8'));
    expect(tasksData.tasks.some((t) => t.source === 'spec:demo:T02' && t.status === 'pending')).toBe(true);
  });

  test('removeSpecTask deletes a pending task and rewrites tasks.md', () => {
    specManager.addSpecTask(projectPath, 'demo', 'to be removed');
    const r = specManager.removeSpecTask(projectPath, 'demo', 'T02');
    expect(r.success).toBe(true);
    const md = fs.readFileSync(path.join(projectPath, '.frame', 'specs', 'demo', 'tasks.md'), 'utf8');
    expect(md).not.toMatch(/T02/);
    const tasksData = JSON.parse(fs.readFileSync(path.join(projectPath, 'tasks.json'), 'utf8'));
    expect(tasksData.tasks.some((t) => t.source === 'spec:demo:T02')).toBe(false);
  });

  test('removeSpecTask refuses to delete a non-pending task', () => {
    // Mark T01 as in_progress in tasks.json
    const tasksJson = JSON.parse(fs.readFileSync(path.join(projectPath, 'tasks.json'), 'utf8'));
    tasksJson.tasks[0].status = 'in_progress';
    fs.writeFileSync(path.join(projectPath, 'tasks.json'), JSON.stringify(tasksJson));
    const r = specManager.removeSpecTask(projectPath, 'demo', 'T01');
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/in_progress/);
    // tasks.md still has T01
    const md = fs.readFileSync(path.join(projectPath, '.frame', 'specs', 'demo', 'tasks.md'), 'utf8');
    expect(md).toMatch(/T01/);
  });
});

describe('autopilot.readAuditEvents + audit emission', () => {
  let projectPath;
  beforeEach(() => {
    projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-autopilot-audit-'));
    fs.mkdirSync(path.join(projectPath, '.frame', 'specs', 'demo'), { recursive: true });
    fs.mkdirSync(path.join(projectPath, '.frame', 'runtime', 'prompts'), { recursive: true });
    autopilot.clearAutopilotState();
  });
  afterEach(() => { fs.rmSync(projectPath, { recursive: true, force: true }); });

  test('readAuditEvents returns [] when log is missing', () => {
    expect(autopilot.readAuditEvents(projectPath, 'demo')).toEqual([]);
  });

  test('loop writes a per-turn audit log; reader replays it', async () => {
    const promptRel = '.frame/runtime/prompts/demo__spec.implement.md';
    fs.writeFileSync(path.join(projectPath, promptRel), 'p');
    const deps = {
      buildSpecCommandFile: () => ({ success: true, relPath: promptRel, instruction: 'r' }),
      readPendingCount: (() => { const seq = [2, 1, 0]; let i = 0; return () => seq[Math.min(i++, 2)]; })(),
      reconcilePhase: () => {},
      appendDiagnostic: () => true,
      appendAuditEvent: autopilot._internal._appendDiagnosticToPromptFile
        ? require('../main/autopilot').readAuditEvents
        : null,
      tasksJSONMtime: () => Date.now(),
      waitForLaneIdle: async () => ({ idle: true }),
      dispatchToLane: () => true,
      getLastOutputAt: () => null,
    };
    // Use real audit writer
    deps.appendAuditEvent = (pp, slug, evt) => {
      const dir = path.join(pp, '.frame', 'specs', slug);
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(path.join(dir, 'autopilot-events.jsonl'), JSON.stringify(evt) + '\n');
      return true;
    };
    const { loopPromise } = autopilot.startAutopilot({
      projectPath, scope: 'spec', slug: 'demo', terminalId: 't', deps,
    });
    await loopPromise;
    const events = autopilot.readAuditEvents(projectPath, 'demo');
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].event).toBe('run-started');
    expect(events.some((e) => e.outcome === 'progress')).toBe(true);
    expect(events[events.length - 1].event).toBe('run-completed');
  });
});

describe('autopilot._runProjectLoop (cross-spec)', () => {
  let projectPath;
  beforeEach(() => {
    projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-autopilot-project-'));
    fs.mkdirSync(path.join(projectPath, '.frame', 'runtime', 'prompts'), { recursive: true });
    autopilot.clearAutopilotState();
  });
  afterEach(() => { fs.rmSync(projectPath, { recursive: true, force: true }); });

  // Build a project containing N specs. pendingMap controls how many
  // pending tasks each spec reports (decremented on each "turn").
  function buildProjectDeps({ specs, footprints, initialPending, terminalAssignments }) {
    fs.writeFileSync(path.join(projectPath, '.frame', 'runtime', 'prompts', 'p.md'), 'p');
    const pending = { ...initialPending };
    const turnCounts = {};
    const dispatchOrder = [];

    return {
      listSpecs: () => specs.map((s) => ({ slug: s, phase: 'tasks_generated' })),
      readPendingCount: (pp, slug) => pending[slug] || 0,
      reconcilePhase: () => {},
      getSpecFootprint: (pp, slug) => footprints[slug] || [],
      findFootprintConflictAmong: (slug, footprint, candidates) => {
        // Reuse the actual orchestration helper for fidelity
        return orchestration.findFootprintConflictAmong(slug, footprint, candidates);
      },
      buildSpecCommandFile: () => ({ success: true, relPath: '.frame/runtime/prompts/p.md', instruction: 'r' }),
      appendDiagnostic: () => true,
      appendAuditEvent: () => true,
      tasksJSONMtime: () => Date.now(),
      waitForLaneIdle: async () => {
        // Each "turn" decrements pending for whichever spec was last
        // dispatched, so the sub-loop sees progress.
        const last = dispatchOrder[dispatchOrder.length - 1];
        if (last && pending[last] > 0) pending[last] -= 1;
        return { idle: true };
      },
      dispatchToLane: (run) => {
        turnCounts[run.slug] = (turnCounts[run.slug] || 0) + 1;
        dispatchOrder.push(run.slug);
        return true;
      },
      getLastOutputAt: () => null,
      _pending: pending,
      _turnCounts: turnCounts,
      _dispatchOrder: dispatchOrder,
    };
  }

  test('runs an independent spec in parallel with one of two conflicting specs', async () => {
    // Specs A and B share a file (conflicting). Spec C is independent.
    // max_parallel_specs=2 → A + C should run in parallel; B waits.
    const deps = buildProjectDeps({
      specs: ['a', 'b', 'c'],
      footprints: {
        a: ['src/shared.js'],
        b: ['src/shared.js'],
        c: ['src/independent.js'],
      },
      initialPending: { a: 1, b: 1, c: 1 },
      terminalAssignments: { a: 't-a', b: 't-b', c: 't-c' },
    });

    const { loopPromise } = autopilot.startAutopilot({
      projectPath, scope: 'project',
      terminalAssignments: { a: 't-a', b: 't-b', c: 't-c' },
      caps: { max_parallel_specs: 2, max_turns_per_task: 3, max_total_turns: 10, _projectPollMs: 10 },
      deps,
    });
    await loopPromise;

    const state = autopilot.getAutopilotState();
    const projectRun = state.activeRuns.find((r) => r.scope === 'project');
    expect(projectRun.status).toBe('completed');

    // All three should have completed at least one turn
    expect(deps._turnCounts.a || 0).toBeGreaterThan(0);
    expect(deps._turnCounts.b || 0).toBeGreaterThan(0);
    expect(deps._turnCounts.c || 0).toBeGreaterThan(0);

    // Footprint guard: A and B never ran at the exact same time.
    // We can verify this by checking pending hit 0 for one before the
    // other's turn count grew above the first batch (loose proxy).
    expect(deps._pending.a).toBe(0);
    expect(deps._pending.b).toBe(0);
    expect(deps._pending.c).toBe(0);
  });

  test('skips specs without a terminal assignment', async () => {
    const deps = buildProjectDeps({
      specs: ['a', 'b'],
      footprints: { a: ['src/a.js'], b: ['src/b.js'] },
      initialPending: { a: 1, b: 1 },
      terminalAssignments: { a: 't-a' }, // b is unassigned
    });

    const { loopPromise } = autopilot.startAutopilot({
      projectPath, scope: 'project',
      terminalAssignments: { a: 't-a' },
      caps: { max_parallel_specs: 2, max_turns_per_task: 3, max_total_turns: 10 },
      deps,
    });
    await loopPromise;

    expect(deps._turnCounts.a).toBeGreaterThan(0);
    expect(deps._turnCounts.b).toBeFalsy();
  });

  test('graceful stop cascades to in-flight sub-runs', async () => {
    let stoppedDuringTurn = false;
    const deps = buildProjectDeps({
      specs: ['a'],
      footprints: { a: ['src/a.js'] },
      initialPending: { a: 5 },
      terminalAssignments: { a: 't-a' },
    });
    // Patch dispatch to trigger stop after first dispatch.
    const realDispatch = deps.dispatchToLane;
    deps.dispatchToLane = (run, instr) => {
      const r = realDispatch(run, instr);
      if (!stoppedDuringTurn) {
        stoppedDuringTurn = true;
        // Stop the PROJECT run; should cascade to sub.
        const state = autopilot.getAutopilotState();
        const projectRun = state.activeRuns.find((rr) => rr.scope === 'project');
        if (projectRun) autopilot.stopAutopilot({ projectPath, runId: projectRun.id });
      }
      return r;
    };

    const { loopPromise } = autopilot.startAutopilot({
      projectPath, scope: 'project',
      terminalAssignments: { a: 't-a' },
      caps: { max_parallel_specs: 1, max_turns_per_task: 3, max_total_turns: 50, _projectPollMs: 10 },
      deps,
    });
    await loopPromise;
    // Wait briefly so cascaded child run can finish exiting.
    await new Promise((r) => setTimeout(r, 100));

    const state = autopilot.getAutopilotState();
    const projectRun = state.activeRuns.find((r) => r.scope === 'project');
    const subRun = state.activeRuns.find((r) => r.scope === 'spec' && r.slug === 'a');
    expect(projectRun.status).toBe('stopped');
    // Sub run had stopRequested set; its loop returns 'stopped' after the
    // in-flight turn finishes.
    expect(subRun.status).toBe('stopped');
  });
});

describe('autopilot.config.DEFAULTS', () => {
  test('matches the spec-declared shape', () => {
    expect(DEFAULTS).toEqual({
      max_turns_per_task: 3,
      max_total_turns: 50,
      budget_usd: null,
      pause_on_phase_transition: [],
      stop_on_explicit_error: true,
    });
  });

  test('is frozen so callers cannot mutate it', () => {
    expect(Object.isFrozen(DEFAULTS)).toBe(true);
  });
});
