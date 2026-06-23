/**
 * Shared bridge between the supervisor's YAML profiles and Frame's JSON
 * profile shape. Used by:
 *
 *   - `scripts/migrate-supervisor-profile.js` — one-shot translator
 *   - `src/main/profile.js`                   — on-the-fly fallback when a
 *                                                project has no .frame/profile.json
 *
 * Single source of truth for:
 *   - the canonical project_id → supervisor profile → workdir map
 *   - the hand-rolled YAML parser sufficient for the supervisor profile shape
 *   - the supervisor-YAML → Frame-JSON translation rules
 *
 * The migration script re-exports these so external scripts only depend on
 * one module.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = os.homedir();

// TODO: surface FRAME_SUPERVISOR_PROFILES_DIR as a documented env override
// (it is honoured below today, just not yet documented in AGENTS.md).
const DEFAULT_SUPERVISOR_PROFILES_DIR = path.join(
  HOME,
  'Desktop/lemonade-stand/autonomous_agent/autonomous-supervisor/supervisor/profiles'
);

function supervisorProfilesDir() {
  return process.env.FRAME_SUPERVISOR_PROFILES_DIR || DEFAULT_SUPERVISOR_PROFILES_DIR;
}

// ─── Canonical project mapping ────────────────────────────
//
// project_id is the canonical name used for both Frame's profile.json
// (`project.id`, `project.memoryId`) and the supervisor's ~/memory/<id>/
// directory. The supervisor's *profile filename* may differ — e.g. the
// `cengage-intake` profile maps to project `cengage`. Role-specific
// Localized variants are intentionally absent: only the canonical
// `localized.yaml` is referenced here.

const PROJECT_MAP = [
  {
    projectId: 'localized',
    name: 'Localized',
    profileName: 'localized',
    workdir: path.join(HOME, 'Desktop/lemonade-stand/localized/develop'),
  },
  {
    projectId: 'kitli-kids',
    name: 'Kitli Kids',
    profileName: 'kitli-kids',
    workdir: path.join(HOME, 'Desktop/lemonade-stand/kitli-kids/develop'),
  },
  {
    projectId: 'renovive-services',
    name: 'Renovive Services',
    profileName: 'renovive-services',
    workdir: path.join(HOME, 'Desktop/lemonade-stand/renovive/develop/renovive-services'),
  },
  {
    projectId: 'renovive-qa',
    name: 'Renovive QA',
    profileName: 'renovive-qa',
    workdir: path.join(HOME, 'Desktop/lemonade-stand/renovive/develop/renovive'),
  },
  {
    projectId: 'cengage',
    name: 'Cengage',
    profileName: 'cengage-intake',
    workdir: path.join(HOME, 'Desktop/lemonade-stand/cengage/develop'),
  },
  {
    projectId: 'mason',
    name: 'Mason',
    profileName: 'mason',
    workdir: path.join(HOME, 'Desktop/lemonade-stand/mason/develop'),
  },
  {
    projectId: 'supervisor-self',
    name: 'Supervisor Self-Build',
    profileName: 'supervisor-self',
    workdir: path.join(HOME, 'Desktop/lemonade-stand/autonomous_agent/autonomous-supervisor/supervisor-build'),
  },
  {
    // Frame's own workdir — the supervisor's `frame-research` profile
    // is read-heavy with a strict "no source_modification" escalation
    // category. Used by the renderer's supervisor-profile-found banner
    // when Frame opens itself as a project (project.memoryId = 'frame').
    projectId: 'frame',
    name: 'Frame',
    profileName: 'frame-research',
    workdir: path.join(HOME, 'Desktop/lemonade-stand/Frame'),
  },
];

function _normPath(p) {
  if (!p) return p;
  return path.resolve(p).replace(/\/+$/, '');
}

/**
 * Look up the canonical mapping row for a workdir. Two-stage match:
 *   1. Exact (normalised) path equality against each row's workdir.
 *   2. Basename equality against each row's projectId — handles the case
 *      where a user opened the project from a sibling worktree.
 */
function findMappingForWorkdir(workdir) {
  if (!workdir) return null;
  const target = _normPath(workdir);
  for (const row of PROJECT_MAP) {
    if (_normPath(row.workdir) === target) return row;
  }
  const base = path.basename(target);
  for (const row of PROJECT_MAP) {
    if (row.projectId === base) return row;
  }
  return null;
}

// ─── Minimal YAML parser ──────────────────────────────────
//
// Handles the subset the supervisor profiles use: nested `key: value`
// mappings (2-space indent), list items with `- scalar` / `- { ... }` /
// `- key: value` (inline mapping continued by deeper indent), inline
// flow sequences `[a, b]` and flow mappings `{ a: b }`. Does NOT handle
// anchors, aliases, or multi-line scalars.

function parseYaml(source) {
  const lines = _preprocess(source);
  const result = _parseBlock(lines, 0, 0);
  return result.value;
}

function _preprocess(source) {
  const out = [];
  for (const raw of String(source).split(/\r?\n/)) {
    const stripped = _stripLineComment(raw);
    if (stripped.trim() === '') continue;
    const indent = stripped.match(/^ */)[0].length;
    out.push({ indent, content: stripped.slice(indent) });
  }
  return out;
}

function _stripLineComment(line) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === '#' && !inSingle && !inDouble) {
      return line.slice(0, i).replace(/\s+$/, '');
    }
  }
  return line.replace(/\s+$/, '');
}

function _parseBlock(lines, idx, indent) {
  if (idx >= lines.length) return { value: null, nextIdx: idx };
  const first = lines[idx];
  if (first.indent < indent) return { value: null, nextIdx: idx };
  if (first.content.startsWith('- ') || first.content === '-') {
    return _parseList(lines, idx, indent);
  }
  return _parseMap(lines, idx, indent);
}

function _parseMap(lines, idx, indent) {
  const map = {};
  let i = idx;
  while (i < lines.length) {
    const line = lines[i];
    if (line.indent < indent) break;
    if (line.indent !== indent) break;
    if (line.content.startsWith('-')) break;
    const colonAt = _findKeyColon(line.content);
    if (colonAt === -1) { i += 1; continue; }
    const key = line.content.slice(0, colonAt).trim();
    const rest = line.content.slice(colonAt + 1).trim();
    if (rest === '') {
      const nextLine = lines[i + 1];
      if (!nextLine || nextLine.indent <= indent) {
        map[key] = null;
        i += 1;
      } else {
        const nested = _parseBlock(lines, i + 1, nextLine.indent);
        map[key] = nested.value;
        i = nested.nextIdx;
      }
    } else {
      map[key] = _parseScalar(rest);
      i += 1;
    }
  }
  return { value: map, nextIdx: i };
}

function _parseList(lines, idx, indent) {
  const list = [];
  let i = idx;
  while (i < lines.length) {
    const line = lines[i];
    if (line.indent !== indent) break;
    if (!line.content.startsWith('-')) break;
    const payload = line.content === '-' ? '' : line.content.slice(1).trim();

    if (payload === '') {
      const nextLine = lines[i + 1];
      if (nextLine && nextLine.indent > line.indent) {
        const nested = _parseBlock(lines, i + 1, nextLine.indent);
        list.push(nested.value);
        i = nested.nextIdx;
        continue;
      }
      list.push(null);
      i += 1;
      continue;
    }

    if (payload.startsWith('{')) {
      list.push(_parseFlowMapping(payload));
      i += 1;
      continue;
    }

    const colonAt = _findKeyColon(payload);
    if (colonAt !== -1) {
      const innerIndent = line.indent + 2;
      const virtLines = [{ indent: innerIndent, content: payload }];
      let j = i + 1;
      while (j < lines.length) {
        const l = lines[j];
        if (l.indent < innerIndent) break;
        if (l.indent === line.indent && l.content.startsWith('-')) break;
        virtLines.push(l);
        j += 1;
      }
      const mapResult = _parseMap(virtLines, 0, innerIndent);
      list.push(mapResult.value);
      i = j;
      continue;
    }

    list.push(_parseScalar(payload));
    i += 1;
  }
  return { value: list, nextIdx: i };
}

function _findKeyColon(content) {
  let inSingle = false;
  let inDouble = false;
  let brace = 0;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (!inSingle && !inDouble) {
      if (ch === '{') brace += 1;
      else if (ch === '}') brace -= 1;
      else if (ch === ':' && brace === 0) {
        const next = content[i + 1];
        if (next === undefined || next === ' ') return i;
      }
    }
  }
  return -1;
}

function _parseScalar(raw) {
  const s = raw.trim();
  if (s === '' || s.toLowerCase() === 'null' || s === '~') return null;
  if (s.toLowerCase() === 'true') return true;
  if (s.toLowerCase() === 'false') return false;
  if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) return s.slice(1, -1);
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) return s.slice(1, -1);
  if (s.startsWith('[') && s.endsWith(']')) return _parseFlowSequence(s);
  if (s.startsWith('{') && s.endsWith('}')) return _parseFlowMapping(s);
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d*\.\d+$/.test(s)) return parseFloat(s);
  return s;
}

function _parseFlowMapping(raw) {
  const inner = raw.replace(/^\{/, '').replace(/\}$/, '').trim();
  const out = {};
  if (!inner) return out;
  for (const part of _splitFlowParts(inner)) {
    const colon = _findKeyColon(part);
    if (colon === -1) continue;
    out[part.slice(0, colon).trim()] = _parseScalar(part.slice(colon + 1).trim());
  }
  return out;
}

function _parseFlowSequence(raw) {
  const inner = raw.replace(/^\[/, '').replace(/\]$/, '').trim();
  if (!inner) return [];
  return _splitFlowParts(inner).map(_parseScalar);
}

function _splitFlowParts(s) {
  const out = [];
  let buf = '';
  let inSingle = false;
  let inDouble = false;
  let brace = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (!inSingle && !inDouble) {
      if (ch === '{') brace += 1;
      else if (ch === '}') brace -= 1;
      else if (ch === ',' && brace === 0) {
        out.push(buf.trim());
        buf = '';
        continue;
      }
    }
    buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

// ─── Translation ──────────────────────────────────────────

function translateSupervisorProfile(parsed, { projectId, name }) {
  const out = {
    id: projectId,
    project: {
      id: projectId,
      name: name || projectId,
      memoryId: projectId,
    },
  };
  const worker = parsed && parsed.worker;
  const outWorker = {};
  if (worker) {
    if (worker.provider != null) outWorker.provider = worker.provider;
    if (worker.model != null) outWorker.model = worker.model;
    if (worker.auth != null) outWorker.auth = worker.auth;
    const perm = worker.permission;
    if (perm != null) {
      if (typeof perm === 'string') {
        outWorker.permission = perm;
      } else if (typeof perm === 'object') {
        outWorker.permission = {};
        if (perm.mode != null) outWorker.permission.mode = perm.mode;
        if (Array.isArray(perm.allowed_tools)) {
          outWorker.permission.allowedTools = perm.allowed_tools.slice();
        }
      }
    }
  }
  if (Object.keys(outWorker).length > 0) out.worker = outWorker;

  if (parsed && Array.isArray(parsed.context_sources)) {
    out.context_sources = parsed.context_sources.slice();
  }
  if (parsed && parsed.policy && typeof parsed.policy === 'object') {
    out.policy = JSON.parse(JSON.stringify(parsed.policy));
  }
  if (parsed && Array.isArray(parsed.roles)) {
    out.roles = JSON.parse(JSON.stringify(parsed.roles));
  }
  if (parsed && parsed.people && typeof parsed.people === 'object') {
    out.people = JSON.parse(JSON.stringify(parsed.people));
  }
  if (parsed && Array.isArray(parsed.capabilities)) {
    out.capabilities = parsed.capabilities.slice();
  }
  if (parsed && parsed.budgets && typeof parsed.budgets === 'object') {
    out.budgets = JSON.parse(JSON.stringify(parsed.budgets));
  }
  if (parsed && parsed.escalation && typeof parsed.escalation === 'object') {
    out.escalation = JSON.parse(JSON.stringify(parsed.escalation));
  }
  if (parsed && parsed.store != null) out.store = parsed.store;
  return out;
}

/**
 * Read + parse <profilesDir>/<profileName>.yaml. Returns null when the
 * file is missing or fails to parse.
 */
function readSupervisorProfile(profileName, profilesDir) {
  const dir = profilesDir || supervisorProfilesDir();
  const yamlPath = path.join(dir, `${profileName}.yaml`);
  if (!fs.existsSync(yamlPath)) return null;
  let raw;
  try { raw = fs.readFileSync(yamlPath, 'utf8'); } catch { return null; }
  try { return parseYaml(raw); } catch { return null; }
}

/**
 * On-the-fly fallback: given a project workdir, try to translate the
 * matching supervisor YAML. Returns null when no mapping or no YAML.
 * Does NOT write anything to disk — that is the migration script's job.
 */
function translateSupervisorProfileForWorkdir(projectPath, profilesDir) {
  const row = findMappingForWorkdir(projectPath);
  if (!row) return null;
  const parsed = readSupervisorProfile(row.profileName, profilesDir);
  if (!parsed) return null;
  return translateSupervisorProfile(parsed, row);
}

// Shallow merge: supervisor base + Frame override (per top-level key).
function mergeProfiles(supervisorProfile, frameProfile) {
  if (!frameProfile || typeof frameProfile !== 'object') return supervisorProfile;
  const out = { ...supervisorProfile };
  for (const k of Object.keys(frameProfile)) out[k] = frameProfile[k];
  return out;
}

module.exports = {
  PROJECT_MAP,
  DEFAULT_SUPERVISOR_PROFILES_DIR,
  supervisorProfilesDir,
  findMappingForWorkdir,
  parseYaml,
  translateSupervisorProfile,
  translateSupervisorProfileForWorkdir,
  readSupervisorProfile,
  mergeProfiles,
};
