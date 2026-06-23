const fs = require('fs');
const os = require('os');
const path = require('path');
const profile = require('../main/profile');

function tmpProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-profile-test-'));
  fs.mkdirSync(path.join(root, '.frame'), { recursive: true });
  return root;
}

describe('profile.loadProfile', () => {
  it('returns the default profile when no file exists', () => {
    const root = tmpProject();
    const { profile: p, source, warnings } = profile.loadProfile(root);
    expect(source).toBe('default');
    expect(warnings).toEqual([]);
    expect(p.id).toBe(path.basename(root));
    expect(p.policy.escalate_categories).toEqual([]);
    expect(p.budgets.iteration_cap).toBe(3);
  });

  it('parses a valid profile.json from disk', () => {
    const root = tmpProject();
    const payload = {
      id: 'my-proj',
      policy: { escalate_categories: ['schema'], cost_ceiling_usd: 5.0, rules: [] },
      capabilities: ['spec_reader'],
    };
    fs.writeFileSync(path.join(root, '.frame', 'profile.json'),
      JSON.stringify(payload), 'utf8');
    const { profile: p, source } = profile.loadProfile(root);
    expect(source).toBe('file');
    expect(p.id).toBe('my-proj');
    expect(p.policy.escalate_categories).toEqual(['schema']);
    expect(p.capabilities).toEqual(['spec_reader']);
    // Default fields preserved when the on-disk profile omits them
    expect(p.budgets.iteration_cap).toBe(3);
  });

  it('falls back to default and warns on malformed JSON', () => {
    const root = tmpProject();
    fs.writeFileSync(path.join(root, '.frame', 'profile.json'), '{not json', 'utf8');
    const { profile: p, source, warnings } = profile.loadProfile(root);
    expect(source).toBe('default');
    expect(p.id).toBe(path.basename(root));
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.join('|')).toMatch(/malformed/);
  });

  it('reports fileExists=false when the file is absent', () => {
    const root = tmpProject();
    const { fileExists, source } = profile.loadProfile(root);
    expect(fileExists).toBe(false);
    expect(source).toBe('default');
  });

  it('reports fileExists=true when the file is present, even if malformed', () => {
    const root = tmpProject();
    fs.writeFileSync(path.join(root, '.frame', 'profile.json'), '{not json', 'utf8');
    const { fileExists, source } = profile.loadProfile(root);
    expect(fileExists).toBe(true);
    expect(source).toBe('default');
  });

  it('reports fileExists=true when the file is present and valid', () => {
    const root = tmpProject();
    fs.writeFileSync(path.join(root, '.frame', 'profile.json'),
      JSON.stringify({ id: 'demo' }), 'utf8');
    const { fileExists, source } = profile.loadProfile(root);
    expect(fileExists).toBe(true);
    expect(source).toBe('file');
  });

  it('passes loosely on unknown fields with a warning', () => {
    const root = tmpProject();
    fs.writeFileSync(path.join(root, '.frame', 'profile.json'),
      JSON.stringify({ id: 'x', surprise_key: 1, policy: { unknown_policy: true } }),
      'utf8');
    const { source, warnings } = profile.loadProfile(root);
    expect(source).toBe('file');
    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/unknown top-level key: surprise_key/),
        expect.stringMatching(/unknown policy key: unknown_policy/),
      ])
    );
  });
});

describe('profile.saveProfile', () => {
  it('writes the profile and round-trips', () => {
    const root = tmpProject();
    const payload = profile.defaultProfile(root);
    payload.policy.cost_ceiling_usd = 10.0;
    payload.capabilities = ['spec_reader', 'knowledge_search'];
    const { success } = profile.saveProfile(root, payload);
    expect(success).toBe(true);
    const { profile: reloaded } = profile.loadProfile(root);
    expect(reloaded.policy.cost_ceiling_usd).toBe(10.0);
    expect(reloaded.capabilities).toEqual(['spec_reader', 'knowledge_search']);
  });

  it('rejects an invalid profile', () => {
    const root = tmpProject();
    const { success, error } = profile.saveProfile(root, null);
    expect(success).toBe(false);
    expect(error).toBeTruthy();
  });
});

describe('profile.validateProfile', () => {
  it('flags an unknown policy rule route', () => {
    const { warnings } = profile.validateProfile({
      policy: { rules: [{ category: 'naming', route: 'banana' }] },
    });
    expect(warnings.join('|')).toMatch(/policy.rules\[0\].route invalid: banana/);
  });
});
