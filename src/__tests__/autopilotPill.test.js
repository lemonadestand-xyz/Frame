const { renderAutopilotPill } = require('../renderer/autopilotPill');

describe('renderAutopilotPill', () => {
  describe('legacy behaviour (no verdict)', () => {
    it('returns empty string when no run and no verdict', () => {
      expect(renderAutopilotPill(null)).toBe('');
      expect(renderAutopilotPill(null, null)).toBe('');
      expect(renderAutopilotPill(null, null, null)).toBe('');
    });

    it('returns empty string for unknown statuses with no verdict', () => {
      expect(renderAutopilotPill({ status: 'idle' })).toBe('');
      expect(renderAutopilotPill({ status: 'completed' })).toBe('');
    });

    it('renders a running pill with progress when totals are present', () => {
      const html = renderAutopilotPill(
        { status: 'running', turnsTotal: 3 },
        { completed: 2, total: 5 },
      );
      expect(html).toContain('autopilot-pill-running');
      expect(html).toContain('2/5 tasks done');
      expect(html).toContain('turn 3');
    });

    it('renders a paused pill with the paused reason', () => {
      const html = renderAutopilotPill(
        { status: 'paused', pausedReason: 'max_turns_per_task' },
      );
      expect(html).toContain('autopilot-pill-paused');
      expect(html).toContain('max_turns_per_task');
      expect(html).toContain('needs review');
    });

    it('renders a failed pill', () => {
      const html = renderAutopilotPill(
        { status: 'failed', lastTurnReason: 'dispatch_failed' },
      );
      expect(html).toContain('autopilot-pill-failed');
      expect(html).toContain('dispatch_failed');
    });
  });

  describe('supervisor verdict badge', () => {
    it('renders the verdict badge alongside a running pill', () => {
      const html = renderAutopilotPill(
        { status: 'running', turnsTotal: 1 },
        { completed: 0, total: 3 },
        { route: 'research', confidence: 0.82, reasoning: 'gathering evidence' },
      );
      expect(html).toContain('autopilot-pill-running');
      expect(html).toContain('supervisor-verdict-badge');
      expect(html).toContain('supervisor-verdict-research');
      expect(html).toContain('RESEARCH');
      expect(html).toContain('82%');
    });

    it('renders verdict-only badge when no autopilot run is present', () => {
      const html = renderAutopilotPill(
        null,
        null,
        { route: 'escalate', confidence: 0.4 },
      );
      expect(html).toContain('supervisor-verdict-badge');
      expect(html).toContain('supervisor-verdict-escalate');
      expect(html).toContain('ESCALATE');
      expect(html).toContain('40%');
      expect(html).not.toContain('autopilot-pill-');
    });

    it('renders verdict-only badge when the run status is unknown', () => {
      const html = renderAutopilotPill(
        { status: 'completed' },
        null,
        { route: 'auto_answer', confidence: 0.95 },
      );
      expect(html).toContain('supervisor-verdict-auto_answer');
      expect(html).toContain('AUTO_ANSWER');
      expect(html).toContain('95%');
    });

    it('falls through to existing pill behaviour when no verdict is present', () => {
      const html = renderAutopilotPill(
        { status: 'running', turnsTotal: 2 },
        { completed: 1, total: 4 },
        null,
      );
      expect(html).toContain('autopilot-pill-running');
      expect(html).not.toContain('supervisor-verdict-badge');
    });

    it('renders verdict without confidence when confidence is non-numeric', () => {
      const html = renderAutopilotPill(
        null,
        null,
        { route: 'research' },
      );
      expect(html).toContain('supervisor-verdict-badge');
      expect(html).toContain('RESEARCH');
      expect(html).not.toMatch(/\d+%/);
    });

    it('clamps confidence into the 0..1 percentage range', () => {
      const high = renderAutopilotPill(null, null, { route: 'x', confidence: 1.7 });
      expect(high).toContain('100%');
      const low = renderAutopilotPill(null, null, { route: 'x', confidence: -0.5 });
      expect(low).toContain('0%');
    });

    it('escapes verdict reasoning that contains HTML', () => {
      const html = renderAutopilotPill(
        null,
        null,
        { route: 'research', confidence: 0.5, reasoning: '<img src=x onerror=alert(1)>' },
      );
      expect(html).not.toContain('<img');
      expect(html).toContain('&lt;img');
    });

    it('handles unknown route values without throwing', () => {
      const html = renderAutopilotPill(null, null, { route: 'mystery_route', confidence: 0.5 });
      expect(html).toContain('MYSTERY_ROUTE');
      expect(html).toContain('supervisor-verdict-mystery_route');
    });
  });
});
