const fs = require('fs');
const os = require('os');
const path = require('path');

const attachments = require('../main/specAttachments');
const { FRAME_DIR } = require('../shared/frameConstants');

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'frame-spec-attach-test-'));
}

function createFakeSpec(projectPath, slug) {
  const specDir = path.join(projectPath, FRAME_DIR, 'specs', slug);
  fs.mkdirSync(specDir, { recursive: true });
  fs.writeFileSync(path.join(specDir, 'status.json'), JSON.stringify({ slug }));
  return specDir;
}

function fixtureSource(projectPath, name, bytes) {
  const p = path.join(projectPath, name);
  fs.writeFileSync(p, bytes || Buffer.from('hello world'));
  return p;
}

describe('specAttachments.sanitizeBasename', () => {
  it('strips directory traversal', () => {
    expect(attachments.sanitizeBasename('../../etc/passwd')).toBe('passwd');
    expect(attachments.sanitizeBasename('..\\..\\Windows\\sys.dll')).toBe('sys.dll');
  });
  it('strips leading dots so we do not write a hidden file', () => {
    expect(attachments.sanitizeBasename('.hidden')).toBe('hidden');
  });
  it('replaces exotic characters with underscores', () => {
    expect(attachments.sanitizeBasename('foo bar!@#.png')).toBe('foo_bar_.png');
  });
  it('returns a fallback when the input collapses to empty', () => {
    expect(attachments.sanitizeBasename('')).toBe('file');
    expect(attachments.sanitizeBasename(null)).toBe('file');
    expect(attachments.sanitizeBasename('...')).toBe('file');
  });
});

describe('specAttachments.buildAttachmentFilename', () => {
  it('combines a sortable timestamp prefix with the sanitised basename', () => {
    const now = new Date('2026-06-22T12:34:56.123Z');
    const name = attachments.buildAttachmentFilename('Screen Shot.png', now);
    expect(name).toMatch(/^2026-06-22T12-34-56Z__Screen_Shot\.png$/);
  });
});

describe('specAttachments.attachToSpec', () => {
  it('refuses an unknown spec', () => {
    const proj = tmpProject();
    const src = fixtureSource(proj, 'img.png');
    const res = attachments.attachToSpec(proj, 'no-such-slug', {
      kind: 'path',
      originalName: 'img.png',
      sourcePath: src
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/spec not found/);
  });

  it('writes kind=path attachments under attachments/ and returns the relative path', () => {
    const proj = tmpProject();
    createFakeSpec(proj, 'demo');
    const src = fixtureSource(proj, 'logo.png');
    const res = attachments.attachToSpec(proj, 'demo', {
      kind: 'path',
      originalName: 'logo.png',
      sourcePath: src
    });
    expect(res.success).toBe(true);
    expect(res.relativePath.startsWith('attachments/')).toBe(true);
    const onDisk = path.join(proj, FRAME_DIR, 'specs', 'demo', res.relativePath);
    expect(fs.existsSync(onDisk)).toBe(true);
  });

  it('writes kind=buffer attachments from base64', () => {
    const proj = tmpProject();
    createFakeSpec(proj, 'demo');
    const data = Buffer.from('pretend-png').toString('base64');
    const res = attachments.attachToSpec(proj, 'demo', {
      kind: 'buffer',
      originalName: 'paste.png',
      data
    });
    expect(res.success).toBe(true);
    const onDisk = path.join(proj, FRAME_DIR, 'specs', 'demo', res.relativePath);
    expect(fs.readFileSync(onDisk, 'utf8')).toBe('pretend-png');
  });

  it('rejects files larger than the 25 MB cap (path kind)', () => {
    const proj = tmpProject();
    createFakeSpec(proj, 'demo');
    const bigPath = path.join(proj, 'big.bin');
    const fd = fs.openSync(bigPath, 'w');
    fs.ftruncateSync(fd, attachments.MAX_BYTES + 1);
    fs.closeSync(fd);
    const res = attachments.attachToSpec(proj, 'demo', {
      kind: 'path',
      originalName: 'big.bin',
      sourcePath: bigPath
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/25 MB cap/);
  });

  it('rejects an unknown payload.kind', () => {
    const proj = tmpProject();
    createFakeSpec(proj, 'demo');
    const res = attachments.attachToSpec(proj, 'demo', { kind: 'magic', originalName: 'x.png' });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/unknown payload.kind/);
  });
});

describe('specAttachments staging flow', () => {
  it('stages a file under .frame/runtime/spec-attachments-staging/<id>/', () => {
    const proj = tmpProject();
    const src = fixtureSource(proj, 'p1.png');
    const res = attachments.stageAttachment(proj, 'stage123', {
      kind: 'path',
      originalName: 'p1.png',
      sourcePath: src
    });
    expect(res.success).toBe(true);
    const stagingDir = attachments.getStagingDir(proj, 'stage123');
    expect(stagingDir).toContain(path.join(FRAME_DIR, 'runtime', 'spec-attachments-staging'));
    expect(fs.existsSync(path.join(stagingDir, res.filename))).toBe(true);
  });

  it('rejects invalid stagingIds', () => {
    const proj = tmpProject();
    const res = attachments.stageAttachment(proj, '../escape', {
      kind: 'buffer',
      originalName: 'x.png',
      data: Buffer.from('x').toString('base64')
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/invalid stagingId/);
  });

  it('allows re-staging multiple files under the same id (timestamps prevent collision)', async () => {
    const proj = tmpProject();
    const src = fixtureSource(proj, 'multi.png');
    const r1 = attachments.stageAttachment(proj, 'sess1', {
      kind: 'path', originalName: 'multi.png', sourcePath: src
    });
    // Ensure timestamps differ across stages
    await new Promise((res) => setTimeout(res, 1100));
    const r2 = attachments.stageAttachment(proj, 'sess1', {
      kind: 'path', originalName: 'multi.png', sourcePath: src
    });
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    expect(r1.filename).not.toBe(r2.filename);
    const stagingDir = attachments.getStagingDir(proj, 'sess1');
    const entries = fs.readdirSync(stagingDir).sort();
    expect(entries).toHaveLength(2);
  });

  it('promoteStagedAttachments moves files into the spec dir and returns relative paths', () => {
    const proj = tmpProject();
    createFakeSpec(proj, 'demo');
    const src = fixtureSource(proj, 'p.png');
    attachments.stageAttachment(proj, 'sessX', {
      kind: 'path', originalName: 'p.png', sourcePath: src
    });
    const res = attachments.promoteStagedAttachments(proj, 'sessX', 'demo');
    expect(res.success).toBe(true);
    expect(res.relativePaths).toHaveLength(1);
    expect(res.relativePaths[0].startsWith('attachments/')).toBe(true);
    const targetDir = attachments.getSpecAttachmentsDir(proj, 'demo');
    const entries = fs.readdirSync(targetDir);
    expect(entries).toHaveLength(1);
    expect(fs.existsSync(attachments.getStagingDir(proj, 'sessX'))).toBe(false);
  });

  it('promoteStagedAttachments is a no-op (success, empty list) for an unknown staging id', () => {
    const proj = tmpProject();
    createFakeSpec(proj, 'demo');
    const res = attachments.promoteStagedAttachments(proj, 'never-staged', 'demo');
    expect(res.success).toBe(true);
    expect(res.relativePaths).toEqual([]);
  });

  it('purgeStagedAttachments removes the staging dir', () => {
    const proj = tmpProject();
    const src = fixtureSource(proj, 'p.png');
    attachments.stageAttachment(proj, 'purgeMe', {
      kind: 'path', originalName: 'p.png', sourcePath: src
    });
    const dir = attachments.getStagingDir(proj, 'purgeMe');
    expect(fs.existsSync(dir)).toBe(true);
    const res = attachments.purgeStagedAttachments(proj, 'purgeMe');
    expect(res.success).toBe(true);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('purgeStagedAttachments is a no-op when the dir does not exist', () => {
    const proj = tmpProject();
    const res = attachments.purgeStagedAttachments(proj, 'never-staged');
    expect(res.success).toBe(true);
  });
});

describe('specSection.buildMarkdownRef', () => {
  // Pure projection: image extensions get the ![]() embed; everything else
  // falls back to []() so the AI tools still pick up the link.
  let specSection;
  beforeAll(() => {
    jest.resetModules();
    jest.doMock('electron', () => ({ ipcRenderer: { on() {}, send() {}, invoke: async () => ({}) } }), { virtual: true });
    jest.doMock('../renderer/state', () => ({ getProjectPath: () => '/tmp/proj' }), { virtual: true });
    jest.doMock('marked', () => ({ marked: { parse: (s) => s } }));
    jest.doMock('../renderer/sectionRail', () => ({}), { virtual: true });
    jest.doMock('lucide', () => ({ FileText: {} }), { virtual: true });
    jest.doMock('../renderer/autopilotClient', () => ({}), { virtual: true });
    jest.doMock('../renderer/autopilotPill', () => ({ renderAutopilotPill: () => '' }), { virtual: true });
    jest.doMock('../renderer/autopilotToggle', () => ({ renderAutopilotToggle: () => ({ html: '', wire: () => {} }) }), { virtual: true });
    jest.doMock('../renderer/memoryTab', () => ({ mount: () => {} }), { virtual: true });
    specSection = require('../renderer/specSection');
  });

  it('uses ![]() for image extensions', () => {
    expect(specSection.buildMarkdownRef('shot.png', 'attachments/x.png')).toBe('![shot.png](attachments/x.png)');
    expect(specSection.buildMarkdownRef('photo.JPEG', 'attachments/y.jpeg')).toBe('![photo.JPEG](attachments/y.jpeg)');
  });

  it('uses []() for non-images (PDFs, docs, txt)', () => {
    expect(specSection.buildMarkdownRef('brief.pdf', 'attachments/b.pdf')).toBe('[brief.pdf](attachments/b.pdf)');
    expect(specSection.buildMarkdownRef('notes.txt', 'attachments/n.txt')).toBe('[notes.txt](attachments/n.txt)');
  });
});

describe('specSection.renderAttachmentsChip', () => {
  let specSection;
  beforeAll(() => {
    jest.resetModules();
    jest.doMock('electron', () => ({ ipcRenderer: { on() {}, send() {}, invoke: async () => ({}) } }), { virtual: true });
    jest.doMock('../renderer/state', () => ({ getProjectPath: () => '/tmp/proj' }), { virtual: true });
    jest.doMock('marked', () => ({ marked: { parse: (s) => s } }));
    jest.doMock('../renderer/sectionRail', () => ({}), { virtual: true });
    jest.doMock('lucide', () => ({ FileText: {} }), { virtual: true });
    jest.doMock('../renderer/autopilotClient', () => ({}), { virtual: true });
    jest.doMock('../renderer/autopilotPill', () => ({ renderAutopilotPill: () => '' }), { virtual: true });
    jest.doMock('../renderer/autopilotToggle', () => ({ renderAutopilotToggle: () => ({ html: '', wire: () => {} }) }), { virtual: true });
    jest.doMock('../renderer/memoryTab', () => ({ mount: () => {} }), { virtual: true });
    specSection = require('../renderer/specSection');
  });

  it('returns empty string when no attachments exist', () => {
    expect(specSection.renderAttachmentsChip([])).toBe('');
    expect(specSection.renderAttachmentsChip(null)).toBe('');
    expect(specSection.renderAttachmentsChip(undefined)).toBe('');
  });

  it('renders Attachments + count for a non-empty list', () => {
    const html = specSection.renderAttachmentsChip([
      'attachments/a.png',
      'attachments/b.pdf'
    ]);
    expect(html).toMatch(/spec-attachments-chip/);
    expect(html).toMatch(/Attachments/);
    expect(html).toMatch(/<span class="spec-attachments-chip-count">2<\/span>/);
  });
});

describe('specPanel.makeStagingId', () => {
  // The id is passed through to specAttachments.stageAttachment, which
  // requires /^[A-Za-z0-9_-]{1,64}$/. Regression-guard the renderer's
  // generator so a future refactor cannot ship ids the main process
  // would reject.
  let prevCrypto;
  beforeAll(() => {
    prevCrypto = global.crypto;
    if (!global.crypto || typeof global.crypto.randomUUID !== 'function') {
      // Node 18 has crypto.randomUUID via require('crypto'); attach it
      // to the global if the test environment doesn't expose it.
      const nodeCrypto = require('crypto');
      global.crypto = global.crypto || {};
      if (typeof global.crypto.randomUUID !== 'function' && nodeCrypto.randomUUID) {
        global.crypto.randomUUID = nodeCrypto.randomUUID.bind(nodeCrypto);
      }
    }
  });
  afterAll(() => {
    global.crypto = prevCrypto;
  });

  it('produces an id that matches the main-process safe pattern', () => {
    // Stub the renderer's electron / state requires so requiring the
    // module under a node test env does not blow up.
    jest.resetModules();
    jest.doMock('electron', () => ({ ipcRenderer: { on() {}, send() {}, invoke: async () => ({}) } }), { virtual: true });
    jest.doMock('../renderer/state', () => ({ getProjectPath: () => '/tmp/proj' }), { virtual: true });
    jest.doMock('marked', () => ({ marked: { parse: (s) => s } }));
    const specPanel = require('../renderer/specPanel');
    const id = specPanel.makeStagingId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
    expect(id.length).toBeLessThanOrEqual(64);
    expect(/^[A-Za-z0-9_-]+$/.test(id)).toBe(true);
    // Sanity: two consecutive calls should not collide.
    expect(specPanel.makeStagingId()).not.toBe(id);
  });
});

describe('specAttachments.setupIPC', () => {
  function makeFakeIpc() {
    const handlers = new Map();
    return {
      handlers,
      handle(channel, fn) { handlers.set(channel, fn); },
      async invoke(channel, args) {
        const fn = handlers.get(channel);
        if (!fn) throw new Error(`no handler for ${channel}`);
        return fn({}, args);
      }
    };
  }

  it('registers ATTACH_SPEC_FILE / LIST_SPEC_ATTACHMENTS / PURGE_STAGED_ATTACHMENTS handlers', async () => {
    const { IPC } = require('../shared/ipcChannels');
    const ipc = makeFakeIpc();
    attachments.setupIPC(ipc);
    expect(ipc.handlers.has(IPC.ATTACH_SPEC_FILE)).toBe(true);
    expect(ipc.handlers.has(IPC.LIST_SPEC_ATTACHMENTS)).toBe(true);
    expect(ipc.handlers.has(IPC.PURGE_STAGED_ATTACHMENTS)).toBe(true);
  });

  it('ATTACH_SPEC_FILE with slug → persists; LIST_SPEC_ATTACHMENTS returns it', async () => {
    const { IPC } = require('../shared/ipcChannels');
    const ipc = makeFakeIpc();
    attachments.setupIPC(ipc);
    const proj = tmpProject();
    createFakeSpec(proj, 'demo');
    const res = await ipc.invoke(IPC.ATTACH_SPEC_FILE, {
      projectPath: proj,
      slug: 'demo',
      payload: {
        kind: 'buffer',
        originalName: 'paste.png',
        data: Buffer.from('hello').toString('base64')
      }
    });
    expect(res.success).toBe(true);
    expect(res.relativePath.startsWith('attachments/')).toBe(true);

    const list = await ipc.invoke(IPC.LIST_SPEC_ATTACHMENTS, {
      projectPath: proj,
      slug: 'demo'
    });
    expect(list).toHaveLength(1);
    expect(list[0]).toBe(res.relativePath);
  });

  it('ATTACH_SPEC_FILE with stagingId → stages under runtime; PURGE removes it', async () => {
    const { IPC } = require('../shared/ipcChannels');
    const ipc = makeFakeIpc();
    attachments.setupIPC(ipc);
    const proj = tmpProject();
    const res = await ipc.invoke(IPC.ATTACH_SPEC_FILE, {
      projectPath: proj,
      stagingId: 'sess1',
      payload: {
        kind: 'buffer',
        originalName: 'pre.png',
        data: Buffer.from('x').toString('base64')
      }
    });
    expect(res.success).toBe(true);
    const dir = attachments.getStagingDir(proj, 'sess1');
    expect(fs.existsSync(dir)).toBe(true);
    const purge = await ipc.invoke(IPC.PURGE_STAGED_ATTACHMENTS, {
      projectPath: proj,
      stagingId: 'sess1'
    });
    expect(purge.success).toBe(true);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('ATTACH_SPEC_FILE with neither slug nor stagingId returns an error', async () => {
    const { IPC } = require('../shared/ipcChannels');
    const ipc = makeFakeIpc();
    attachments.setupIPC(ipc);
    const res = await ipc.invoke(IPC.ATTACH_SPEC_FILE, { projectPath: '/tmp/x', payload: {} });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/slug or stagingId required/);
  });
});

describe('specManager.createSpec + pendingAttachments', () => {
  const specManager = require('../main/specManager');

  function newProject() {
    const root = tmpProject();
    // specManager's pushSpecData watcher fans events to a BrowserWindow.
    // We pass init() a no-op fake so createSpec's pushSpecData doesn't blow up.
    specManager.init({ webContents: { send() {} }, isDestroyed: () => true });
    return root;
  }

  it('regression — createSpec with no pendingAttachments still works', () => {
    const proj = newProject();
    const res = specManager.createSpec(proj, { title: 'Plain Spec' });
    expect(res.slug).toBeTruthy();
    const specDir = path.join(proj, FRAME_DIR, 'specs', res.slug);
    expect(fs.existsSync(path.join(specDir, 'status.json'))).toBe(true);
  });

  it('promotes staged attachments into the new spec dir and appends a References block', () => {
    const proj = newProject();
    const src = fixtureSource(proj, 'wire.png');
    const stagingId = 'wire1';
    const stage = attachments.stageAttachment(proj, stagingId, {
      kind: 'path', originalName: 'wire.png', sourcePath: src
    });
    expect(stage.success).toBe(true);

    const res = specManager.createSpec(proj, {
      title: 'With Attachment',
      description: 'has an image',
      pendingAttachments: stagingId
    });
    expect(res.slug).toBeTruthy();

    const specDir = path.join(proj, FRAME_DIR, 'specs', res.slug);
    const attachDir = path.join(specDir, 'attachments');
    expect(fs.existsSync(attachDir)).toBe(true);
    expect(fs.readdirSync(attachDir).length).toBe(1);

    const specMd = fs.readFileSync(path.join(specDir, 'spec.md'), 'utf8');
    expect(specMd).toMatch(/## References/);
    // Image reference uses ![...](...) and the timestamped attachments path.
    expect(specMd).toMatch(/!\[[^\]]+wire\.png\]\(attachments\/[^)]+wire\.png\)/);

    // Staging dir cleaned up by promoteStagedAttachments.
    expect(fs.existsSync(attachments.getStagingDir(proj, stagingId))).toBe(false);
  });

  it('handles a stagingId that was never used (no error, no References block)', () => {
    const proj = newProject();
    const res = specManager.createSpec(proj, {
      title: 'Ghost Stage',
      description: 'no real attachments',
      pendingAttachments: 'never-staged-id'
    });
    expect(res.slug).toBeTruthy();
    const specMd = fs.readFileSync(
      path.join(proj, FRAME_DIR, 'specs', res.slug, 'spec.md'),
      'utf8'
    );
    expect(specMd).not.toMatch(/## References/);
  });
});

describe('specAttachments.listSpecAttachments', () => {
  it('returns an empty array when the spec has no attachments/ dir', () => {
    const proj = tmpProject();
    createFakeSpec(proj, 'demo');
    expect(attachments.listSpecAttachments(proj, 'demo')).toEqual([]);
  });

  it('lists attachments as posix relative paths in sorted order', () => {
    const proj = tmpProject();
    createFakeSpec(proj, 'demo');
    const src = fixtureSource(proj, 'one.png');
    attachments.attachToSpec(proj, 'demo', {
      kind: 'path', originalName: 'one.png', sourcePath: src
    });
    attachments.attachToSpec(proj, 'demo', {
      kind: 'buffer', originalName: 'two.txt', data: Buffer.from('hi').toString('base64')
    });
    const list = attachments.listSpecAttachments(proj, 'demo');
    expect(list).toHaveLength(2);
    list.forEach((p) => expect(p.startsWith('attachments/')).toBe(true));
    // posix-style separator regardless of platform
    list.forEach((p) => expect(p.includes('\\')).toBe(false));
  });
});
