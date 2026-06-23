/**
 * Supervisor loop's hard-policy fast path.
 *
 * Mirrors supervisor/classifier/policy.py:29-64. Runs before the LLM
 * classifier. Returns one of:
 *
 *   { route: 'wait',     reason }       — defer (e.g. footprint conflict)
 *   { route: 'done' }                   — spec finished
 *   { route: 'paused',   reason }       — user pause / explicit stop
 *   { route: 'escalate', draftedQuestion, category } — needs human input
 *   { route: 'implement', actionKind: 'implement_turn' }
 *   { route: 'critic',   actionKind: 'critic_pass' }
 *   { route: 'advance',  actionKind: 'advance_phase', nextPhase }
 *   null                                — fall through to LLM classifier
 *
 * Pure function: no IO, no LLM call. Easy to test exhaustively.
 */

const OPEN_QUESTION_HEADER_RE = /^\s*#{1,3}\s+(?:Open questions?|Open Questions?)\s*$/im;
const FOOTPRINT_HEADER_RE = /^\s*#{1,3}\s+Footprint\s*$/im;

/**
 * @param {{status, tasks, lane, profile, audit, specBody, planBody}} args
 * @returns {{route, ...} | null}
 */
function decideFastPath(args) {
  const { status, tasks = [], lane, specBody = '', planBody = '' } = args || {};
  if (!status) return null;

  // Stop conditions
  if (status.phase === 'done') return { route: 'done' };
  if (args.userPaused) return { route: 'paused', reason: 'user_paused' };
  if (args.footprintConflict) {
    return { route: 'wait', reason: 'footprint_conflict' };
  }

  // Lane required for any dispatch-bearing route
  const undoneCount = tasks.filter((t) =>
    t && (t.status === 'pending' || t.status === 'in_progress')).length;
  const completedCount = tasks.filter((t) => t && t.status === 'completed').length;

  if (!lane || !lane.terminalId) {
    return { route: 'wait', reason: 'no_lane_attached' };
  }

  // Phase-specific gates
  if (status.phase === 'tasks_generated' || status.phase === 'implementing') {
    if (undoneCount > 0) {
      return { route: 'implement', actionKind: 'implement_turn' };
    }
    // Undone reached zero but phase hasn't been promoted — invoke critic to
    // judge whether we're truly done.
    return { route: 'critic', actionKind: 'critic_pass', completedCount };
  }

  if (status.phase === 'specified') {
    const hasOpenQuestions = OPEN_QUESTION_HEADER_RE.test(specBody)
      && _hasUnansweredQuestion(specBody);
    if (hasOpenQuestions) {
      return {
        route: 'escalate',
        category: 'scope',
        draftedQuestion: 'Spec has unanswered Open Questions; please resolve before planning.',
      };
    }
    return { route: 'advance', actionKind: 'advance_phase', nextPhase: 'planned' };
  }

  if (status.phase === 'planned') {
    if (!FOOTPRINT_HEADER_RE.test(planBody)) {
      return {
        route: 'escalate',
        category: 'scope',
        draftedQuestion: 'plan.md is missing a `## Footprint` block — supervisor cannot dispatch tasks without it.',
      };
    }
    return { route: 'advance', actionKind: 'advance_phase', nextPhase: 'tasks_generated' };
  }

  if (status.phase === 'draft') {
    return {
      route: 'escalate',
      category: 'scope',
      draftedQuestion: 'Spec is still in draft — flesh out spec.md before continuing.',
    };
  }

  return null; // fall through to LLM classifier
}

function _hasUnansweredQuestion(text) {
  // Detect a Q heading or bullet that doesn't have an Answer line beneath it.
  // Conservative: if any line in the Open Questions section is a question
  // without an explicit "Answer:" / "Working stance:" follow-up, assume unanswered.
  const lines = text.split(/\r?\n/);
  let inSection = false;
  let sawQuestion = false;
  let sawAnswerSinceQuestion = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (OPEN_QUESTION_HEADER_RE.test(raw)) { inSection = true; continue; }
    if (inSection && /^#{1,3}\s+/.test(raw)) {
      // hit the next section heading
      if (sawQuestion && !sawAnswerSinceQuestion) return true;
      inSection = false;
      continue;
    }
    if (!inSection) continue;
    if (/[?]\s*$/.test(line) || /^\d+\.\s+\*\*/.test(line)) {
      if (sawQuestion && !sawAnswerSinceQuestion) return true;
      sawQuestion = true;
      sawAnswerSinceQuestion = false;
    }
    if (/answer:|working stance:|answered/i.test(line)) {
      sawAnswerSinceQuestion = true;
    }
  }
  return sawQuestion && !sawAnswerSinceQuestion;
}

module.exports = { decideFastPath, _hasUnansweredQuestion };
