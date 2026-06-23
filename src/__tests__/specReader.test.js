const fs = require('fs');
const os = require('os');
const path = require('path');
const { SpecReader } = require('../main/capabilities/specReader');

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'frame-specreader-'));
}

describe('SpecReader', () => {
  it('returns Evidence ranked by keyword score', async () => {
    const project = tmpProject();
    fs.writeFileSync(path.join(project, 'docs.md'),
      `# Doc

This is about postgres deployment.

This paragraph is about something else entirely.

Another postgres mention here.`, 'utf8');
    const cap = new SpecReader({ projectPath: project, profile: { context_sources: ['docs.md'] } });
    const ev = await cap.run({ question: 'postgres deployment' });
    expect(ev.length).toBeGreaterThan(0);
    expect(ev[0].source).toBe('spec_reader');
    expect(ev[0].refs[0]).toMatch(/docs\.md:L/);
    expect(ev[0].score).toBeGreaterThanOrEqual(2);
  });

  it('returns empty for empty question', async () => {
    const cap = new SpecReader({ projectPath: tmpProject(), profile: { context_sources: ['anything.md'] } });
    expect(await cap.run({ question: '' })).toEqual([]);
  });

  it('warns on missing files', async () => {
    const cap = new SpecReader({ projectPath: tmpProject(), profile: { context_sources: ['gone.md'] } });
    const ev = await cap.run({ question: 'anything' });
    expect(ev[0].summary).toMatch(/not found/);
  });

  it('skips Frame meta files even when listed', async () => {
    const project = tmpProject();
    fs.writeFileSync(path.join(project, 'AGENTS.md'), 'long meta content with anything', 'utf8');
    const cap = new SpecReader({ projectPath: project, profile: { context_sources: ['AGENTS.md'] } });
    const ev = await cap.run({ question: 'anything' });
    expect(ev).toEqual([]);
  });

  it('caps results at K', async () => {
    const project = tmpProject();
    const body = Array.from({ length: 10 }, (_, i) => `paragraph ${i}\nshared`).join('\n\n');
    fs.writeFileSync(path.join(project, 'doc.md'), body, 'utf8');
    const cap = new SpecReader({ projectPath: project, profile: { context_sources: ['doc.md'] } });
    const ev = await cap.run({ question: 'shared' });
    expect(ev.length).toBeLessThanOrEqual(5);
  });
});
