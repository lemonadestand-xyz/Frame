/**
 * memoryTab — pure-helper tests.
 *
 * Covers the filter logic that the Memory tab uses to scope notes to the
 * current spec, and the HTML projection helpers. The IPC + mount lifecycle
 * are exercised manually inside Electron — too much DOM mocking to cover
 * here.
 */

const memoryTab = require('../renderer/memoryTab');

const fixture = [
  {
    path: '/x/decisions/a.md',
    title: 'pick redis vs in-memory',
    category: 'decisions',
    metadata: { spec_slug: 'frame-supervisor-loop', created_at: '2026-06-20T10:00:00Z' },
    body: '# pick redis vs in-memory\n\nWe chose in-memory for v1.',
  },
  {
    path: '/x/rules/auth.md',
    title: 'auth tokens never leak',
    category: 'rules',
    metadata: { spec_slug: 'frame-escalation-adapters', created_at: '2026-06-21T10:00:00Z' },
    body: '# auth tokens never leak\n\nMust scrub tokens from logs.',
  },
  {
    path: '/x/context/c.md',
    title: 'project background',
    category: 'context',
    metadata: { created_at: '2026-06-19T10:00:00Z' },
    body: '# project background\n\nDescribes the project.',
  },
];

describe('memoryTab.filterNotes', () => {
  it('returns notes with matching spec_slug by default', () => {
    const filtered = memoryTab.filterNotes(fixture, { slug: 'frame-supervisor-loop' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].metadata.spec_slug).toBe('frame-supervisor-loop');
  });

  it('returns all notes when showAll is true', () => {
    const filtered = memoryTab.filterNotes(fixture, { slug: 'frame-supervisor-loop', showAll: true });
    expect(filtered).toHaveLength(3);
  });

  it('returns empty when slug is unset and showAll is false', () => {
    expect(memoryTab.filterNotes(fixture, {})).toEqual([]);
    expect(memoryTab.filterNotes(fixture, { slug: '', showAll: false })).toEqual([]);
  });

  it('tolerates a non-array input', () => {
    expect(memoryTab.filterNotes(null, { showAll: true })).toEqual([]);
    expect(memoryTab.filterNotes(undefined, { slug: 'x' })).toEqual([]);
  });

  it('project scope returns every note, ignoring slug+showAll', () => {
    const filtered = memoryTab.filterNotes(fixture, { scope: 'project', slug: 'frame-supervisor-loop' });
    expect(filtered).toHaveLength(3);
  });
});

describe('memoryTab.renderHtml — project scope', () => {
  it('hides the "show all" toggle when scope is project', () => {
    const html = memoryTab.renderHtml(fixture, { scope: 'project' });
    expect(html).not.toContain('memory-tab-toggle');
    expect(html).not.toContain('Show all project notes');
  });

  it('summary mentions the project scope', () => {
    const html = memoryTab.renderHtml(fixture, { scope: 'project' });
    expect(html).toContain('3 notes');
    expect(html).toMatch(/\(project\)/);
  });

  it('search input still renders in project scope', () => {
    const html = memoryTab.renderHtml([], { scope: 'project', query: 'redis' });
    expect(html).toContain('memory-tab-search');
    expect(html).toMatch(/value="redis"/);
  });

  it('empty-state copy assumes the project view (no spec-filter hint)', () => {
    const html = memoryTab.renderHtml([], { scope: 'project' });
    expect(html).toContain('No notes yet for this project');
    expect(html).not.toContain('spec_slug:');
  });
});

describe('memoryTab.renderHtml', () => {
  it('renders the toggle label "show all" by default', () => {
    const html = memoryTab.renderHtml([], { slug: 'demo', showAll: false });
    expect(html).toContain('Show all project notes');
    expect(html).toContain('memory-tab-empty');
  });

  it('renders the toggle label "this spec" when in show-all mode', () => {
    const html = memoryTab.renderHtml([], { slug: 'demo', showAll: true });
    expect(html).toContain('Show only this spec');
  });

  it('renders one row per note with category + title', () => {
    const html = memoryTab.renderHtml(fixture, { slug: 'demo', showAll: true });
    expect(html).toContain('memory-tab-row');
    expect(html).toContain('pick redis vs in-memory');
    expect(html).toContain('auth tokens never leak');
    expect(html).toContain('project background');
    expect(html).toContain('decisions');
    expect(html).toContain('rules');
  });

  it('escapes HTML in note titles and bodies', () => {
    const notes = [{
      path: '/x/decisions/sneaky.md',
      title: '<script>alert(1)</script>',
      category: 'decisions',
      metadata: { spec_slug: 'demo' },
      body: '# <script>alert(1)</script>\n\n<img onerror=x>',
    }];
    const html = memoryTab.renderHtml(notes, { slug: 'demo', showAll: false });
    expect(html).not.toMatch(/<script>alert/);
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders a search input that reflects the active query', () => {
    const html = memoryTab.renderHtml([], { slug: 'demo', showAll: false, query: 'redis' });
    expect(html).toContain('memory-tab-search');
    expect(html).toMatch(/value="redis"/);
    // Search empty-state copy mentions the query.
    expect(html).toMatch(/No notes matched/);
    expect(html).toContain('redis');
  });

  it('renders the keyword score chip when SEARCH_MEMORY supplies a score', () => {
    const scored = [{
      path: '/x/rules/auth.md',
      title: 'auth tokens never leak',
      category: 'rules',
      metadata: { spec_slug: 'demo' },
      body: '# auth tokens never leak\n\nMust scrub.',
      score: 6,
    }];
    const html = memoryTab.renderHtml(scored, { slug: 'demo', showAll: true, query: 'auth' });
    expect(html).toContain('memory-tab-score');
    expect(html).toMatch(/>6</);
  });

  it('summary reads "N matches for <query>" when searching', () => {
    const html = memoryTab.renderHtml(fixture.slice(0, 2), { slug: 'demo', showAll: true, query: 'auth' });
    expect(html).toMatch(/2 matches for "auth"/);
  });
});
