/**
 * Outcome critic — judges whether a task actually shipped what it asked for.
 *
 * Mirrors supervisor/loops/self_revision.py:77-89, with the **bug #44 fix
 * ported inline** so this spec doesn't block on the supervisor child spec
 * landing: `is_terminal_message` short-circuits a critic call when the
 * outcome.md entry is a pure completion summary with no tool calls.
 *
 * Public API:
 *   critique({task, outcomeEntry, footprintDeclared, filesActuallyChanged,
 *             toolUsesInLastN, iterationCount, iterationCap?}) → Critique
 *   isTerminalMessage(text, {finalEventSeen, toolUsesInLastN}) → boolean
 *
 * Critique:
 *   { passed: bool, issues: string[], category: string,
 *     correctiveInstructions: string, reasoning: string,
 *     confidence: number, warnings: string[] }
 */

const { runClaudeJson } = require('./supervisorClaudeRunner');
const { buildCriticPrompt } = require('./supervisorPromptBuilder');

const DEFAULT_ITERATION_CAP = 2;

// Bug #44 short-circuit. Matches the supervisor's tightened
// classifier from spec engine-fix-decision-overdetection §2.
const COMPLETION_MARKERS = [
  'VERDICT:', 'STATUS:', 'READY', 'DONE', 'COMPLETE',
  'SUMMARY:', 'OUTCOME:', 'RESULT:',
];

function isTerminalMessage(text, { finalEventSeen = true, toolUsesInLastN = 0 } = {}) {
  if (!text || typeof text !== 'string') return false;
  if (!finalEventSeen) return false;
  if (toolUsesInLastN > 0) return false;
  const head = text.slice(0, 600).toUpperCase();
  if (COMPLETION_MARKERS.some((m) => head.includes(m))) return true;
  // Markdown summary header at the top is also a strong terminal signal.
  return /^\s*#{1,3}\s+/.test(text);
}

/**
 * @param {{task, outcomeEntry, footprintDeclared, filesActuallyChanged,
 *          toolUsesInLastN, iterationCount, iterationCap?}} args
 * @returns {Promise<Critique>}
 */
async function critique(args) {
  const {
    task = {}, outcomeEntry = '', footprintDeclared = [],
    filesActuallyChanged = [], toolUsesInLastN = 0,
    iterationCount = 0, iterationCap = DEFAULT_ITERATION_CAP,
  } = args || {};

  if (isTerminalMessage(outcomeEntry, { finalEventSeen: true, toolUsesInLastN })) {
    return {
      passed: true,
      issues: [],
      category: 'summary_structure',
      correctiveInstructions: '',
      reasoning: 'pure completion summary with no tool calls — critic short-circuit (bug #44 port)',
      confidence: 1.0,
      warnings: [],
    };
  }

  // Footprint violation is a hard fail regardless of what the LLM says.
  const violations = filesActuallyChanged.filter((p) =>
    !_matchesAnyFootprint(p, footprintDeclared)
  );
  if (violations.length > 0 && footprintDeclared.length > 0) {
    return {
      passed: false,
      issues: [`Changed files outside footprint: ${violations.join(', ')}`],
      category: 'footprint_violation',
      correctiveInstructions: 'Restrict the change to declared footprint or update the spec.',
      reasoning: 'footprint violation detected pre-LLM',
      confidence: 1.0,
      warnings: [],
    };
  }

  let verdict;
  try {
    const prompt = buildCriticPrompt({
      taskTitle: task.title || task.id || 'unknown',
      taskAcceptance: task.acceptanceCriteria || '',
      outcomeEntry,
      footprintDeclared,
      filesActuallyChanged,
    });
    const raw = await runClaudeJson(prompt);
    verdict = _normaliseCritique(raw);
  } catch (err) {
    // On runner failure default to PASS (don't block) but warn loudly.
    return {
      passed: true,
      issues: [],
      category: 'tooling',
      correctiveInstructions: '',
      reasoning: `critic runner failed: ${err.message || String(err)}; defaulting to pass`,
      confidence: 0,
      warnings: [`critic runner failure — verify manually`],
    };
  }

  // Bug #44 echo: demote `summary_structure`-only fails to PASS-with-warning.
  if (!verdict.passed && verdict.category === 'summary_structure') {
    return {
      ...verdict,
      passed: true,
      warnings: [
        `summary structure issue demoted to warning (bug #44 fix): ${verdict.issues.join('; ')}`,
      ],
    };
  }

  // Cap hit → escalate signal (caller surfaces as ESCALATE)
  if (!verdict.passed && iterationCount + 1 >= iterationCap) {
    verdict.iterationCapHit = true;
  }
  return verdict;
}

function _matchesAnyFootprint(filePath, footprint) {
  // Accept exact paths and trailing `/**` globs (the only style used in
  // Frame's plan.md Footprint blocks today).
  for (const entry of footprint) {
    if (!entry) continue;
    if (filePath === entry) return true;
    if (entry.endsWith('/**')) {
      const prefix = entry.slice(0, -3);
      if (filePath.startsWith(prefix)) return true;
    }
    if (entry.endsWith('/*')) {
      const prefix = entry.slice(0, -2);
      if (filePath.startsWith(prefix) && !filePath.slice(prefix.length).includes('/')) {
        return true;
      }
    }
  }
  return false;
}

function _normaliseCritique(raw) {
  const r = raw || {};
  return {
    passed: !!r.passed,
    issues: Array.isArray(r.issues) ? r.issues.map(String) : [],
    category: typeof r.category === 'string' ? r.category : 'other',
    correctiveInstructions: typeof r.correctiveInstructions === 'string'
      ? r.correctiveInstructions : '',
    reasoning: typeof r.reasoning === 'string' ? r.reasoning : '',
    confidence: typeof r.confidence === 'number' ? Math.max(0, Math.min(1, r.confidence)) : 0,
    warnings: Array.isArray(r.warnings) ? r.warnings.map(String) : [],
  };
}

module.exports = {
  critique,
  isTerminalMessage,
  COMPLETION_MARKERS,
  DEFAULT_ITERATION_CAP,
};
