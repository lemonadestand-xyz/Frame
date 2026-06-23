#!/usr/bin/env node
/**
 * Migrate supervisor YAML profiles into per-project `.frame/profile.json`.
 *
 * For each (canonical project_id → supervisor profile → workdir) row in the
 * mapping table, this script:
 *
 *   1. Reads <supervisor-profiles>/<profile>.yaml
 *   2. Translates it to Frame's ProjectProfile JSON shape
 *   3. Merges with any existing <workdir>/.frame/profile.json
 *      (Frame fields win; supervisor fills gaps only)
 *   4. Writes <workdir>/.frame/profile.json
 *
 * Re-running is a no-op: identical content is detected and the write is
 * skipped. Pass `--dry-run` to print the planned writes without touching
 * disk. Pass `-v` / `--verbose` to print the resolved profiles dir.
 *
 * No external deps. The shared YAML parser + mapping table + translator
 * live in `src/main/supervisorProfileBridge.js` so the on-the-fly
 * fallback in `profile.js` uses the same code path.
 */

const fs = require('fs');
const path = require('path');

const bridge = require('../src/main/supervisorProfileBridge');

function migrateOne(row, opts = {}) {
  const dryRun = !!opts.dryRun;
  const profilesDir = opts.profilesDir || bridge.supervisorProfilesDir();
  const result = {
    projectId: row.projectId,
    workdir: row.workdir,
    target: path.join(row.workdir, '.frame', 'profile.json'),
    action: 'skip',
    reason: null,
  };

  const parsed = bridge.readSupervisorProfile(row.profileName, profilesDir);
  if (!parsed) {
    result.action = 'skip';
    result.reason = `supervisor profile not found or unparseable: ${row.profileName}.yaml`;
    return result;
  }
  if (!fs.existsSync(row.workdir)) {
    result.action = 'skip';
    result.reason = `workdir not present: ${row.workdir}`;
    return result;
  }

  const supervisorProfile = bridge.translateSupervisorProfile(parsed, row);
  let existing = null;
  if (fs.existsSync(result.target)) {
    try {
      existing = JSON.parse(fs.readFileSync(result.target, 'utf8'));
    } catch (err) {
      result.action = 'skip';
      result.reason = `existing profile.json is malformed; refusing to clobber: ${err.message}`;
      return result;
    }
  }

  const merged = bridge.mergeProfiles(supervisorProfile, existing);
  const nextRaw = JSON.stringify(merged, null, 2) + '\n';
  const prevRaw = existing ? fs.readFileSync(result.target, 'utf8') : null;
  if (prevRaw === nextRaw) {
    result.action = 'noop';
    result.reason = 'already up to date';
    return result;
  }

  if (dryRun) {
    result.action = existing ? 'would-merge' : 'would-write';
    return result;
  }

  fs.mkdirSync(path.dirname(result.target), { recursive: true });
  fs.writeFileSync(result.target, nextRaw, 'utf8');
  result.action = existing ? 'merged' : 'wrote';
  return result;
}

function migrateAll(opts = {}) {
  return bridge.PROJECT_MAP.map((row) => migrateOne(row, opts));
}

function _formatRow(r) {
  const tag = `[${r.action}]`.padEnd(14);
  const label = `${r.projectId}`.padEnd(20);
  const note = r.reason ? `  (${r.reason})` : '';
  return `${tag} ${label} → ${r.target}${note}`;
}

function _cli(argv) {
  const dryRun = argv.includes('--dry-run');
  const verbose = argv.includes('--verbose') || argv.includes('-v');
  if (verbose) {
    console.log(`Supervisor profiles dir: ${bridge.supervisorProfilesDir()}`);
    console.log(`Mode: ${dryRun ? 'dry-run' : 'apply'}\n`);
  }
  const results = migrateAll({ dryRun });
  for (const r of results) console.log(_formatRow(r));
  const wrote = results.filter((r) => ['wrote', 'merged', 'would-write', 'would-merge'].includes(r.action));
  const skipped = results.filter((r) => r.action === 'skip');
  const noop = results.length - wrote.length - skipped.length;
  console.log(`\n${wrote.length} ${dryRun ? 'would write' : 'wrote'}, ${skipped.length} skipped, ${noop} no-op.`);
}

if (require.main === module) {
  _cli(process.argv.slice(2));
}

module.exports = {
  migrateOne,
  migrateAll,
  // re-exports for tests
  PROJECT_MAP: bridge.PROJECT_MAP,
  SUPERVISOR_PROFILES_DIR: bridge.DEFAULT_SUPERVISOR_PROFILES_DIR,
  parseYaml: bridge.parseYaml,
  translateSupervisorProfile: bridge.translateSupervisorProfile,
  mergeProfiles: bridge.mergeProfiles,
  readSupervisorProfile: bridge.readSupervisorProfile,
};
