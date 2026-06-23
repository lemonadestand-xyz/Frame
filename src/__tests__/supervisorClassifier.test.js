const classifier = require('../main/supervisorClassifier');
const runner = require('../main/supervisorClaudeRunner');

const LANE = { terminalId: 'frame-1' };

afterEach(() => runner.resetRunner());

describe('classifyNextStep — hard policy shortcuts', () => {
  it('returns the policy decision when fast-path fires (no LLM call)', async () => {
    runner.setRunner(async () => { throw new Error('should not be called'); });
    const verdict = await classifier.classifyNextStep({
      status: { phase: 'tasks_generated', slug: 's1' },
      tasks: [{ status: 'pending' }],
      lane: LANE,
    });
    expect(verdict.route).toBe('implement');
    expect(verdict.confidence).toBe(1.0);
  });

  it('uses LLM when policy returns null (no specific phase rule fired)', async () => {
    runner.setRunner(async () => ({
      route: 'implement', actionKind: 'implement_turn',
      reasoning: 'go', confidence: 0.9,
    }));
    // Use a phase the policy doesn't have a rule for — let's fake it by
    // passing an unknown phase value.
    const verdict = await classifier.classifyNextStep({
      status: { phase: 'unknown_phase', slug: 's1' },
      tasks: [], lane: LANE,
    });
    expect(verdict.route).toBe('implement');
    expect(verdict.confidence).toBe(0.9);
  });

  it('demotes low-confidence LLM verdict to escalate', async () => {
    runner.setRunner(async () => ({
      route: 'implement', actionKind: 'implement_turn',
      reasoning: 'maybe', confidence: 0.4,
    }));
    const verdict = await classifier.classifyNextStep({
      status: { phase: 'unknown_phase', slug: 's1' },
      tasks: [], lane: LANE,
    });
    expect(verdict.route).toBe('escalate');
    expect(verdict.actionKind).toBe('escalate_low_confidence');
  });

  it('returns escalate when the runner throws', async () => {
    runner.setRunner(async () => { throw new Error('haiku down'); });
    const verdict = await classifier.classifyNextStep({
      status: { phase: 'unknown_phase', slug: 's1' },
      tasks: [], lane: LANE,
    });
    expect(verdict.route).toBe('escalate');
    expect(verdict.actionKind).toBe('escalate_classify_failed');
  });
});

describe('classifyWithResearch', () => {
  it('re-classifies once after RESEARCH evidence comes back', async () => {
    let callCount = 0;
    runner.setRunner(async () => {
      callCount += 1;
      if (callCount === 1) {
        return { route: 'research', actionKind: 'research', reasoning: 'need ctx', confidence: 0.9 };
      }
      return { route: 'implement', actionKind: 'implement_turn', reasoning: 'have ctx', confidence: 0.9 };
    });
    const runCaps = async () => ([{ source: 'spec_reader', summary: 'context found', refs: ['x.md'], score: 0.8 }]);
    const verdict = await classifier.classifyWithResearch({
      status: { phase: 'unknown_phase', slug: 's1' }, tasks: [], lane: LANE,
    }, runCaps);
    expect(callCount).toBe(2);
    expect(verdict.route).toBe('implement');
  });
});
