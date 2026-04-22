import { describe, it, expect } from 'vitest';
import { buildDepGraph, traverseGraph, normalizeGraphKey } from './server.js';

const SAMPLE_MAP = `# RepoMap

- [[src/auth]] — exports: verifyToken(token: string) — deps: src/database, src/crypto
- [[src/database]] — exports: connect() — deps: src/db/pool
- [[src/crypto]] — exports: hash()
- [[src/db/pool]] — exports: Pool
- [[src/api]] — deps: src/auth
`;

describe('buildDepGraph', () => {
  it('parses a RepoMap into forward and reverse adjacency maps', () => {
    const { forward, reverse } = buildDepGraph(SAMPLE_MAP);

    expect(forward.get('src/auth')).toEqual(['src/database', 'src/crypto']);
    expect(forward.get('src/database')).toEqual(['src/db/pool']);
    expect(forward.get('src/crypto')).toEqual([]);

    expect(reverse.get('src/database')).toEqual(['src/auth']);
    expect(reverse.get('src/crypto')).toEqual(['src/auth']);
    expect(reverse.get('src/auth')).toEqual(['src/api']);
    expect(reverse.get('src/db/pool')).toEqual(['src/database']);
  });

  it('handles entries without a deps segment', () => {
    const { forward } = buildDepGraph('- [[src/foo]] — exports: bar()\n');
    expect(forward.get('src/foo')).toEqual([]);
  });
});

describe('traverseGraph — dependencies', () => {
  it('returns direct deps only at depth 1', () => {
    const { forward } = buildDepGraph(SAMPLE_MAP);
    const results = traverseGraph(forward, 'src/auth', 1);
    expect(results).toEqual([
      { file: 'src/database', depth: 1 },
      { file: 'src/crypto', depth: 1 },
    ]);
  });

  it('returns 1st + 2nd degree deps at depth 2 and dedupes', () => {
    const { forward } = buildDepGraph(SAMPLE_MAP);
    const results = traverseGraph(forward, 'src/auth', 2);
    expect(results).toEqual([
      { file: 'src/database', depth: 1 },
      { file: 'src/crypto', depth: 1 },
      { file: 'src/db/pool', depth: 2 },
    ]);
  });
});

describe('traverseGraph — callers', () => {
  it('returns reverse edges correctly', () => {
    const { reverse } = buildDepGraph(SAMPLE_MAP);
    const results = traverseGraph(reverse, 'src/db/pool', 2);
    expect(results).toEqual([
      { file: 'src/database', depth: 1 },
      { file: 'src/auth', depth: 2 },
    ]);
  });
});

describe('traverseGraph — edge cases', () => {
  it('returns empty array for unknown node', () => {
    const { forward } = buildDepGraph(SAMPLE_MAP);
    const results = traverseGraph(forward, 'src/does-not-exist', 3);
    expect(results).toEqual([]);
  });

  it('does not infinite-loop on cycles', () => {
    const cyclic = `# RepoMap

- [[a]] — deps: b
- [[b]] — deps: a
`;
    const { forward } = buildDepGraph(cyclic);
    const results = traverseGraph(forward, 'a', 5);
    expect(results).toEqual([{ file: 'b', depth: 1 }]);
  });
});

describe('normalizeGraphKey', () => {
  it('strips source extensions', () => {
    expect(normalizeGraphKey('src/auth.ts')).toBe('src/auth');
    expect(normalizeGraphKey('src/app.py')).toBe('src/app');
    expect(normalizeGraphKey('src/mod.go')).toBe('src/mod');
  });

  it('leaves already-stripped keys alone', () => {
    expect(normalizeGraphKey('src/auth')).toBe('src/auth');
  });
});
