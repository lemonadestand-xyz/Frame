/**
 * Wrapper around `claude -p --output-format json --max-turns 1`.
 *
 * Used by the supervisor's classifier + critic to make a single judgment
 * call with structured output. Mirrors supervisor/classifier/llm.py:93-99.
 *
 * The runner is exported as a function `runClaudeJson(prompt, opts)` so
 * tests can mock it via `setRunner(fn)` without bringing up a real subprocess.
 */

const { spawn } = require('child_process');

const DEFAULT_MODEL = 'claude-haiku-4-5';
const DEFAULT_TIMEOUT_MS = 30_000;

let _runner = _realRunner;

async function _realRunner(prompt, { model = DEFAULT_MODEL, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('prompt required');
  }
  return new Promise((resolve, reject) => {
    const args = ['-p', prompt,
      '--output-format', 'json',
      '--max-turns', '1',
      '--permission-mode', 'default',
      '--model', model,
    ];
    let proc;
    try {
      proc = spawn('claude', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      return reject(new Error(`failed to spawn claude: ${err.message}`));
    }
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (b) => { stdout += b.toString(); });
    proc.stderr.on('data', (b) => { stderr += b.toString(); });
    const timer = setTimeout(() => {
      try { proc.kill('SIGTERM'); } catch { /* ignore */ }
      reject(new Error(`claude runner timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    proc.on('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        return reject(new Error(`claude exited ${code}: ${stderr.slice(0, 500)}`));
      }
      // claude -p --output-format json emits an envelope; pull the assistant
      // text out and JSON.parse it (the supervisor's runner does the same).
      let envelope;
      try { envelope = JSON.parse(stdout); } catch (err) {
        return reject(new Error(`malformed claude envelope: ${err.message}`));
      }
      const text = (envelope && (envelope.result || envelope.output || envelope.text)) || '';
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) {
        return reject(new Error(`no JSON object in claude response: ${text.slice(0, 200)}`));
      }
      try {
        resolve(JSON.parse(match[0]));
      } catch (err) {
        reject(new Error(`failed to parse inner JSON: ${err.message}`));
      }
    });
  });
}

async function runClaudeJson(prompt, opts) {
  return _runner(prompt, opts);
}

// Test seam — replace the runner with a stub.
function setRunner(fn) { _runner = typeof fn === 'function' ? fn : _realRunner; }
function resetRunner() { _runner = _realRunner; }

module.exports = { runClaudeJson, setRunner, resetRunner, DEFAULT_MODEL };
