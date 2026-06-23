/**
 * Memory mirror — writes durable decisions from the supervisor loop into
 * the project's Basic Memory directory.
 *
 * Mirrors supervisor/store/memory_mirror.py:40-80. Only "durable"
 * categories trigger a write; trivia (style, naming, formatting) does
 * not pollute the memory.
 *
 * Public surface:
 *   recordDurableDecision(projectPath, payload) →
 *     { written: bool, notePath?, reason? }
 *
 * The supervisor loop calls this on every ESCALATE-answered or
 * AUTO_ANSWER with a durable category. The renderer never calls this
 * directly.
 */

const path = require('path');
const { BasicMemoryBackend, defaultRootDir } = require('./memory');
const { loadProfile } = require('./profile');

// Categories whose decisions are worth carrying forward across sessions.
// Conservative default; profiles may extend via the override below.
const DEFAULT_DURABLE_CATEGORIES = new Set([
  'dependency',
  'schema',
  'consistency',
  'deployment',
  'security',
  'architecture',
]);

function isDurableCategory(category, profile) {
  if (!category) return false;
  const override = profile && profile.memory_mirror && Array.isArray(profile.memory_mirror.durable_categories);
  const set = override
    ? new Set(profile.memory_mirror.durable_categories)
    : DEFAULT_DURABLE_CATEGORIES;
  return set.has(category);
}

function deriveProjectId(profile, projectPath) {
  if (profile && profile.project && typeof profile.project.memoryId === 'string' && profile.project.memoryId) {
    return profile.project.memoryId;
  }
  if (profile && typeof profile.id === 'string' && profile.id) return profile.id;
  if (projectPath) return path.basename(projectPath);
  return 'default';
}

/**
 * @param {string} projectPath
 * @param {{
 *   category: string,
 *   spec_slug: string,
 *   task_id?: string,
 *   draftedQuestion: string,
 *   answer: string,
 *   reasoning?: string,
 *   confidence?: number,
 *   route?: string,   // 'escalate' | 'auto_answer' | 'research'
 * }} payload
 * @returns {{written: boolean, notePath?: string, reason?: string}}
 */
async function recordDurableDecision(projectPath, payload) {
  if (!projectPath) return { written: false, reason: 'projectPath required' };
  if (!payload || typeof payload !== 'object') {
    return { written: false, reason: 'payload required' };
  }
  const { profile } = loadProfile(projectPath);
  if (!isDurableCategory(payload.category, profile)) {
    return { written: false, reason: `category not durable: ${payload.category}` };
  }
  if (!payload.spec_slug || !payload.draftedQuestion || !payload.answer) {
    return { written: false, reason: 'spec_slug + draftedQuestion + answer required' };
  }
  const bm = new BasicMemoryBackend({
    rootDir: defaultRootDir(),
    projectId: deriveProjectId(profile, projectPath),
  });
  const title = _buildTitle(payload);
  const body = _buildBody(payload);
  const metadata = {
    category: payload.category,
    spec_slug: payload.spec_slug,
    durable: 'true',
    route: payload.route || 'escalate',
    ...(payload.task_id ? { task_id: payload.task_id } : {}),
    ...(payload.confidence != null ? { confidence: String(payload.confidence) } : {}),
  };
  try {
    const note = await bm.write({ category: 'decisions', title, body, metadata });
    return { written: true, notePath: note.path };
  } catch (err) {
    return { written: false, reason: err.message || String(err) };
  }
}

function _buildTitle(payload) {
  const stem = (payload.spec_slug || 'spec') + (payload.task_id ? `-${payload.task_id}` : '');
  return `${stem}-${Date.now()}`;
}

function _buildBody(payload) {
  const lines = [];
  lines.push(`# ${payload.draftedQuestion}`);
  lines.push('');
  lines.push(`**Answer:** ${payload.answer}`);
  if (payload.reasoning) {
    lines.push('');
    lines.push(`**Reasoning:** ${payload.reasoning}`);
  }
  if (payload.confidence != null) {
    lines.push('');
    lines.push(`**Confidence:** ${payload.confidence}`);
  }
  return lines.join('\n');
}

module.exports = {
  recordDurableDecision,
  isDurableCategory,
  DEFAULT_DURABLE_CATEGORIES,
};
