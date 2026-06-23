const fs = require('fs');
const os = require('os');
const path = require('path');
const { UIAdapter } = require('../main/adapters/uiAdapter');

function tmpProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-uiadapter-'));
  fs.mkdirSync(path.join(root, '.frame', 'specs', 'demo'), { recursive: true });
  return root;
}

describe('UIAdapter', () => {
  it('writes the escalation file and resolves on answer', async () => {
    const project = tmpProject();
    const emitted = [];
    let answeredHandler = null;
    const adapter = new UIAdapter({
      emit: (channel, payload) => emitted.push({ channel, payload }),
      onAnswered: (fn) => { answeredHandler = fn; return () => {}; },
    });
    const promise = adapter.present({
      slug: 'demo',
      projectPath: project,
      draftedQuestion: 'pick foo or bar?',
      draftAnswer: 'foo',
      category: 'scope',
      role: 'user',
    });
    expect(emitted).toHaveLength(1);
    expect(emitted[0].channel).toBe('SUPERVISOR_ESCALATION_OPEN');
    const id = emitted[0].payload.id;
    const filePath = path.join(project, '.frame', 'specs', 'demo', 'escalations', `${id}.json`);
    expect(fs.existsSync(filePath)).toBe(true);
    answeredHandler({ id, answer: 'foo', answeredBy: 'user' });
    const result = await promise;
    expect(result).toEqual({ id, answer: 'foo', answeredBy: 'user' });
    // File should be moved to answered/.
    expect(fs.existsSync(filePath)).toBe(false);
    expect(fs.existsSync(path.join(project, '.frame', 'specs', 'demo', 'escalations', 'answered', `${id}.json`))).toBe(true);
  });

  it('rejects when slug/projectPath are missing', async () => {
    const adapter = new UIAdapter({ emit: () => {} });
    await expect(adapter.present({})).rejects.toThrow(/slug \+ projectPath/);
  });
});
