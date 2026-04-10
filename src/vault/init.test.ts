import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be hoisted before any imports that use the mocked modules
// ---------------------------------------------------------------------------

vi.mock('../ast/parser.js', () => ({
  parseFile: vi.fn(),
}));

vi.mock('../compression/ollama.js', () => ({
  summarizeFunctions: vi.fn(),
}));

vi.mock('../compression/formatter.js', () => ({
  formatVaultNote: vi.fn(),
}));

// We mock 'fs/promises' so no real disk I/O happens.
// All write/mkdir calls are intercepted; readdir returns a controlled tree.
vi.mock('fs/promises', () => ({
  readdir: vi.fn(),
  stat: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  readFile: vi.fn(),
  unlink: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { runInit, writeRepoMap, VaultRegistry, walkDir } from './init.js';
import { parseFile } from '../ast/parser.js';
import { summarizeFunctions } from '../compression/ollama.js';
import { formatVaultNote } from '../compression/formatter.js';
import * as fsp from 'fs/promises';
import type { ParseResult } from '../ast/parser.js';
import type { FunctionSummary } from '../compression/ollama.js';
import type { Dirent } from 'node:fs';

// ---------------------------------------------------------------------------
// Typed mock helpers
// ---------------------------------------------------------------------------

const mockParseFile = vi.mocked(parseFile);
const mockSummarizeFunctions = vi.mocked(summarizeFunctions);
const mockFormatVaultNote = vi.mocked(formatVaultNote);
const mockReaddir = vi.mocked(fsp.readdir);
const mockMkdir = vi.mocked(fsp.mkdir);
const mockWriteFile = vi.mocked(fsp.writeFile);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXED_PARSE_RESULT: ParseResult = {
  filePath: '/project/src/auth.ts',
  deps: ['database', 'crypto'],
  exports: ['verifyToken(token: string)', 'hashPwd(plain: string)'],
};

const FIXED_SUMMARIES: FunctionSummary[] = [
  { signature: 'verifyToken(token: string)', caveman: 'Check token. Return bool.' },
  { signature: 'hashPwd(plain: string)', caveman: 'Hash password. Return string.' },
];

const FIXED_NOTE_CONTENT =
  '---\ntgt: /project/src/auth.ts\ndep: [[database]], [[crypto]]\nexp: [verifyToken, hashPwd]\n---';

// ---------------------------------------------------------------------------
// Helpers to build mock Dirent entries
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeDirent(name: string, isDir: boolean): any {
  return {
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    isSymbolicLink: () => false,
    path: '',
    parentPath: '',
  };
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Default: mkdir and writeFile are no-ops
  mockMkdir.mockResolvedValue(undefined);
  mockWriteFile.mockResolvedValue(undefined);
  // Default formatter returns fixed content
  mockFormatVaultNote.mockReturnValue(FIXED_NOTE_CONTENT);
});

// ---------------------------------------------------------------------------
// walkDir tests
// ---------------------------------------------------------------------------

describe('walkDir', () => {
  it('returns supported source files and skips node_modules', async () => {
    mockReaddir
      .mockResolvedValueOnce([
        makeDirent('src', true),
        makeDirent('node_modules', true),
        makeDirent('README.md', false),
      ])
      .mockResolvedValueOnce([
        makeDirent('auth.ts', false),
        makeDirent('index.ts', false),
        makeDirent('styles.css', false),
      ]);

    const files = await walkDir('/project');
    expect(files).toHaveLength(2);
    expect(files.some((f) => f.includes('auth.ts'))).toBe(true);
    expect(files.some((f) => f.includes('index.ts'))).toBe(true);
    expect(files.every((f) => !f.includes('node_modules'))).toBe(true);
  });

  it('skips .git, dist, and .optivault directories', async () => {
    mockReaddir.mockResolvedValueOnce([
      makeDirent('.git', true),
      makeDirent('dist', true),
      makeDirent('.optivault', true),
      makeDirent('main.ts', false),
    ]);

    const files = await walkDir('/project');
    expect(files).toHaveLength(1);
    expect(files[0]).toContain('main.ts');
  });

  it('recurses into nested directories', async () => {
    mockReaddir
      .mockResolvedValueOnce([makeDirent('src', true)])
      .mockResolvedValueOnce([makeDirent('utils', true), makeDirent('index.ts', false)])
      .mockResolvedValueOnce([makeDirent('helper.ts', false)]);

    const files = await walkDir('/project');
    expect(files).toHaveLength(2);
    expect(files.some((f) => f.includes('index.ts'))).toBe(true);
    expect(files.some((f) => f.includes('helper.ts'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// runInit — correct number of files written
// ---------------------------------------------------------------------------

describe('runInit', () => {
  it('writes one .md note per source file plus _RepoMap.md', async () => {
    // Simulate a flat project with 3 source files
    mockReaddir.mockResolvedValueOnce([
      makeDirent('auth.ts', false),
      makeDirent('index.ts', false),
      makeDirent('utils.py', false),
    ]);

    mockParseFile.mockResolvedValue(FIXED_PARSE_RESULT);
    mockSummarizeFunctions.mockResolvedValue(FIXED_SUMMARIES);

    await runInit('/project', '/project/.optivault');

    // writeFile should be called N (source files) + 1 (_RepoMap.md) times
    // Each source file → one .md note; _RepoMap is the last call
    const writeCalls = mockWriteFile.mock.calls;
    expect(writeCalls.length).toBe(4); // 3 notes + 1 RepoMap

    const writtenPaths = writeCalls.map((c) => String(c[0]));
    expect(writtenPaths.some((p) => p.endsWith('_RepoMap.md'))).toBe(true);
  });

  it('writes the correct number of notes for a two-file project', async () => {
    mockReaddir.mockResolvedValueOnce([
      makeDirent('server.ts', false),
      makeDirent('client.ts', false),
    ]);

    mockParseFile.mockResolvedValue(FIXED_PARSE_RESULT);
    mockSummarizeFunctions.mockResolvedValue(FIXED_SUMMARIES);

    await runInit('/repo', '/repo/.optivault');

    // 2 source notes + 1 _RepoMap.md
    expect(mockWriteFile).toHaveBeenCalledTimes(3);
  });

  // -------------------------------------------------------------------------
  // Graceful Ollama degradation
  // -------------------------------------------------------------------------

  it('still writes notes when summarizeFunctions throws (Ollama unavailable)', async () => {
    mockReaddir.mockResolvedValueOnce([makeDirent('auth.ts', false)]);
    mockParseFile.mockResolvedValue(FIXED_PARSE_RESULT);
    // Simulate Ollama not running
    mockSummarizeFunctions.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(runInit('/project', '/project/.optivault')).resolves.not.toThrow();

    // The note should still be written (with empty summaries)
    const writeCalls = mockWriteFile.mock.calls;
    expect(writeCalls.length).toBe(2); // 1 note + 1 RepoMap

    // formatVaultNote should have been called with empty summaries []
    expect(mockFormatVaultNote).toHaveBeenCalledWith(FIXED_PARSE_RESULT, []);
  });

  it('writes all notes even if Ollama fails on every file', async () => {
    mockReaddir.mockResolvedValueOnce([
      makeDirent('a.ts', false),
      makeDirent('b.ts', false),
      makeDirent('c.ts', false),
    ]);
    mockParseFile.mockResolvedValue(FIXED_PARSE_RESULT);
    mockSummarizeFunctions.mockRejectedValue(new Error('Connection refused'));

    await expect(runInit('/project', '/project/.optivault')).resolves.not.toThrow();

    // 3 notes + 1 RepoMap
    expect(mockWriteFile).toHaveBeenCalledTimes(4);
  });

  // -------------------------------------------------------------------------
  // _RepoMap.md content
  // -------------------------------------------------------------------------

  it('_RepoMap.md contains correct wikilinks for each file', async () => {
    mockReaddir.mockResolvedValueOnce([
      makeDirent('auth.ts', false),
      makeDirent('index.ts', false),
    ]);

    const authParsed: ParseResult = {
      filePath: '/project/auth.ts',
      deps: ['database', 'crypto'],
      exports: ['verifyToken', 'hashPwd'],
    };
    const indexParsed: ParseResult = {
      filePath: '/project/index.ts',
      deps: ['commander'],
      exports: ['main'],
    };

    mockParseFile
      .mockResolvedValueOnce(authParsed)
      .mockResolvedValueOnce(indexParsed);
    mockSummarizeFunctions.mockResolvedValue([]);

    await runInit('/project', '/project/.optivault');

    // Find the _RepoMap.md write call
    const repoMapCall = mockWriteFile.mock.calls.find((c) =>
      String(c[0]).endsWith('_RepoMap.md')
    );
    expect(repoMapCall).toBeDefined();

    const repoMapContent = String(repoMapCall![1]);
    expect(repoMapContent).toContain('[[auth]]');
    expect(repoMapContent).toContain('[[index]]');
    expect(repoMapContent).toContain('# RepoMap');
  });

  it('_RepoMap.md includes files with no exports and no deps as bare wikilinks', async () => {
    mockReaddir.mockResolvedValueOnce([makeDirent('empty.ts', false)]);

    const emptyParsed: ParseResult = {
      filePath: '/project/empty.ts',
      deps: [],
      exports: [],
    };
    mockParseFile.mockResolvedValue(emptyParsed);
    mockSummarizeFunctions.mockResolvedValue([]);

    await runInit('/project', '/project/.optivault');

    const repoMapCall = mockWriteFile.mock.calls.find((c) =>
      String(c[0]).endsWith('_RepoMap.md')
    );
    const content = String(repoMapCall![1]);
    expect(content).toContain('[[empty]]');
    // Should NOT have a dash separator since there are no parts
    expect(content).not.toContain('— exports:');
    expect(content).not.toContain('— deps:');
  });

  it('_RepoMap.md lists exports and deps in the right format', async () => {
    mockReaddir.mockResolvedValueOnce([makeDirent('auth.ts', false)]);

    const parsed: ParseResult = {
      filePath: '/project/auth.ts',
      deps: ['database', 'crypto'],
      exports: ['verifyToken', 'hashPwd'],
    };
    mockParseFile.mockResolvedValue(parsed);
    mockSummarizeFunctions.mockResolvedValue([]);

    await runInit('/project', '/project/.optivault');

    const repoMapCall = mockWriteFile.mock.calls.find((c) =>
      String(c[0]).endsWith('_RepoMap.md')
    );
    const content = String(repoMapCall![1]);
    expect(content).toContain('exports: verifyToken, hashPwd');
    expect(content).toContain('deps: database, crypto');
  });
});

// ---------------------------------------------------------------------------
// writeRepoMap unit tests
// ---------------------------------------------------------------------------

describe('writeRepoMap', () => {
  it('creates a well-formed RepoMap with wikilinks', async () => {
    const parsed: ParseResult[] = [
      {
        filePath: '/project/src/auth.ts',
        deps: ['database'],
        exports: ['verifyToken'],
      },
    ];

    await writeRepoMap('/project/.optivault', parsed, '/project');

    expect(mockWriteFile).toHaveBeenCalledOnce();
    const content = String(mockWriteFile.mock.calls[0][1]);
    expect(content).toContain('# RepoMap');
    expect(content).toContain('[[src/auth]]');
    expect(content).toContain('exports: verifyToken');
    expect(content).toContain('deps: database');
  });

  it('uses forward slashes in wikilinks even on Windows-style paths', async () => {
    // Simulate Windows-style resolved paths by putting backslashes in the relative result.
    // The implementation should normalise them.
    const parsed: ParseResult[] = [
      {
        filePath: '/project/src/utils/helper.ts',
        deps: [],
        exports: ['helperFn'],
      },
    ];

    await writeRepoMap('/project/.optivault', parsed, '/project');

    const content = String(mockWriteFile.mock.calls[0][1]);
    // Wikilink must use forward slash, never backslash
    expect(content).not.toContain('\\');
    expect(content).toContain('[[src/utils/helper]]');
  });
});

// ---------------------------------------------------------------------------
// VaultRegistry unit tests
// ---------------------------------------------------------------------------

describe('VaultRegistry', () => {
  it('stores and retrieves ParseResults', () => {
    const registry = new VaultRegistry();
    registry.set('/project/src/auth.ts', FIXED_PARSE_RESULT);
    expect(registry.getAll()).toHaveLength(1);
    expect(registry.has('/project/src/auth.ts')).toBe(true);
  });

  it('deletes entries correctly', () => {
    const registry = new VaultRegistry();
    registry.set('/project/src/auth.ts', FIXED_PARSE_RESULT);
    registry.delete('/project/src/auth.ts');
    expect(registry.getAll()).toHaveLength(0);
    expect(registry.has('/project/src/auth.ts')).toBe(false);
  });

  it('returns all entries in insertion order', () => {
    const registry = new VaultRegistry();
    const p1: ParseResult = { filePath: '/a.ts', deps: [], exports: ['A'] };
    const p2: ParseResult = { filePath: '/b.ts', deps: [], exports: ['B'] };
    registry.set('/a.ts', p1);
    registry.set('/b.ts', p2);
    const all = registry.getAll();
    expect(all).toHaveLength(2);
    expect(all[0].exports).toContain('A');
    expect(all[1].exports).toContain('B');
  });
});
