/**
 * Basic Memory backend — Node port of the supervisor's `BasicMemoryBackend`
 * (supervisor/memory.py around line 60).
 *
 * On-disk layout (shared with the supervisor app, both processes can read/write):
 *
 *   ~/memory/<project_id>/
 *     rules/<title>.md
 *     decisions/<slug>.md
 *     context/<slug>.md
 *     transcripts/<slug>.md
 *
 * Each note is a markdown file with YAML-ish frontmatter:
 *
 *   ---
 *   category: dependency
 *   spec_slug: frame-supervisor-loop
 *   created_at: 2026-06-22T01:30:00Z
 *   ---
 *   # Title
 *   body body body
 *
 * Search is a keyword score over title+body tokens. Notes in `rules/` get
 * a 2× multiplier — same as the supervisor at supervisor/memory.py:94-95.
 *
 * The frontmatter parser is intentionally tiny: it accepts only flat
 * `key: value` lines between two `---` fences. The supervisor's Python
 * loader is equivalently strict for this directory layout. If a downstream
 * use case requires nested YAML, swap in a real YAML parser then.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CATEGORIES = ['rules', 'decisions', 'context', 'transcripts'];
const RULES_SCORE_MULTIPLIER = 2;
const DEFAULT_TOP_K = 5;
const MIN_TOKEN_LEN = 3;
const LEGACY_HASH_PREFIX = 'frame-mirror-project-';
const LEGACY_HASH_LEN = 6;
const LEGACY_HASH_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function defaultRootDir() {
  return path.join(os.homedir(), 'memory');
}

// ─── Project id resolution ────────────────────────────────
//
// Memory dirs are named by the canonical project id from
// `<projectPath>/.frame/profile.json`'s `project.memoryId` field —
// mirroring the supervisor convention (~/memory/localized/, etc.).
// When the profile is absent or the field is unset, the resolver
// falls back to the legacy `frame-mirror-project-<hash>` format so
// older sandboxes that never declared a profile keep working.

const _resolutionLogged = new Set();
const _autoBridgeAttempted = new Set();

/**
 * Deterministic 6-char base62 hash of a project path. Used as the
 * fallback bucket name for projects without a `.frame/profile.json`.
 * Same format as the legacy `frame-mirror-project-XXXX` dirs.
 */
function _legacyHashOf(projectPath) {
  const buf = crypto.createHash('sha1').update(String(projectPath)).digest();
  let out = '';
  for (let i = 0; i < LEGACY_HASH_LEN; i++) {
    out += LEGACY_HASH_CHARS[buf[i] % LEGACY_HASH_CHARS.length];
  }
  return out;
}

function legacyHashNameFor(projectPath) {
  return `${LEGACY_HASH_PREFIX}${_legacyHashOf(projectPath)}`;
}

function resolveProjectId(projectPath, { rootDir } = {}) {
  if (!projectPath) return 'default';
  let resolved = null;
  let source = 'hash';
  try {
    const profilePath = path.join(projectPath, '.frame', 'profile.json');
    if (fs.existsSync(profilePath)) {
      const raw = fs.readFileSync(profilePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && parsed.project && typeof parsed.project.memoryId === 'string' && parsed.project.memoryId) {
        resolved = parsed.project.memoryId;
        source = 'profile.project.memoryId';
      }
    }
  } catch { /* swallow — fall through to hash */ }
  if (!resolved) {
    resolved = legacyHashNameFor(projectPath);
    source = 'hash';
  }
  // Emit a one-time INFO line so the user can confirm which projects
  // resolve to named dirs vs. the hash fallback.
  const key = `${projectPath}::${resolved}`;
  if (!_resolutionLogged.has(key)) {
    _resolutionLogged.add(key);
    // eslint-disable-next-line no-console
    console.log(`[memory] ${projectPath} → ~/memory/${resolved}/ (via ${source})`);
  }
  // Auto-bridge: when a project resolves to a NAMED id and a legacy
  // hash dir exists for the same projectPath, bridge it once per
  // process. Safe-by-construction — bridgeLegacyHashDir refuses to
  // overwrite a populated named dir.
  if (source === 'profile.project.memoryId') {
    const bridgeKey = `${projectPath}::${resolved}::bridge`;
    if (!_autoBridgeAttempted.has(bridgeKey)) {
      _autoBridgeAttempted.add(bridgeKey);
      try {
        bridgeLegacyHashDir({
          rootDir: rootDir || defaultRootDir(),
          hashName: legacyHashNameFor(projectPath),
          namedId: resolved,
        });
      } catch { /* swallow — never block resolution on a bridge error */ }
    }
  }
  return resolved;
}

/**
 * Bridge a legacy `frame-mirror-project-<XXXX>` directory to a named id
 * by renaming the old dir to the new name and replacing the old path
 * with a symlink → named.
 *
 * Safe by construction:
 *   - If the named dir already exists with content → log + no-op
 *     (collision; manual merge required)
 *   - If `hashName` is already a symlink → no-op
 *   - Otherwise: rename hashDir → namedDir, then symlink hashName → named.
 *
 * Returns `{ action: 'noop' | 'bridged' | 'collision' | 'missing', reason? }`.
 */
function bridgeLegacyHashDir({ rootDir, hashName, namedId }) {
  const root = rootDir || defaultRootDir();
  if (!hashName || !namedId) return { action: 'noop', reason: 'hashName + namedId required' };
  const hashPath = path.join(root, hashName);
  const namedPath = path.join(root, namedId);
  if (!fs.existsSync(hashPath)) return { action: 'missing', reason: `${hashPath} does not exist` };

  let hashStat;
  try { hashStat = fs.lstatSync(hashPath); } catch { return { action: 'noop', reason: 'lstat failed' }; }
  if (hashStat.isSymbolicLink()) return { action: 'noop', reason: 'already a symlink' };

  const namedExists = fs.existsSync(namedPath);
  if (namedExists) {
    // Treat any populated named dir as "real content" — collision.
    let namedHasContent = false;
    try {
      for (const cat of CATEGORIES) {
        const dir = path.join(namedPath, cat);
        if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) {
          namedHasContent = true; break;
        }
      }
    } catch { namedHasContent = true; }
    if (namedHasContent) {
      // eslint-disable-next-line no-console
      console.warn(`[memory] ${hashPath} and ${namedPath} both have content — skipping bridge to avoid data loss`);
      return { action: 'collision', reason: 'both dirs populated' };
    }
    // Named exists but empty → remove it so the rename can land.
    try { fs.rmdirSync(namedPath); } catch { /* swallow */ }
  }
  try {
    fs.renameSync(hashPath, namedPath);
    fs.symlinkSync(namedPath, hashPath, 'dir');
    // eslint-disable-next-line no-console
    console.log(`[memory] bridged ${hashName} → ${namedId}`);
    return { action: 'bridged' };
  } catch (err) {
    return { action: 'noop', reason: err.message || String(err) };
  }
}

function tokenize(text) {
  if (!text) return [];
  const lower = String(text).toLowerCase();
  // Split on whitespace + most punctuation; keep alphanumerics + underscore + hyphen
  const raw = lower.split(/[^a-z0-9_-]+/);
  return raw.filter((t) => t.length >= MIN_TOKEN_LEN);
}

function parseFrontmatter(raw) {
  if (typeof raw !== 'string') return { metadata: {}, body: '' };
  if (!raw.startsWith('---')) return { metadata: {}, body: raw };
  const after = raw.slice(3);
  const end = after.indexOf('\n---');
  if (end === -1) return { metadata: {}, body: raw };
  const fmText = after.slice(0, end).trim();
  const body = after.slice(end + 4).replace(/^\r?\n/, '');
  const metadata = {};
  for (const line of fmText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colon = trimmed.indexOf(':');
    if (colon <= 0) continue;
    const key = trimmed.slice(0, colon).trim();
    let value = trimmed.slice(colon + 1).trim();
    // Strip simple quotes if present
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    metadata[key] = value;
  }
  return { metadata, body };
}

function serialiseFrontmatter(metadata) {
  const keys = Object.keys(metadata || {});
  if (keys.length === 0) return '';
  const lines = ['---'];
  for (const k of keys) {
    lines.push(`${k}: ${metadata[k]}`);
  }
  lines.push('---', '');
  return lines.join('\n');
}

function safeFilename(title) {
  const base = String(title || 'note').toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (base || 'note').slice(0, 96) + '.md';
}

class BasicMemoryBackend {
  /**
   * @param {object} opts
   * @param {string} [opts.rootDir] — defaults to ~/memory
   * @param {string} [opts.projectId] — explicit override; wins over projectPath
   * @param {string} [opts.projectPath] — when provided, resolveProjectId reads
   *   <projectPath>/.frame/profile.json to derive the dir name (preferring
   *   `project.memoryId`, then `id`, then basename)
   */
  constructor({ rootDir, projectId, projectPath } = {}) {
    this.rootDir = rootDir || defaultRootDir();
    if (projectId) {
      this.projectId = projectId;
    } else if (projectPath) {
      // Pass rootDir through so auto-bridge fires against the same root
      // we'll actually read from.
      this.projectId = resolveProjectId(projectPath, { rootDir: this.rootDir });
    } else {
      this.projectId = 'default';
    }
  }

  projectDir() {
    return path.join(this.rootDir, this.projectId);
  }

  categoryDir(category) {
    return path.join(this.projectDir(), category);
  }

  /**
   * @param {string} query
   * @param {number} k
   * @returns {Promise<Array<{path,title,category,metadata,body,score}>>}
   */
  async search(query, k = DEFAULT_TOP_K) {
    const qTokens = new Set(tokenize(query));
    if (qTokens.size === 0) return [];

    const all = await this.list({});
    const scored = [];
    for (const note of all) {
      const haystack = `${note.title || ''} ${note.body || ''}`;
      const noteTokens = tokenize(haystack);
      let intersection = 0;
      for (const t of noteTokens) {
        if (qTokens.has(t)) intersection += 1;
      }
      if (intersection === 0) continue;
      let score = intersection;
      if (note.category === 'rules') score *= RULES_SCORE_MULTIPLIER;
      scored.push({ ...note, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
  }

  /**
   * @param {{category?: string, spec_slug?: string}} opts
   * @returns {Promise<Array<{path,title,category,metadata,body}>>}
   */
  async list({ category, spec_slug } = {}) {
    const projDir = this.projectDir();
    if (!fs.existsSync(projDir)) return [];
    const cats = category ? [category] : CATEGORIES;
    const out = [];
    for (const cat of cats) {
      const dir = this.categoryDir(cat);
      if (!fs.existsSync(dir)) continue;
      let names;
      try { names = fs.readdirSync(dir); } catch { continue; }
      for (const name of names) {
        if (!name.endsWith('.md')) continue;
        const notePath = path.join(dir, name);
        let raw;
        try { raw = fs.readFileSync(notePath, 'utf8'); } catch { continue; }
        const { metadata, body } = parseFrontmatter(raw);
        if (spec_slug && metadata.spec_slug !== spec_slug) continue;
        // Title: first markdown H1 in body, else filename stem
        const m = body.match(/^#\s+(.+?)\s*$/m);
        const title = (m && m[1]) || name.replace(/\.md$/, '');
        out.push({ path: notePath, title, category: cat, metadata, body });
      }
    }
    return out;
  }

  async read(notePath) {
    if (!fs.existsSync(notePath)) return null;
    const raw = fs.readFileSync(notePath, 'utf8');
    const { metadata, body } = parseFrontmatter(raw);
    const m = body.match(/^#\s+(.+?)\s*$/m);
    const title = (m && m[1]) || path.basename(notePath, '.md');
    // Derive category from parent dir name when it matches a known category
    const parent = path.basename(path.dirname(notePath));
    const category = CATEGORIES.includes(parent) ? parent : null;
    return { path: notePath, title, category, metadata, body };
  }

  /**
   * Write a note. `category` MUST be one of CATEGORIES; `title` is used both
   * as the body H1 and the filename stem. Returns the written Note.
   */
  async write({ category, title, body, metadata }) {
    if (!CATEGORIES.includes(category)) {
      throw new Error(`unknown category: ${category}`);
    }
    if (!title || typeof title !== 'string') throw new Error('title required');
    const dir = this.categoryDir(category);
    fs.mkdirSync(dir, { recursive: true });
    const fullMetadata = {
      category,
      created_at: new Date().toISOString(),
      ...(metadata || {}),
    };
    const fileBody = body && body.startsWith('# ')
      ? body
      : `# ${title}\n\n${body || ''}`;
    const content = serialiseFrontmatter(fullMetadata) + fileBody.replace(/\s+$/, '') + '\n';
    const notePath = path.join(dir, safeFilename(title));
    fs.writeFileSync(notePath, content, 'utf8');
    return { path: notePath, title, category, metadata: fullMetadata, body: fileBody };
  }
}

module.exports = {
  BasicMemoryBackend,
  CATEGORIES,
  RULES_SCORE_MULTIPLIER,
  LEGACY_HASH_PREFIX,
  defaultRootDir,
  resolveProjectId,
  legacyHashNameFor,
  bridgeLegacyHashDir,
  // exposed for tests
  tokenize,
  parseFrontmatter,
  serialiseFrontmatter,
  safeFilename,
};
