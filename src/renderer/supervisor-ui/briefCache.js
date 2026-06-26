// Pure helpers extracted from taskDetailModal.js so the Phase R.1 brief
// cache-decision tree can be unit-tested without booting Electron.

function snippetOf(full) {
  return full.length > 4000 ? full.slice(0, 4000) + '\n\n…(truncated)' : full;
}

// Decide what loadBriefIntoBody should do given the current cache entry.
// Phase R's prefetchBriefForVerification writes {full, abs} with no
// `content` key; the previous `if (cached)` short-circuit then painted
// undefined → "(empty brief)". Treat that as a hydratable hit, not a paint.
function classifyBriefCache(cached) {
  if (cached && cached.content) return { kind: 'paint', content: cached.content };
  if (cached && cached.full) return { kind: 'hydrate', snippet: snippetOf(cached.full) };
  return { kind: 'fetch' };
}

// /api/file may answer with the JSON envelope {path, content} or the
// raw file body (older supervisor builds). Try JSON first, fall back.
function parseBriefResponse(raw) {
  try {
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed.content === 'string') ? parsed.content : raw;
  } catch {
    return raw;
  }
}

module.exports = { snippetOf, classifyBriefCache, parseBriefResponse };
