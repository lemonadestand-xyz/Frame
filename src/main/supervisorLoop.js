/**
 * Per-spec supervisor loop — one instance per Auto'd spec.
 *
 * Mirrors supervisor/loop.py:78-90 + classifier dispatch. Frame's version:
 *
 *   tick() {
 *     snapshot();
 *     verdict = await classifyNextStep(snapshot)
 *     await dispatch(verdict)
 *     audit(verdict)
 *     scheduleNextTick()
 *   }
 *
 * Dispatch actions are pluggable via the constructor's `executors` map so
 * the loop is testable without touching real lanes or files. The default
 * executors wire to specManager / autopilot / memoryMirror / escalations.
 */

const fs = require('fs');
const path = require('path');
const classifier = require('./supervisorClassifier');
const critic = require('./supervisorCritic');
const { recordDurableDecision } = require('./memoryMirror');
const { loadProfile } = require('./profile');

const DEFAULT_TICK_INTERVAL_MS = 1000;
const DEFAULT_MAX_TOTAL_TICKS = 200;

class SupervisorLoop {
  constructor({
    projectPath,
    slug,
    executors = {},
    onStateChange = null,
    onAudit = null,
    tickIntervalMs = DEFAULT_TICK_INTERVAL_MS,
    maxTotalTicks = DEFAULT_MAX_TOTAL_TICKS,
    capabilities = null,
  } = {}) {
    if (!projectPath || !slug) {
      throw new Error('SupervisorLoop requires projectPath + slug');
    }
    this.projectPath = projectPath;
    this.slug = slug;
    this.executors = executors;
    this.onStateChange = onStateChange;
    this.onAudit = onAudit;
    this.tickIntervalMs = tickIntervalMs;
    this.maxTotalTicks = maxTotalTicks;
    this.capabilities = capabilities;

    this.state = {
      status: 'idle', // idle | running | paused | completed | failed
      tickCount: 0,
      lastVerdict: null,
      lastTickAt: null,
      pausedReason: null,
    };
    this._stopRequested = false;
    this._stopGracefulPromise = null;
  }

  // ─── Public surface ───────────────────────────────────

  async start() {
    if (this.state.status === 'running') return;
    this.state.status = 'running';
    this._stopRequested = false;
    this._emitState();
    this._loop().catch((err) => {
      this.state.status = 'failed';
      this.state.pausedReason = err.message || String(err);
      this._emitState();
    });
  }

  async stop() {
    this._stopRequested = true;
    if (this._stopGracefulPromise) await this._stopGracefulPromise;
    if (this.state.status === 'running') {
      this.state.status = 'paused';
      this.state.pausedReason = 'user_stopped';
      this._emitState();
    }
  }

  getState() { return { ...this.state, projectPath: this.projectPath, slug: this.slug }; }

  // ─── Internal loop ────────────────────────────────────

  async _loop() {
    while (!this._stopRequested && this.state.tickCount < this.maxTotalTicks) {
      this._stopGracefulPromise = this._tick();
      try { await this._stopGracefulPromise; } finally { this._stopGracefulPromise = null; }
      if (this.state.status === 'completed' || this.state.status === 'failed') return;
      await _sleep(this.tickIntervalMs);
    }
    if (this.state.tickCount >= this.maxTotalTicks) {
      this.state.status = 'paused';
      this.state.pausedReason = 'max_total_ticks';
      this._emitState();
    }
  }

  async _tick() {
    this.state.tickCount += 1;
    this.state.lastTickAt = new Date().toISOString();

    const snapshot = await this._snapshot();
    let verdict;
    try {
      if (this.capabilities) {
        verdict = await classifier.classifyWithResearch(snapshot, async (q, ctx) => {
          return this.capabilities.runAll(q, ctx);
        });
      } else {
        verdict = await classifier.classifyNextStep(snapshot);
      }
    } catch (err) {
      verdict = {
        route: 'escalate',
        actionKind: 'escalate_classify_threw',
        reasoning: err.message || String(err),
        confidence: 0,
        draftedQuestion: 'Classifier threw — review and decide.',
        category: 'tooling',
      };
    }
    this.state.lastVerdict = verdict;
    this._emitAudit({ ...snapshot._audit, verdict });
    this._emitState();

    // Dispatch
    try {
      await this._dispatch(verdict, snapshot);
    } catch (err) {
      this.state.status = 'failed';
      this.state.pausedReason = `dispatch_failed: ${err.message || String(err)}`;
      this._emitState();
    }
  }

  async _snapshot() {
    const ex = this.executors;
    const status = ex.readStatus ? await ex.readStatus(this.projectPath, this.slug) : null;
    const tasks = ex.readTasks ? await ex.readTasks(this.projectPath, this.slug) : [];
    const lane = ex.readLane ? await ex.readLane(this.slug) : null;
    const specBody = ex.readDoc ? await ex.readDoc(this.projectPath, this.slug, 'spec.md') : '';
    const planBody = ex.readDoc ? await ex.readDoc(this.projectPath, this.slug, 'plan.md') : '';
    const recentAudit = ex.readRecentAudit ? await ex.readRecentAudit(this.projectPath, this.slug, 5) : [];
    const profile = ex.readProfile
      ? await ex.readProfile(this.projectPath)
      : loadProfile(this.projectPath).profile;
    return {
      status, tasks, lane, specBody, planBody, recentAudit, profile,
      userPaused: this._stopRequested,
      footprintConflict: ex.checkFootprintConflict ? await ex.checkFootprintConflict(this.projectPath, this.slug) : false,
      _audit: {
        ts: new Date().toISOString(),
        tick: this.state.tickCount,
        phase: status?.phase,
        beforeUndone: tasks.filter((t) => t && (t.status === 'pending' || t.status === 'in_progress')).length,
      },
    };
  }

  async _dispatch(verdict, snapshot) {
    const ex = this.executors;
    switch (verdict.route) {
      case 'done':
        if (ex.markDone) await ex.markDone(this.projectPath, this.slug);
        this.state.status = 'completed';
        break;

      case 'paused':
      case 'wait':
        this.state.pausedReason = verdict.reason || verdict.route;
        // Loop will idle on next sleep — don't change status if we're just waiting on a transient signal.
        break;

      case 'escalate': {
        if (ex.presentEscalation) {
          // Fire-and-await — supervisor blocks until the user answers
          const answer = await ex.presentEscalation({
            slug: this.slug,
            projectPath: this.projectPath,
            draftedQuestion: verdict.draftedQuestion,
            draftAnswer: verdict.reasoning,
            category: verdict.category || 'scope',
            confidence: verdict.confidence,
          });
          if (answer && answer.answer) {
            // Best-effort durable mirror
            await recordDurableDecision(this.projectPath, {
              category: verdict.category || 'scope',
              spec_slug: this.slug,
              draftedQuestion: verdict.draftedQuestion,
              answer: answer.answer,
              reasoning: verdict.reasoning,
              confidence: verdict.confidence,
              route: 'escalate',
            });
          }
        } else {
          this.state.status = 'paused';
          this.state.pausedReason = 'escalate_no_adapter';
        }
        break;
      }

      case 'advance':
        if (ex.advancePhase) {
          await ex.advancePhase(this.projectPath, this.slug, verdict.nextPhase);
        }
        break;

      case 'implement':
        if (ex.implementNextTurn) {
          await ex.implementNextTurn(this.projectPath, this.slug);
        }
        break;

      case 'critic': {
        if (ex.readLastOutcomeEntry) {
          const outcomeEntry = await ex.readLastOutcomeEntry(this.projectPath, this.slug);
          const lastTask = (snapshot.tasks || []).filter((t) => t && t.status === 'completed').slice(-1)[0] || {};
          const footprintDeclared = ex.readFootprint ? await ex.readFootprint(this.projectPath, this.slug) : [];
          const filesActuallyChanged = ex.readChangedFiles ? await ex.readChangedFiles(this.projectPath, this.slug) : [];
          const result = await critic.critique({
            task: lastTask,
            outcomeEntry,
            footprintDeclared,
            filesActuallyChanged,
            toolUsesInLastN: 0,
            iterationCount: 0,
          });
          if (result.passed) {
            if (ex.markDone) await ex.markDone(this.projectPath, this.slug);
            this.state.status = 'completed';
          } else if (ex.dispatchRevision) {
            await ex.dispatchRevision(this.projectPath, this.slug, result.correctiveInstructions);
          }
        }
        break;
      }

      case 'research':
        // classifyWithResearch already attempted; if we still see RESEARCH it
        // means capabilities returned nothing useful — escalate.
        if (ex.presentEscalation) {
          await ex.presentEscalation({
            slug: this.slug,
            projectPath: this.projectPath,
            draftedQuestion: 'Capabilities returned no actionable evidence; need human input.',
            draftAnswer: verdict.reasoning,
            category: verdict.category || 'scope',
            confidence: verdict.confidence,
          });
        }
        break;

      default:
        this.state.status = 'paused';
        this.state.pausedReason = `unknown_route: ${verdict.route}`;
    }
  }

  // ─── Helpers ──────────────────────────────────────────

  _emitState() {
    if (typeof this.onStateChange === 'function') {
      try { this.onStateChange(this.getState()); } catch { /* swallow */ }
    }
  }

  _emitAudit(entry) {
    if (typeof this.onAudit === 'function') {
      try { this.onAudit(entry); } catch { /* swallow */ }
    }
    // Append to disk too if the project path is writable.
    try {
      const dir = path.join(this.projectPath, '.frame', 'specs', this.slug);
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(path.join(dir, 'supervisor-audit.jsonl'),
        JSON.stringify(entry) + '\n', 'utf8');
    } catch { /* swallow — audit is best-effort */ }
  }
}

function _sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

module.exports = { SupervisorLoop, DEFAULT_TICK_INTERVAL_MS, DEFAULT_MAX_TOTAL_TICKS };
