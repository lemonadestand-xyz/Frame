/**
 * Chat Session Manager
 *
 * Owns cross-project chat sessions under ~/.frame/chat-sessions/<id>/.
 * Each session is a staging directory containing:
 *
 *   CLAUDE.md / AGENTS.md       — primer that orients the AI tool
 *   context/<project-slug>/
 *     metadata.md               — name, description, KV pairs, real path
 *     tasks.md                  — readable task list (status / priority / dates / refs)
 *   suggestions/                — agent writes proposed action items here
 *     <uuid>.json               — { type, project, title, description, ... }
 *
 * Sessions persist on disk. Claude Code stores its conversation history
 * keyed by cwd, so reopening a session and launching the CLI again
 * resumes the prior conversation for free.
 *
 * The suggestions/ directory is watched. New JSON files are parsed and
 * pushed to the renderer for the user to apply or dismiss.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { IPC } = require('../shared/ipcChannels');
const { WORKSPACE_DIR } = require('../shared/frameConstants');

const SESSIONS_DIR = 'chat-sessions';
const SUGGESTIONS_DIRNAME = 'suggestions';
const PRIMER_FILENAMES = ['CLAUDE.md', 'AGENTS.md'];

let mainWindow = null;
let sessionsRoot = null;
let globalDashboardManager = null;
let tasksManager = null;
const watchers = new Map(); // sessionId -> { watcher, debounce }

function init(window) {
  mainWindow = window;
  sessionsRoot = path.join(os.homedir(), WORKSPACE_DIR, SESSIONS_DIR);
  if (!fs.existsSync(sessionsRoot)) fs.mkdirSync(sessionsRoot, { recursive: true });
  // Lazy-required to avoid load-order coupling
  globalDashboardManager = require('./globalDashboardManager');
  tasksManager = require('./tasksManager');
  rebindWatchers();
}

function generateSessionId() {
  const ts = new Date().toISOString().replace(/[^0-9TZ]/g, '').slice(0, 15);
  const tag = crypto.randomBytes(3).toString('hex');
  return `${ts}-${tag}`;
}

function slugify(name) {
  return String(name || 'project')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40) || 'project';
}

function listSessions() {
  if (!fs.existsSync(sessionsRoot)) return [];
  const entries = fs.readdirSync(sessionsRoot, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(sessionsRoot, entry.name);
    const metaPath = path.join(dir, 'session.json');
    let meta = null;
    if (fs.existsSync(metaPath)) {
      try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch (_) { /* skip */ }
    }
    out.push({
      id: entry.name,
      path: dir,
      title: (meta && meta.title) || entry.name,
      projects: (meta && meta.projects) || [],
      createdAt: (meta && meta.createdAt) || null,
      suggestions: readSuggestions(dir)
    });
  }
  out.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return out;
}

function readSuggestions(sessionDir) {
  const dir = path.join(sessionDir, SUGGESTIONS_DIRNAME);
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const fname of fs.readdirSync(dir)) {
    if (!fname.endsWith('.json')) continue;
    const full = path.join(dir, fname);
    try {
      const raw = JSON.parse(fs.readFileSync(full, 'utf8'));
      out.push({ id: fname.replace(/\.json$/, ''), file: full, ...raw });
    } catch (err) {
      console.warn('Bad suggestion file:', full, err.message);
    }
  }
  return out;
}

/**
 * Create a new staging directory bootstrapped with primer + context.
 * `projectPaths` is the list of registry-tracked project paths to include.
 * `title` is a human label shown in the session list.
 */
function createSession({ title, projectPaths = [] }) {
  if (!projectPaths || projectPaths.length === 0) {
    throw new Error('At least one project must be selected');
  }
  const id = generateSessionId();
  const dir = path.join(sessionsRoot, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'context'), { recursive: true });
  fs.mkdirSync(path.join(dir, SUGGESTIONS_DIRNAME), { recursive: true });

  const registry = globalDashboardManager.loadRegistry();
  const includedProjects = [];

  for (const projectPath of projectPaths) {
    const entry = registry.projects[projectPath];
    if (!entry) continue;
    const slug = slugify(entry.name);
    const projDir = path.join(dir, 'context', slug);
    fs.mkdirSync(projDir, { recursive: true });
    fs.writeFileSync(path.join(projDir, 'metadata.md'), renderMetadataMd(entry));
    fs.writeFileSync(path.join(projDir, 'tasks.md'), renderTasksMd(entry));
    includedProjects.push({ slug, name: entry.name, path: entry.path });
  }

  const meta = {
    id,
    title: title || defaultSessionTitle(includedProjects),
    projects: includedProjects,
    createdAt: new Date().toISOString()
  };
  fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify(meta, null, 2));

  // Primer — written under both filenames so Claude Code (CLAUDE.md)
  // and other tools (AGENTS.md) pick it up.
  const primer = renderPrimer(meta);
  for (const fname of PRIMER_FILENAMES) {
    fs.writeFileSync(path.join(dir, fname), primer);
  }

  startSuggestionsWatcher(id, dir);
  return meta;
}

function deleteSession(id) {
  const dir = path.join(sessionsRoot, id);
  if (!fs.existsSync(dir)) return false;
  stopSuggestionsWatcher(id);
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

function defaultSessionTitle(projects) {
  if (!projects || projects.length === 0) return 'Cross-project chat';
  if (projects.length <= 3) {
    return `Chat: ${projects.map(p => p.name).join(', ')}`;
  }
  return `Chat: ${projects.slice(0, 3).map(p => p.name).join(', ')} +${projects.length - 3}`;
}

function renderMetadataMd(entry) {
  const lines = [`# ${entry.name}`, ''];
  lines.push(`- **directory:** ${entry.path}`);
  if (entry.description) lines.push(`- **description:** ${entry.description}`);
  if (entry.metadata && Object.keys(entry.metadata).length > 0) {
    lines.push('', '## Metadata', '');
    for (const [k, v] of Object.entries(entry.metadata)) {
      lines.push(`- **${k}:** ${v}`);
    }
  }
  lines.push('', '## Pointers for deeper reads', '');
  lines.push(`- The project's real ${entry.path}/tasks.json (write-ready)`);
  lines.push(`- ${entry.path}/PROJECT_NOTES.md if it exists`);
  lines.push(`- ${entry.path}/STRUCTURE.json if it exists`);
  lines.push(`- ${entry.path}/CLAUDE.md (the project's own AI instructions)`);
  return lines.join('\n') + '\n';
}

function renderTasksMd(entry) {
  const snap = entry.taskSnapshot;
  if (!snap || !Array.isArray(snap.tasks) || snap.tasks.length === 0) {
    return `# ${entry.name} — tasks\n\n_No tasks at last sync._\n`;
  }
  const grouped = { pending: [], in_progress: [], completed: [] };
  for (const t of snap.tasks) {
    const status = (t.status === 'in_progress' || t.status === 'completed') ? t.status : 'pending';
    grouped[status].push(t);
  }
  const out = [`# ${entry.name} — tasks`, ''];
  out.push(`_Snapshot read ${snap.readAt || 'unknown'}_`, '');
  const renderTask = (t) => {
    const lines = [];
    const tag = (t.priority || 'medium').toUpperCase();
    lines.push(`- **[${tag}]** ${t.title || 'Untitled'} (#${t.id})`);
    if (t.description) lines.push(`    - ${t.description.split('\n').join(' ')}`);
    if (t.acceptanceCriteria) lines.push(`    - **acceptance:** ${t.acceptanceCriteria.split('\n').join(' ')}`);
    if (t.startDate) lines.push(`    - **starts:** ${t.startDate}`);
    if (t.endDate) lines.push(`    - **due:** ${t.endDate}`);
    if (t.category) lines.push(`    - **category:** ${t.category}`);
    if (Array.isArray(t.references) && t.references.length > 0) {
      const refs = t.references.map(r => r.label || r.value).join(', ');
      lines.push(`    - **refs:** ${refs}`);
    }
    if (t.parentId) lines.push(`    - **parent:** #${t.parentId}`);
    return lines.join('\n');
  };
  if (grouped.in_progress.length > 0) {
    out.push('## In progress', '');
    grouped.in_progress.forEach(t => out.push(renderTask(t)));
    out.push('');
  }
  if (grouped.pending.length > 0) {
    out.push('## Pending', '');
    grouped.pending.forEach(t => out.push(renderTask(t)));
    out.push('');
  }
  if (grouped.completed.length > 0) {
    out.push('## Completed', '');
    grouped.completed.forEach(t => out.push(renderTask(t)));
    out.push('');
  }
  return out.join('\n') + '\n';
}

function renderPrimer(meta) {
  const projList = meta.projects
    .map(p => `- **${p.name}** — context in \`./context/${p.slug}/\` · real directory \`${p.path}\``)
    .join('\n');
  return `# Cross-Project Planning Session

You are Christopher's cross-project planning assistant. This is the
**overview-session chat** — distinct from per-project execution
terminals. You are not editing code here. You are reviewing,
synthesizing, and proposing.

## Projects in scope

${projList}

## What's in \`./context/\`

For each project you have two files:

- \`metadata.md\` — name, description, freeform KV metadata
  (budget, deadlines, stakeholders, etc.), and the project's **real
  directory path** on disk.
- \`tasks.md\` — all tasks at the last sync, grouped by status, with
  priority / dates / references / acceptance criteria.

These are **read-only snapshots**. Do **not** edit anything under
\`./context/\` — your edits won't reach the real projects and will be
overwritten on the next sync.

If you need more depth than the snapshot, read directly from the real
project directories listed above. Useful starting points per project:

- \`<project-dir>/tasks.json\` — authoritative task list
- \`<project-dir>/PROJECT_NOTES.md\` — decisions and history
- \`<project-dir>/STRUCTURE.json\` — codebase map
- \`<project-dir>/CLAUDE.md\` — the project's own AI instructions

Treat these reads as research. Do **not** modify project files from
this session — that's what the per-project terminals are for.

## How to propose action items

When you have a concrete actionable item, write it to
\`./suggestions/<short-id>.json\` with one of these shapes:

**Add a new task:**

\`\`\`json
{
  "type": "add-task",
  "project": "<project name from list above>",
  "title": "Short actionable title",
  "description": "What and why, 1-3 sentences",
  "priority": "high | medium | low",
  "category": "feature | fix | refactor | docs | test",
  "endDate": "YYYY-MM-DD or null",
  "rationale": "Why this matters now"
}
\`\`\`

**Update an existing task:**

\`\`\`json
{
  "type": "update-task",
  "project": "<project name>",
  "taskId": "<task id from tasks.md>",
  "updates": { "status": "in_progress", "priority": "high" },
  "rationale": "Why this change now"
}
\`\`\`

Use a short unique id for the filename (e.g. \`a1b2c3.json\`). Frame
watches \`./suggestions/\` and surfaces each new file as a card with
an **Apply** button — the user reviews before anything is written to
the real project. Do not try to apply changes yourself.

## Style

- Ground every claim in the context. When you reference a task,
  include its id (#task-xxx). When you reference a project decision,
  quote or paraphrase the source file.
- If the user's question requires data you don't have, say so plainly
  and ask — don't guess.
- Prefer concise summaries with grouped bullets over walls of prose.
`;
}

/* -------------------- Suggestions watcher -------------------- */

function rebindWatchers() {
  for (const session of listSessions()) {
    startSuggestionsWatcher(session.id, session.path);
  }
}

function startSuggestionsWatcher(sessionId, sessionDir) {
  if (watchers.has(sessionId)) return;
  const dir = path.join(sessionDir, SUGGESTIONS_DIRNAME);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  try {
    let timer = null;
    const watcher = fs.watch(dir, { persistent: false }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => pushSuggestions(sessionId, sessionDir), 80);
    });
    watchers.set(sessionId, { watcher, timer });
  } catch (err) {
    console.warn('Failed to watch suggestions dir for', sessionId, err.message);
  }
}

function stopSuggestionsWatcher(sessionId) {
  const entry = watchers.get(sessionId);
  if (!entry) return;
  try { entry.watcher.close(); } catch (_) { /* ignore */ }
  watchers.delete(sessionId);
}

function pushSuggestions(sessionId, sessionDir) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const suggestions = readSuggestions(sessionDir);
  mainWindow.webContents.send(IPC.CHAT_SUGGESTIONS_DATA, {
    sessionId,
    suggestions
  });
}

function dismissSuggestion(sessionId, suggestionId) {
  const dir = path.join(sessionsRoot, sessionId, SUGGESTIONS_DIRNAME);
  const file = path.join(dir, `${suggestionId}.json`);
  if (fs.existsSync(file)) {
    try { fs.unlinkSync(file); return true; } catch (_) { return false; }
  }
  return false;
}

/**
 * Apply a suggestion to the real project. Currently supports:
 *  - add-task: creates a new task in the matching project's tasks.json
 *  - update-task: applies updates to an existing task
 *
 * The suggestion file is deleted on success so the card disappears.
 * On failure we leave the suggestion in place so the user can retry.
 */
function applySuggestion(sessionId, suggestionId) {
  const sessionDir = path.join(sessionsRoot, sessionId);
  const sessionMetaPath = path.join(sessionDir, 'session.json');
  if (!fs.existsSync(sessionMetaPath)) return { ok: false, error: 'Session not found' };

  const sessionMeta = JSON.parse(fs.readFileSync(sessionMetaPath, 'utf8'));
  const suggestionFile = path.join(sessionDir, SUGGESTIONS_DIRNAME, `${suggestionId}.json`);
  if (!fs.existsSync(suggestionFile)) return { ok: false, error: 'Suggestion not found' };

  const suggestion = JSON.parse(fs.readFileSync(suggestionFile, 'utf8'));
  const projectMatch = (sessionMeta.projects || []).find(p =>
    p.name === suggestion.project || p.slug === suggestion.project
  );
  if (!projectMatch) {
    return { ok: false, error: `Project "${suggestion.project}" not in session scope` };
  }

  if (suggestion.type === 'add-task') {
    const created = tasksManager.addTask(projectMatch.path, {
      title: suggestion.title,
      description: suggestion.description || '',
      priority: suggestion.priority || 'medium',
      category: suggestion.category || 'feature',
      startDate: suggestion.startDate || null,
      endDate: suggestion.endDate || null,
      references: suggestion.references || []
    });
    if (!created) return { ok: false, error: 'Failed to write task' };
    try { fs.unlinkSync(suggestionFile); } catch (_) { /* ignore */ }
    return { ok: true, applied: { type: 'add-task', taskId: created.id, project: projectMatch.path } };
  }

  if (suggestion.type === 'update-task') {
    if (!suggestion.taskId) return { ok: false, error: 'taskId required for update-task' };
    const updated = tasksManager.updateTask(projectMatch.path, suggestion.taskId, suggestion.updates || {});
    if (!updated) return { ok: false, error: 'Task not found or update failed' };
    try { fs.unlinkSync(suggestionFile); } catch (_) { /* ignore */ }
    return { ok: true, applied: { type: 'update-task', taskId: suggestion.taskId, project: projectMatch.path } };
  }

  return { ok: false, error: `Unsupported suggestion type "${suggestion.type}"` };
}

/* -------------------- IPC -------------------- */

function setupIPC(ipcMain) {
  ipcMain.handle(IPC.CREATE_CHAT_SESSION, async (event, { title, projectPaths } = {}) => {
    try {
      const meta = createSession({ title, projectPaths });
      // Push fresh sessions list right after creation
      if (event.sender && !event.sender.isDestroyed()) {
        event.sender.send(IPC.CHAT_SESSIONS_DATA, listSessions());
      }
      return { ok: true, session: meta };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.on(IPC.LIST_CHAT_SESSIONS, (event) => {
    event.sender.send(IPC.CHAT_SESSIONS_DATA, listSessions());
  });

  ipcMain.on(IPC.DELETE_CHAT_SESSION, (event, { id } = {}) => {
    deleteSession(id);
    event.sender.send(IPC.CHAT_SESSIONS_DATA, listSessions());
  });

  ipcMain.handle(IPC.APPLY_CHAT_SUGGESTION, (event, { sessionId, suggestionId } = {}) => {
    const result = applySuggestion(sessionId, suggestionId);
    // Push fresh sessions list so the suggestion count updates
    if (event.sender && !event.sender.isDestroyed()) {
      event.sender.send(IPC.CHAT_SESSIONS_DATA, listSessions());
    }
    return result;
  });

  ipcMain.on(IPC.DISMISS_CHAT_SUGGESTION, (event, { sessionId, suggestionId } = {}) => {
    dismissSuggestion(sessionId, suggestionId);
    event.sender.send(IPC.CHAT_SESSIONS_DATA, listSessions());
  });
}

module.exports = {
  init,
  setupIPC,
  listSessions,
  createSession,
  deleteSession,
  applySuggestion
};
