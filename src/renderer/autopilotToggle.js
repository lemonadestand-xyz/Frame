/**
 * Autopilot toggle button
 *
 * The "Auto" button sitting next to "Implement Next Task". Clicking it
 * starts or stops a spec-scoped autopilot run, depending on whether one
 * is already active.
 *
 * Stateless render → returns HTML + attachHandlers(root). Callers wire
 * the button into their own DOM and call attachHandlers once.
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const client = require('./autopilotClient');

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function _isActive(run) {
  return !!run && ['starting', 'running'].includes(run.status);
}

function renderAutopilotToggle({ projectPath, slug, scope = 'spec', getTerminalId, surface = 'inline' }) {
  const run = client.getRunFor({ projectPath, slug, scope });
  const active = _isActive(run);
  // `surface` disambiguates multiple toggles for the same scope+slug on the
  // same page (e.g. the inline one in the Implement card AND the one in the
  // spec header). Without it both buttons share an id, querySelector returns
  // only the first match, and the second button has no click handler.
  const btnId = `autopilot-toggle-${scope}-${slug || 'project'}-${surface}`;
  const label = active ? 'Stop Auto' : 'Auto';
  const cls = active ? 'btn btn-secondary autopilot-toggle autopilot-toggle-on' : 'btn btn-secondary autopilot-toggle';
  const hint = active
    ? 'Stop after the current turn finishes.'
    : 'Run /spec.implement repeatedly until pending tasks are exhausted.';
  return {
    html: `<button id="${btnId}" class="${cls}" type="button" title="${escapeHtml(hint)}" data-autopilot-active="${active ? '1' : '0'}">${escapeHtml(label)}</button>`,
    attachHandlers(rootEl) {
      const btn = rootEl.querySelector(`#${btnId}`);
      if (!btn) return;
      btn.addEventListener('click', async () => {
        const currentRun = client.getRunFor({ projectPath, slug, scope });
        if (_isActive(currentRun)) {
          await client.stop({ projectPath, runId: currentRun.id });
          return;
        }
        const terminalId = typeof getTerminalId === 'function' ? getTerminalId() : null;
        if (!terminalId) {
          // Surface visibly — autopilot can't drive a lane that doesn't exist.
          btn.classList.add('autopilot-toggle-error');
          btn.title = 'Open or assign a Frame for this spec first.';
          setTimeout(() => btn.classList.remove('autopilot-toggle-error'), 2500);
          return;
        }
        await client.start({ projectPath, scope, slug, terminalId });
      });
    },
  };
}

/**
 * Project-scoped Autopilot toggle for the laneBoard.
 *
 * Builds the slug → terminalId map at click time by querying LIST_SPECS
 * and asking agentDispatch for each spec's assigned lane; specs without
 * an attached lane get skipped by the main-process project loop.
 */
function renderProjectAutopilotToggle({ projectPath }) {
  const run = client.getRunFor({ projectPath, scope: 'project' });
  const active = _isActive(run);
  const btnId = `autopilot-toggle-project`;
  const label = active ? 'Stop Project Auto' : '🤖 Project Autopilot';
  const cls = active ? 'btn btn-secondary autopilot-toggle autopilot-toggle-on' : 'btn btn-secondary autopilot-toggle';
  const hint = active
    ? 'Stop after each in-flight spec finishes its current turn.'
    : 'Drive every assigned spec to completion. Specs without an attached Frame are skipped.';
  return {
    html: `<button id="${btnId}" class="${cls}" type="button" title="${escapeHtml(hint)}" data-autopilot-active="${active ? '1' : '0'}">${escapeHtml(label)}</button>`,
    attachHandlers(rootEl) {
      const btn = rootEl.querySelector(`#${btnId}`);
      if (!btn) return;
      btn.addEventListener('click', async () => {
        const currentRun = client.getRunFor({ projectPath, scope: 'project' });
        if (_isActive(currentRun)) {
          await client.stop({ projectPath, runId: currentRun.id });
          return;
        }
        // Collect lane assignments from the renderer's known state.
        let specs = [];
        try { specs = await ipcRenderer.invoke(IPC.LIST_SPECS, projectPath) || []; } catch {}
        const agentDispatch = require('./agentDispatch');
        const terminalAssignments = {};
        let attached = 0;
        for (const s of specs) {
          const info = agentDispatch.getSpecLaneInfo(s.slug);
          if (info && info.terminalId) {
            terminalAssignments[s.slug] = info.terminalId;
            attached += 1;
          }
        }
        if (attached === 0) {
          btn.classList.add('autopilot-toggle-error');
          btn.title = 'No specs have an attached Frame. Open or assign a Frame for at least one spec first.';
          setTimeout(() => btn.classList.remove('autopilot-toggle-error'), 3000);
          return;
        }
        await client.start({ projectPath, scope: 'project', terminalAssignments });
      });
    },
  };
}

module.exports = { renderAutopilotToggle, renderProjectAutopilotToggle };
