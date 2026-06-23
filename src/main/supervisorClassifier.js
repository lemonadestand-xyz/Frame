/**
 * LLM-judged classifier — combines hard-policy + LLM verdict + evidence
 * re-classification.
 *
 * Mirrors supervisor/classifier/__init__.py:27-42 `DefaultClassifier.classify()`.
 *
 * Public API:
 *   classifyNextStep({status, tasks, lane, profile, specBody, planBody,
 *                     recentAudit, evidence, capabilities}) → Verdict
 *
 * Verdict:
 *   { route, actionKind, reasoning, confidence, draftedQuestion?, category? }
 */

const policy = require('./supervisorPolicy');
const { runClaudeJson } = require('./supervisorClaudeRunner');
const { buildClassifierPrompt } = require('./supervisorPromptBuilder');

const DEFAULT_CONFIDENCE_THRESHOLD = 0.65;
const MAX_RECLASSIFY = 1;

async function classifyNextStep(args) {
  const fastPath = policy.decideFastPath(args || {});
  if (fastPath) {
    return _withDefaults(fastPath, args);
  }

  // Fall through to LLM. Build the prompt; call the runner; parse.
  let verdict;
  try {
    const prompt = buildClassifierPrompt({
      specBody: args.specBody || '',
      status: args.status,
      tasks: args.tasks,
      lane: args.lane,
      recentAudit: args.recentAudit || [],
      profile: args.profile,
      evidence: args.evidence || [],
    });
    const raw = await runClaudeJson(prompt, {});
    verdict = _normaliseVerdict(raw);
  } catch (err) {
    return {
      route: 'escalate',
      actionKind: 'escalate_classify_failed',
      reasoning: `classifier failed: ${err.message || String(err)}`,
      confidence: 0,
      draftedQuestion: 'The supervisor classifier failed; please review and decide the next step manually.',
      category: 'tooling',
    };
  }

  const threshold = (args.profile?.supervisor?.confidence_threshold) ?? DEFAULT_CONFIDENCE_THRESHOLD;
  if ((verdict.confidence ?? 0) < threshold && verdict.route !== 'escalate') {
    return {
      route: 'escalate',
      actionKind: 'escalate_low_confidence',
      reasoning: `confidence ${verdict.confidence} below threshold ${threshold}`,
      confidence: verdict.confidence,
      draftedQuestion: verdict.draftedQuestion
        || verdict.reasoning
        || 'Supervisor was not confident enough to act — please review.',
      category: verdict.category || 'scope',
    };
  }

  // RESEARCH route → caller is responsible for running capabilities and
  // re-invoking with `evidence` populated. We expose a small helper for that.
  return verdict;
}

/**
 * Run the classifier; if it returns RESEARCH and we have capabilities,
 * run them once, then re-classify with the evidence. Caps at MAX_RECLASSIFY.
 *
 * @param {Object} args  same shape as classifyNextStep
 * @param {(question: string, ctx: Object) => Promise<Array>} runCapabilities
 */
async function classifyWithResearch(args, runCapabilities) {
  let verdict = await classifyNextStep(args);
  let reclassifies = 0;
  while (verdict.route === 'research' && reclassifies < MAX_RECLASSIFY && typeof runCapabilities === 'function') {
    const evidence = await runCapabilities(
      verdict.draftedQuestion || verdict.reasoning || 'context',
      { status: args.status, specBody: args.specBody }
    );
    verdict = await classifyNextStep({ ...args, evidence });
    reclassifies += 1;
  }
  return verdict;
}

function _normaliseVerdict(raw) {
  const r = raw || {};
  const route = ['advance', 'implement', 'research', 'escalate', 'critic', 'done'].includes(r.route)
    ? r.route : 'escalate';
  return {
    route,
    actionKind: typeof r.actionKind === 'string' ? r.actionKind : route,
    reasoning: typeof r.reasoning === 'string' ? r.reasoning : '',
    confidence: typeof r.confidence === 'number' ? Math.max(0, Math.min(1, r.confidence)) : 0,
    draftedQuestion: typeof r.draftedQuestion === 'string' ? r.draftedQuestion : '',
    category: typeof r.category === 'string' ? r.category : '',
  };
}

function _withDefaults(verdict, args) {
  return {
    route: verdict.route,
    actionKind: verdict.actionKind || verdict.route,
    reasoning: verdict.reasoning || `policy fast-path: ${verdict.route}`,
    confidence: verdict.confidence ?? 1.0, // hard-policy is fully confident
    draftedQuestion: verdict.draftedQuestion || '',
    category: verdict.category || '',
    ...(verdict.nextPhase ? { nextPhase: verdict.nextPhase } : {}),
    ...(verdict.completedCount != null ? { completedCount: verdict.completedCount } : {}),
    ...(verdict.reason ? { reason: verdict.reason } : {}),
  };
}

module.exports = {
  classifyNextStep,
  classifyWithResearch,
  DEFAULT_CONFIDENCE_THRESHOLD,
};
