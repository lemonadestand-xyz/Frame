/**
 * Escalation modal — surfaces drafted-question + suggested answer from the
 * supervisor loop. User picks Approve / Edit / Redirect → result is sent
 * back via SUPERVISOR_ESCALATION_ANSWERED.
 *
 * Visual styling mirrors the supervisor PWA's "Needs you" treatment:
 *   --escalate: #e0556b  (red border + tag)
 *   --auto:     #3fb27f  (approve action)
 *   Three-button flex: Approve drafted | Edit reply | Redirect
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');

let _overlay = null;
let _activeEscalation = null;

function init() {
  ipcRenderer.on(IPC.SUPERVISOR_ESCALATION_OPEN, (event, escalation) => {
    show(escalation);
  });
}

function show(escalation) {
  if (!escalation || !escalation.id) return;
  _activeEscalation = escalation;
  _render();
}

function _close() {
  if (_overlay) {
    _overlay.remove();
    _overlay = null;
  }
  _activeEscalation = null;
}

function _submit(answer) {
  if (!_activeEscalation) return;
  ipcRenderer.send(IPC.SUPERVISOR_ESCALATION_ANSWERED, {
    id: _activeEscalation.id,
    answer,
    answeredBy: 'user',
  });
  _close();
}

function _render() {
  if (_overlay) _overlay.remove();
  const esc = _activeEscalation;
  _overlay = document.createElement('div');
  _overlay.className = 'supervisor-escalation-overlay';
  _overlay.innerHTML = `
    <div class="supervisor-escalation-modal" role="dialog" aria-modal="true">
      <div class="supervisor-escalation-header">
        <span class="supervisor-escalation-tag">⚠️ Needs your input</span>
        <span class="supervisor-escalation-meta">${_escape(esc.slug || '')} · ${_escape(esc.category || 'scope')}</span>
      </div>
      <h3 class="supervisor-escalation-question">${_escape(esc.draftedQuestion || 'Drafted question missing')}</h3>
      ${esc.draftAnswer ? `
        <div class="supervisor-escalation-suggested">
          <div class="supervisor-escalation-suggested-label">Supervisor suggests:</div>
          <div class="supervisor-escalation-suggested-body">${_escape(esc.draftAnswer)}</div>
          ${esc.confidence != null ? `<div class="supervisor-escalation-confidence">confidence: ${Math.round((esc.confidence || 0) * 100)}%</div>` : ''}
        </div>` : ''}
      ${Array.isArray(esc.options) && esc.options.length > 0 ? `
        <div class="supervisor-escalation-options">
          ${esc.options.map((opt) => `<button type="button" class="supervisor-escalation-option" data-option="${_escape(opt)}">${_escape(opt)}</button>`).join('')}
        </div>` : ''}
      <label class="supervisor-escalation-field-label" for="supervisor-escalation-answer">Your answer (or override the suggestion):</label>
      <textarea id="supervisor-escalation-answer" class="supervisor-escalation-textarea" rows="4" placeholder="Type your answer, or hit Approve to accept the suggestion above."></textarea>
      <div class="supervisor-escalation-actions">
        <button type="button" class="btn supervisor-escalation-redirect">Skip</button>
        <button type="button" class="btn supervisor-escalation-edit">Submit answer</button>
        <button type="button" class="btn btn-primary supervisor-escalation-approve">Approve drafted</button>
      </div>
    </div>
  `;
  document.body.appendChild(_overlay);
  const ta = _overlay.querySelector('#supervisor-escalation-answer');
  setTimeout(() => ta.focus(), 30);

  _overlay.querySelector('.supervisor-escalation-approve').addEventListener('click', () => {
    _submit(esc.draftAnswer || '');
  });
  _overlay.querySelector('.supervisor-escalation-edit').addEventListener('click', () => {
    const text = ta.value.trim();
    if (!text) { ta.focus(); return; }
    _submit(text);
  });
  _overlay.querySelector('.supervisor-escalation-redirect').addEventListener('click', () => {
    // Skip resolves with empty answer — supervisor loop treats this as "no
    // durable decision, retry later". For now we send empty; supervisor
    // can decide what to do (typically re-tick).
    _submit('');
  });
  _overlay.querySelectorAll('.supervisor-escalation-option').forEach((btn) => {
    btn.addEventListener('click', () => {
      _submit(btn.dataset.option);
    });
  });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      _submit(ta.value.trim() || esc.draftAnswer || '');
    }
    if (e.key === 'Escape') _close();
  });
}

function _escape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = { init, show };
