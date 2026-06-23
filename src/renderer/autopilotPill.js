/**
 * Autopilot pill
 *
 * Renders the small `🤖 Auto · N/M tasks done · turn K` status pill that
 * appears in the spec card header / spec section while autopilot is
 * running, and the `⏸ Auto-paused · needs review` variant after escalate.
 *
 * Also renders a small supervisor verdict badge (route + confidence) next
 * to the autopilot pill when a supervisor loop has recorded a verdict —
 * even when no autopilot run is active. Subscription to the verdict feed
 * lives in supervisorClient.onChange(...); this module is pure HTML.
 *
 * Pure: given a run + totals + verdict, returns HTML. State subscription
 * lives in autopilotClient.js / supervisorClient.js.
 */

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function _verdictBadge(verdict) {
  if (!verdict || !verdict.route) return '';
  const route = String(verdict.route).toUpperCase();
  const conf = Number(verdict.confidence);
  const confPct = Number.isFinite(conf)
    ? `${Math.round(Math.max(0, Math.min(1, conf)) * 100)}%`
    : null;
  const text = confPct ? `${route} · ${confPct}` : route;
  const safeRouteCls = route.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  const title = verdict.reasoning
    ? `Supervisor verdict: ${verdict.reasoning}`
    : `Supervisor verdict: ${route}`;
  return `<span class="supervisor-verdict-badge supervisor-verdict-${safeRouteCls}" title="${escapeHtml(title)}">${escapeHtml(text)}</span>`;
}

function renderAutopilotPill(run, totals = null, verdict = null) {
  const verdictHtml = _verdictBadge(verdict);

  if (!run) {
    // No autopilot run — fall through to verdict-only render when available.
    return verdictHtml;
  }
  const status = run.status;
  if (!['starting', 'running', 'paused', 'failed'].includes(status)) {
    return verdictHtml;
  }

  const turn = Number(run.turnsTotal || 0);
  let n = 0, m = 0;
  if (totals && Number.isFinite(totals.completed) && Number.isFinite(totals.total)) {
    n = totals.completed; m = totals.total;
  }

  let pill;
  if (status === 'paused') {
    const reason = run.pausedReason
      ? ` · ${escapeHtml(run.pausedReason)}`
      : '';
    pill = `<span class="autopilot-pill autopilot-pill-paused" title="Autopilot paused after repeated no-progress turns">⏸ Auto-paused${reason} · needs review</span>`;
  } else if (status === 'failed') {
    const reason = run.lastTurnReason || run.pausedReason || 'error';
    pill = `<span class="autopilot-pill autopilot-pill-failed" title="Autopilot failed">⚠ Auto · ${escapeHtml(reason)}</span>`;
  } else {
    // running / starting
    const progress = (m > 0) ? `${n}/${m} tasks done · ` : '';
    pill = `<span class="autopilot-pill autopilot-pill-running" title="Autopilot is driving /spec.implement turns automatically">🤖 Auto · ${progress}turn ${turn}</span>`;
  }

  return verdictHtml ? `${pill}${verdictHtml}` : pill;
}

module.exports = { renderAutopilotPill };
