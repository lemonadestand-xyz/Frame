/**
 * KnowledgeSearch capability — backed by BasicMemoryBackend.
 *
 * Returns prior decisions/rules/context from the project's memory as
 * Evidence. Requires `bm:<id>` in profile.context_sources to activate.
 *
 * Mirrors supervisor/capabilities.py:123-152.
 */

const { Capability } = require('./types');

class KnowledgeSearch extends Capability {
  constructor({ memory, profile } = {}) {
    super();
    this.memory = memory;
    this.profile = profile || {};
  }

  async run({ question }) {
    const ctxSources = this.profile.context_sources || [];
    const hasBm = ctxSources.some((s) => typeof s === 'string' && s.startsWith('bm:'));
    if (!hasBm) {
      return [{
        source: 'knowledge_search',
        summary: 'knowledge_search disabled — add bm:<id> to context_sources',
        refs: [],
        score: 0,
      }];
    }
    if (!this.memory) {
      return [{
        source: 'knowledge_search',
        summary: 'no memory backend wired',
        refs: [],
        score: 0,
      }];
    }
    const notes = await this.memory.search(question, 5);
    return notes.map((n) => ({
      source: 'knowledge_search',
      summary: `[${n.category}] ${n.title}: ${(n.body || '').slice(0, 240)}`,
      refs: [n.path],
      score: n.score || 0,
    }));
  }
}

KnowledgeSearch.name = 'knowledge_search';

module.exports = { KnowledgeSearch };
