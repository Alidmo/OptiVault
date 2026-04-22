import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoist mutable state so vi.mock factories can safely reference it
// ---------------------------------------------------------------------------
const { capturedTools, mockReadFile, mockWriteFile, mockMkdir } = vi.hoisted(() => ({
  capturedTools: {} as Record<string, (...args: unknown[]) => unknown>,
  mockReadFile: vi.fn(),
  mockWriteFile: vi.fn(),
  mockMkdir: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock the MCP SDK so tests never touch stdio or real network
// ---------------------------------------------------------------------------
vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => {
  return {
    McpServer: vi.fn().mockImplementation(() => ({
      tool: vi.fn(
        (
          _name: string,
          _descriptionOrSchema: unknown,
          _schemaOrCb: unknown,
          maybeCb?: (...args: unknown[]) => unknown,
        ) => {
          const name = _name as string;
          const cb = maybeCb ?? (_schemaOrCb as (...args: unknown[]) => unknown);
          capturedTools[name] = cb;
        },
      ),
      connect: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => {
  return { StdioServerTransport: vi.fn().mockImplementation(() => ({})) };
});

// ---------------------------------------------------------------------------
// Mock fs/promises
// ---------------------------------------------------------------------------
vi.mock('fs/promises', () => ({
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
}));

vi.mock('../ast/parser.js', () => ({
  parseFile: vi.fn(),
}));

vi.mock('../ast/function-extractor.js', () => ({
  extractFunctionCode: vi.fn(() => null),
}));

vi.mock('../compression/formatter.js', () => ({
  formatVaultNote: vi.fn(() => '---\ntgt: mocked\n---'),
}));

// Import under test after mocks are in place
import { startMcpServer, getTestFileCandidates } from './server.js';
import { parseFile } from '../ast/parser.js';
import { formatVaultNote } from '../compression/formatter.js';
import type { ParseResult } from '../ast/parser.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const VAULT_DIR = '/vault';
const SOURCE_DIR = '/src';
const FILENAME = 'src/auth.ts';
const NOTE_CONTENT = '# auth.ts\nCompressed shadow context here.';

const MOCK_PARSE_RESULT: ParseResult = {
  filePath: '/src/src/auth.ts',
  deps: ['database'],
  exports: ['verifyToken(token: string)'],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('MCP server – semantic routing tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteFile.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);
    // Reset captured tools between tests
    for (const key of Object.keys(capturedTools)) {
      delete capturedTools[key];
    }
  });

  it('registers read_repo_map tool', async () => {
    await startMcpServer(VAULT_DIR);
    expect(capturedTools['read_repo_map']).toBeDefined();
    expect(typeof capturedTools['read_repo_map']).toBe('function');
  });

  it('registers read_file_skeleton tool', async () => {
    await startMcpServer(VAULT_DIR);
    expect(capturedTools['read_file_skeleton']).toBeDefined();
    expect(typeof capturedTools['read_file_skeleton']).toBe('function');
  });

  it('registers read_function_code tool', async () => {
    await startMcpServer(VAULT_DIR, SOURCE_DIR);
    expect(capturedTools['read_function_code']).toBeDefined();
    expect(typeof capturedTools['read_function_code']).toBe('function');
  });

  it('registers sync_file_context tool', async () => {
    await startMcpServer(VAULT_DIR, SOURCE_DIR);
    expect(capturedTools['sync_file_context']).toBeDefined();
    expect(typeof capturedTools['sync_file_context']).toBe('function');
  });

  it('read_file_skeleton returns file skeleton when it exists', async () => {
    mockReadFile.mockResolvedValueOnce(NOTE_CONTENT);
    await startMcpServer(VAULT_DIR);

    const handler = capturedTools['read_file_skeleton'];
    const result = (await handler({ filename: FILENAME })) as {
      content: Array<{ type: string; text: string }>;
    };

    expect(result.content).toHaveLength(1);
    expect(result.content[0].text).toBe(NOTE_CONTENT);
    expect(mockReadFile).toHaveBeenCalledWith(
      `${VAULT_DIR}/${FILENAME}.md`,
      'utf-8'
    );
  });

  it('read_file_skeleton returns error message when file missing', async () => {
    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    mockReadFile.mockRejectedValueOnce(enoent);
    await startMcpServer(VAULT_DIR);

    const handler = capturedTools['read_file_skeleton'];
    const result = (await handler({ filename: FILENAME })) as {
      content: Array<{ type: string; text: string }>;
    };

    expect(result.content[0].text).toContain('No skeleton found');
  });

  it('registers read_tests_for_file tool', async () => {
    await startMcpServer(VAULT_DIR, SOURCE_DIR);
    expect(capturedTools['read_tests_for_file']).toBeDefined();
    expect(typeof capturedTools['read_tests_for_file']).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// sync_file_context
// ---------------------------------------------------------------------------
describe('sync_file_context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteFile.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);
    for (const key of Object.keys(capturedTools)) {
      delete capturedTools[key];
    }
  });

  it('returns error when sourceDir is not configured', async () => {
    await startMcpServer(VAULT_DIR); // no sourceDir

    const handler = capturedTools['sync_file_context'];
    const result = (await handler({ filename: FILENAME })) as {
      content: Array<{ type: string; text: string }>;
    };

    expect(result.content[0].text).toContain('Source directory not configured');
  });

  it('parses the file, writes vault note, patches RepoMap, and returns success', async () => {
    vi.mocked(parseFile).mockResolvedValueOnce(MOCK_PARSE_RESULT);
    vi.mocked(formatVaultNote).mockReturnValueOnce('---\ntgt: /src/src/auth.ts\n---');
    // First readFile: existing vault note (for concepts merge) — absent
    mockReadFile.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    // Second readFile: _RepoMap.md — return a minimal existing map
    mockReadFile.mockResolvedValueOnce('# RepoMap\n\n- [[src/other]] — exports: foo\n');

    await startMcpServer(VAULT_DIR, SOURCE_DIR);
    const handler = capturedTools['sync_file_context'];
    const result = (await handler({ filename: FILENAME })) as {
      content: Array<{ type: string; text: string }>;
    };

    expect(result.content[0].text).toContain(`Successfully synced shadow context for ${FILENAME}`);

    // parseFile called with a path that includes the filename component
    expect(vi.mocked(parseFile)).toHaveBeenCalledWith(
      expect.stringContaining('auth.ts')
    );

    // writeFile called twice: once for vault note, once for patched _RepoMap.md
    expect(mockWriteFile).toHaveBeenCalledTimes(2);

    // First write is the vault note (path separator is platform-dependent)
    const [notePath, noteContent] = mockWriteFile.mock.calls[0] as [string, string, string];
    expect(notePath.replace(/\\/g, '/')).toContain(FILENAME + '.md');
    expect(noteContent).toContain('tgt:');

    // Second write is the updated RepoMap
    const [repoMapPath, repoMapContent] = mockWriteFile.mock.calls[1] as [string, string, string];
    expect(repoMapPath.replace(/\\/g, '/')).toContain('_RepoMap.md');
    expect(repoMapContent).toContain('[[src/auth]]');
  });

  it('inserts a new entry when the file is not yet in the RepoMap', async () => {
    vi.mocked(parseFile).mockResolvedValueOnce(MOCK_PARSE_RESULT);
    vi.mocked(formatVaultNote).mockReturnValueOnce('---\ntgt: /src/src/auth.ts\n---');
    // First readFile: existing vault note (for concepts merge) — absent
    mockReadFile.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    // RepoMap that does NOT yet contain src/auth
    mockReadFile.mockResolvedValueOnce('# RepoMap\n\n- [[src/other]] — exports: foo\n');

    await startMcpServer(VAULT_DIR, SOURCE_DIR);
    const handler = capturedTools['sync_file_context'];
    await handler({ filename: FILENAME });

    const [, repoMapContent] = mockWriteFile.mock.calls[1] as [string, string, string];
    // New entry appended
    expect(repoMapContent).toContain('[[src/auth]]');
    // Original entry preserved
    expect(repoMapContent).toContain('[[src/other]]');
  });

  it('replaces an existing entry in the RepoMap', async () => {
    vi.mocked(parseFile).mockResolvedValueOnce(MOCK_PARSE_RESULT);
    vi.mocked(formatVaultNote).mockReturnValueOnce('---\ntgt: /src/src/auth.ts\n---');
    // First readFile: existing vault note (for concepts merge) — absent
    mockReadFile.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    // RepoMap already has a stale src/auth entry
    mockReadFile.mockResolvedValueOnce(
      '# RepoMap\n\n- [[src/auth]] — exports: oldSignature\n'
    );

    await startMcpServer(VAULT_DIR, SOURCE_DIR);
    const handler = capturedTools['sync_file_context'];
    await handler({ filename: FILENAME });

    const [, repoMapContent] = mockWriteFile.mock.calls[1] as [string, string, string];
    // Stale signature replaced
    expect(repoMapContent).not.toContain('oldSignature');
    expect(repoMapContent).toContain('[[src/auth]]');
  });

  it('preserves existing concepts: [Auth] when re-syncing', async () => {
    vi.mocked(parseFile).mockResolvedValueOnce(MOCK_PARSE_RESULT);
    vi.mocked(formatVaultNote).mockImplementationOnce(
      (p: ParseResult) => `---\ntgt: x\nconcepts: [${(p.concepts ?? []).join(', ')}]\n---`
    );
    // First readFile: existing vault note with concepts
    const existingNote = [
      '---',
      'tgt: src/auth.ts',
      'concepts: [Auth]',
      '---',
    ].join('\n');
    mockReadFile.mockResolvedValueOnce(existingNote);
    // Second readFile: RepoMap
    mockReadFile.mockResolvedValueOnce('# RepoMap\n');

    await startMcpServer(VAULT_DIR, SOURCE_DIR);
    const handler = capturedTools['sync_file_context'];
    await handler({ filename: FILENAME });

    // formatVaultNote received parsed with concepts: ['Auth']
    const call = vi.mocked(formatVaultNote).mock.calls[0];
    const passed = call[0] as ParseResult;
    expect(passed.concepts).toEqual(['Auth']);

    // Vault note written with concepts preserved
    const [, noteContent] = mockWriteFile.mock.calls[0] as [string, string, string];
    expect(noteContent).toContain('concepts: [Auth]');
  });

  it('returns ENOENT error when the source file does not exist', async () => {
    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    vi.mocked(parseFile).mockRejectedValueOnce(enoent);

    await startMcpServer(VAULT_DIR, SOURCE_DIR);
    const handler = capturedTools['sync_file_context'];
    const result = (await handler({ filename: FILENAME })) as {
      content: Array<{ type: string; text: string }>;
    };

    expect(result.content[0].text).toContain(`File not found: ${FILENAME}`);
    // writeFile must not have been called
    expect(mockWriteFile).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// read_tests_for_file
// ---------------------------------------------------------------------------

describe('read_tests_for_file', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteFile.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);
    for (const key of Object.keys(capturedTools)) {
      delete capturedTools[key];
    }
  });

  it('returns error when sourceDir is not configured', async () => {
    await startMcpServer(VAULT_DIR); // no sourceDir
    const handler = capturedTools['read_tests_for_file'];
    const result = (await handler({ filename: 'src/auth.ts' })) as {
      content: Array<{ type: string; text: string }>;
    };
    expect(result.content[0].text).toContain('Source directory not configured');
  });

  it('returns test file content when first candidate is found', async () => {
    const testContent = `import { describe, it } from 'vitest';`;
    mockReadFile.mockResolvedValueOnce(testContent);

    await startMcpServer(VAULT_DIR, SOURCE_DIR);
    const handler = capturedTools['read_tests_for_file'];
    const result = (await handler({ filename: 'src/auth.ts' })) as {
      content: Array<{ type: string; text: string }>;
    };

    expect(result.content[0].text).toContain(testContent);
    expect(result.content[0].text).toContain('auth.test.ts');
  });

  it('tries subsequent candidates when first is missing', async () => {
    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    const testContent = `describe('auth', () => {});`;
    // First candidate (auth.test.ts) fails; second (auth.spec.ts) succeeds
    mockReadFile
      .mockRejectedValueOnce(enoent)
      .mockResolvedValueOnce(testContent);

    await startMcpServer(VAULT_DIR, SOURCE_DIR);
    const handler = capturedTools['read_tests_for_file'];
    const result = (await handler({ filename: 'src/auth.ts' })) as {
      content: Array<{ type: string; text: string }>;
    };

    expect(result.content[0].text).toContain(testContent);
  });

  it('returns not-found message when no candidate exists', async () => {
    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    // All candidates fail
    mockReadFile.mockRejectedValue(enoent);

    await startMcpServer(VAULT_DIR, SOURCE_DIR);
    const handler = capturedTools['read_tests_for_file'];
    const result = (await handler({ filename: 'src/auth.ts' })) as {
      content: Array<{ type: string; text: string }>;
    };

    expect(result.content[0].text).toContain('No test file found');
    expect(result.content[0].text).toContain('src/auth.ts');
  });
});

// ---------------------------------------------------------------------------
// getTestFileCandidates (pure unit tests — no IO)
// ---------------------------------------------------------------------------

describe('getTestFileCandidates', () => {
  it('generates .test.ts as first candidate for a .ts file', () => {
    const candidates = getTestFileCandidates('src/auth.ts');
    expect(candidates[0]).toBe('src/auth.test.ts');
  });

  it('generates .spec.ts as second candidate', () => {
    const candidates = getTestFileCandidates('src/auth.ts');
    expect(candidates[1]).toBe('src/auth.spec.ts');
  });

  it('generates __tests__ candidate', () => {
    const candidates = getTestFileCandidates('src/auth.ts');
    expect(candidates).toContain('src/__tests__/auth.test.ts');
  });

  it('generates test_*.py as first candidate for a .py file', () => {
    const candidates = getTestFileCandidates('src/auth.py');
    expect(candidates[0]).toBe('src/test_auth.py');
  });

  it('generates tests/ candidate for Python', () => {
    const candidates = getTestFileCandidates('src/auth.py');
    expect(candidates).toContain('tests/test_auth.py');
  });

  it('returns empty array for unsupported extension', () => {
    expect(getTestFileCandidates('src/styles.css')).toHaveLength(0);
  });

  it('handles files without a directory prefix', () => {
    const candidates = getTestFileCandidates('auth.ts');
    expect(candidates[0]).toBe('auth.test.ts');
  });
});
