/**
 * Capabilities bootstrap — registers built-in capabilities by name.
 */

const registry = require('./registry');
const { SpecReader } = require('./specReader');
const { KnowledgeSearch } = require('./knowledgeSearch');
const { WebResearch } = require('./webResearch');

registry.register('spec_reader', SpecReader);
registry.register('knowledge_search', KnowledgeSearch);
registry.register('web_research', WebResearch);

module.exports = registry;
