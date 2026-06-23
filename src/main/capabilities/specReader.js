/**
 * SpecReader capability — keyword-scores paragraphs from the project
 * profile's `context_sources` markdown files. Returns top-K paragraphs
 * as Evidence with file path + line range refs.
 *
 * Mirrors supervisor/capabilities.py:37-107.
 */

const fs = require('fs');
const path = require('path');
const { Capability } = require('./types');
const { tokenize } = require('../memory');

const FRAME_META_SKIP = new Set([
  'tasks.json', 'STRUCTURE.json', 'PROJECT_NOTES.md',
  'AGENTS.md', 'CLAUDE.md', 'GEMINI.md',
]);
const MAX_FILE_BYTES = 256 * 1024;
const DEFAULT_TOP_K = 5;

class SpecReader extends Capability {
  constructor({ projectPath, profile } = {}) {
    super();
    this.projectPath = projectPath;
    this.profile = profile || {};
  }

  async run({ question }) {
    const sources = (this.profile.context_sources || [])
      .filter((s) => typeof s === 'string' && !s.startsWith('bm:'));
    if (sources.length === 0) return [];
    const qTokens = new Set(tokenize(question));
    if (qTokens.size === 0) return [];
    const scored = [];
    for (const src of sources) {
      const filePath = path.isAbsolute(src) ? src : path.join(this.projectPath, src);
      const basename = path.basename(filePath);
      if (FRAME_META_SKIP.has(basename)) continue;
      if (!fs.existsSync(filePath)) {
        scored.push({
          source: 'spec_reader',
          summary: `source not found: ${src}`,
          refs: [src], score: 0,
        });
        continue;
      }
      let raw;
      try {
        const stat = fs.statSync(filePath);
        if (stat.size > MAX_FILE_BYTES) {
          scored.push({
            source: 'spec_reader',
            summary: `source oversized (${stat.size} bytes): ${src}`,
            refs: [src], score: 0,
          });
          continue;
        }
        raw = fs.readFileSync(filePath, 'utf8');
      } catch (err) {
        scored.push({
          source: 'spec_reader',
          summary: `read failed: ${err.message}`,
          refs: [src], score: 0,
        });
        continue;
      }
      // Split into paragraphs, score each by token-intersection.
      const lines = raw.split(/\r?\n/);
      const paragraphs = [];
      let buf = [];
      let startLine = 1;
      let currentLine = 1;
      for (const line of lines) {
        if (line.trim() === '') {
          if (buf.length > 0) paragraphs.push({ text: buf.join('\n'), startLine, endLine: currentLine - 1 });
          buf = [];
          startLine = currentLine + 1;
        } else {
          buf.push(line);
        }
        currentLine += 1;
      }
      if (buf.length > 0) paragraphs.push({ text: buf.join('\n'), startLine, endLine: currentLine - 1 });

      for (const para of paragraphs) {
        const paraTokens = tokenize(para.text);
        let intersection = 0;
        for (const t of paraTokens) if (qTokens.has(t)) intersection += 1;
        if (intersection === 0) continue;
        scored.push({
          source: 'spec_reader',
          summary: para.text.slice(0, 280),
          refs: [`${src}:L${para.startLine}-L${para.endLine}`],
          score: intersection,
        });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, DEFAULT_TOP_K);
  }
}

SpecReader.name = 'spec_reader';

module.exports = { SpecReader };
