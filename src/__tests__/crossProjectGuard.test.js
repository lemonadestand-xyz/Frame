const { findConflicts, parseFootprintBlock } = require('../main/crossProjectGuard');

describe('parseFootprintBlock', () => {
  it('extracts bullet lines under ## Footprint', () => {
    const md = `## Architecture\nfoo\n\n## Footprint\n- src/a.js\n- src/b.js\n\n## Dependencies\nNone`;
    expect(parseFootprintBlock(md)).toEqual(['src/a.js', 'src/b.js']);
  });
  it('returns empty when no Footprint block', () => {
    expect(parseFootprintBlock('## Architecture\nfoo')).toEqual([]);
  });
});

describe('findConflicts', () => {
  it('detects overlap between two specs', () => {
    const specs = [
      { projectPath: '/p1', slug: 'a', footprint: ['src/a.js', 'src/b.js'] },
      { projectPath: '/p2', slug: 'b', footprint: ['src/b.js', 'src/c.js'] },
    ];
    const out = findConflicts(specs);
    expect(out).toHaveLength(1);
    expect(out[0].paths).toEqual(['src/b.js']);
  });
  it('returns empty when no overlap', () => {
    const specs = [
      { projectPath: '/p1', slug: 'a', footprint: ['src/a.js'] },
      { projectPath: '/p2', slug: 'b', footprint: ['src/b.js'] },
    ];
    expect(findConflicts(specs)).toEqual([]);
  });
});
