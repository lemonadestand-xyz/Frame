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
  RENAME_PROJECT: 'rename-project',

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
  TERMINAL_FOCUS: 'terminal-focus',
  GET_AVAILABLE_SHELLS: 'get-available-shells',
  AVAILABLE_SHELLS_DATA: 'available-shells-data',
  // Terminal completion notifications (lemo-7)
  TERMINAL_MARK_ACTIVE: 'terminal-mark-active',
  TERMINAL_COMPLETED: 'terminal-completed',
  DOCK_BOUNCE: 'dock-bounce',
  WINDOW_FOCUS_AND_SHOW: 'window-focus-and-show',
  // Task references (lemo-4) — picker for files/folders, opener for the
  // shell so a click on a reference reveals it in Finder / opens the URL.
  PICK_REFERENCE_FILE: 'pick-reference-file',
  OPEN_REFERENCE: 'open-reference',

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
  GET_TOOL_FLAGS: 'get-tool-flags',
  SET_TOOL_FLAGS: 'set-tool-flags',

  // User Settings (renderer-side preferences persisted to userData JSON)
  GET_USER_SETTING: 'get-user-setting',
  SET_USER_SETTING: 'set-user-setting',

  // Git Status (file tree decoration)
  WATCH_GIT_STATUS: 'watch-git-status',
  UNWATCH_GIT_STATUS: 'unwatch-git-status',
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

  // Global cross-project dashboard (lemo-global-dashboard)
  LOAD_GLOBAL_DASHBOARD: 'load-global-dashboard',
  SYNC_GLOBAL_DASHBOARD: 'sync-global-dashboard',
  ADD_GLOBAL_PROJECT: 'add-global-project',
  REMOVE_GLOBAL_PROJECT: 'remove-global-project',
  UPDATE_GLOBAL_PROJECT_METADATA: 'update-global-project-metadata',
  SET_GLOBAL_PROJECT_FILTER: 'set-global-project-filter',
  GLOBAL_DASHBOARD_DATA: 'global-dashboard-data',
  GLOBAL_DASHBOARD_SYNC_PROGRESS: 'global-dashboard-sync-progress',
  TOGGLE_GLOBAL_DASHBOARD: 'toggle-global-dashboard',
  PROMPT_GLOBAL_DASHBOARD_ENROLL: 'prompt-global-dashboard-enroll',
  REFRESH_GLOBAL_PROJECT: 'refresh-global-project',
  // Side-effect-free folder picker (does not switch the active project)
  PICK_FOLDER: 'pick-folder',

  // Cross-project chat sessions (overview-session chat, distinct from
  // per-project execution terminals)
  CREATE_CHAT_SESSION: 'create-chat-session',
  CHAT_SESSION_CREATED: 'chat-session-created',
  LIST_CHAT_SESSIONS: 'list-chat-sessions',
  CHAT_SESSIONS_DATA: 'chat-sessions-data',
  DELETE_CHAT_SESSION: 'delete-chat-session',
  GET_CHAT_START_COMMAND: 'get-chat-start-command',
  CHAT_SUGGESTIONS_DATA: 'chat-suggestions-data',
  APPLY_CHAT_SUGGESTION: 'apply-chat-suggestion',
  DISMISS_CHAT_SUGGESTION: 'dismiss-chat-suggestion'
};

module.exports = { IPC };
