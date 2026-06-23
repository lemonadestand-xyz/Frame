/**
 * migrate-supervisor-profile — unit tests for the YAML→JSON translator and
 * the idempotent merge behavior. The migration driver is exercised through
 * a temporary profiles dir + a temporary "workdir" so we can run it without
 * touching real disk locations.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const migrator = require('../../scripts/migrate-supervisor-profile');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

const MINIMAL_YAML = `
id: localized

worker:
  provider: claude_code
  model: null
  auth: subscription
  permission:
    mode: acceptEdits
    allowed_tools:
      - Read
      - Write
      - Edit
  workdir: /tmp/should-be-discarded

context_sources:
  - bm:localized
  - /tmp/initiatives

policy:
  cost_ceiling_usd: 0
  escalate_categories:
    - dependency
    - schema
  rules:
    - { category: naming, route: auto_answer, note: "trivial" }
    - { category: consistency, route: research }

roles:
  - name: engineer
    style: technical
    channel: mobile_api
    authority: ["*"]
    proactivity: 3

people:
  chris: engineer

capabilities:
  - memory_search
  - spec_reader

budgets:
  iteration_cap: 4
  spend_ceiling_task_usd: 20

store: local
`.trim() + '\n';

describe('parseYaml', () => {
  it('parses scalars, nested maps, and lists', () => {
    const parsed = migrator.parseYaml(MINIMAL_YAML);
    expect(parsed.id).toBe('localized');
    expect(parsed.worker.provider).toBe('claude_code');
    expect(parsed.worker.model).toBeNull();
    expect(parsed.worker.permission.mode).toBe('acceptEdits');
    expect(parsed.worker.permission.allowed_tools).toEqual(['Read', 'Write', 'Edit']);
    expect(parsed.context_sources).toEqual(['bm:localized', '/tmp/initiatives']);
    expect(parsed.policy.cost_ceiling_usd).toBe(0);
    expect(parsed.policy.escalate_categories).toEqual(['dependency', 'schema']);
    expect(parsed.capabilities).toEqual(['memory_search', 'spec_reader']);
    expect(parsed.store).toBe('local');
  });

  it('parses inline flow mappings inside list items', () => {
    const parsed = migrator.parseYaml(MINIMAL_YAML);
    expect(parsed.policy.rules).toHaveLength(2);
    expect(parsed.policy.rules[0]).toEqual({
      category: 'naming', route: 'auto_answer', note: 'trivial',
    });
    expect(parsed.policy.rules[1]).toEqual({
      category: 'consistency', route: 'research',
    });
  });

  it('parses a list of mappings via indented children (roles)', () => {
    const parsed = migrator.parseYaml(MINIMAL_YAML);
    expect(parsed.roles).toEqual([
      {
        name: 'engineer',
        style: 'technical',
        channel: 'mobile_api',
        authority: ['*'],
        proactivity: 3,
      },
    ]);
  });

  it('strips line comments but keeps `#` inside quoted strings', () => {
    const yaml = `
id: test
# this is a comment
note: "hash # inside quotes stays"  # tail comment dropped
`;
    const parsed = migrator.parseYaml(yaml);
    expect(parsed.id).toBe('test');
    expect(parsed.note).toBe('hash # inside quotes stays');
  });
});

describe('translateSupervisorProfile', () => {
  it('maps the supervisor YAML shape to Frame ProjectProfile JSON', () => {
    const parsed = migrator.parseYaml(MINIMAL_YAML);
    const out = migrator.translateSupervisorProfile(parsed, {
      projectId: 'localized', name: 'Localized',
    });
    expect(out.id).toBe('localized');
    expect(out.project).toEqual({
      id: 'localized', name: 'Localized', memoryId: 'localized',
    });
    expect(out.worker.provider).toBe('claude_code');
    expect(out.worker.permission.mode).toBe('acceptEdits');
    // `allowed_tools` → camelCase `allowedTools`
    expect(out.worker.permission.allowedTools).toEqual(['Read', 'Write', 'Edit']);
    // workdir discarded
    expect(out.worker.workdir).toBeUndefined();
    expect(out.context_sources).toEqual(['bm:localized', '/tmp/initiatives']);
    expect(out.policy.escalate_categories).toEqual(['dependency', 'schema']);
    expect(out.budgets.iteration_cap).toBe(4);
    expect(out.budgets.spend_ceiling_task_usd).toBe(20);
    expect(out.capabilities).toEqual(['memory_search', 'spec_reader']);
    expect(out.store).toBe('local');
  });

  it('uses the canonical project_id, not the supervisor profile id field', () => {
    // For role-variants like `localized-research.yaml`, id-in-YAML is
    // `localized-research`, but the canonical projectId is `localized`.
    const variantYaml = MINIMAL_YAML.replace('id: localized', 'id: localized-research');
    const parsed = migrator.parseYaml(variantYaml);
    const out = migrator.translateSupervisorProfile(parsed, {
      projectId: 'localized', name: 'Localized',
    });
    expect(out.id).toBe('localized');
    expect(out.project.id).toBe('localized');
    expect(out.project.memoryId).toBe('localized');
  });
});

describe('mergeProfiles', () => {
  it('returns the supervisor profile when no existing Frame profile', () => {
    const supervisor = { id: 'x', policy: { rules: [] } };
    const out = migrator.mergeProfiles(supervisor, null);
    expect(out).toEqual(supervisor);
  });

  it('lets Frame fields win at every top-level key — supervisor fills gaps', () => {
    const supervisor = {
      id: 'x',
      project: { id: 'x', name: 'X', memoryId: 'x' },
      worker: { provider: 'claude_code' },
      capabilities: ['a', 'b'],
    };
    const frame = {
      id: 'x',
      worker: { provider: 'custom-tool' },  // Frame overrides
      extra_key: 'preserved',
    };
    const out = migrator.mergeProfiles(supervisor, frame);
    expect(out.id).toBe('x');
    expect(out.worker.provider).toBe('custom-tool'); // Frame wins
    expect(out.capabilities).toEqual(['a', 'b']);    // supervisor fills gap
    expect(out.project.memoryId).toBe('x');          // supervisor fills gap
    expect(out.extra_key).toBe('preserved');         // Frame-only preserved
  });
});

describe('migrateOne integration', () => {
  function setup() {
    const profilesDir = tmpDir('migrate-profiles');
    const workdir = tmpDir('migrate-workdir');
    fs.writeFileSync(path.join(profilesDir, 'localized.yaml'), MINIMAL_YAML);
    return { profilesDir, workdir };
  }

  it('writes a fresh .frame/profile.json when none exists', () => {
    const { profilesDir, workdir } = setup();
    const result = migrator.migrateOne(
      { projectId: 'localized', name: 'Localized', profileName: 'localized', workdir },
      { profilesDir }
    );
    expect(result.action).toBe('wrote');
    const target = path.join(workdir, '.frame', 'profile.json');
    expect(fs.existsSync(target)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
    expect(parsed.project.memoryId).toBe('localized');
    expect(parsed.worker.permission.allowedTools).toEqual(['Read', 'Write', 'Edit']);
  });

  it('is idempotent — second run is a no-op', () => {
    const { profilesDir, workdir } = setup();
    const row = { projectId: 'localized', name: 'Localized', profileName: 'localized', workdir };
    const first = migrator.migrateOne(row, { profilesDir });
    expect(first.action).toBe('wrote');
    const second = migrator.migrateOne(row, { profilesDir });
    expect(second.action).toBe('noop');
  });

  it('merges an existing profile — Frame fields win', () => {
    const { profilesDir, workdir } = setup();
    fs.mkdirSync(path.join(workdir, '.frame'), { recursive: true });
    fs.writeFileSync(
      path.join(workdir, '.frame', 'profile.json'),
      JSON.stringify({
        id: 'localized',
        worker: { provider: 'frame-custom', model: 'override' },
        custom_field: 'kept',
      }, null, 2) + '\n'
    );
    const result = migrator.migrateOne(
      { projectId: 'localized', name: 'Localized', profileName: 'localized', workdir },
      { profilesDir }
    );
    expect(result.action).toBe('merged');
    const merged = JSON.parse(fs.readFileSync(path.join(workdir, '.frame', 'profile.json'), 'utf8'));
    // Frame fields preserved at the top-level key granularity
    expect(merged.worker.provider).toBe('frame-custom');
    expect(merged.custom_field).toBe('kept');
    // Supervisor-only top-level keys still filled in
    expect(merged.project.memoryId).toBe('localized');
    expect(merged.capabilities).toEqual(['memory_search', 'spec_reader']);
  });

  it('dry-run does not touch disk', () => {
    const { profilesDir, workdir } = setup();
    const row = { projectId: 'localized', name: 'Localized', profileName: 'localized', workdir };
    const result = migrator.migrateOne(row, { profilesDir, dryRun: true });
    expect(result.action).toBe('would-write');
    expect(fs.existsSync(path.join(workdir, '.frame', 'profile.json'))).toBe(false);
  });

  it('skips when the supervisor profile is missing', () => {
    const { profilesDir, workdir } = setup();
    const row = {
      projectId: 'nonexistent', name: 'X', profileName: 'no-such-profile', workdir,
    };
    const result = migrator.migrateOne(row, { profilesDir });
    expect(result.action).toBe('skip');
    expect(result.reason).toMatch(/not found/);
  });

  it('skips when the workdir is missing', () => {
    const { profilesDir } = setup();
    const row = {
      projectId: 'localized',
      name: 'Localized',
      profileName: 'localized',
      workdir: '/tmp/this-path-should-not-exist-pls-' + Date.now(),
    };
    const result = migrator.migrateOne(row, { profilesDir });
    expect(result.action).toBe('skip');
    expect(result.reason).toMatch(/workdir not present/);
  });

  it('multi-profile project: only the canonical YAML migrates; role variants are ignored', () => {
    // Localized ships with 6 supervisor YAMLs (canonical + 5 role variants).
    // The brief: migrate only `localized.yaml` to .frame/profile.json; the
    // variants stay as supervisor-side specialisations.
    const profilesDir = tmpDir('migrate-profiles');
    const workdir = tmpDir('migrate-workdir');

    fs.writeFileSync(path.join(profilesDir, 'localized.yaml'), MINIMAL_YAML);
    // Variants exist alongside — they have different `id` values + different
    // policy to make the assertion sharp.
    fs.writeFileSync(
      path.join(profilesDir, 'localized-research.yaml'),
      MINIMAL_YAML.replace('id: localized', 'id: localized-research')
                  .replace('iteration_cap: 4', 'iteration_cap: 99')
    );
    fs.writeFileSync(
      path.join(profilesDir, 'localized-scraper.yaml'),
      MINIMAL_YAML.replace('id: localized', 'id: localized-scraper')
                  .replace('- dependency', '- destructive')
    );

    const row = { projectId: 'localized', name: 'Localized', profileName: 'localized', workdir };
    const result = migrator.migrateOne(row, { profilesDir });
    expect(result.action).toBe('wrote');

    const written = JSON.parse(fs.readFileSync(path.join(workdir, '.frame', 'profile.json'), 'utf8'));
    // Canonical's content: iteration_cap=4, NOT 99 (variant).
    expect(written.budgets.iteration_cap).toBe(4);
    // Canonical's policy: dependency, NOT destructive (variant).
    expect(written.policy.escalate_categories).toContain('dependency');
    expect(written.policy.escalate_categories).not.toContain('destructive');
    // project.id stays canonical even though variant YAMLs are present.
    expect(written.project.id).toBe('localized');
    expect(written.project.memoryId).toBe('localized');
  });

  it('migrateAll respects PROJECT_MAP and runs migrateOne per row', () => {
    // Just confirm the driver iterates the canonical mapping table —
    // every row should produce a result object (action: 'skip' is fine
    // when the test workdirs do not exist).
    const results = migrator.migrateAll({ dryRun: true });
    expect(results.length).toBe(migrator.PROJECT_MAP.length);
    const projectIds = results.map((r) => r.projectId).sort();
    const expectedIds = migrator.PROJECT_MAP.map((r) => r.projectId).sort();
    expect(projectIds).toEqual(expectedIds);
  });
});
