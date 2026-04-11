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
  readFile: vi.fn(),
  stat: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { runInit, writeRepoMap, VaultRegistry, walkDir, generateClaudeMd } from './init.js';
import { parseFile } from '../ast/parser.js';
import { formatVaultNote } from '../compression/formatter.js';
import * as fsp from 'fs/promises';
import type { ParseResult } from '../ast/parser.js';

// ---------------------------------------------------------------------------
// Mock references
// ---------------------------------------------------------------------------

const mockParseFile = vi.mocked(parseFile);
const mockFormatVaultNote = vi.mocked(formatVaultNote);
const mockReaddir = vi.mocked(fsp.readdir);
const mockMkdir = vi.mocked(fsp.mkdir);
const mockWriteFile = vi.mocked(fsp.writeFile);
const mockReadFile = vi.mocked(fsp.readFile);
const mockStat = vi.mocked(fsp.stat);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXED_PARSE_RESULT: ParseResult = {
  filePath: '/project/src/auth.ts',
  deps: ['database', 'crypto'],
  exports: ['verifyToken(token: string): Promise<boolean>', 'hashPwd(plain: string): string'],
};

const VAULT_NOTE_CONTENT = [
  '---',
  'tgt: /project/src/auth.ts',
  'dep: [[database]], [[crypto]]',
  '---',
  '## Signatures',
  '- `verifyToken(token: string): Promise<boolean>`',
  '- `hashPwd(plain: string): string`',
].join('\n');

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockMkdir.mockResolvedValue(undefined);
  mockWriteFile.mockResolvedValue(undefined);
  // Default: stat throws → note doesn't exist → always re-parse
  mockStat.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
  // Default: readFile returns undefined → CLAUDE.md treated as absent
  mockReadFile.mockResolvedValue(undefined as unknown as string);
});

// ---------------------------------------------------------------------------
// Helpers
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
// walkDir
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

// ---------------------------------------------------------------------------
// runInit
// ---------------------------------------------------------------------------

describe('runInit', () => {
  it('writes notes, _RepoMap.md, and CLAUDE.md on a fresh project', async () => {
    mockReaddir.mockResolvedValueOnce([
      makeDirent('auth.ts', false),
      makeDirent('utils.py', false),
    ]);

    mockParseFile.mockResolvedValue(FIXED_PARSE_RESULT);
    mockFormatVaultNote.mockReturnValue('---\ntgt: test\n---');

    await runInit('/project', '/project/.optivault');

    // 2 vault notes + 1 _RepoMap.md + 1 CLAUDE.md
    expect(mockWriteFile.mock.calls.length).toBe(4);
  });

  it('skips unparseable files gracefully without crashing', async () => {
    mockReaddir.mockResolvedValueOnce([
      makeDirent('good.ts', false),
      makeDirent('corrupt.ts', false),
    ]);

    mockParseFile
      .mockResolvedValueOnce(FIXED_PARSE_RESULT)
      .mockRejectedValueOnce(new Error('SyntaxError: unexpected token'));
    mockFormatVaultNote.mockReturnValue('---\ntgt: test\n---');

    await expect(runInit('/project', '/project/.optivault')).resolves.toBeUndefined();

    // 1 vault note (good file) + 1 _RepoMap.md + 1 CLAUDE.md
    expect(mockWriteFile.mock.calls.length).toBe(3);
  });

  it('completes gracefully for an empty directory', async () => {
    mockReaddir.mockResolvedValueOnce([]);

    await expect(runInit('/project', '/project/.optivault')).resolves.toBeUndefined();

    // 0 vault notes + 1 _RepoMap.md + 1 CLAUDE.md
    expect(mockWriteFile.mock.calls.length).toBe(2);
  });

  it('skips unchanged files when vault note is newer than source', async () => {
    mockReaddir.mockResolvedValueOnce([
      makeDirent('auth.ts', false),
    ]);

    // stat: note is NEWER than source → skip
    mockStat
      .mockResolvedValueOnce({ mtimeMs: 1000 } as ReturnType<typeof fsp.stat> extends Promise<infer T> ? T : never)  // source
      .mockResolvedValueOnce({ mtimeMs: 2000 } as ReturnType<typeof fsp.stat> extends Promise<infer T> ? T : never); // note

    // readFile returns a valid vault note (for readVaultNote reconstruction)
    mockReadFile.mockResolvedValueOnce(VAULT_NOTE_CONTENT as unknown as string);

    await runInit('/project', '/project/.optivault');

    // File was skipped — parseFile must NOT have been called
    expect(mockParseFile).not.toHaveBeenCalled();
    // Only _RepoMap.md + CLAUDE.md — no vault note rewritten
    expect(mockWriteFile.mock.calls.length).toBe(2);
  });

  it('re-parses a file when its source is newer than the vault note', async () => {
    mockReaddir.mockResolvedValueOnce([
      makeDirent('auth.ts', false),
    ]);

    // stat: source is NEWER than note → re-parse
    mockStat
      .mockResolvedValueOnce({ mtimeMs: 3000 } as ReturnType<typeof fsp.stat> extends Promise<infer T> ? T : never)  // source
      .mockResolvedValueOnce({ mtimeMs: 1000 } as ReturnType<typeof fsp.stat> extends Promise<infer T> ? T : never); // note

    mockParseFile.mockResolvedValue(FIXED_PARSE_RESULT);
    mockFormatVaultNote.mockReturnValue('---\ntgt: test\n---');

    await runInit('/project', '/project/.optivault');

    // File was re-parsed
    expect(mockParseFile).toHaveBeenCalledOnce();
    // 1 vault note + 1 _RepoMap.md + 1 CLAUDE.md
    expect(mockWriteFile.mock.calls.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// generateClaudeMd
// ---------------------------------------------------------------------------

describe('generateClaudeMd', () => {
  it('creates a new CLAUDE.md when none exists', async () => {
    // readFile returns undefined → treated as absent
    mockReadFile.mockResolvedValueOnce(undefined as unknown as string);

    await generateClaudeMd('/project');

    expect(mockWriteFile).toHaveBeenCalledOnce();
    const [path, content] = mockWriteFile.mock.calls[0] as [string, string, string];
    expect(path).toContain('CLAUDE.md');
    expect(content).toContain('OptiVault Protocol Active');
    expect(content).toContain('sync_file_context');
    expect(content).toContain('<!-- optivault-protocol -->');
  });

  it('appends the protocol to an existing CLAUDE.md that lacks the marker', async () => {
    const existing = '# My Project\nSome existing instructions.\n';
    mockReadFile.mockResolvedValueOnce(existing as unknown as string);

    await generateClaudeMd('/project');

    expect(mockWriteFile).toHaveBeenCalledOnce();
    const [, content] = mockWriteFile.mock.calls[0] as [string, string, string];
    expect(content).toContain('My Project');             // original content preserved
    expect(content).toContain('OptiVault Protocol Active'); // protocol appended
  });

  it('is a no-op when the marker is already present', async () => {
    const existing = '<!-- optivault-protocol -->\n# OptiVault Protocol Active\n';
    mockReadFile.mockResolvedValueOnce(existing as unknown as string);

    await generateClaudeMd('/project');

    // Must not write anything
    expect(mockWriteFile).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// VaultRegistry
// ---------------------------------------------------------------------------

describe('VaultRegistry', () => {
  it('stores and retrieves ParseResults', () => {
    const registry = new VaultRegistry();
    registry.set('/project/auth.ts', FIXED_PARSE_RESULT);
    expect(registry.getAll()).toHaveLength(1);
  });
});
