import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../ast/parser.js', () => ({
  parseFile: vi.fn(),
}));

vi.mock('../compression/formatter.js', () => ({
  formatVaultNote: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  readdir: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { runInit, writeRepoMap, VaultRegistry, walkDir } from './init.js';
import { parseFile } from '../ast/parser.js';
import { formatVaultNote } from '../compression/formatter.js';
import * as fsp from 'fs/promises';
import type { ParseResult } from '../ast/parser.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockParseFile = vi.mocked(parseFile);
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
  exports: ['verifyToken(token: string): Promise<boolean>', 'hashPwd(plain: string): string'],
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockMkdir.mockResolvedValue(undefined);
  mockWriteFile.mockResolvedValue(undefined);
});

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
// Tests
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
  });
});

describe('runInit', () => {
  it('writes notes and _RepoMap.md', async () => {
    mockReaddir.mockResolvedValueOnce([
      makeDirent('auth.ts', false),
      makeDirent('utils.py', false),
    ]);

    mockParseFile.mockResolvedValue(FIXED_PARSE_RESULT);
    mockFormatVaultNote.mockReturnValue('---\ntgt: test\n---');

    await runInit('/project', '/project/.optivault');

    expect(mockWriteFile.mock.calls.length).toBe(3); // 2 notes + 1 RepoMap
  });

  it('skips unparseable files gracefully without crashing', async () => {
    mockReaddir.mockResolvedValueOnce([
      makeDirent('good.ts', false),
      makeDirent('corrupt.ts', false),
    ]);

    // First file succeeds, second throws
    mockParseFile
      .mockResolvedValueOnce(FIXED_PARSE_RESULT)
      .mockRejectedValueOnce(new Error('SyntaxError: unexpected token'));
    mockFormatVaultNote.mockReturnValue('---\ntgt: test\n---');

    // Must not throw
    await expect(runInit('/project', '/project/.optivault')).resolves.toBeUndefined();

    // Only 1 note written (the good file) + 1 RepoMap
    expect(mockWriteFile.mock.calls.length).toBe(2);
  });

  it('completes gracefully for an empty directory', async () => {
    mockReaddir.mockResolvedValueOnce([]);

    await expect(runInit('/project', '/project/.optivault')).resolves.toBeUndefined();

    // Only _RepoMap.md written
    expect(mockWriteFile.mock.calls.length).toBe(1);
  });
});

describe('VaultRegistry', () => {
  it('stores and retrieves ParseResults', () => {
    const registry = new VaultRegistry();
    registry.set('/project/auth.ts', FIXED_PARSE_RESULT);
    expect(registry.getAll()).toHaveLength(1);
  });
});
