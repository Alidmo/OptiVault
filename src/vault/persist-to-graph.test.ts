import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { openGraphStore, type GraphStore } from '../store/sqlite.js';
import { persistToGraph } from './init.js';
import type { ParseResult } from '../ast/parser.js';

let tmp: string;
let store: GraphStore;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'optivault-persist-'));
  store = openGraphStore(tmp);
});

afterEach(() => {
  store.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('persistToGraph', () => {
  it('writes a file node with roles, purpose, and DEPENDS_ON edges', () => {
    const parsed: ParseResult = {
      filePath: '/project/src/auth.ts',
      deps: ['database', 'crypto'],
      exports: ['verifyToken(token: string)'],
      purpose: 'auth helpers',
      roles: ['Symfony:Security'],
    };
    persistToGraph(store, parsed, '/project');

    const node = store.getNode('src/auth');
    expect(node).not.toBeNull();
    expect(node!.kind).toBe('file');
    expect(node!.roles).toEqual(['Symfony:Security']);
    expect(node!.purpose).toBe('auth helpers');

    const deps = store.neighbors('src/auth', 'out', ['DEPENDS_ON']).map((n) => n.id);
    expect(deps.sort()).toEqual(['crypto', 'database']);
  });

  it('writes entity nodes for functions and classes', () => {
    const parsed: ParseResult = {
      filePath: '/project/src/order.ts',
      deps: [],
      exports: [],
      entities: [
        { kind: 'function', name: 'processOrder' },
        { kind: 'class', name: 'OrderController' },
      ],
    };
    persistToGraph(store, parsed, '/project');

    expect(store.getNode('src/order::processOrder')?.kind).toBe('function');
    expect(store.getNode('src/order::OrderController')?.kind).toBe('class');
    expect(store.getNode('src/order::processOrder')?.file).toBe('src/order');
  });

  it('writes EXTENDS edges from subclass entities to their parent name', () => {
    const parsed: ParseResult = {
      filePath: '/project/src/UserController.ts',
      deps: [],
      exports: [],
      entities: [
        { kind: 'class', name: 'UserController', extendsName: 'AbstractController' },
      ],
    };
    persistToGraph(store, parsed, '/project');

    const edges = store.neighbors('src/UserController::UserController', 'out', ['EXTENDS']);
    expect(edges).toEqual([{ id: 'AbstractController', kind: 'EXTENDS' }]);
  });

  it('replaces stale DEPENDS_ON edges on re-persist', () => {
    const first: ParseResult = {
      filePath: '/project/src/auth.ts',
      deps: ['database'],
      exports: [],
    };
    const second: ParseResult = {
      filePath: '/project/src/auth.ts',
      deps: ['crypto'],
      exports: [],
    };
    persistToGraph(store, first, '/project');
    persistToGraph(store, second, '/project');

    const deps = store.neighbors('src/auth', 'out', ['DEPENDS_ON']).map((n) => n.id);
    expect(deps).toEqual(['crypto']);
  });
});
