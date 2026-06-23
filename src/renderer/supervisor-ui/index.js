// Supervisor UI (renderer) — Phase B composition.
//
// Per docs/frame-edit-discipline.md §1.6, the renderer addition is a standalone
// module under src/renderer/supervisor-ui/ exposing ONE init() function. The
// Frame edit is a single supervisor-mod line in src/renderer/index.js that
// invokes init().
//
// Q1 resolution (see docs/frame-modifications.md): src/renderer/multiTerminalUI.js
// openSection(type, itemRef, factory, opts) treats `type` as an opaque string
// (only used for "find existing viewport of same type" matching at L222-224).
// No dispatch table; no registration required. This module is the factory.
//
// Phase B: createViewport().render(el) composes header + projectTree + kanban
// and wires teardown into the viewport's dispose() hook (already invoked by
// multiTerminalUI on section close — see multiTerminalUI.js:248).

const path = require('path');
const SUP = require('../../shared/supervisor-ipc');

let seq = 0;
let stylesInjected = false;
// Phase E: the OS-notification click handler needs to drive kanban.scrollToTask
// on whichever supervisor viewport is currently mounted. createViewport keeps
// its own `controllers` in closure for normal teardown; we mirror the last
// rendered set here purely so the click path can find it without plumbing.
let latestControllers = null;

function injectStylesOnce() {
  if (stylesInjected) return;
  stylesInjected = true;
  // index.html is loaded with loadFile('index.html') (see src/main/index.js:55);
  // relative href resolves against the project root.
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'src/renderer/supervisor-ui/styles.css';
  link.dataset.supervisorStyles = '1';
  document.head.appendChild(link);
}

function createViewport() {
  const key = `supervisor-vp:${++seq}`;
  let controllers = null;
  let rendered = false;

  function navigate(/* itemRef */) {
    // multiTerminalUI.openSection() calls navigate() once after creating the
    // viewport — every other section module (diffSection, specSection,
    // taskSection, orchestrator) signals notifySectionChanged() here to
    // trigger the host's section render. Without this, the viewport stays
    // off-screen and render() is never invoked.
    const terminal = require('../terminal');
    const host = terminal.getMultiTerminalUI();
    if (host) host.notifySectionChanged();
  }

  function getChip() {
    return { type: 'supervisor', title: 'Supervisor' };
  }

  function render(el) {
    injectStylesOnce();
    el.innerHTML = `
      <div class="supervisor-root">
        <div class="supervisor-header" id="supervisor-header"></div>
        <div class="supervisor-body">
          <aside class="supervisor-tree" id="supervisor-tree"></aside>
          <main class="supervisor-kanban" id="supervisor-kanban"></main>
        </div>
      </div>
    `;
    const header = require('./header').create(el.querySelector('#supervisor-header'));
    const kanban = require('./kanban').create(el.querySelector('#supervisor-kanban'));
    const tree = require('./projectTree').create(
      el.querySelector('#supervisor-tree'),
      { onScrollToTask: (id) => kanban.scrollToTask(id) }
    );
    controllers = { header, tree, kanban };
    latestControllers = controllers;
    rendered = true;
  }

  function dispose() {
    // multiTerminalUI.closeSection() calls viewport.dispose() — wire down all
    // pollers + listeners here so the supervisor view stops polling /api/* once
    // the user closes the tab.
    if (controllers) {
      try { controllers.header.stop(); } catch {}
      try { controllers.tree.stop(); } catch {}
      try { controllers.kanban.stop(); } catch {}
      if (latestControllers === controllers) latestControllers = null;
      controllers = null;
    }
    rendered = false;
  }

  return {
    type: 'supervisor',
    key,
    viewClass: 'section-view',
    navigate,
    getChip,
    render,
    dispose,
  };
}

function open() {
  const terminal = require('../terminal');
  const host = terminal.getMultiTerminalUI();
  if (!host) return;
  host.openSection('supervisor', null, api, { newTab: false });
}

function handleNotifyClick({ taskId }) {
  // Always open / focus the section first so a closed tab still routes to the
  // task. open() reuses the existing viewport when one is present.
  open();
  if (!taskId) return;
  // multiTerminalUI.openSection() runs render() synchronously when it creates
  // a new viewport, but state propagation through notifySectionChanged() is
  // async (it goes through _onStateChange). Defer the scroll one tick so the
  // kanban is mounted + visible before we ask it to scroll.
  setTimeout(() => {
    const k = latestControllers && latestControllers.kanban;
    if (k && typeof k.scrollToTask === 'function') {
      try { k.scrollToTask(taskId); } catch (err) {
        console.warn('[supervisor] scrollToTask failed:', err);
      }
    }
  }, 120);
}

// Phase F: predicate for the palette `when` clause. A command should only be
// offered when the supervisor section is the currently-active tab. We can't
// just check `latestControllers` because that's truthy for any open viewport,
// even one in a background tab. Ask multiTerminalUI for the active section.
function isSupervisorActive() {
  try {
    const host = require('../terminal').getMultiTerminalUI();
    if (!host || !host.isSectionVisible) return false;
    const active = typeof host._activeSection === 'function' ? host._activeSection() : null;
    return !!(active && active.type === 'supervisor');
  } catch {
    return false;
  }
}

function init() {
  const { ipcRenderer } = require('electron');
  const { register } = require('../commandRegistry');
  register({
    id: 'supervisor.open',
    title: 'Open Supervisor',
    category: 'Supervisor',
    shortcut: 'CmdOrCtrl+Shift+U',
    run: () => open(),
  });
  // Phase F: palette commands for the four most common supervisor actions.
  // Submit-task and Tail are section-gated so they don't surface when the
  // user is in some unrelated view; daemon start/stop are global because the
  // daemon affects every supervisor session regardless of which tab is open.
  register({
    id: 'supervisor.submit-task',
    title: 'Supervisor — Submit task',
    category: 'Supervisor',
    shortcut: 'CmdOrCtrl+Shift+N',
    when: () => isSupervisorActive(),
    run: () => require('./submitTaskPanel').open(),
  });
  register({
    id: 'supervisor.start-daemon',
    title: 'Supervisor — Start daemon',
    category: 'Supervisor',
    run: () => {
      ipcRenderer.invoke(SUP.SUPERVISOR_DAEMON_START)
        .catch((err) => console.warn('[supervisor] daemon start failed:', err));
    },
  });
  register({
    id: 'supervisor.stop-daemon',
    title: 'Supervisor — Stop daemon (confirm)',
    category: 'Supervisor',
    run: () => {
      if (!window.confirm('Stop the supervisor daemon? In-flight tasks finish first.')) return;
      ipcRenderer.invoke(SUP.SUPERVISOR_DAEMON_STOP)
        .catch((err) => console.warn('[supervisor] daemon stop failed:', err));
    },
  });
  register({
    id: 'supervisor.tail-current',
    title: 'Supervisor — Tail current in-flight task',
    category: 'Supervisor',
    when: () => isSupervisorActive(),
    run: () => require('./kanban').expandTailOnFirstInflight(),
  });
  // Phase E: start the OS-notification detector at init() so escalations /
  // failures / daemon-stale alerts fire for the whole Frame session, not just
  // while the supervisor tab is open. The detector itself is idempotent —
  // calling start() twice is a no-op.
  const notifications = require('./notifications');
  notifications.start({ onNotifyClick: handleNotifyClick });
  // Phase F: the sidebar-footer heartbeat chip mounts itself when the host
  // calls require('./sidebar-ui/sidebarChip').mount(); subscribing to
  // SUPERVISOR_STATE is started lazily on mount and runs for the whole
  // Frame session.
}

const api = { init, open, createViewport, __getLatestControllers: () => latestControllers };
module.exports = api;
