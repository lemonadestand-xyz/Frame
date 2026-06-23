/**
 * Worker registry bootstrap.
 *
 * `require('./workers')` from `src/main/index.js` to register every
 * built-in worker. Tests can call `registry._resetForTests()` and then
 * register only the workers they need.
 */

const registry = require('./registry');
const { FakeWorker } = require('./fakeWorker');
const { ClaudeCodeWorker } = require('./claudeCodeWorker');
const { CodexWorker } = require('./codexWorker');
const { GeminiWorker } = require('./geminiWorker');

registry.register('fake', FakeWorker);
// Tool ids match `src/main/aiToolManager.js` AI_TOOLS keys so callers
// can route by the same toolId the renderer's `aiToolSelector` already
// uses (`claude` / `codex` / `gemini`).
registry.register('claude', ClaudeCodeWorker);
registry.register('codex', CodexWorker);
registry.register('gemini', GeminiWorker);

module.exports = registry;
