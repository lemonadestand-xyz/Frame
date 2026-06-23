const critic = require('../main/supervisorCritic');
const runner = require('../main/supervisorClaudeRunner');

afterEach(() => runner.resetRunner());

describe('isTerminalMessage (bug #44 short-circuit)', () => {
  it('flags an outcome.md with a SUMMARY/VERDICT marker as terminal', () => {
    expect(critic.isTerminalMessage('SUMMARY: shipped X with tests', { finalEventSeen: true, toolUsesInLastN: 0 })).toBe(true);
    expect(critic.isTerminalMessage('VERDICT: pass — all green', { finalEventSeen: true, toolUsesInLastN: 0 })).toBe(true);
  });

  it('flags a markdown summary header as terminal', () => {
    expect(critic.isTerminalMessage('## T01 — shipped\n\ndetails', { finalEventSeen: true, toolUsesInLastN: 0 })).toBe(true);
  });

  it('rejects mid-conversation messages (tool calls in last N)', () => {
    expect(critic.isTerminalMessage('SUMMARY: …', { finalEventSeen: true, toolUsesInLastN: 3 })).toBe(false);
  });

  it('rejects when finalEventSeen is false', () => {
    expect(critic.isTerminalMessage('## anything', { finalEventSeen: false, toolUsesInLastN: 0 })).toBe(false);
  });
});

describe('critique', () => {
  it('short-circuits to passed on pure completion summary', async () => {
    // runner should not be called
    runner.setRunner(async () => { throw new Error('should not be called'); });
    const res = await critic.critique({
      task: { title: 'T01' },
      outcomeEntry: 'SUMMARY: shipped foo.js + tests',
      toolUsesInLastN: 0,
    });
    expect(res.passed).toBe(true);
    expect(res.category).toBe('summary_structure');
    expect(res.reasoning).toMatch(/short-circuit/);
  });

  it('fails on footprint violation regardless of LLM verdict', async () => {
    runner.setRunner(async () => ({ passed: true, issues: [], category: 'other', confidence: 1 }));
    const res = await critic.critique({
      task: { title: 'T02' },
      outcomeEntry: 'Some technical change report',
      footprintDeclared: ['src/main/foo.js'],
      filesActuallyChanged: ['src/main/foo.js', 'src/main/bar.js'],
      toolUsesInLastN: 5, // bypass terminal short-circuit
    });
    expect(res.passed).toBe(false);
    expect(res.category).toBe('footprint_violation');
    expect(res.issues[0]).toMatch(/bar\.js/);
  });

  it('demotes summary_structure-only failures to pass-with-warning', async () => {
    runner.setRunner(async () => ({
      passed: false,
      issues: ['summary wording is off'],
      category: 'summary_structure',
      confidence: 0.9,
    }));
    const res = await critic.critique({
      task: { title: 'T03' },
      outcomeEntry: 'Long body without completion markers but with detail.',
      toolUsesInLastN: 5,
    });
    expect(res.passed).toBe(true);
    expect(res.warnings.join('|')).toMatch(/summary structure/);
  });

  it('falls back to pass-with-warning when the runner throws', async () => {
    runner.setRunner(async () => { throw new Error('haiku unreachable'); });
    const res = await critic.critique({
      task: { title: 'T04' },
      outcomeEntry: 'plain prose with no markers',
      toolUsesInLastN: 5,
    });
    expect(res.passed).toBe(true);
    expect(res.warnings.length).toBeGreaterThan(0);
    expect(res.reasoning).toMatch(/critic runner failed/);
  });

  it('matches footprint globs', async () => {
    runner.setRunner(async () => ({ passed: true, category: 'other', confidence: 1 }));
    const res = await critic.critique({
      task: { title: 'T05' },
      outcomeEntry: 'no marker prose',
      footprintDeclared: ['src/main/foo/**'],
      filesActuallyChanged: ['src/main/foo/bar.js'],
      toolUsesInLastN: 5,
    });
    expect(res.passed).toBe(true);
  });
});
