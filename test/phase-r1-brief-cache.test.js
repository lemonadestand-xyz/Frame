// Phase R.1 regression test for the brief preview "(empty brief)" bug.
//
// Before the fix, prefetchBriefForVerification populated briefCache with
// {full, abs} (no `content` key). loadBriefIntoBody then short-circuited
// on the truthy cache hit and painted `cached.content === undefined` →
// "(empty brief)". The decision logic now lives in briefCache.js so this
// test can exercise it without booting Electron + DOM.
//
// Run with: node test/phase-r1-brief-cache.test.js

const assert = require('assert');
const { snippetOf, classifyBriefCache, parseBriefResponse } = require('../src/renderer/supervisor-ui/briefCache');

let pass = 0;
const t = (name, fn) => { fn(); console.log(`PASS: ${name}`); pass += 1; };

// --- The bug case: prefetch populated {full, abs} but no `content` --------
t('classifyBriefCache hydrates from cached.full when content is missing (the bug)', () => {
  const out = classifyBriefCache({ full: '# Brief body markdown', abs: '/tmp/brief.md' });
  assert.strictEqual(out.kind, 'hydrate', 'expected hydrate, got ' + out.kind);
  assert.strictEqual(out.snippet, '# Brief body markdown');
});

// --- The happy paths -----------------------------------------------------
t('classifyBriefCache paints content when both content + full are cached', () => {
  const out = classifyBriefCache({ content: 'snippet body', full: 'full body', abs: '/x' });
  assert.strictEqual(out.kind, 'paint');
  assert.strictEqual(out.content, 'snippet body');
});

t('classifyBriefCache returns fetch on cache miss (undefined)', () => {
  assert.strictEqual(classifyBriefCache(undefined).kind, 'fetch');
});

t('classifyBriefCache returns fetch on empty object (no content, no full)', () => {
  assert.strictEqual(classifyBriefCache({}).kind, 'fetch');
});

t('classifyBriefCache returns fetch when content is empty string', () => {
  // Empty content should not paint "(empty brief)" — refetch instead.
  assert.strictEqual(classifyBriefCache({ content: '', abs: '/x' }).kind, 'fetch');
});

// --- snippetOf truncation -----------------------------------------------
t('snippetOf passes through bodies ≤4000 chars unchanged', () => {
  assert.strictEqual(snippetOf('# small'), '# small');
});

t('snippetOf truncates bodies >4000 chars with the truncation marker', () => {
  const big = 'x'.repeat(5000);
  const out = snippetOf(big);
  assert.strictEqual(out.length, 4000 + '\n\n…(truncated)'.length);
  assert.ok(out.endsWith('…(truncated)'));
});

// --- parseBriefResponse: JSON envelope vs raw body ----------------------
t('parseBriefResponse extracts content from JSON envelope', () => {
  assert.strictEqual(parseBriefResponse('{"content":"# Brief"}'), '# Brief');
});

t('parseBriefResponse falls back to raw body when not JSON (markdown H1)', () => {
  // Pre-Phase R bug: JSON.parse("# Brief") threw "Unexpected token '#'".
  assert.strictEqual(parseBriefResponse('# Brief body'), '# Brief body');
});

t('parseBriefResponse falls back to raw body when JSON has no content field', () => {
  assert.strictEqual(parseBriefResponse('{"path":"/x"}'), '{"path":"/x"}');
});

// --- End-to-end simulation: the original failure sequence ----------------
t('full sequence: prefetch then "Show brief" no longer renders (empty brief)', () => {
  const cache = new Map();
  // Step 1: prefetchBriefForVerification resolves first (Phase R).
  cache.set('t1', { full: '# real brief markdown\n\nbody', abs: '/p/brief.md' });
  // Step 2: user clicks "Show brief" → loadBriefIntoBody runs.
  const decision = classifyBriefCache(cache.get('t1'));
  assert.strictEqual(decision.kind, 'hydrate', 'should hydrate, not fall through to paint(undefined)');
  // Step 3: loadBriefIntoBody writes content back so subsequent opens hit paint path.
  cache.set('t1', { ...cache.get('t1'), content: decision.snippet });
  const next = classifyBriefCache(cache.get('t1'));
  assert.strictEqual(next.kind, 'paint');
  assert.strictEqual(next.content, '# real brief markdown\n\nbody');
});

console.log(`\n✓ ${pass} Phase R.1 brief-cache regression checks passed`);
