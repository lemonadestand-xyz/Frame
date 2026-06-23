/**
 * profilePanel — pure-helper tests.
 *
 * The DOM-bound modal isn't exercised here (jest runs in node, no document).
 * We cover the form↔JSON projection helpers + the JSON-safety parser. These
 * are the bits the renderer relies on to keep both surfaces in sync on every
 * blur and save.
 */

const profilePanel = require('../renderer/profilePanel');

describe('profilePanel.profileToFormData', () => {
  it('returns empty fields for an empty profile', () => {
    const fd = profilePanel.profileToFormData({});
    expect(fd.id).toBe('');
    expect(fd.escalateCategories).toBe('');
    expect(fd.costCeilingUsd).toBe('');
    expect(fd.iterationCap).toBe('');
    expect(fd.spendPerTaskUsd).toBe('');
    expect(fd.spendPerDayUsd).toBe('');
    expect(fd.capabilities).toBe('');
    expect(fd.contextSources).toBe('');
  });

  it('flattens policy + budgets + capabilities into form fields', () => {
    const profile = {
      id: 'frame',
      policy: { escalate_categories: ['dependency', 'schema'], cost_ceiling_usd: 5 },
      budgets: { iteration_cap: 3, spend_per_task_usd: 1.0, spend_per_day_usd: 20 },
      capabilities: ['spec_reader', 'knowledge_search'],
      context_sources: ['bm:frame', 'docs/AUTOPILOT.md'],
    };
    const fd = profilePanel.profileToFormData(profile);
    expect(fd.id).toBe('frame');
    expect(fd.escalateCategories).toBe('dependency, schema');
    expect(fd.costCeilingUsd).toBe('5');
    expect(fd.iterationCap).toBe('3');
    expect(fd.spendPerTaskUsd).toBe('1');
    expect(fd.spendPerDayUsd).toBe('20');
    expect(fd.capabilities).toBe('spec_reader, knowledge_search');
    expect(fd.contextSources).toBe('bm:frame\ndocs/AUTOPILOT.md');
  });
});

describe('profilePanel.formDataToProfile', () => {
  it('round-trips a profile via formData', () => {
    const profile = {
      id: 'frame',
      worker: { auth: 'subscription' },
      policy: { escalate_categories: ['dependency'], cost_ceiling_usd: 2.5, rules: [] },
      budgets: { iteration_cap: 3, spend_per_task_usd: 1, spend_per_day_usd: 20 },
      capabilities: ['spec_reader'],
      context_sources: ['bm:frame'],
      // Unmanaged blocks must survive the round-trip untouched.
      roles: [{ name: 'user', authority: ['*'], channel: 'ui' }],
      escalation: { slack: { webhook_url: 'https://x.example' } },
    };
    const fd = profilePanel.profileToFormData(profile);
    const back = profilePanel.formDataToProfile(fd, profile);
    expect(back.id).toBe('frame');
    expect(back.policy.escalate_categories).toEqual(['dependency']);
    expect(back.policy.cost_ceiling_usd).toBe(2.5);
    expect(back.budgets.iteration_cap).toBe(3);
    expect(back.capabilities).toEqual(['spec_reader']);
    expect(back.context_sources).toEqual(['bm:frame']);
    // Unmanaged blocks preserved.
    expect(back.worker).toEqual({ auth: 'subscription' });
    expect(back.roles).toEqual([{ name: 'user', authority: ['*'], channel: 'ui' }]);
    expect(back.escalation.slack.webhook_url).toBe('https://x.example');
    // Existing rules array stays in place (form doesn't touch it).
    expect(back.policy.rules).toEqual([]);
  });

  it('coerces empty inputs to null and skips trailing whitespace tokens', () => {
    const back = profilePanel.formDataToProfile({
      id: '  frame  ',
      escalateCategories: ' dependency , , schema , ',
      costCeilingUsd: '',
      iterationCap: '',
      spendPerTaskUsd: '',
      spendPerDayUsd: '',
      capabilities: '',
      contextSources: 'bm:frame\n\n  docs/AUTOPILOT.md  \n',
    }, {});
    expect(back.id).toBe('frame');
    expect(back.policy.escalate_categories).toEqual(['dependency', 'schema']);
    expect(back.policy.cost_ceiling_usd).toBeNull();
    expect(back.budgets.iteration_cap).toBeNull();
    expect(back.budgets.spend_per_task_usd).toBeNull();
    expect(back.budgets.spend_per_day_usd).toBeNull();
    expect(back.capabilities).toEqual([]);
    expect(back.context_sources).toEqual(['bm:frame', 'docs/AUTOPILOT.md']);
  });
});

describe('profilePanel.shouldShowNudge', () => {
  it('returns true when loadProfile reports fileExists=false', () => {
    expect(profilePanel.shouldShowNudge({ fileExists: false, source: 'default', profile: {} })).toBe(true);
  });

  it('returns false when a real file was loaded from disk', () => {
    expect(profilePanel.shouldShowNudge({ fileExists: true, source: 'file', profile: {} })).toBe(false);
  });

  it('returns false when the file exists but is malformed (source=default + fileExists=true)', () => {
    // A file-on-disk should not be silently overwritten by the nudge button.
    // Surface the warning instead — the user should fix the file, not regen.
    expect(profilePanel.shouldShowNudge({ fileExists: true, source: 'default', profile: {} })).toBe(false);
  });

  it('returns false for malformed input', () => {
    expect(profilePanel.shouldShowNudge(null)).toBe(false);
    expect(profilePanel.shouldShowNudge('default')).toBe(false);
    expect(profilePanel.shouldShowNudge(undefined)).toBe(false);
  });

  it('returns false when fileExists is undefined (defensive)', () => {
    expect(profilePanel.shouldShowNudge({ source: 'default', profile: {} })).toBe(false);
  });

  it('returns false when a supervisor YAML is available (banner replaces nudge)', () => {
    expect(profilePanel.shouldShowNudge({
      fileExists: false, source: 'supervisor', supervisorAvailable: true, profile: {},
    })).toBe(false);
  });
});

describe('profilePanel.shouldShowSupervisorBanner', () => {
  it('returns true when fileExists=false AND supervisorAvailable=true', () => {
    expect(profilePanel.shouldShowSupervisorBanner({
      fileExists: false, source: 'supervisor', supervisorAvailable: true, profile: {},
    })).toBe(true);
  });

  it('returns false once the file is on disk (post-migrate state)', () => {
    expect(profilePanel.shouldShowSupervisorBanner({
      fileExists: true, source: 'file', supervisorAvailable: true, profile: {},
    })).toBe(false);
  });

  it('returns false when no supervisor YAML is discoverable', () => {
    expect(profilePanel.shouldShowSupervisorBanner({
      fileExists: false, source: 'default', supervisorAvailable: false, profile: {},
    })).toBe(false);
  });

  it('renderSupervisorBannerHtml includes the Migrate button', () => {
    const html = profilePanel.renderSupervisorBannerHtml();
    expect(html).toContain('profile-tab-supervisor-banner');
    expect(html).toContain('profile-tab-supervisor-migrate');
    expect(html).toContain('Migrate');
  });
});

describe('profilePanel form ↔ JSON sync (blur projection)', () => {
  // The DOM-bound `blur` handler reads the form into a flat object, projects
  // it back onto the profile via formDataToProfile, then re-stringifies. We
  // exercise the same composition here so the sync logic is testable without
  // a DOM.
  function simulateBlurSync(formInputs, basis) {
    const next = profilePanel.formDataToProfile(formInputs, basis);
    return { profile: next, jsonText: JSON.stringify(next, null, 2) };
  }

  it('projects form edits back into the JSON view on blur', () => {
    const basis = {
      id: 'frame',
      policy: { escalate_categories: ['naming'], cost_ceiling_usd: 1 },
      budgets: { iteration_cap: 1 },
      capabilities: [],
    };
    const formInputs = {
      id: 'frame',
      escalateCategories: 'dependency, schema',
      costCeilingUsd: '7.5',
      iterationCap: '5',
      spendPerTaskUsd: '',
      spendPerDayUsd: '',
      capabilities: 'spec_reader',
      contextSources: 'bm:frame',
    };
    const { profile, jsonText } = simulateBlurSync(formInputs, basis);
    expect(profile.policy.escalate_categories).toEqual(['dependency', 'schema']);
    expect(profile.policy.cost_ceiling_usd).toBe(7.5);
    expect(profile.budgets.iteration_cap).toBe(5);
    expect(profile.capabilities).toEqual(['spec_reader']);
    expect(profile.context_sources).toEqual(['bm:frame']);
    // The JSON view textarea would receive exactly this string.
    const reparsed = JSON.parse(jsonText);
    expect(reparsed).toEqual(profile);
  });

  it('JSON edits re-parse via parseJsonSafely (Save path)', () => {
    // The Save button uses parseJsonSafely(jsonEl.value) as the source of
    // truth. Verify the round trip JSON edit → parse → save-payload.
    const edited = '{"id":"x","policy":{"cost_ceiling_usd":12.5,"escalate_categories":[],"rules":[]}}';
    const r = profilePanel.parseJsonSafely(edited);
    expect(r.ok).toBe(true);
    expect(r.value.policy.cost_ceiling_usd).toBe(12.5);
    // A malformed edit must abort the save (errorEl shows the error).
    const bad = profilePanel.parseJsonSafely('{"id":');
    expect(bad.ok).toBe(false);
    expect(typeof bad.error).toBe('string');
  });
});

describe('profilePanel nudge banner — button behavior (B-T11)', () => {
  it('renderNudgeBannerHtml includes a .profile-tab-nudge-generate button labelled "Generate default"', () => {
    const html = profilePanel.renderNudgeBannerHtml();
    expect(html).toContain('class="profile-tab-nudge"');
    expect(html).toContain('class="btn profile-tab-nudge-generate"');
    expect(html).toContain('Generate default');
    expect(html).toMatch(/role="status"/);
  });

  it('buildNudgeSavePayload returns the SAVE_PROFILE shape with the default profile in scope', () => {
    // When fileExists=false, LOAD_PROFILE returned the default profile and the
    // mount stored it on state.profile. Click → invoke SAVE_PROFILE with that.
    const defaultProfile = {
      id: 'my-project',
      worker: { auth: 'subscription' },
      policy: { escalate_categories: [], cost_ceiling_usd: null, rules: [] },
      budgets: { iteration_cap: 3 },
    };
    const state = {
      projectPath: '/tmp/projects/my-project',
      profile: defaultProfile,
      source: 'default',
      fileExists: false,
    };
    const payload = profilePanel.buildNudgeSavePayload(state);
    expect(payload).toEqual({
      projectPath: '/tmp/projects/my-project',
      profile: defaultProfile,
    });
  });

  it('buildNudgeSavePayload returns null when the projectPath or profile is missing', () => {
    expect(profilePanel.buildNudgeSavePayload(null)).toBeNull();
    expect(profilePanel.buildNudgeSavePayload({})).toBeNull();
    expect(profilePanel.buildNudgeSavePayload({ projectPath: '/x' })).toBeNull();
    expect(profilePanel.buildNudgeSavePayload({ profile: {} })).toBeNull();
  });

  it('end-to-end click path: button → invoke(SAVE_PROFILE, payload) wires correctly', async () => {
    // Mirror what the click handler does (the handler is DOM-bound; the parts
    // it composes are: buildNudgeSavePayload + invoke + state flip).
    const invokeSpy = jest.fn().mockResolvedValue({ success: true });
    const state = {
      projectPath: '/tmp/proj',
      profile: { id: 'proj', policy: { escalate_categories: [] }, budgets: { iteration_cap: 3 } },
      source: 'default',
      fileExists: false,
    };
    const payload = profilePanel.buildNudgeSavePayload(state);
    const res = await invokeSpy('save-profile', payload);
    expect(invokeSpy).toHaveBeenCalledWith('save-profile', {
      projectPath: '/tmp/proj',
      profile: state.profile,
    });
    expect(res.success).toBe(true);
  });
});

describe('profilePanel.parseJsonSafely', () => {
  it('returns ok+value for valid JSON', () => {
    const r = profilePanel.parseJsonSafely('{"id":"frame","budgets":{"iteration_cap":3}}');
    expect(r.ok).toBe(true);
    expect(r.error).toBeNull();
    expect(r.value).toEqual({ id: 'frame', budgets: { iteration_cap: 3 } });
  });

  it('returns ok=false + error on malformed JSON', () => {
    const r = profilePanel.parseJsonSafely('{not valid');
    expect(r.ok).toBe(false);
    expect(typeof r.error).toBe('string');
    expect(r.value).toBeNull();
  });

  it('treats non-strings as not-ok', () => {
    const r = profilePanel.parseJsonSafely(null);
    expect(r.ok).toBe(false);
    expect(r.value).toBeNull();
  });
});
