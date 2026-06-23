/**
 * Profile discovery fallback — when a project has no .frame/profile.json
 * AND a canonical supervisor YAML exists for the workdir, loadProfile
 * translates the YAML on the fly. The fallback never writes to disk.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const MINIMAL_YAML = `
id: localized
worker:
  provider: claude_code
  permission:
    mode: acceptEdits
    allowed_tools: [Read, Write]
context_sources:
  - bm:localized
policy:
  cost_ceiling_usd: 0
  escalate_categories:
    - dependency
capabilities:
  - memory_search
budgets:
  iteration_cap: 4
store: local
`.trim() + '\n';

function setupSupervisorDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-fb-yaml-'));
  fs.writeFileSync(path.join(dir, 'localized.yaml'), MINIMAL_YAML);
  return dir;
}

function withWorkdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'localized-'));
}

describe('profile discovery fallback', () => {
  let savedEnv;
  let supervisorDir;

  beforeEach(() => {
    // Force a deterministic discovery path. The bridge resolves the dir
    // via FRAME_SUPERVISOR_PROFILES_DIR before falling back to its
    // hardcoded default — so the env override is enough to isolate.
    savedEnv = process.env.FRAME_SUPERVISOR_PROFILES_DIR;
    supervisorDir = setupSupervisorDir();
    process.env.FRAME_SUPERVISOR_PROFILES_DIR = supervisorDir;
    // jest's module cache holds the previous resolution — wipe it.
    jest.resetModules();
  });

  afterEach(() => {
    if (savedEnv === undefined) delete process.env.FRAME_SUPERVISOR_PROFILES_DIR;
    else process.env.FRAME_SUPERVISOR_PROFILES_DIR = savedEnv;
  });

  it('returns the supervisor-translated profile when only the YAML exists', () => {
    const profile = require('../main/profile');
    const root = withWorkdir(); // path basename = "localized-XXXX" → won't basename-match
    // To match, the workdir basename must be a known project_id. Use
    // an explicit mkdtemp inside a parent that ends with "localized".
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'parent-'));
    const work = path.join(parent, 'localized');
    fs.mkdirSync(work);

    const loaded = profile.loadProfile(work);
    expect(loaded.source).toBe('supervisor');
    expect(loaded.fileExists).toBe(false);
    expect(loaded.supervisorAvailable).toBe(true);
    expect(loaded.profile.project.memoryId).toBe('localized');
    expect(loaded.profile.worker.permission.allowedTools).toEqual(['Read', 'Write']);
    // The fallback must not have written anything to disk.
    expect(fs.existsSync(path.join(work, '.frame', 'profile.json'))).toBe(false);
    // Suppress unused warning.
    expect(root).toBeTruthy();
  });

  it('.frame/profile.json wins when both file and supervisor YAML exist', () => {
    const profile = require('../main/profile');
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'parent-'));
    const work = path.join(parent, 'localized');
    fs.mkdirSync(work);
    fs.mkdirSync(path.join(work, '.frame'));
    fs.writeFileSync(
      path.join(work, '.frame', 'profile.json'),
      JSON.stringify({ id: 'override', capabilities: ['only-frame-side'] })
    );
    const loaded = profile.loadProfile(work);
    expect(loaded.source).toBe('file');
    expect(loaded.fileExists).toBe(true);
    expect(loaded.profile.id).toBe('override');
    expect(loaded.profile.capabilities).toEqual(['only-frame-side']);
  });

  it('returns the default profile when neither file nor supervisor YAML exists', () => {
    const profile = require('../main/profile');
    // A workdir whose basename does not appear in PROJECT_MAP.
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'unknown-project-'));
    const loaded = profile.loadProfile(work);
    expect(loaded.source).toBe('default');
    expect(loaded.fileExists).toBe(false);
    expect(loaded.supervisorAvailable).toBeUndefined();
    expect(loaded.profile.id).toBe(path.basename(work));
  });

  it('findSupervisorProfileForWorkdir returns the mapping row when YAML exists', () => {
    const profile = require('../main/profile');
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'parent-'));
    const work = path.join(parent, 'localized');
    fs.mkdirSync(work);
    const row = profile.findSupervisorProfileForWorkdir(work);
    expect(row).toBeTruthy();
    expect(row.projectId).toBe('localized');
    expect(row.profileName).toBe('localized');
  });

  it('findSupervisorProfileForWorkdir returns null for an unknown workdir', () => {
    const profile = require('../main/profile');
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'random-junk-'));
    expect(profile.findSupervisorProfileForWorkdir(work)).toBeNull();
  });
});
