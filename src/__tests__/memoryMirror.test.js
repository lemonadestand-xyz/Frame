const fs = require('fs');
const os = require('os');
const path = require('path');
const { recordDurableDecision, isDurableCategory } = require('../main/memoryMirror');
const memory = require('../main/memory');

function tmpProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-mirror-project-'));
  fs.mkdirSync(path.join(root, '.frame'), { recursive: true });
  return root;
}

// Force HOME to a tmp dir so the mirror writes don't touch the user's real memory.
const ORIG_HOME = process.env.HOME;
let tmpHome;
beforeAll(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-mirror-home-'));
  process.env.HOME = tmpHome;
});
afterAll(() => {
  process.env.HOME = ORIG_HOME;
});

describe('memoryMirror.isDurableCategory', () => {
  it('accepts the default durable categories', () => {
    expect(isDurableCategory('dependency', {})).toBe(true);
    expect(isDurableCategory('schema', {})).toBe(true);
    expect(isDurableCategory('security', {})).toBe(true);
  });

  it('rejects non-durable categories', () => {
    expect(isDurableCategory('naming', {})).toBe(false);
    expect(isDurableCategory('formatting', {})).toBe(false);
    expect(isDurableCategory(null, {})).toBe(false);
  });

  it('respects a profile override of durable_categories', () => {
    expect(isDurableCategory('naming', { memory_mirror: { durable_categories: ['naming'] } })).toBe(true);
    expect(isDurableCategory('schema', { memory_mirror: { durable_categories: ['naming'] } })).toBe(false);
  });
});

describe('memoryMirror.recordDurableDecision', () => {
  it('writes a decisions/<slug>-<task>-<ts>.md note for durable categories', async () => {
    const projectPath = tmpProject();
    const res = await recordDurableDecision(projectPath, {
      category: 'dependency',
      spec_slug: 'frame-supervisor-loop',
      task_id: 'T05',
      draftedQuestion: 'Should we adopt react 19?',
      answer: 'Yes — feature flag for 4 weeks.',
      reasoning: 'Aligns with the existing migration plan.',
      confidence: 0.82,
      route: 'escalate',
    });
    expect(res.written).toBe(true);
    expect(res.notePath).toMatch(/decisions\/.+\.md$/);
    const note = fs.readFileSync(res.notePath, 'utf8');
    expect(note).toMatch(/category: dependency/);
    expect(note).toMatch(/spec_slug: frame-supervisor-loop/);
    expect(note).toMatch(/durable: true/);
    expect(note).toMatch(/task_id: T05/);
    expect(note).toMatch(/Should we adopt react 19\?/);
    expect(note).toMatch(/Yes — feature flag for 4 weeks/);
  });

  it('skips non-durable categories', async () => {
    const res = await recordDurableDecision(tmpProject(), {
      category: 'naming',
      spec_slug: 'x',
      draftedQuestion: 'What should we call this variable?',
      answer: 'fooBar',
    });
    expect(res.written).toBe(false);
    expect(res.reason).toMatch(/not durable/);
  });

  it('rejects payloads missing required fields', async () => {
    const res = await recordDurableDecision(tmpProject(), {
      category: 'schema',
      // missing spec_slug
      draftedQuestion: 'q',
      answer: 'a',
    });
    expect(res.written).toBe(false);
    expect(res.reason).toMatch(/spec_slug \+ draftedQuestion \+ answer required/);
  });
});
