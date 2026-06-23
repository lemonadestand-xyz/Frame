const { KnowledgeSearch } = require('../main/capabilities/knowledgeSearch');

class FakeMemoryBackend {
  constructor(notes) { this.notes = notes; }
  async search(query, k) {
    return this.notes
      .filter((n) => (n.body + n.title).toLowerCase().includes(query.toLowerCase()))
      .slice(0, k);
  }
}

describe('KnowledgeSearch', () => {
  it('returns the warning Evidence when no bm: source is configured', async () => {
    const cap = new KnowledgeSearch({
      memory: new FakeMemoryBackend([]),
      profile: { context_sources: ['docs.md'] },
    });
    const ev = await cap.run({ question: 'postgres' });
    expect(ev).toHaveLength(1);
    expect(ev[0].summary).toMatch(/add bm:/);
  });

  it('returns Evidence from the memory backend when bm: is enabled', async () => {
    const cap = new KnowledgeSearch({
      memory: new FakeMemoryBackend([
        { category: 'decisions', title: 'pick-postgres', body: 'we picked postgres', path: '/m/d/pick.md', score: 3 },
      ]),
      profile: { context_sources: ['bm:demo'] },
    });
    const ev = await cap.run({ question: 'postgres' });
    expect(ev).toHaveLength(1);
    expect(ev[0].refs[0]).toBe('/m/d/pick.md');
    expect(ev[0].source).toBe('knowledge_search');
  });

  it('warns when no memory backend is wired', async () => {
    const cap = new KnowledgeSearch({ memory: null, profile: { context_sources: ['bm:demo'] } });
    const ev = await cap.run({ question: 'anything' });
    expect(ev[0].summary).toMatch(/no memory backend/);
  });
});
