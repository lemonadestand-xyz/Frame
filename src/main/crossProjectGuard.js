/**
 * Cross-project footprint conflict detector.
 *
 * Best-effort: walks every active spec's plan.md `## Footprint` block and
 * detects overlaps between specs across projects. v1 warns only — does
 * not block dispatch (per spec frame-cross-project-orchestration-ui §non-goals).
 *
 * Pure function over file inputs so it can be tested without the registry.
 */

const fs = require('fs');
const path = require('path');

function readFootprint(projectPath, slug) {
  const planPath = path.join(projectPath, '.frame', 'specs', slug, 'plan.md');
  if (!fs.existsSync(planPath)) return [];
  let raw;
  try { raw = fs.readFileSync(planPath, 'utf8'); } catch { return []; }
  return parseFootprintBlock(raw);
}

function parseFootprintBlock(planMd) {
  const lines = String(planMd || '').split(/\r?\n/);
  let inBlock = false;
  const out = [];
  for (const line of lines) {
    if (/^\s*#{1,3}\s+Footprint\s*$/i.test(line)) { inBlock = true; continue; }
    if (inBlock && /^\s*#{1,3}\s+/.test(line)) break;
    if (!inBlock) continue;
    const m = line.match(/^\s*-\s+(.+?)\s*$/);
    if (m) out.push(m[1]);
  }
  return out;
}

/**
 * @param {Array<{projectPath, slug, footprint?: string[]}>} specs
 *   `footprint` may be omitted to force a disk read.
 * @returns {Array<{a, b, paths: string[]}>}  pairwise conflict descriptions
 */
function findConflicts(specs) {
  const enriched = specs.map((s) => ({
    ...s,
    footprint: s.footprint || readFootprint(s.projectPath, s.slug),
  }));
  const conflicts = [];
  for (let i = 0; i < enriched.length; i++) {
    for (let j = i + 1; j < enriched.length; j++) {
      const a = enriched[i];
      const b = enriched[j];
      const overlap = _overlap(a.footprint, b.footprint);
      if (overlap.length > 0) {
        conflicts.push({
          a: { projectPath: a.projectPath, slug: a.slug },
          b: { projectPath: b.projectPath, slug: b.slug },
          paths: overlap,
        });
      }
    }
  }
  return conflicts;
}

function _overlap(a, b) {
  const set = new Set(a.map(_normalise));
  const overlap = [];
  for (const entry of b) {
    if (set.has(_normalise(entry))) overlap.push(entry);
  }
  return overlap;
}

function _normalise(p) {
  // Collapse `foo/**` and `foo/*` to a stem so 'foo/x.js' vs 'foo/**' collide.
  // v1: literal-path equality only. Glob handling is a follow-up.
  return String(p || '').trim();
}

module.exports = { findConflicts, parseFootprintBlock, readFootprint };
