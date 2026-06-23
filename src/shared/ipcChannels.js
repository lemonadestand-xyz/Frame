/**
 * IPC Channel Constants
 * Single source of truth for all IPC channel names
 */

const IPC = {
  // Terminal
  START_TERMINAL: 'start-terminal',
  RESTART_TERMINAL: 'restart-terminal',
  TERMINAL_INPUT: 'terminal-input',
  TERMINAL_OUTPUT: 'terminal-output',
  TERMINAL_RESIZE: 'terminal-resize',

  // Project
  SELECT_PROJECT_FOLDER: 'select-project-folder',
  CREATE_NEW_PROJECT: 'create-new-project',
  CLONE_GITHUB_REPO: 'clone-github-repo',
  CLONE_GITHUB_REPO_RESULT: 'clone-github-repo-result',
  OPEN_SAMPLE_PROJECT: 'open-sample-project',
  GET_SAMPLE_PROJECT_PATH: 'get-sample-project-path',
  PROJECT_SELECTED: 'project-selected',

  // File Tree
  LOAD_FILE_TREE: 'load-file-tree',
  FILE_TREE_DATA: 'file-tree-data',

  // History
  LOAD_PROMPT_HISTORY: 'load-prompt-history',
  PROMPT_HISTORY_DATA: 'prompt-history-data',
  TOGGLE_HISTORY_PANEL: 'toggle-history-panel',

  // Commands
  RUN_COMMAND: 'run-command',

  // Workspace
  LOAD_WORKSPACE: 'load-workspace',
  WORKSPACE_DATA: 'workspace-data',
  WORKSPACE_UPDATED: 'workspace-updated',
  ADD_PROJECT_TO_WORKSPACE: 'add-project-to-workspace',
  REMOVE_PROJECT_FROM_WORKSPACE: 'remove-project-from-workspace',
  REORDER_WORKSPACE_PROJECTS: 'reorder-workspace-projects',

  // Frame Project
  INITIALIZE_FRAME_PROJECT: 'initialize-frame-project',
  FRAME_PROJECT_INITIALIZED: 'frame-project-initialized',
  CHECK_IS_FRAME_PROJECT: 'check-is-frame-project',
  IS_FRAME_PROJECT_RESULT: 'is-frame-project-result',
  GET_FRAME_CONFIG: 'get-frame-config',
  FRAME_CONFIG_DATA: 'frame-config-data',

  // File Editor
  READ_FILE: 'read-file',
  FILE_CONTENT: 'file-content',
  WRITE_FILE: 'write-file',
  FILE_SAVED: 'file-saved',

  // Multi-Terminal
  TERMINAL_CREATE: 'terminal-create',
  TERMINAL_CREATED: 'terminal-created',
  TERMINAL_DESTROY: 'terminal-destroy',
  TERMINAL_DESTROYED: 'terminal-destroyed',
  TERMINAL_INPUT_ID: 'terminal-input-id',
  TERMINAL_OUTPUT_ID: 'terminal-output-id',
  TERMINAL_RESIZE_ID: 'terminal-resize-id',
  TERMINAL_PROCESS_DATA: 'terminal-process-data',
  TERMINAL_FOCUS: 'terminal-focus',
  GET_AVAILABLE_SHELLS: 'get-available-shells',
  AVAILABLE_SHELLS_DATA: 'available-shells-data',

  // Tasks Panel
  LOAD_TASKS: 'load-tasks',
  TASKS_DATA: 'tasks-data',
  ADD_TASK: 'add-task',
  UPDATE_TASK: 'update-task',
  DELETE_TASK: 'delete-task',
  REORDER_TASKS: 'reorder-tasks',
  TASK_UPDATED: 'task-updated',
  TOGGLE_TASKS_PANEL: 'toggle-tasks-panel',
  TOGGLE_TASKS_DASHBOARD: 'toggle-tasks-dashboard',

  // Plugins Panel
  LOAD_PLUGINS: 'load-plugins',
  PLUGINS_DATA: 'plugins-data',
  TOGGLE_PLUGIN: 'toggle-plugin',
  PLUGIN_TOGGLED: 'plugin-toggled',
  TOGGLE_PLUGINS_PANEL: 'toggle-plugins-panel',
  REFRESH_PLUGINS: 'refresh-plugins',

  // Claude Sessions
  LOAD_CLAUDE_SESSIONS: 'load-claude-sessions',
  REFRESH_CLAUDE_SESSIONS: 'refresh-claude-sessions',

  // GitHub Panel
  LOAD_GITHUB_ISSUES: 'load-github-issues',
  GITHUB_ISSUES_DATA: 'github-issues-data',
  TOGGLE_GITHUB_PANEL: 'toggle-github-panel',
  OPEN_GITHUB_ISSUE: 'open-github-issue',

  // Claude Usage
  LOAD_CLAUDE_USAGE: 'load-claude-usage',
  CLAUDE_USAGE_DATA: 'claude-usage-data',
  REFRESH_CLAUDE_USAGE: 'refresh-claude-usage',

  // Overview Panel
  LOAD_OVERVIEW: 'load-overview',
  OVERVIEW_DATA: 'overview-data',
  GET_FILE_GIT_HISTORY: 'get-file-git-history',

  // Git Branches Panel
  LOAD_GIT_BRANCHES: 'load-git-branches',
  SWITCH_GIT_BRANCH: 'switch-git-branch',
  CREATE_GIT_BRANCH: 'create-git-branch',
  DELETE_GIT_BRANCH: 'delete-git-branch',
  LOAD_GIT_WORKTREES: 'load-git-worktrees',
  ADD_GIT_WORKTREE: 'add-git-worktree',
  REMOVE_GIT_WORKTREE: 'remove-git-worktree',
  TOGGLE_GIT_BRANCHES_PANEL: 'toggle-git-branches-panel',

  // Update Check
  CHECK_FOR_UPDATE: 'check-for-update',
  UPDATE_AVAILABLE: 'update-available',
  GET_UPDATE_STATUS: 'get-update-status',

  // AI Tool Settings
  GET_AI_TOOL_CONFIG: 'get-ai-tool-config',
  AI_TOOL_CONFIG_DATA: 'ai-tool-config-data',
  SET_AI_TOOL: 'set-ai-tool',
  AI_TOOL_CHANGED: 'ai-tool-changed',
  CHECK_AI_TOOL_AVAILABLE: 'check-ai-tool-available',
  GET_TOOL_FLAGS: 'get-tool-flags',                  // renderer → main: { presets, enabledPresets, customFlags, fullCommand }
  SET_TOOL_FLAGS: 'set-tool-flags',                  // renderer → main: persist { enabledPresets, customFlags }

  // User Settings (renderer-side preferences persisted to userData JSON)
  GET_USER_SETTING: 'get-user-setting',
  SET_USER_SETTING: 'set-user-setting',

  // Git Status (file tree decoration)
  WATCH_GIT_STATUS: 'watch-git-status',
  UNWATCH_GIT_STATUS: 'unwatch-git-status',
  REFRESH_GIT_STATUS: 'refresh-git-status',
  GIT_STATUS_DATA: 'git-status-data',
  GET_GIT_DIFF: 'get-git-diff',

  // Telemetry (Aptabase, opt-out via Settings)
  TELEMETRY_SET_ENABLED: 'telemetry-set-enabled',

  // Settings UI (open settings modal from menu)
  OPEN_SETTINGS: 'open-settings',

  // Spec-Driven Development (Slice 1) — .frame/specs/<slug>/ lifecycle
  LIST_SPECS: 'list-specs',
  GET_SPEC: 'get-spec',
  CREATE_SPEC: 'create-spec',
  UPDATE_SPEC_STATUS: 'update-spec-status',
  RENAME_SPEC: 'rename-spec',
  WATCH_SPECS: 'watch-specs',
  UNWATCH_SPECS: 'unwatch-specs',
  SPEC_DATA: 'spec-data',
  TOGGLE_SPECS_PANEL: 'toggle-specs-panel',
  TOGGLE_SPECS_DASHBOARD: 'toggle-specs-dashboard',
  GET_SPEC_PROMPT: 'get-spec-prompt',
  BUILD_SPEC_COMMAND_FILE: 'build-spec-command-file',

  // Spec-Driven Development opt-in (Slice 1.5)
  IS_SPEC_DRIVEN_ENABLED: 'is-spec-driven-enabled',
  ENABLE_SPEC_DRIVEN: 'enable-spec-driven',

  // Orchestration (conductor / parallel spec execution)
  OPEN_ORCHESTRATOR: 'open-orchestrator',            // → renderer: open the orchestrator view
  START_ORCHESTRATION: 'start-orchestration',        // renderer → main: begin a session (conductor lane id in)
  STOP_ORCHESTRATION: 'stop-orchestration',          // renderer → main: teardown (workers, worktrees, branches)
  GET_ORCH_STATE: 'get-orch-state',                  // renderer → main: snapshot of the session
  ORCH_ASSIGN_SPECS: 'orch-assign-specs',            // renderer → main: set the specs assigned to the conductor
  ORCH_STATE: 'orch-state',                          // main → renderer: pushed session/lane state
  ORCH_SPAWN_WORKER: 'orch-spawn-worker',            // main → renderer: create a worker lane (slug, worktreeDir, env) + dispatch
  ORCH_WORKER_LANE: 'orch-worker-lane',              // renderer → main: report the terminalId it created for a worker
  ORCH_MERGE_WORKER: 'orch-merge-worker',            // renderer → main: merge a worker's branch (per-worker board action)
  ORCH_REMOVE_WORKER: 'orch-remove-worker',          // renderer → main: cleanup a worker (worktree + branch)

  // Autopilot (drives /spec.implement repeatedly without manual clicks)
  AUTOPILOT_START: 'autopilot-start',                // renderer → main: { projectPath, scope, slug?, terminalId, caps? }
  AUTOPILOT_STOP: 'autopilot-stop',                  // renderer → main: { projectPath, runId }
  AUTOPILOT_GET: 'autopilot-get',                    // renderer → main: snapshot of active runs
  AUTOPILOT_STATE: 'autopilot-state',                // main → renderer: pushed state on every run transition
  AUTOPILOT_AUDIT: 'autopilot-audit',                // renderer → main: read .frame/specs/<slug>/autopilot-events.jsonl
  SET_AUTO_ON_TASKS: 'set-auto-on-tasks',            // renderer → main: { projectPath, slug, value } persists pre-arm flag
  GET_AUTO_ON_TASKS: 'get-auto-on-tasks',            // renderer → main: { projectPath, slug } → boolean
  AUTOPILOT_ARM_REQUEST: 'autopilot-arm-request',    // main → renderer: { projectPath, slug } fires when an armed spec hits tasks_generated

  // Spec doc / tasks editing from the UI
  WRITE_SPEC_DOC: 'write-spec-doc',                  // renderer → main: overwrite spec.md | plan.md | tasks.md
  ADD_SPEC_TASK: 'add-spec-task',                    // renderer → main: append a pending task to tasks.md + tasks.json
  REMOVE_SPEC_TASK: 'remove-spec-task',              // renderer → main: delete a pending spec task (rejects non-pending)

  // Spec attachments (screenshots / docs referenced from spec.md / plan.md)
  ATTACH_SPEC_FILE: 'attach-spec-file',              // renderer → main: { projectPath, slug?|stagingId?, payload } → { success, relativePath?, filename?, error? }
  LIST_SPEC_ATTACHMENTS: 'list-spec-attachments',    // renderer → main: { projectPath, slug } → string[] relative paths
  PURGE_STAGED_ATTACHMENTS: 'purge-staged-attachments', // renderer → main: { projectPath, stagingId } — cancel cleanup

  // Project profile (.frame/profile.json)
  LOAD_PROFILE: 'load-profile',                      // renderer → main: { projectPath } → { profile, source, warnings }
  SAVE_PROFILE: 'save-profile',                      // renderer → main: { projectPath, profile } → { success, error? }
  WATCH_PROFILE: 'watch-profile',                    // renderer → main: subscribe to profile changes for projectPath
  UNWATCH_PROFILE: 'unwatch-profile',                // renderer → main: stop the watcher
  PROFILE_DATA: 'profile-data',                      // main → renderer: pushed on initial load + every watcher fire

  // Basic Memory (per-project markdown notes under ~/memory/<id>/)
  SEARCH_MEMORY: 'search-memory',                    // renderer → main: { projectPath, query, k? } → Note[]
  LIST_MEMORY: 'list-memory',                        // renderer → main: { projectPath, category?, spec_slug? } → Note[]

  // Supervisor loop (replaces autopilot for LLM-judged spec orchestration)
  SUPERVISOR_START: 'supervisor-start',                          // renderer → main: { projectPath, slug, terminalId? }
  SUPERVISOR_STOP: 'supervisor-stop',                            // renderer → main: { projectPath, slug } — graceful
  SUPERVISOR_STATE: 'supervisor-state',                          // main → renderer: pushed on every state change
  SUPERVISOR_AUDIT: 'supervisor-audit',                          // renderer → main: read .frame/specs/<slug>/supervisor-audit.jsonl
  SUPERVISOR_ESCALATION_OPEN: 'supervisor-escalation-open',      // main → renderer: pause + drafted-question
  SUPERVISOR_ESCALATION_ANSWERED: 'supervisor-escalation-answered', // renderer → main: { id, answer, answeredBy }

  // Cross-project orchestration (aggregated view across all open projects)
  LIST_CROSS_PROJECT_SUPERVISORS: 'list-cross-project-supervisors',  // renderer → main: snapshot
  WATCH_CROSS_PROJECT_SUPERVISORS: 'watch-cross-project-supervisors', // renderer → main: subscribe push
  CROSS_PROJECT_SUPERVISORS_DATA: 'cross-project-supervisors-data',  // main → renderer: pushed snapshot
  PAUSE_SPEC_SUPERVISOR: 'pause-spec-supervisor',                    // renderer → main: { projectPath, slug }
  RESUME_SPEC_SUPERVISOR: 'resume-spec-supervisor',                  // renderer → main: { projectPath, slug, terminalId? }
  PAUSE_ALL_SUPERVISORS: 'pause-all-supervisors',                    // renderer → main
  RESUME_ALL_SUPERVISORS: 'resume-all-supervisors'                   // renderer → main
};

module.exports = { IPC };
