/**
 * Spec Attachments
 *
 * Storage layer for files (screenshots, PDFs, docs) referenced from a
 * spec's spec.md / plan.md. Files live at:
 *
 *   .frame/specs/<slug>/attachments/<filename>
 *
 * For the New Spec modal — where the slug doesn't exist yet — files are
 * staged at:
 *
 *   .frame/runtime/spec-attachments-staging/<stagingId>/<filename>
 *
 * and then moved into the spec's attachments dir on createSpec.
 * (Plan called for an `attachments/.staging/` sibling under
 * `.frame/specs/`, but that path collides with specManager's slug
 * discovery walker. .frame/runtime/ already houses ephemeral state.)
 */

const fs = require('fs');
const path = require('path');
const { FRAME_DIR } = require('../shared/frameConstants');

const SPECS_DIR_NAME = 'specs';
const ATTACHMENTS_DIR_NAME = 'attachments';
const STAGING_DIR_NAME = path.join('runtime', 'spec-attachments-staging');
const STATUS_FILE = 'status.json';

const MAX_BYTES = 25 * 1024 * 1024;
const SAFE_NAME_RE = /[^A-Za-z0-9._-]/g;

// ─── Path helpers ─────────────────────────────────────────

function getSpecAttachmentsDir(projectPath, slug) {
  return path.join(projectPath, FRAME_DIR, SPECS_DIR_NAME, slug, ATTACHMENTS_DIR_NAME);
}

function getStagingDir(projectPath, stagingId) {
  return path.join(projectPath, FRAME_DIR, STAGING_DIR_NAME, stagingId);
}

function specExists(projectPath, slug) {
  return fs.existsSync(path.join(projectPath, FRAME_DIR, SPECS_DIR_NAME, slug, STATUS_FILE));
}

// ─── Filename machinery ───────────────────────────────────

// Strip path components, normalise to a safe set, and guarantee a non-empty
// basename. Path traversal (`..`), null bytes, and exotic separators are all
// neutralised. The extension is preserved when possible.
function sanitizeBasename(originalName) {
  const raw = String(originalName == null ? '' : originalName);
  // Strip directory segments (handles both / and \), then trim leading dots
  // so we don't accidentally produce a hidden file.
  const base = raw.replace(/^.*[\\/]/, '').replace(/^\.+/, '');
  if (!base) return 'file';
  const cleaned = base.replace(SAFE_NAME_RE, '_').replace(/_+/g, '_');
  return cleaned || 'file';
}

// ISO timestamp safe for filenames on every OS (colons replaced).
function timestampPrefix(now) {
  const d = now instanceof Date ? now : new Date();
  return d.toISOString().replace(/:/g, '-').replace(/\.\d+Z$/, 'Z');
}

function buildAttachmentFilename(originalName, now) {
  return `${timestampPrefix(now)}__${sanitizeBasename(originalName)}`;
}

// ─── Shared write (size cap + dispatch on kind) ───────────

function writePayloadTo(targetDir, payload) {
  if (!payload || typeof payload !== 'object') {
    return { success: false, error: 'payload required' };
  }
  const { kind, originalName } = payload;
  if (kind !== 'path' && kind !== 'buffer') {
    return { success: false, error: `unknown payload.kind: ${kind}` };
  }

  const filename = buildAttachmentFilename(originalName, new Date());
  const destPath = path.join(targetDir, filename);

  try {
    fs.mkdirSync(targetDir, { recursive: true });

    if (kind === 'path') {
      const sourcePath = payload.sourcePath;
      if (!sourcePath || typeof sourcePath !== 'string') {
        return { success: false, error: 'payload.sourcePath required for kind=path' };
      }
      let stat;
      try {
        stat = fs.statSync(sourcePath);
      } catch (err) {
        return { success: false, error: `source not readable: ${err.message}` };
      }
      if (!stat.isFile()) return { success: false, error: 'source is not a file' };
      if (stat.size > MAX_BYTES) {
        return { success: false, error: `file exceeds 25 MB cap (${stat.size} bytes)` };
      }
      fs.copyFileSync(sourcePath, destPath);
    } else {
      const data = payload.data;
      if (typeof data !== 'string') {
        return { success: false, error: 'payload.data (base64 string) required for kind=buffer' };
      }
      const buf = Buffer.from(data, 'base64');
      if (buf.length > MAX_BYTES) {
        return { success: false, error: `buffer exceeds 25 MB cap (${buf.length} bytes)` };
      }
      fs.writeFileSync(destPath, buf);
    }

    return { success: true, filename, absolutePath: destPath };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
}

// ─── Public API ───────────────────────────────────────────

// Attach a file to an EXISTING spec. Returns the relative path the renderer
// should insert into the markdown (e.g. "attachments/2026-06-22T..._foo.png").
function attachToSpec(projectPath, slug, payload) {
  if (!projectPath || !slug) {
    return { success: false, error: 'projectPath + slug required' };
  }
  if (!specExists(projectPath, slug)) {
    return { success: false, error: `spec not found: ${slug}` };
  }
  const targetDir = getSpecAttachmentsDir(projectPath, slug);
  const written = writePayloadTo(targetDir, payload);
  if (!written.success) return written;
  return {
    success: true,
    relativePath: path.posix.join(ATTACHMENTS_DIR_NAME, written.filename)
  };
}

// Stage a file before the spec slug is allocated (New Spec modal flow).
// stagingId is a renderer-provided opaque id (e.g. a uuid) used both to
// promote and to purge later.
function stageAttachment(projectPath, stagingId, payload) {
  if (!projectPath || !stagingId) {
    return { success: false, error: 'projectPath + stagingId required' };
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(stagingId)) {
    return { success: false, error: 'invalid stagingId' };
  }
  const targetDir = getStagingDir(projectPath, stagingId);
  const written = writePayloadTo(targetDir, payload);
  if (!written.success) return written;
  return { success: true, filename: written.filename };
}

// Move every file from .frame/runtime/spec-attachments-staging/<stagingId>/
// into the spec's attachments dir. Called from createSpec once the slug is
// allocated. Returns the relative paths so createSpec can append a
// References block.
function promoteStagedAttachments(projectPath, stagingId, slug) {
  if (!projectPath || !stagingId || !slug) {
    return { success: false, error: 'projectPath + stagingId + slug required' };
  }
  const stagingDir = getStagingDir(projectPath, stagingId);
  if (!fs.existsSync(stagingDir)) {
    // No staged files is a valid no-op (user created spec without attachments).
    return { success: true, relativePaths: [] };
  }
  const targetDir = getSpecAttachmentsDir(projectPath, slug);
  try {
    fs.mkdirSync(targetDir, { recursive: true });
    const entries = fs.readdirSync(stagingDir);
    const moved = [];
    for (const name of entries) {
      const src = path.join(stagingDir, name);
      const dest = path.join(targetDir, name);
      fs.renameSync(src, dest);
      moved.push(path.posix.join(ATTACHMENTS_DIR_NAME, name));
    }
    fs.rmSync(stagingDir, { recursive: true, force: true });
    return { success: true, relativePaths: moved };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
}

// Abandon a staging session (modal cancel). Best-effort — never throws.
function purgeStagedAttachments(projectPath, stagingId) {
  if (!projectPath || !stagingId) return { success: false, error: 'projectPath + stagingId required' };
  const stagingDir = getStagingDir(projectPath, stagingId);
  try {
    if (fs.existsSync(stagingDir)) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
}

// List attachments for an existing spec as relative paths (posix-style so
// the strings can be inserted into markdown unchanged).
function listSpecAttachments(projectPath, slug) {
  if (!projectPath || !slug) return [];
  const dir = getSpecAttachmentsDir(projectPath, slug);
  if (!fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir)
      .filter((name) => {
        try { return fs.statSync(path.join(dir, name)).isFile(); }
        catch { return false; }
      })
      .sort()
      .map((name) => path.posix.join(ATTACHMENTS_DIR_NAME, name));
  } catch {
    return [];
  }
}

// ─── IPC wiring ───────────────────────────────────────────

// One handler covers both flows:
//  - { projectPath, slug, payload }      → attachToSpec
//  - { projectPath, stagingId, payload } → stageAttachment
// Returning the same shape ({ success, relativePath?, filename?, error })
// so the renderer can pick the field it needs.
function setupIPC(ipcMain) {
  const { IPC } = require('../shared/ipcChannels');

  ipcMain.handle(IPC.ATTACH_SPEC_FILE, async (_event, args) => {
    if (!args || typeof args !== 'object') {
      return { success: false, error: 'invalid args' };
    }
    const { projectPath, slug, stagingId, payload } = args;
    if (slug) {
      return attachToSpec(projectPath, slug, payload);
    }
    if (stagingId) {
      return stageAttachment(projectPath, stagingId, payload);
    }
    return { success: false, error: 'slug or stagingId required' };
  });

  ipcMain.handle(IPC.LIST_SPEC_ATTACHMENTS, async (_event, args) => {
    if (!args || typeof args !== 'object') return [];
    return listSpecAttachments(args.projectPath, args.slug);
  });

  ipcMain.handle(IPC.PURGE_STAGED_ATTACHMENTS, async (_event, args) => {
    if (!args || typeof args !== 'object') {
      return { success: false, error: 'invalid args' };
    }
    return purgeStagedAttachments(args.projectPath, args.stagingId);
  });
}

module.exports = {
  // public
  attachToSpec,
  stageAttachment,
  promoteStagedAttachments,
  purgeStagedAttachments,
  listSpecAttachments,
  setupIPC,
  // exposed for tests
  sanitizeBasename,
  buildAttachmentFilename,
  getSpecAttachmentsDir,
  getStagingDir,
  MAX_BYTES
};
