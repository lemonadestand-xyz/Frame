const fs = require('fs');
const os = require('os');
const path = require('path');
const memory = require('../main/memory');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'frame-memory-test-'));
}

function backendFor(projectId = 'proj') {
  return new memory.BasicMemoryBackend({ rootDir: tmpRoot(), projectId });
}

describe('memory.tokenize', () => {
  it('drops tokens shorter than 3 chars and lowercases', () => {
    expect(memory.tokenize('Hello to a Tiny World!')).toEqual(['hello', 'tiny', 'world']);
  });
});

describe('memory.parseFrontmatter / serialiseFrontmatter', () => {
  it('round-trips a flat metadata block', () => {
    const meta = { category: 'rules', spec_slug: 'foo-bar', created_at: '2026-01-01T00:00:00Z' };
    const fm = memory.serialiseFrontmatter(meta);
    const { metadata, body } = memory.parseFrontmatter(fm + '# Title\n\nBody');
    expect(metadata).toMatchObject(meta);
    expect(body).toMatch(/^# Title/);
  });

  it('returns empty metadata when there is no frontmatter', () => {
    const { metadata, body } = memory.parseFrontmatter('# Just a title\n\nNo fences here.');
    expect(metadata).toEqual({});
    expect(body).toMatch(/^# Just a title/);
  });
});

describe('BasicMemoryBackend.write + list + read', () => {
  it('writes and reads a note round-trip', async () => {
    const bm = backendFor();
    const note = await bm.write({
      category: 'decisions',
      title: 'pick-postgres',
      body: 'We picked Postgres because…',
      metadata: { spec_slug: 'frame-supervisor-loop' },
    });
    expect(fs.existsSync(note.path)).toBe(true);
    const reloaded = await bm.read(note.path);
    expect(reloaded.title).toBe('pick-postgres');
    expect(reloaded.metadata.spec_slug).toBe('frame-supervisor-loop');
    expect(reloaded.body).toMatch(/We picked Postgres/);
    expect(reloaded.category).toBe('decisions');
  });

  it('list returns empty when projectDir is missing', async () => {
    const bm = backendFor();
    expect(await bm.list({})).toEqual([]);
  });

  it('list filters by spec_slug', async () => {
    const bm = backendFor();
    await bm.write({ category: 'decisions', title: 'A', metadata: { spec_slug: 's1' } });
    await bm.write({ category: 'decisions', title: 'B', metadata: { spec_slug: 's2' } });
    const filtered = await bm.list({ spec_slug: 's1' });
    expect(filtered.map((n) => n.title).sort()).toEqual(['A']);
  });

  it('rejects unknown category on write', async () => {
    const bm = backendFor();
    await expect(bm.write({ category: 'nope', title: 'x' })).rejects.toThrow(/unknown category/);
  });
});

describe('resolveProjectId', () => {
  function withProject(profile) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-resolve-'));
    fs.mkdirSync(path.join(root, '.frame'), { recursive: true });
    if (profile != null) {
      fs.writeFileSync(
        path.join(root, '.frame', 'profile.json'),
        JSON.stringify(profile, null, 2)
      );
    }
    return root;
  }

  it('returns profile.project.memoryId when present', () => {
    const proj = withProject({ id: 'whatever', project: { id: 'localized', name: 'L', memoryId: 'localized' } });
    expect(memory.resolveProjectId(proj)).toBe('localized');
  });

  it('falls back to the legacy hash format when no profile is present', () => {
    const proj = withProject(null);
    const resolved = memory.resolveProjectId(proj);
    expect(resolved).toMatch(/^frame-mirror-project-[A-Za-z0-9]{6}$/);
  });

  it('falls back to hash when profile.json is malformed', () => {
    const proj = withProject(null);
    fs.writeFileSync(path.join(proj, '.frame', 'profile.json'), '{not json');
    const resolved = memory.resolveProjectId(proj);
    expect(resolved).toMatch(/^frame-mirror-project-[A-Za-z0-9]{6}$/);
  });

  it('falls back to hash when project.memoryId is missing', () => {
    // profile exists but lacks the canonical `project` block — still
    // hash, per the bridge convention.
    const proj = withProject({ id: 'old-style-id' });
    const resolved = memory.resolveProjectId(proj);
    expect(resolved).toMatch(/^frame-mirror-project-[A-Za-z0-9]{6}$/);
  });

  it('legacyHashNameFor is deterministic for the same projectPath', () => {
    const a = memory.legacyHashNameFor('/tmp/foo/bar');
    const b = memory.legacyHashNameFor('/tmp/foo/bar');
    expect(a).toBe(b);
    expect(a).toMatch(/^frame-mirror-project-[A-Za-z0-9]{6}$/);
  });

  it('legacyHashNameFor differs across distinct projectPaths', () => {
    expect(memory.legacyHashNameFor('/tmp/a')).not.toBe(memory.legacyHashNameFor('/tmp/b'));
  });
});

describe('resolveProjectId — auto-bridge on first resolution', () => {
  it('bridges a pre-existing hash dir to the named dir when both are absent of collision', () => {
    const memRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-autoroot-'));
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-autoprj-'));
    fs.mkdirSync(path.join(project, '.frame'), { recursive: true });
    fs.writeFileSync(
      path.join(project, '.frame', 'profile.json'),
      JSON.stringify({ project: { memoryId: 'localized' } })
    );
    // Pre-seed the legacy hash dir with content.
    const hashName = memory.legacyHashNameFor(project);
    fs.mkdirSync(path.join(memRoot, hashName, 'decisions'), { recursive: true });
    fs.writeFileSync(path.join(memRoot, hashName, 'decisions', 'note.md'), '# from-legacy');

    // First resolution triggers the auto-bridge.
    const resolved = memory.resolveProjectId(project, { rootDir: memRoot });
    expect(resolved).toBe('localized');

    // Content is reachable through both the named path and the symlink.
    expect(fs.existsSync(path.join(memRoot, 'localized', 'decisions', 'note.md'))).toBe(true);
    expect(fs.lstatSync(path.join(memRoot, hashName)).isSymbolicLink()).toBe(true);
  });

  it('does NOT bridge when both hash and named dirs already contain content (collision-safe)', () => {
    const memRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-autoroot-'));
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-autoprj-'));
    fs.mkdirSync(path.join(project, '.frame'), { recursive: true });
    fs.writeFileSync(
      path.join(project, '.frame', 'profile.json'),
      JSON.stringify({ project: { memoryId: 'localized' } })
    );
    const hashName = memory.legacyHashNameFor(project);
    fs.mkdirSync(path.join(memRoot, hashName, 'decisions'), { recursive: true });
    fs.writeFileSync(path.join(memRoot, hashName, 'decisions', 'h.md'), '# hash');
    fs.mkdirSync(path.join(memRoot, 'localized', 'decisions'), { recursive: true });
    fs.writeFileSync(path.join(memRoot, 'localized', 'decisions', 'n.md'), '# named');

    memory.resolveProjectId(project, { rootDir: memRoot });

    // Both originals untouched — no symlink, no overwrite.
    expect(fs.lstatSync(path.join(memRoot, hashName)).isSymbolicLink()).toBe(false);
    expect(fs.existsSync(path.join(memRoot, hashName, 'decisions', 'h.md'))).toBe(true);
    expect(fs.existsSync(path.join(memRoot, 'localized', 'decisions', 'n.md'))).toBe(true);
  });
});

describe('BasicMemoryBackend constructor with projectPath', () => {
  it('resolves projectId from .frame/profile.json when constructed with projectPath', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-bm-pp-'));
    fs.mkdirSync(path.join(root, '.frame'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.frame', 'profile.json'),
      JSON.stringify({ project: { memoryId: 'localized' } })
    );
    const memRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-bm-mem-'));
    const bm = new memory.BasicMemoryBackend({ rootDir: memRoot, projectPath: root });
    expect(bm.projectId).toBe('localized');
    expect(bm.projectDir()).toBe(path.join(memRoot, 'localized'));
  });

  it('explicit projectId overrides projectPath-derived value', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-bm-override-'));
    const bm = new memory.BasicMemoryBackend({ projectId: 'forced', projectPath: root });
    expect(bm.projectId).toBe('forced');
  });
});

describe('bridgeLegacyHashDir', () => {
  function setup() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-bridge-'));
    return root;
  }

  it('renames the hash dir to the named id and replaces the hash path with a symlink', () => {
    const root = setup();
    const hashName = `${memory.LEGACY_HASH_PREFIX}10vMOW`;
    fs.mkdirSync(path.join(root, hashName, 'decisions'), { recursive: true });
    fs.writeFileSync(path.join(root, hashName, 'decisions', 'one.md'), '# one');

    const res = memory.bridgeLegacyHashDir({ rootDir: root, hashName, namedId: 'localized' });
    expect(res.action).toBe('bridged');
    // Content visible at both paths now (symlink redirects).
    expect(fs.existsSync(path.join(root, 'localized', 'decisions', 'one.md'))).toBe(true);
    expect(fs.lstatSync(path.join(root, hashName)).isSymbolicLink()).toBe(true);
    // Reading through the symlink resolves to the same content.
    expect(fs.readFileSync(path.join(root, hashName, 'decisions', 'one.md'), 'utf8')).toBe('# one');
  });

  it('is a no-op when the hash dir is already a symlink', () => {
    const root = setup();
    const hashName = `${memory.LEGACY_HASH_PREFIX}abc`;
    fs.mkdirSync(path.join(root, 'localized'), { recursive: true });
    fs.symlinkSync(path.join(root, 'localized'), path.join(root, hashName), 'dir');
    const res = memory.bridgeLegacyHashDir({ rootDir: root, hashName, namedId: 'localized' });
    expect(res.action).toBe('noop');
  });

  it('declines to bridge when both dirs have content (no data loss)', () => {
    const root = setup();
    const hashName = `${memory.LEGACY_HASH_PREFIX}collide`;
    fs.mkdirSync(path.join(root, hashName, 'decisions'), { recursive: true });
    fs.writeFileSync(path.join(root, hashName, 'decisions', 'h.md'), '# hash side');
    fs.mkdirSync(path.join(root, 'localized', 'decisions'), { recursive: true });
    fs.writeFileSync(path.join(root, 'localized', 'decisions', 'n.md'), '# named side');
    const res = memory.bridgeLegacyHashDir({ rootDir: root, hashName, namedId: 'localized' });
    expect(res.action).toBe('collision');
    // Both originals untouched.
    expect(fs.existsSync(path.join(root, hashName, 'decisions', 'h.md'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'localized', 'decisions', 'n.md'))).toBe(true);
  });

  it('returns "missing" when the hash dir does not exist', () => {
    const root = setup();
    const res = memory.bridgeLegacyHashDir({ rootDir: root, hashName: 'nope', namedId: 'localized' });
    expect(res.action).toBe('missing');
  });
});

describe('BasicMemoryBackend.search', () => {
  it('applies the 2× rules multiplier so rules outrank ordinary matches', async () => {
    const bm = backendFor();
    // Both notes contain the same keyword. Rules note should win.
    await bm.write({
      category: 'decisions',
      title: 'ordinary-decision',
      body: 'We discussed postgres deployment options yesterday.',
    });
    await bm.write({
      category: 'rules',
      title: 'rule-of-thumb',
      body: 'For postgres deployment, always pin the version.',
    });
    const results = await bm.search('postgres deployment', 5);
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results[0].category).toBe('rules');
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it('returns empty array on empty query', async () => {
    const bm = backendFor();
    await bm.write({ category: 'context', title: 't', body: 'b' });
    expect(await bm.search('', 5)).toEqual([]);
  });

  it('caps results at k', async () => {
    const bm = backendFor();
    for (let i = 0; i < 7; i++) {
      await bm.write({
        category: 'context',
        title: `note-${i}`,
        body: 'shared-keyword shared-keyword',
      });
    }
    const results = await bm.search('shared-keyword', 3);
    expect(results).toHaveLength(3);
  });
});
