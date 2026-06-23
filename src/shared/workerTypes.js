/**
 * Worker abstraction types — shared between main and renderer.
 *
 * Shapes mirror the autonomous supervisor's `WorkerInterface` types at
 * supervisor/types.py around lines 230-239 so future supervisor↔Frame
 * interop reads identically.
 *
 * @typedef {Object} WorkerEvent
 * @property {'progress'|'tool_use'|'decision'|'done'|'error'} kind
 * @property {string} ts            ISO timestamp
 * @property {Object} payload       free-form per-kind data
 *
 * @typedef {Object} SessionHandle
 * @property {string|null} sessionId
 * @property {string} terminalId
 * @property {string} tool          'claude_code' | 'codex' | 'gemini' | 'fake'
 * @property {string|null} model
 * @property {string} workdir
 *
 * @typedef {Object} TaskResult
 * @property {'done'|'failed'|'awaiting_human'} status
 * @property {string} summary
 * @property {number|null} costUsd
 * @property {string|null} sessionId
 */

const Posture = Object.freeze({
  CAUTIOUS: 'cautious',
  DEFAULT: 'default',
  DANGEROUSLY_SKIP: 'dangerously_skip',
});

const WorkerEventKind = Object.freeze({
  PROGRESS: 'progress',
  TOOL_USE: 'tool_use',
  DECISION: 'decision',
  DONE: 'done',
  ERROR: 'error',
});

module.exports = { Posture, WorkerEventKind };
