/**
 * EmailAdapter tests — `.eml` file creation, well-formed headers,
 * unique message-IDs, and fallback behaviour.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { EmailAdapter } = require('../main/adapters/emailAdapter');

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'frame-emailadapter-'));
}

describe('EmailAdapter.buildEml', () => {
  it('produces RFC-5322-shaped headers + body', () => {
    const adapter = new EmailAdapter({ to: 'chris@example.com', from: 'frame@example.com', subject_prefix: '[Frame]' });
    const { content, messageId } = adapter.buildEml({
      id: 'esc-1',
      slug: 'demo',
      category: 'scope',
      taskId: 'T01',
      draftedQuestion: 'merge or rebase?',
      draftAnswer: 'merge',
      options: ['merge', 'rebase'],
    });
    expect(content).toMatch(/^From: frame@example\.com\r\n/);
    expect(content).toMatch(/\r\nTo: chris@example\.com\r\n/);
    // The middle-dot in the subject is non-ASCII → RFC-2047 wrapping.
    expect(content).toMatch(/\r\nSubject: =\?utf-8\?B\?[A-Za-z0-9+/=]+\?=\r\n/);
    expect(content).toMatch(/\r\nDate: /);
    expect(content).toMatch(/\r\nMessage-ID: <esc-1\.[a-f0-9]+@frame\.local>\r\n/);
    expect(content).toMatch(/\r\nMIME-Version: 1\.0\r\n/);
    expect(content).toMatch(/\r\nX-Frame-Spec-Slug: demo\r\n/);
    expect(messageId).toMatch(/^<esc-1\..+@frame\.local>$/);
    // Body content
    expect(content).toContain('merge or rebase?');
    expect(content).toContain("Frame's suggested answer");
    expect(content).toContain('  - merge');
    expect(content).toContain('Reply to this email and re-import via Frame');
  });

  it('produces a different message-ID per escalation', () => {
    const adapter = new EmailAdapter({ to: 'a@b' });
    const a = adapter.buildEml({ id: 'one', slug: 'demo', draftedQuestion: '?' });
    const b = adapter.buildEml({ id: 'two', slug: 'demo', draftedQuestion: '?' });
    expect(a.messageId).not.toBe(b.messageId);
  });

  it('RFC-2047 encodes non-ASCII subjects', () => {
    const adapter = new EmailAdapter({ to: 'a@b' });
    const { content } = adapter.buildEml({
      id: 'utf',
      slug: 'demo',
      draftedQuestion: 'naïve choice 🎯?',
    });
    expect(content).toMatch(/Subject: =\?utf-8\?B\?[A-Za-z0-9+/=]+\?=/);
  });
});

describe('EmailAdapter.present', () => {
  it('writes a .eml file under .frame/runtime/email-drafts/', async () => {
    const project = tmpProject();
    const adapter = new EmailAdapter({ to: 'chris@example.com' });
    const presentPromise = adapter.present({
      id: 'esc-write',
      slug: 'demo',
      projectPath: project,
      draftedQuestion: 'is this ok?',
      draftAnswer: 'yes',
      category: 'scope',
    });
    // The present-promise stays open until _testAnswer fires; verify the
    // file was written.
    const filePath = path.join(project, '.frame', 'runtime', 'email-drafts', 'esc-write.eml');
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, 'utf8');
    expect(content).toMatch(/^From: frame@localhost\r\n/);
    expect(content).toMatch(/\r\nTo: chris@example\.com\r\n/);
    expect(content).toContain('is this ok?');
    adapter._testAnswer('esc-write', 'yes');
    const result = await presentPromise;
    expect(result).toEqual({ id: 'esc-write', answer: 'yes', answeredBy: 'email' });
  });

  it('falls back to UI when `to` is missing', async () => {
    const fallback = {
      present: jest.fn().mockResolvedValue({ id: 'fb', answer: 'ok', answeredBy: 'ui' }),
    };
    const adapter = new EmailAdapter({}, { fallback });
    const result = await adapter.present({
      id: 'esc-no-to',
      slug: 'demo',
      projectPath: tmpProject(),
      draftedQuestion: 'q?',
    });
    expect(fallback.present).toHaveBeenCalled();
    expect(result.answeredBy).toBe('ui');
  });

  it('falls back to UI when escalation.projectPath is missing', async () => {
    const fallback = {
      present: jest.fn().mockResolvedValue({ id: 'fb', answer: 'ok', answeredBy: 'ui' }),
    };
    const adapter = new EmailAdapter({ to: 'a@b' }, { fallback });
    const result = await adapter.present({ id: 'esc-no-pp', slug: 'demo', draftedQuestion: 'q?' });
    expect(fallback.present).toHaveBeenCalled();
    expect(result.answeredBy).toBe('ui');
  });
});
