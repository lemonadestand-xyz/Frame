const fs = require('fs');
const os = require('os');
const path = require('path');

const config = require('../main/autopilot.config');

function mkProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-autopilot-intent-'));
  fs.mkdirSync(path.join(dir, '.frame', 'specs', 'demo'), { recursive: true });
  return dir;
}

describe('autopilot.config auto_on_tasks helpers', () => {
  let projectPath;

  beforeEach(() => { projectPath = mkProject(); });
  afterEach(() => { fs.rmSync(projectPath, { recursive: true, force: true }); });

  test('readAutoOnTasks defaults to false when file is absent', () => {
    expect(config.readAutoOnTasks(projectPath, 'demo')).toBe(false);
  });

  test('writeAutoOnTasks(true) → readAutoOnTasks returns true', () => {
    config.writeAutoOnTasks(projectPath, 'demo', true);
    expect(config.readAutoOnTasks(projectPath, 'demo')).toBe(true);
  });

  test('writeAutoOnTasks(false) when file is empty does not create the file', () => {
    config.writeAutoOnTasks(projectPath, 'demo', false);
    const filePath = path.join(projectPath, '.frame', 'specs', 'demo', 'autopilot.json');
    expect(fs.existsSync(filePath)).toBe(false);
  });

  test('writeAutoOnTasks(false) preserves other caps in the same file', () => {
    const filePath = path.join(projectPath, '.frame', 'specs', 'demo', 'autopilot.json');
    fs.writeFileSync(filePath, JSON.stringify({ max_turns_per_task: 7, auto_on_tasks: true }));
    config.writeAutoOnTasks(projectPath, 'demo', false);
    const after = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(after).toEqual({ max_turns_per_task: 7 });
  });

  test('writeAutoOnTasks(true) merges with existing caps without clobbering', () => {
    const filePath = path.join(projectPath, '.frame', 'specs', 'demo', 'autopilot.json');
    fs.writeFileSync(filePath, JSON.stringify({ max_turns_per_task: 7 }));
    config.writeAutoOnTasks(projectPath, 'demo', true);
    const after = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(after).toEqual({ max_turns_per_task: 7, auto_on_tasks: true });
  });

  test('readAutoOnTasks returns false for malformed JSON (no throw)', () => {
    const filePath = path.join(projectPath, '.frame', 'specs', 'demo', 'autopilot.json');
    fs.writeFileSync(filePath, 'not json');
    expect(config.readAutoOnTasks(projectPath, 'demo')).toBe(false);
  });
});
