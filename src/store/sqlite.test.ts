import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GraphStore, openGraphStore } from './sqlite.js';
import { rmSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let tmp: string;
let store: GraphStore;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'optivault-store-'));
  store = openGraphStore(tmp);
});

afterEach(() => {
  store.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('GraphStore', () => {
  it('upserts and retrieves a file node with roles', () => {
    store.upsertNode({
      id: 'src/User',
      kind: 'file',
      file: 'src/User',
      name: null,
      roles: ['Symfony:Entity'],
      purpose: 'User domain model',
      isEntryPoint: false,
    });

    const node = store.getNode('src/User');
    expect(node).not.toBeNull();
    expect(node!.roles).toEqual(['Symfony:Entity']);
    expect(node!.purpose).toBe('User domain model');
  });

  it('upserts is idempotent — second insert overwrites', () => {
    store.upsertNode({
      id: 'a',
      kind: 'file',
      file: 'a',
      name: null,
      roles: [],
      purpose: null,
      isEntryPoint: false,
    });
    store.upsertNode({
      id: 'a',
      kind: 'file',
      file: 'a',
      name: null,
      roles: ['X'],
      purpose: 'updated',
      isEntryPoint: true,
    });
    const node = store.getNode('a');
    expect(node!.roles).toEqual(['X']);
    expect(node!.isEntryPoint).toBe(true);
  });

  it('queryByRole returns only matching file nodes', () => {
    store.upsertNode({
      id: 'a',
      kind: 'file',
      file: 'a',
      name: null,
      roles: ['Symfony:Entity'],
      purpose: null,
      isEntryPoint: false,
    });
    store.upsertNode({
      id: 'b',
      kind: 'file',
      file: 'b',
      name: null,
      roles: ['Symfony:Controller'],
      purpose: null,
      isEntryPoint: false,
    });

    const entities = store.queryByRole('Symfony:Entity');
    expect(entities.map((n) => n.id)).toEqual(['a']);
  });

  it('traverses outgoing DEPENDS_ON edges by depth', () => {
    for (const id of ['a', 'b', 'c', 'd']) {
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
    store.upsertEdge({ src: 'a', dst: 'b', kind: 'DEPENDS_ON' });
    store.upsertEdge({ src: 'b', dst: 'c', kind: 'DEPENDS_ON' });
    store.upsertEdge({ src: 'c', dst: 'd', kind: 'DEPENDS_ON' });

    const depth1 = store.traverse('a', 'out', 1, ['DEPENDS_ON']);
    expect(depth1.map((r) => r.file)).toEqual(['b']);

    const depth3 = store.traverse('a', 'out', 3, ['DEPENDS_ON']);
    expect(depth3.map((r) => r.file)).toEqual(['b', 'c', 'd']);
    expect(depth3.find((r) => r.file === 'd')!.depth).toBe(3);
  });

  it('traverses incoming edges (callers direction)', () => {
    store.upsertEdge({ src: 'caller', dst: 'target', kind: 'DEPENDS_ON' });
    store.upsertEdge({ src: 'other', dst: 'target', kind: 'DEPENDS_ON' });

    const callers = store.traverse('target', 'in', 1, ['DEPENDS_ON']);
    expect(callers.map((r) => r.file).sort()).toEqual(['caller', 'other']);
  });

  it('replaceOutgoingEdges deletes stale edges', () => {
    store.upsertEdge({ src: 'a', dst: 'b', kind: 'DEPENDS_ON' });
    store.upsertEdge({ src: 'a', dst: 'c', kind: 'DEPENDS_ON' });
    store.replaceOutgoingEdges('a', [{ src: 'a', dst: 'd', kind: 'DEPENDS_ON' }]);

    const ns = store.neighbors('a', 'out');
    expect(ns.map((n) => n.id)).toEqual(['d']);
  });

  it('deleteFile removes the file node and all edges', () => {
    store.upsertNode({
      id: 'a',
      kind: 'file',
      file: 'a',
      name: null,
      roles: [],
      purpose: null,
      isEntryPoint: false,
    });
    store.upsertEdge({ src: 'a', dst: 'b', kind: 'DEPENDS_ON' });
    store.upsertEdge({ src: 'b', dst: 'a', kind: 'DEPENDS_ON' });

    store.deleteFile('a');

    expect(store.getNode('a')).toBeNull();
    expect(store.neighbors('b', 'out')).toEqual([]);
  });

  it('separates edge kinds (CALLS vs DEPENDS_ON)', () => {
    store.upsertEdge({ src: 'a', dst: 'b', kind: 'DEPENDS_ON' });
    store.upsertEdge({ src: 'a', dst: 'c', kind: 'CALLS' });

    const deps = store.neighbors('a', 'out', ['DEPENDS_ON']);
    expect(deps.map((n) => n.id)).toEqual(['b']);

    const calls = store.neighbors('a', 'out', ['CALLS']);
    expect(calls.map((n) => n.id)).toEqual(['c']);
  });
});
