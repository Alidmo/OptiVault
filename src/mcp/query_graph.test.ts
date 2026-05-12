import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { openGraphStore } from '../store/sqlite.js';
import { normalizeGraphKey } from '../store/keys.js';

describe('normalizeGraphKey', () => {
  it('strips source extensions', () => {
    expect(normalizeGraphKey('src/auth.ts')).toBe('src/auth');
    expect(normalizeGraphKey('src/app.py')).toBe('src/app');
    expect(normalizeGraphKey('src/mod.go')).toBe('src/mod');
    expect(normalizeGraphKey('src/View.swift')).toBe('src/View');
  });

  it('leaves already-stripped keys alone', () => {
    expect(normalizeGraphKey('src/auth')).toBe('src/auth');
  });

  it('converts backslashes to forward slashes', () => {
    expect(normalizeGraphKey('src\\foo\\bar.ts')).toBe('src/foo/bar');
  });
});

// ---------------------------------------------------------------------------
// SQLite-backed traversal — replaces the v2.0 RepoMap-parsing tests
// ---------------------------------------------------------------------------

describe('query_graph — SQLite-backed traversal', () => {
  let tmp: string;
  let store: ReturnType<typeof openGraphStore>;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'optivault-qg-'));
    store = openGraphStore(tmp);

    // Build the same graph the old RepoMap tests used:
    //   auth -> database -> db/pool
    //   auth -> crypto
    //   api  -> auth
    for (const id of ['src/auth', 'src/database', 'src/crypto', 'src/db/pool', 'src/api']) {
      store.upsertNode({
        id,
        kind: 'file',
        file: id,
        name: null,
        roles: [],
        purpose: null,
        isEntryPoint: false,
      });
    }
    store.replaceOutgoingEdges('src/auth', [
      { src: 'src/auth', dst: 'src/database', kind: 'DEPENDS_ON' },
      { src: 'src/auth', dst: 'src/crypto', kind: 'DEPENDS_ON' },
    ]);
    store.replaceOutgoingEdges('src/database', [
      { src: 'src/database', dst: 'src/db/pool', kind: 'DEPENDS_ON' },
    ]);
    store.replaceOutgoingEdges('src/api', [
      { src: 'src/api', dst: 'src/auth', kind: 'DEPENDS_ON' },
    ]);
  });

  afterEach(() => {
    store.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns direct dependencies at depth 1', () => {
    const results = store.traverse('src/auth', 'out', 1, ['DEPENDS_ON']);
    expect(results.map((r) => r.file).sort()).toEqual(['src/crypto', 'src/database']);
  });

  it('returns 1st + 2nd degree deps at depth 2 and dedupes', () => {
    const results = store.traverse('src/auth', 'out', 2, ['DEPENDS_ON']);
    const byDepth = results.map((r) => `${r.file}@${r.depth}`).sort();
    expect(byDepth).toEqual([
      'src/crypto@1',
      'src/database@1',
      'src/db/pool@2',
    ]);
  });

  it('traverses incoming edges (callers direction)', () => {
    const results = store.traverse('src/db/pool', 'in', 2, ['DEPENDS_ON']);
    expect(results.map((r) => `${r.file}@${r.depth}`).sort()).toEqual([
      'src/auth@2',
      'src/database@1',
    ]);
  });

  it('returns empty array for unknown node', () => {
    const results = store.traverse('src/does-not-exist', 'out', 3, ['DEPENDS_ON']);
    expect(results).toEqual([]);
  });

  it('does not infinite-loop on cycles', () => {
    store.upsertNode({ id: 'a', kind: 'file', file: 'a', name: null, roles: [], purpose: null, isEntryPoint: false });
    store.upsertNode({ id: 'b', kind: 'file', file: 'b', name: null, roles: [], purpose: null, isEntryPoint: false });
    store.replaceOutgoingEdges('a', [{ src: 'a', dst: 'b', kind: 'DEPENDS_ON' }]);
    store.replaceOutgoingEdges('b', [{ src: 'b', dst: 'a', kind: 'DEPENDS_ON' }]);

    const results = store.traverse('a', 'out', 5, ['DEPENDS_ON']);
    expect(results.map((r) => r.file)).toEqual(['b']);
  });

  it('queryByRole filters file nodes by framework role', () => {
    store.upsertNode({
      id: 'src/User',
      kind: 'file',
      file: 'src/User',
      name: null,
      roles: ['Symfony:Entity'],
      purpose: null,
      isEntryPoint: false,
    });
    store.upsertNode({
      id: 'src/UserController',
      kind: 'file',
      file: 'src/UserController',
      name: null,
      roles: ['Symfony:Controller'],
      purpose: null,
      isEntryPoint: false,
    });

    expect(store.queryByRole('Symfony:Entity').map((n) => n.id)).toEqual(['src/User']);
    expect(store.queryByRole('Symfony:Controller').map((n) => n.id)).toEqual(['src/UserController']);
    expect(store.queryByRole('Symfony:Nonexistent')).toEqual([]);
  });
});
