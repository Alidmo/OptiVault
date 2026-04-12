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

vi.mock('../config.js', () => ({
  LEGACY_VAULT_DIR: '.optivault',
  DEFAULT_VAULT_DIR: '_optivault',
  IGNORED_DIRECTORIES: [
    'node_modules', '.git', '.venv', 'venv', 'env', 'vendor',
    'dist', 'build', 'coverage', '.next', '.nuxt', '__pycache__',
  ],
  getConfig: vi.fn(() => ({ vaultDir: '_optivault' })),
}));

vi.mock('fs/promises', () => ({
  readdir: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  readFile: vi.fn(),
  stat: vi.fn(),
  rename: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
  runInit,
  writeRepoMap,
  VaultRegistry,
  walkDir,
  generateClaudeMd,
  ensureGitignored,
  migrateLegacyVault,
} from './init.js';
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
const mockRename = vi.mocked(fsp.rename);

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
  mockRename.mockResolvedValue(undefined);
  // Default: stat throws ENOENT → note doesn't exist → always re-parse
  mockStat.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
  // Default: readFile returns undefined → treated as absent
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

// Convenience: stat mock that resolves for the first two calls
// (srcStat, noteStat) with the given mtime values.
function mockStatForSkip(srcMtime: number, noteMtime: number): void {
  mockStat
    .mockResolvedValueOnce({ mtimeMs: srcMtime } as Awaited<ReturnType<typeof fsp.stat>>)
    .mockResolvedValueOnce({ mtimeMs: noteMtime } as Awaited<ReturnType<typeof fsp.stat>>);
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

  it('skips a directory passed in extraSkipDirs', async () => {
    mockReaddir.mockResolvedValueOnce([
      makeDirent('src', true),
      makeDirent('_optivault', true),
    ]).mockResolvedValueOnce([
      makeDirent('auth.ts', false),
    ]);

    const files = await walkDir('/project', new Set(['_optivault']));
    expect(files).toHaveLength(1);
    expect(files[0]).toContain('auth.ts');
  });

  it('skips .venv and does not recurse into it', async () => {
    // Project root has src/ and .venv/ — .venv should never be entered
    mockReaddir.mockResolvedValueOnce([
      makeDirent('src', true),
      makeDirent('.venv', true),
    ]).mockResolvedValueOnce([
      // Only src/ is recursed; this returns its contents
      makeDirent('main.py', false),
    ]);
    // .venv/ is never entered, so no second readdir call for it

    const files = await walkDir('/project');
    expect(files).toHaveLength(1);
    expect(files[0]).toContain('main.py');
    // readdir was called twice: once for root, once for src/
    expect(mockReaddir).toHaveBeenCalledTimes(2);
  });

  it('skips __pycache__ directories', async () => {
    mockReaddir.mockResolvedValueOnce([
      makeDirent('src', true),
      makeDirent('__pycache__', true),
    ]).mockResolvedValueOnce([
      makeDirent('utils.py', false),
    ]);

    const files = await walkDir('/project');
    expect(files).toHaveLength(1);
    expect(files[0]).toContain('utils.py');
    expect(mockReaddir).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// runInit
// ---------------------------------------------------------------------------

describe('runInit', () => {
  it('writes notes, _RepoMap.md, CLAUDE.md, and .gitignore on a fresh project', async () => {
    mockReaddir.mockResolvedValueOnce([
      makeDirent('auth.ts', false),
      makeDirent('utils.py', false),
    ]);
    mockParseFile.mockResolvedValue(FIXED_PARSE_RESULT);
    mockFormatVaultNote.mockReturnValue('---\ntgt: test\n---');

    await runInit('/project', '/project/_optivault');

    // 2 vault notes + 1 _RepoMap.md + 1 CLAUDE.md + 1 .gitignore
    expect(mockWriteFile.mock.calls.length).toBe(5);
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

    await expect(runInit('/project', '/project/_optivault')).resolves.toBeUndefined();

    // 1 vault note + 1 _RepoMap.md + 1 CLAUDE.md + 1 .gitignore
    expect(mockWriteFile.mock.calls.length).toBe(4);
  });

  it('completes gracefully for an empty directory', async () => {
    mockReaddir.mockResolvedValueOnce([]);

    await expect(runInit('/project', '/project/_optivault')).resolves.toBeUndefined();

    // 0 vault notes + 1 _RepoMap.md + 1 CLAUDE.md + 1 .gitignore
    expect(mockWriteFile.mock.calls.length).toBe(3);
  });

  it('skips unchanged files when vault note is newer than source', async () => {
    mockReaddir.mockResolvedValueOnce([makeDirent('auth.ts', false)]);
    mockStatForSkip(1000, 2000); // note newer → skip
    mockReadFile.mockResolvedValueOnce(VAULT_NOTE_CONTENT as unknown as string);

    await runInit('/project', '/project/_optivault');

    expect(mockParseFile).not.toHaveBeenCalled();
    // 0 vault notes + 1 _RepoMap.md + 1 CLAUDE.md + 1 .gitignore
    expect(mockWriteFile.mock.calls.length).toBe(3);
  });

  it('re-parses a file when its source is newer than the vault note', async () => {
    mockReaddir.mockResolvedValueOnce([makeDirent('auth.ts', false)]);
    mockStatForSkip(3000, 1000); // source newer → re-parse
    mockParseFile.mockResolvedValue(FIXED_PARSE_RESULT);
    mockFormatVaultNote.mockReturnValue('---\ntgt: test\n---');

    await runInit('/project', '/project/_optivault');

    expect(mockParseFile).toHaveBeenCalledOnce();
    // 1 vault note + 1 _RepoMap.md + 1 CLAUDE.md + 1 .gitignore
    expect(mockWriteFile.mock.calls.length).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// generateClaudeMd
// ---------------------------------------------------------------------------

describe('generateClaudeMd', () => {
  it('creates a new CLAUDE.md when none exists', async () => {
    mockReadFile.mockResolvedValueOnce(undefined as unknown as string);

    await generateClaudeMd('/project', '_optivault');

    expect(mockWriteFile).toHaveBeenCalledOnce();
    const [path, content] = mockWriteFile.mock.calls[0] as [string, string, string];
    expect(path).toContain('CLAUDE.md');
    expect(content).toContain('OptiVault Protocol Active');
    expect(content).toContain('sync_file_context');
    expect(content).toContain('<!-- optivault-protocol -->');
    expect(content).toContain('Shadow vault: `_optivault/`');
  });

  it('appends the protocol to an existing CLAUDE.md that lacks the marker', async () => {
    const existing = '# My Project\nSome existing instructions.\n';
    mockReadFile.mockResolvedValueOnce(existing as unknown as string);

    await generateClaudeMd('/project', '_optivault');

    expect(mockWriteFile).toHaveBeenCalledOnce();
    const [, content] = mockWriteFile.mock.calls[0] as [string, string, string];
    expect(content).toContain('My Project');
    expect(content).toContain('OptiVault Protocol Active');
    expect(content).toContain('_optivault');
  });

  it('is a no-op when the marker is already present', async () => {
    const existing = '<!-- optivault-protocol -->\n# OptiVault Protocol Active\n';
    mockReadFile.mockResolvedValueOnce(existing as unknown as string);

    await generateClaudeMd('/project', '_optivault');

    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('includes the vaultDir name in the generated content', async () => {
    mockReadFile.mockResolvedValueOnce(undefined as unknown as string);

    await generateClaudeMd('/project', 'my_custom_vault');

    const [, content] = mockWriteFile.mock.calls[0] as [string, string, string];
    expect(content).toContain('my_custom_vault');
  });
});

// ---------------------------------------------------------------------------
// ensureGitignored
// ---------------------------------------------------------------------------

describe('ensureGitignored', () => {
  it('creates .gitignore with the entry when none exists', async () => {
    mockReadFile.mockResolvedValueOnce(undefined as unknown as string);

    await ensureGitignored('/project', '_optivault');

    expect(mockWriteFile).toHaveBeenCalledOnce();
    const [path, content] = mockWriteFile.mock.calls[0] as [string, string, string];
    expect(path).toContain('.gitignore');
    expect(content).toContain('_optivault');
  });

  it('appends the entry to an existing .gitignore', async () => {
    const existing = 'node_modules\ndist\n';
    mockReadFile.mockResolvedValueOnce(existing as unknown as string);

    await ensureGitignored('/project', '_optivault');

    const [, content] = mockWriteFile.mock.calls[0] as [string, string, string];
    expect(content).toContain('node_modules');
    expect(content).toContain('_optivault');
  });

  it('is a no-op when the entry is already present', async () => {
    const existing = 'node_modules\n_optivault\ndist\n';
    mockReadFile.mockResolvedValueOnce(existing as unknown as string);

    await ensureGitignored('/project', '_optivault');

    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('works with a custom vault dir name', async () => {
    mockReadFile.mockResolvedValueOnce(undefined as unknown as string);

    await ensureGitignored('/project', 'my_custom_vault');

    const [, content] = mockWriteFile.mock.calls[0] as [string, string, string];
    expect(content).toContain('my_custom_vault');
  });
});

// ---------------------------------------------------------------------------
// migrateLegacyVault
// ---------------------------------------------------------------------------

describe('migrateLegacyVault', () => {
  it('renames .optivault to the target dir when legacy exists and target does not', async () => {
    // First stat (legacy .optivault) → resolves (exists)
    // Second stat (target _optivault) → rejects (does not exist)
    mockStat
      .mockResolvedValueOnce({} as Awaited<ReturnType<typeof fsp.stat>>)  // legacy exists
      .mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })); // target absent

    await migrateLegacyVault('/project', '/project/_optivault');

    expect(mockRename).toHaveBeenCalledOnce();
    const [from, to] = mockRename.mock.calls[0] as [string, string];
    expect(from.replace(/\\/g, '/')).toContain('.optivault');
    expect(to.replace(/\\/g, '/')).toContain('_optivault');
  });

  it('does nothing when legacy .optivault does not exist', async () => {
    // stat for legacy throws → no legacy vault
    mockStat.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    await migrateLegacyVault('/project', '/project/_optivault');

    expect(mockRename).not.toHaveBeenCalled();
  });

  it('does nothing when target path equals the legacy path', async () => {
    await migrateLegacyVault('/project', '/project/.optivault');

    expect(mockStat).not.toHaveBeenCalled();
    expect(mockRename).not.toHaveBeenCalled();
  });

  it('warns and skips when both legacy and target already exist', async () => {
    // Both stat calls resolve → both directories exist
    mockStat
      .mockResolvedValueOnce({} as Awaited<ReturnType<typeof fsp.stat>>)  // legacy exists
      .mockResolvedValueOnce({} as Awaited<ReturnType<typeof fsp.stat>>); // target also exists

    await migrateLegacyVault('/project', '/project/_optivault');

    expect(mockRename).not.toHaveBeenCalled();
  });

  it('passes absolute paths to fs.rename', async () => {
    mockStat
      .mockResolvedValueOnce({} as Awaited<ReturnType<typeof fsp.stat>>)
      .mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    await migrateLegacyVault('/absolute/project', '/absolute/project/_optivault');

    const [from] = mockRename.mock.calls[0] as [string, string];
    // Normalize slashes so the assertion is cross-platform
    expect(from.replace(/\\/g, '/')).toContain('/absolute/project');
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

  it('deletes entries', () => {
    const registry = new VaultRegistry();
    registry.set('/project/auth.ts', FIXED_PARSE_RESULT);
    registry.delete('/project/auth.ts');
    expect(registry.getAll()).toHaveLength(0);
  });

  it('has() reflects current state', () => {
    const registry = new VaultRegistry();
    expect(registry.has('/project/auth.ts')).toBe(false);
    registry.set('/project/auth.ts', FIXED_PARSE_RESULT);
    expect(registry.has('/project/auth.ts')).toBe(true);
  });
});
