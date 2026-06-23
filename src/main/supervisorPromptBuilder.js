/**
 * Prompt builders for the supervisor's classifier + critic.
 *
 * Mirrors the supervisor's inline prompts (supervisor/classifier/llm.py:26-51
 * and supervisor/loops/self_revision.py:42-61). The Frame versions are
 * tuned to also surface phase-transition guidance — the supervisor's
 * original was single-decision focused.
 */

function _truncate(text, n) {
  if (!text) return '';
  const s = String(text);
  if (s.length <= n) return s;
  return s.slice(0, n) + '\n…[truncated]';
}

function buildClassifierPrompt({
  specBody = '',
  status = {},
  tasks = [],
  lane = null,
  recentAudit = [],
  profile = null,
  evidence = [],
} = {}) {
  const undone = tasks.filter((t) =>
    t && (t.status === 'pending' || t.status === 'in_progress')).length;
  const completed = tasks.filter((t) => t && t.status === 'completed').length;
  const policyJson = JSON.stringify(profile?.policy || {}, null, 2);
  const auditJson = JSON.stringify(recentAudit.slice(-5), null, 2);
  const evidenceJson = JSON.stringify(evidence || [], null, 2);
  return [
    'You are the supervisor for a Frame project spec. Decide the next single step.',
    '',
    `Spec slug: ${status.slug}`,
    `Phase: ${status.phase}`,
    `Lane attached: ${lane ? 'yes' : 'no'}`,
    `Tasks: ${completed} done, ${undone} undone (pending or in_progress).`,
    '',
    'Spec.md (head):',
    '"""',
    _truncate(specBody, 4000),
    '"""',
    '',
    'Project policy (subset of the profile):',
    policyJson,
    '',
    'Recent audit (last 5 entries):',
    auditJson,
    '',
    'Evidence already gathered (if any):',
    evidenceJson,
    '',
    'Return a JSON object EXACTLY in this shape:',
    '{"route": "advance"|"implement"|"research"|"escalate"|"critic"|"done",',
    ' "actionKind": <string>,',
    ' "reasoning": <string>,',
    ' "confidence": <float 0..1>,',
    ' "draftedQuestion": <string or empty>,',
    ' "category": <string or empty>}',
    '',
    'Rules:',
    '- "advance" advances the phase via the next /spec.<phase> dispatch.',
    '- "implement" dispatches /spec.implement for the next undone task.',
    '- "research" requests evidence; supervisor will run capabilities then re-call.',
    '- "escalate" pauses for human input with a drafted question.',
    '- "critic" runs the outcome critic on the most recent task.',
    '- "done" only when undone===0 AND phase already===done.',
    '- If confidence < 0.65, prefer "escalate".',
    'Return JSON only — no surrounding prose.',
  ].join('\n');
}

function buildCriticPrompt({
  taskTitle = '',
  taskAcceptance = '',
  outcomeEntry = '',
  footprintDeclared = [],
  filesActuallyChanged = [],
} = {}) {
  return [
    'You are the outcome critic. Did the task actually ship what it asked for?',
    '',
    `Task title: ${taskTitle}`,
    `Acceptance criteria: ${taskAcceptance || '(none declared)'}`,
    '',
    'Spec footprint (files this spec is allowed to touch):',
    JSON.stringify(footprintDeclared, null, 2),
    '',
    'Files actually changed (best-effort heuristic):',
    JSON.stringify(filesActuallyChanged, null, 2),
    '',
    'Outcome.md entry the implementer wrote:',
    '"""',
    _truncate(outcomeEntry, 3000),
    '"""',
    '',
    'Return a JSON object EXACTLY in this shape:',
    '{"passed": <bool>,',
    ' "issues": [<short string>, ...],',
    ' "category": <"summary_structure"|"missing_test"|"missing_code"|"footprint_violation"|"other">,',
    ' "correctiveInstructions": <string>,',
    ' "reasoning": <string>,',
    ' "confidence": <float 0..1>}',
    '',
    'Rules:',
    '- A clean "I shipped X, tests pass" outcome with no contradicting evidence → passed:true.',
    '- If the only complaint is summary structure / wording → category:"summary_structure" (the loop will demote to warning).',
    '- Footprint violations always → passed:false, category:"footprint_violation".',
    'Return JSON only.',
  ].join('\n');
}

module.exports = { buildClassifierPrompt, buildCriticPrompt };
