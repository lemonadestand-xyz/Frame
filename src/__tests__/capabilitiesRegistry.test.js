const fs = require('fs');
const os = require('os');
const path = require('path');
const { Capability } = require('../main/capabilities/types');
const registry = require('../main/capabilities/registry');

beforeEach(() => registry._resetForTests());

class FastCap extends Capability {
  async run({ question }) {
    return [{ source: 'fast', summary: `q=${question}`, refs: ['x.md'], score: 0.9 }];
  }
}
FastCap.name = 'fast';

class SlowCap extends Capability {
  async run() {
    await new Promise((r) => setTimeout(r, 50));
    return [{ source: 'slow', summary: 'slow result', refs: [], score: 0.5 }];
  }
}
SlowCap.name = 'slow';
SlowCap.timeoutMs = 10; // force timeout

class ErrorCap extends Capability {
  async run() { throw new Error('boom'); }
}
ErrorCap.name = 'error';

// Capabilities mirroring the supervisor's three built-ins so we can
// exercise the all-three-registered scenario without dragging in the
// real specReader / knowledgeSearch / webResearch implementations.
class FakeSpecReader extends Capability {
  constructor({ projectPath } = {}) {
    super();
    this.projectPath = projectPath;
  }
  async run({ question }) {
    return [{ source: 'spec_reader', summary: `spec match for ${question}`, refs: ['.frame/specs/x/spec.md'], score: 0.8 }];
  }
}
FakeSpecReader.name = 'spec_reader';

class FakeKnowledgeSearch extends Capability {
  async run() {
    return [
      { source: 'knowledge_search', summary: 'memory note A', refs: ['bm:project'], score: 0.7 },
      { source: 'knowledge_search', summary: 'memory note B', refs: ['bm:project'], score: 0.6 },
    ];
  }
}
FakeKnowledgeSearch.name = 'knowledge_search';

class FakeWebResearch extends Capability {
  async run() {
    return [{ source: 'web_research', summary: 'web result', refs: ['https://example.com'], score: 0.5 }];
  }
}
FakeWebResearch.name = 'web_research';

function _mkTmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'frame-caps-audit-'));
}

function _readAuditLines(projectPath) {
  const auditPath = path.join(projectPath, registry.AUDIT_RELATIVE_PATH);
  if (!fs.existsSync(auditPath)) return [];
  return fs.readFileSync(auditPath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe('Capability abstract', () => {
  it('throws on run() when not overridden', async () => {
    const c = new Capability();
    await expect(c.run({})).rejects.toThrow(/abstract/);
  });
});

describe('capabilities/registry.buildRegistry', () => {
  it('returns an empty map when the profile has no capabilities', () => {
    const reg = registry.buildRegistry({}, {});
    expect(Object.keys(reg)).toEqual([]);
  });

  it('only instantiates registered capabilities the profile lists', () => {
    registry.register('fast', FastCap);
    registry.register('slow', SlowCap);
    const reg = registry.buildRegistry(
      { capabilities: ['fast', 'unknown_cap'] }, {}
    );
    expect(Object.keys(reg)).toEqual(['fast']);
    expect(reg.fast).toBeInstanceOf(FastCap);
  });
});

describe('capabilities/registry.runAll', () => {
  it('flattens Evidence across every capability', async () => {
    registry.register('fast', FastCap);
    const reg = registry.buildRegistry({ capabilities: ['fast'] }, {});
    const ev = await registry.runAll(reg, 'hello?', {}, {});
    expect(ev).toEqual([{
      source: 'fast', summary: 'q=hello?', refs: ['x.md'], score: 0.9,
    }]);
  });

  it('returns a warning Evidence when a capability times out', async () => {
    registry.register('slow', SlowCap);
    const reg = registry.buildRegistry({ capabilities: ['slow'] }, {});
    const ev = await registry.runAll(reg, 'q', {}, {});
    expect(ev).toHaveLength(1);
    expect(ev[0].summary).toMatch(/timed out/);
    expect(ev[0].score).toBe(0);
  });

  it('returns a warning Evidence when a capability throws', async () => {
    registry.register('error', ErrorCap);
    const reg = registry.buildRegistry({ capabilities: ['error'] }, {});
    const ev = await registry.runAll(reg, 'q', {}, {});
    expect(ev).toHaveLength(1);
    expect(ev[0].summary).toMatch(/error: boom/);
  });

  it('returns [] for empty registry', async () => {
    expect(await registry.runAll({}, 'q', {}, {})).toEqual([]);
  });

  // ─── C-T08 broadened scenarios ──────────────────────────

  it('all-three-registered: returns evidence from every capability', async () => {
    registry.register('spec_reader', FakeSpecReader);
    registry.register('knowledge_search', FakeKnowledgeSearch);
    registry.register('web_research', FakeWebResearch);
    const reg = registry.buildRegistry({
      capabilities: ['spec_reader', 'knowledge_search', 'web_research'],
    }, {});
    expect(Object.keys(reg).sort()).toEqual(
      ['knowledge_search', 'spec_reader', 'web_research']
    );
    const ev = await registry.runAll(reg, 'what next?', {}, {});
    const sources = new Set(ev.map((e) => e.source));
    expect(sources.has('spec_reader')).toBe(true);
    expect(sources.has('knowledge_search')).toBe(true);
    expect(sources.has('web_research')).toBe(true);
    // 1 + 2 + 1 = 4 evidence items
    expect(ev).toHaveLength(4);
  });

  it('timeout: a hanging capability is killed and other capabilities still complete', async () => {
    registry.register('fast', FastCap);
    registry.register('slow', SlowCap);
    const reg = registry.buildRegistry({ capabilities: ['fast', 'slow'] }, {});
    const ev = await registry.runAll(reg, 'q', {}, {});
    // Fast cap delivers its real evidence; slow cap surfaces the timeout
    // as a single warning-shaped Evidence (source = slow).
    const fastEv = ev.filter((e) => e.source === 'fast');
    const timeoutEv = ev.filter((e) => /timed out/.test(e.summary));
    expect(fastEv).toHaveLength(1);
    expect(timeoutEv).toHaveLength(1);
    expect(timeoutEv[0].score).toBe(0);
  });

  it('error: a throwing capability is logged but other capabilities still complete', async () => {
    registry.register('fast', FastCap);
    registry.register('error', ErrorCap);
    const reg = registry.buildRegistry({ capabilities: ['fast', 'error'] }, {});
    const ev = await registry.runAll(reg, 'q', {}, {});
    const fastEv = ev.filter((e) => e.source === 'fast');
    const errorEv = ev.filter((e) => /error: boom/.test(e.summary));
    expect(fastEv).toHaveLength(1);
    expect(errorEv).toHaveLength(1);
  });
});

describe('capabilities/registry.runAll audit JSONL (C-T09)', () => {
  it('writes one line per capability per runAll call to .frame/runtime/capability-audit.jsonl', async () => {
    const projectPath = _mkTmpProject();
    try {
      registry.register('spec_reader', FakeSpecReader);
      registry.register('knowledge_search', FakeKnowledgeSearch);
      const reg = registry.buildRegistry(
        { capabilities: ['spec_reader', 'knowledge_search'] },
        { projectPath },
      );
      await registry.runAll(reg, 'q1', { projectPath }, {});
      const lines = _readAuditLines(projectPath);
      expect(lines).toHaveLength(2);
      const byCap = Object.fromEntries(lines.map((l) => [l.capability, l]));
      expect(Object.keys(byCap).sort()).toEqual(['knowledge_search', 'spec_reader']);
      // spec_reader returns 1 evidence; knowledge_search returns 2.
      expect(byCap.spec_reader.evidenceCount).toBe(1);
      expect(byCap.knowledge_search.evidenceCount).toBe(2);
      // Each record carries the expected shape.
      for (const rec of lines) {
        expect(typeof rec.capability).toBe('string');
        expect(rec.question).toBe('q1');
        expect(typeof rec.evidenceCount).toBe('number');
        expect(typeof rec.duration_ms).toBe('number');
        expect(rec.duration_ms).toBeGreaterThanOrEqual(0);
        expect(typeof rec.ts).toBe('string');
        // ISO-8601 sanity
        expect(rec.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      }
    } finally {
      fs.rmSync(projectPath, { recursive: true, force: true });
    }
  });

  it('appends — successive runAll calls add new lines without truncating earlier ones', async () => {
    const projectPath = _mkTmpProject();
    try {
      registry.register('fast', FastCap);
      const reg = registry.buildRegistry({ capabilities: ['fast'] }, { projectPath });
      await registry.runAll(reg, 'first', { projectPath }, {});
      await registry.runAll(reg, 'second', { projectPath }, {});
      const lines = _readAuditLines(projectPath);
      expect(lines).toHaveLength(2);
      expect(lines.map((l) => l.question)).toEqual(['first', 'second']);
    } finally {
      fs.rmSync(projectPath, { recursive: true, force: true });
    }
  });

  it('still emits a record (evidenceCount may be 1 for the warning shape) when a capability times out', async () => {
    const projectPath = _mkTmpProject();
    try {
      registry.register('slow', SlowCap);
      const reg = registry.buildRegistry({ capabilities: ['slow'] }, { projectPath });
      await registry.runAll(reg, 'why slow?', { projectPath }, {});
      const lines = _readAuditLines(projectPath);
      expect(lines).toHaveLength(1);
      expect(lines[0].capability).toBe('slow');
      // Warning Evidence: 1 record returned.
      expect(lines[0].evidenceCount).toBe(1);
      expect(lines[0].duration_ms).toBeGreaterThanOrEqual(SlowCap.timeoutMs);
    } finally {
      fs.rmSync(projectPath, { recursive: true, force: true });
    }
  });

  it('creates the runtime directory on first write when it does not yet exist', async () => {
    const projectPath = _mkTmpProject();
    try {
      // No .frame directory at all yet — the audit writer should mkdir -p.
      expect(fs.existsSync(path.join(projectPath, '.frame'))).toBe(false);
      registry.register('fast', FastCap);
      const reg = registry.buildRegistry({ capabilities: ['fast'] }, { projectPath });
      await registry.runAll(reg, 'q', { projectPath }, {});
      const auditPath = path.join(projectPath, registry.AUDIT_RELATIVE_PATH);
      expect(fs.existsSync(auditPath)).toBe(true);
      const lines = _readAuditLines(projectPath);
      expect(lines).toHaveLength(1);
    } finally {
      fs.rmSync(projectPath, { recursive: true, force: true });
    }
  });

  it('does not throw and writes nothing when no projectPath can be resolved', async () => {
    registry.register('fast', FastCap);
    const reg = registry.buildRegistry({ capabilities: ['fast'] }, {});
    // No projectPath on ctx or cap instance — should be a no-op.
    await expect(registry.runAll(reg, 'q', {}, {})).resolves.toBeDefined();
  });

  it('falls back to the capability instance projectPath when ctx omits it', async () => {
    const projectPath = _mkTmpProject();
    try {
      registry.register('spec_reader', FakeSpecReader);
      const reg = registry.buildRegistry(
        { capabilities: ['spec_reader'] },
        { projectPath },
      );
      // Note: ctx has no projectPath — the writer should still find it on the cap instance.
      await registry.runAll(reg, 'q', {}, {});
      const lines = _readAuditLines(projectPath);
      expect(lines).toHaveLength(1);
      expect(lines[0].capability).toBe('spec_reader');
    } finally {
      fs.rmSync(projectPath, { recursive: true, force: true });
    }
  });
});
