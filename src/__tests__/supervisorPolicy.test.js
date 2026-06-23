const { decideFastPath, _hasUnansweredQuestion } = require('../main/supervisorPolicy');

const LANE = { terminalId: 'frame-1' };

describe('decideFastPath — stop conditions', () => {
  it('returns done when phase===done', () => {
    expect(decideFastPath({ status: { phase: 'done' } })).toEqual({ route: 'done' });
  });

  it('returns paused when user paused', () => {
    expect(decideFastPath({ status: { phase: 'implementing' }, userPaused: true }))
      .toEqual({ route: 'paused', reason: 'user_paused' });
  });

  it('returns wait on footprint conflict', () => {
    expect(decideFastPath({
      status: { phase: 'implementing' }, footprintConflict: true, lane: LANE,
    })).toEqual({ route: 'wait', reason: 'footprint_conflict' });
  });
});

describe('decideFastPath — phase-specific', () => {
  it('waits when no lane is attached', () => {
    expect(decideFastPath({ status: { phase: 'specified' } })).toEqual({
      route: 'wait', reason: 'no_lane_attached',
    });
  });

  it('implements when tasks_generated with undone tasks', () => {
    const tasks = [{ status: 'pending' }, { status: 'completed' }];
    const out = decideFastPath({
      status: { phase: 'tasks_generated' }, tasks, lane: LANE,
    });
    expect(out.route).toBe('implement');
    expect(out.actionKind).toBe('implement_turn');
  });

  it('implements when in_progress tasks remain (in_progress counts as undone)', () => {
    const tasks = [{ status: 'in_progress' }, { status: 'completed' }];
    expect(decideFastPath({ status: { phase: 'implementing' }, tasks, lane: LANE }).route).toBe('implement');
  });

  it('runs critic when undone reaches zero', () => {
    const tasks = [{ status: 'completed' }, { status: 'completed' }];
    expect(decideFastPath({ status: { phase: 'implementing' }, tasks, lane: LANE }).route).toBe('critic');
  });

  it('escalates on specified with open unanswered question', () => {
    const specBody = '## Open Questions\n1. Should we adopt foo?';
    const out = decideFastPath({ status: { phase: 'specified' }, lane: LANE, specBody });
    expect(out.route).toBe('escalate');
    expect(out.category).toBe('scope');
  });

  it('advances on specified when no open questions', () => {
    const out = decideFastPath({ status: { phase: 'specified' }, lane: LANE, specBody: '## Goal\n…' });
    expect(out).toEqual({ route: 'advance', actionKind: 'advance_phase', nextPhase: 'planned' });
  });

  it('escalates on planned without footprint block', () => {
    const out = decideFastPath({ status: { phase: 'planned' }, lane: LANE, planBody: '## Architecture\n…' });
    expect(out.route).toBe('escalate');
  });

  it('advances on planned with footprint', () => {
    const planBody = '## Architecture\n…\n## Footprint\n- src/foo.js';
    expect(decideFastPath({ status: { phase: 'planned' }, lane: LANE, planBody }).nextPhase).toBe('tasks_generated');
  });

  it('escalates on draft', () => {
    expect(decideFastPath({ status: { phase: 'draft' }, lane: LANE }).route).toBe('escalate');
  });
});

describe('_hasUnansweredQuestion', () => {
  it('detects unanswered questions in an Open Questions section', () => {
    expect(_hasUnansweredQuestion(
      '## Open Questions\n1. Should X happen?\n2. Should Y happen?'
    )).toBe(true);
  });

  it('returns false when every question has an answer below', () => {
    expect(_hasUnansweredQuestion(
      '## Open Questions\n1. **Should X?** \n   Working stance: yes.\n2. **Should Y?**\n   Answer: no.'
    )).toBe(false);
  });
});
